const crypto = require('node:crypto');
const userStore = require('../models/user-store');

function buildSessionUser(user) {
  return {
    username: user.username,
    role: user.role,
    card: user.card || null,
    accountLimit: user.accountLimit,
    expiresAt: user.expiresAt || null,
    mustChangePassword: false,
  };
}

function sendSession(res, createAdminSession, user) {
  const sessionUser = buildSessionUser(user);
  const token = createAdminSession(sessionUser);
  return res.json({
    ok: true,
    data: {
      token,
      role: sessionUser.role,
      card: sessionUser.card,
      accountLimit: sessionUser.accountLimit,
      expiresAt: sessionUser.expiresAt,
      user: { username: sessionUser.username },
      mustChangePassword: false,
    },
  });
}

// 找回密码失败尝试限制：同一来源 + 用户名 10 分钟内最多 5 次，超出锁定 10 分钟
const FORGOT_ATTEMPT_LIMIT = 5;
const FORGOT_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const FORGOT_LOCKOUT_MS = 10 * 60 * 1000;
const FORGOT_ATTEMPT_MAX_KEYS = 5000;

// 两步找回：卡密验证通过后发放的短期重置凭据（内存态，重启即失效）
const FORGOT_RESET_TOKEN_TTL_MS = 5 * 60 * 1000;
const FORGOT_RESET_TOKEN_MAX = 1000;

function registerAdminAuthRoutes({ app, createAdminSession, updateAdminSessions, invalidateAdminSessions }) {
  const forgotAttempts = new Map();

  function normalizeClientAddress(address) {
    // IPv4-mapped IPv6 归一化，避免 ::ffff:1.2.3.4 和 1.2.3.4 变成两个互不影响的桶。
    // 取不到地址时返回空字符串，由调用方决定是拒绝还是兜底，不能统一成 'unknown' 共享同一个桶
    return String(address ?? '').trim().toLowerCase().replace(/^::ffff:/, '');
  }

  function forgotAttemptKey(req, username) {
    // 必须用 TCP 对端地址而不是 req.ip：项目开启了 trust proxy，
    // req.ip 取自客户端可控的 X-Forwarded-For，伪造即可绕过失败锁定
    return `${normalizeClientAddress(req.socket?.remoteAddress)}::${String(username || '').trim().toLowerCase()}`;
  }

  function pruneForgotAttempts(now) {
    for (const [key, attempt] of forgotAttempts.entries()) {
      const windowExpired = now - attempt.firstAt > FORGOT_ATTEMPT_WINDOW_MS;
      const lockExpired = !attempt.lockUntil || attempt.lockUntil <= now;
      if (windowExpired && lockExpired) forgotAttempts.delete(key);
    }
    if (forgotAttempts.size <= FORGOT_ATTEMPT_MAX_KEYS) return;
    // 兜底：仍超上限时丢弃最早的一批，避免来源被伪造时内存无限增长
    const overflow = forgotAttempts.size - FORGOT_ATTEMPT_MAX_KEYS;
    const oldestFirst = [...forgotAttempts.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt);
    for (let i = 0; i < overflow; i += 1) forgotAttempts.delete(oldestFirst[i][0]);
  }

  function forgotLockRemainingMs(key) {
    const attempt = forgotAttempts.get(key);
    if (!attempt || !attempt.lockUntil) return 0;
    return Math.max(0, attempt.lockUntil - Date.now());
  }

  function recordForgotFailure(key) {
    const now = Date.now();
    pruneForgotAttempts(now);
    const attempt = forgotAttempts.get(key);
    if (!attempt || now - attempt.firstAt > FORGOT_ATTEMPT_WINDOW_MS) {
      forgotAttempts.set(key, { firstAt: now, count: 1, lockUntil: 0 });
      return;
    }
    attempt.count += 1;
    if (attempt.count >= FORGOT_ATTEMPT_LIMIT) {
      attempt.lockUntil = now + FORGOT_LOCKOUT_MS;
    }
    forgotAttempts.set(key, attempt);
  }

  function clearForgotFailures(key) {
    forgotAttempts.delete(key);
  }

  /** 卡密是否曾被该用户使用（注册卡在用户档案，续费卡记录在卡密库 usedBy） */
  function isCardBoundToUser(code, username) {
    const key = userStore.findCardKey(code);
    return Boolean(key && key.usedBy === username);
  }

  // ============ 两步找回密码（步骤 1 验证卡密 → 步骤 2 设置新密码） ============
  const forgotResetTokens = new Map();

  function pruneForgotResetTokens(now) {
    for (const [token, entry] of forgotResetTokens.entries()) {
      if (entry.expiresAt <= now)
        forgotResetTokens.delete(token);
    }
    if (forgotResetTokens.size <= FORGOT_RESET_TOKEN_MAX)
      return;
    // 兜底清理最旧的一批，避免内存无限增长
    const overflow = forgotResetTokens.size - FORGOT_RESET_TOKEN_MAX;
    const oldestFirst = [...forgotResetTokens.entries()].sort((a, b) => a.expiresAt - b.expiresAt);
    for (let i = 0; i < overflow; i += 1) forgotResetTokens.delete(oldestFirst[i][0]);
  }

  function issueForgotResetToken(username) {
    const now = Date.now();
    pruneForgotResetTokens(now);
    const expiresAt = now + FORGOT_RESET_TOKEN_TTL_MS;
    const token = crypto.randomBytes(32).toString('hex');
    forgotResetTokens.set(token, { username, expiresAt });
    return { token, expiresAt };
  }

  /** 一次性消费重置凭据；不存在或已过期返回 null */
  function consumeForgotResetToken(token) {
    const key = String(token || '');
    const entry = forgotResetTokens.get(key);
    if (!entry || entry.expiresAt <= Date.now())
      return null;
    forgotResetTokens.delete(key);
    return entry;
  }

  /** 通过卡密反查绑定账号：注册卡记录在用户档案 card，续费卡记录在卡密库 usedBy */
  function findUserByCardCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    if (!normalized)
      return null;
    const byProfile = userStore.getAllUsers().find(
      user => user.role !== 'super_admin' && String(user.card || '').trim().toUpperCase() === normalized,
    );
    if (byProfile)
      return byProfile;
    const key = userStore.findCardKey(normalized);
    if (!key || !key.usedBy)
      return null;
    const bound = userStore.findUser(key.usedBy);
    if (!bound || bound.role === 'super_admin')
      return null;
    return bound;
  }

  // 两步流程里没有用户名可挂，失败桶固定挂在来源地址上，防止换卡密/换 token 绕开锁定
  function forgotVerifyAttemptKey(req) {
    return `${normalizeClientAddress(req.socket?.remoteAddress)}::@card-verify`;
  }

  // 兼容旧客户端：不再自动发放会话，必须走登录
  app.post('/api/auto-login', (_req, res) => {
    res.status(401).json({ ok: false, error: '请先登录' });
  });

  // 登录：超级管理员 / 普通用户通用
  app.post('/api/login', (req, res) => {
    try {
      const { username, password } = req.body || {};
      const user = userStore.verifyPassword(username, password);
      if (!user) {
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
      }
      if (user.disabled) {
        return res.status(403).json({ ok: false, error: '账号已被禁用，请联系管理员' });
      }
      if (userStore.isUserExpired(user)) {
        return res.status(403).json({ ok: false, error: '账号已过期，请使用卡密续费后重新登录' });
      }
      return sendSession(res, createAdminSession, user);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 注册普通用户（需要卡密）
  app.post('/api/register', (req, res) => {
    try {
      const { username, password, cardKey } = req.body || {};
      if (!userStore.usernameValid(username)) {
        return res.status(400).json({ ok: false, error: '用户名需为 2-24 位字母、数字、下划线或中文' });
      }
      if (!password || String(password).length < 6) {
        return res.status(400).json({ ok: false, error: '密码至少 6 位' });
      }
      // 先校验用户名可用，避免卡密被无谓消耗
      if (userStore.findUser(username)) {
        return res.status(400).json({ ok: false, error: '用户名已存在' });
      }
      const key = userStore.consumeCardKey(cardKey, username);
      const expiresAt = Date.now() + Number(key.days) * 24 * 60 * 60 * 1000;
      const user = userStore.createUser({
        username,
        password,
        role: 'user',
        card: key.code,
        accountLimit: key.accountLimit,
        expiresAt,
      });
      return sendSession(res, createAdminSession, user);
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 卡密续费
  app.post('/api/renew', (req, res) => {
    try {
      const { username, cardKey } = req.body || {};
      const user = userStore.findUser(username);
      if (!user) {
        return res.status(404).json({ ok: false, error: '用户不存在' });
      }
      if (user.role === 'super_admin') {
        return res.status(400).json({ ok: false, error: '超级管理员无需续费' });
      }
      const key = userStore.consumeCardKey(cardKey, username);
      const addMs = Number(key.days) * 24 * 60 * 60 * 1000;
      const base = user.expiresAt && user.expiresAt > Date.now() ? user.expiresAt : Date.now();
      // 天数与额度都要生效，和应用内续费（/api/user/card-redeem）保持一致
      const currentLimit = Number(user.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2);
      const updated = userStore.updateUser(username, {
        expiresAt: base + addMs,
        accountLimit: currentLimit + Number(key.accountLimit || 0),
      });
      // 同步该用户的在线会话，额度/有效期立即生效
      if (typeof updateAdminSessions === 'function') {
        updateAdminSessions(
          session => session.username === updated.username,
          session => Object.assign(session, updated),
        );
      }
      return res.json({
        ok: true,
        data: {
          username: updated.username,
          expiresAt: updated.expiresAt,
          accountLimit: updated.accountLimit,
          accountLimitAdded: key.accountLimit,
          cardKey: key.code,
          days: key.days,
        },
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 注册前免费领取试用卡密：同一来源地址只能领一次
  app.post('/api/free-card', (req, res) => {
    try {
      const { username } = req.body || {};
      // 与找回密码限流一致：用 TCP 对端地址，req.ip 可被 X-Forwarded-For 伪造
      const address = normalizeClientAddress(req.socket?.remoteAddress);
      const card = userStore.claimFreeCard({ address, username });
      return res.json({
        ok: true,
        data: {
          cardKey: card.code,
          days: card.days,
          accountLimit: card.accountLimit,
        },
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 找回密码：凭账号绑定的卡密验证身份，自助重置登录密码
  app.post('/api/forgot-password', (req, res) => {
    try {
      const { cardKey, newPassword } = req.body || {};
      const name = String(req.body?.username || '').trim();
      const code = String(cardKey || '').trim().toUpperCase();
      const attemptKey = forgotAttemptKey(req, name);

      const lockedMs = forgotLockRemainingMs(attemptKey);
      if (lockedMs > 0) {
        const minutes = Math.max(1, Math.ceil(lockedMs / 60000));
        return res.status(429).json({ ok: false, error: `尝试次数过多，请约 ${minutes} 分钟后再试` });
      }
      if (!name || !code || !newPassword) {
        return res.status(400).json({ ok: false, error: '请填写用户名、绑定卡密和新密码' });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ ok: false, error: '新密码至少 6 位' });
      }

      const user = userStore.findUser(name);
      // 统一报错，不暴露用户名是否存在或账号状态
      const identityMatched = Boolean(
        user
          && user.role !== 'super_admin'
          && (String(user.card || '').trim().toUpperCase() === code || isCardBoundToUser(code, name)),
      );
      if (!identityMatched) {
        recordForgotFailure(attemptKey);
        return res.status(400).json({ ok: false, error: '用户名或绑定卡密不匹配' });
      }

      clearForgotFailures(attemptKey);
      userStore.updateUser(user.username, { password: newPassword });
      // 重置后踢掉该账号的在线会话，必须用新密码重新登录
      if (typeof invalidateAdminSessions === 'function') {
        invalidateAdminSessions(session => session.username === user.username);
      }
      return res.json({ ok: true, data: { username: user.username } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 找回密码（两步式）步骤 1/2：验证卡密，返回绑定账号与 5 分钟内有效的重置凭据
  app.post('/api/forgot-password/verify', (req, res) => {
    try {
      const code = String(req.body?.cardKey || '').trim().toUpperCase();
      const attemptKey = forgotVerifyAttemptKey(req);
      const lockedMs = forgotLockRemainingMs(attemptKey);
      if (lockedMs > 0) {
        const minutes = Math.max(1, Math.ceil(lockedMs / 60000));
        return res.status(429).json({ ok: false, error: `尝试次数过多，请约 ${minutes} 分钟后再试` });
      }
      if (!code) {
        return res.status(400).json({ ok: false, error: '请输入卡密' });
      }
      const user = findUserByCardCode(code);
      if (!user) {
        recordForgotFailure(attemptKey);
        // 统一报错：不区分「卡密不存在 / 未绑定账号 / 账号被禁用」，避免被用来探测
        return res.status(400).json({ ok: false, error: '卡密不正确或未绑定任何账号' });
      }
      clearForgotFailures(attemptKey);
      const { token, expiresAt } = issueForgotResetToken(user.username);
      return res.json({
        ok: true,
        data: {
          username: user.username,
          resetToken: token,
          expiresInSec: Math.max(1, Math.round((expiresAt - Date.now()) / 1000)),
        },
      });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 找回密码（两步式）步骤 2/2：凭重置凭据设置新密码（凭据一次性，5 分钟有效）
  app.post('/api/forgot-password/reset', (req, res) => {
    try {
      const { resetToken, newPassword } = req.body || {};
      const attemptKey = forgotVerifyAttemptKey(req);
      const lockedMs = forgotLockRemainingMs(attemptKey);
      if (lockedMs > 0) {
        const minutes = Math.max(1, Math.ceil(lockedMs / 60000));
        return res.status(429).json({ ok: false, error: `尝试次数过多，请约 ${minutes} 分钟后再试` });
      }
      if (!resetToken || !newPassword) {
        return res.status(400).json({ ok: false, error: '重置凭据已失效，请重新验证卡密' });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ ok: false, error: '新密码至少 6 位' });
      }
      const entry = consumeForgotResetToken(resetToken);
      if (!entry) {
        recordForgotFailure(attemptKey);
        return res.status(400).json({ ok: false, error: '重置凭据已失效，请重新验证卡密' });
      }
      const user = userStore.findUser(entry.username);
      if (!user || user.role === 'super_admin') {
        return res.status(400).json({ ok: false, error: '账号不存在或无权重置，请重新验证卡密' });
      }
      clearForgotFailures(attemptKey);
      userStore.updateUser(user.username, { password: newPassword });
      // 重置后踢掉该账号的在线会话，必须用新密码重新登录
      if (typeof invalidateAdminSessions === 'function') {
        invalidateAdminSessions(session => session.username === user.username);
      }
      return res.json({ ok: true, data: { username: user.username } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminAuthRoutes };
