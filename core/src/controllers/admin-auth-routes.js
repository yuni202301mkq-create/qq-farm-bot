const crypto = require('node:crypto');
const userStore = require('../models/user-store');

function buildSessionUser(user) {
  return {
    username: user.username,
    role: user.role,
    card: user.card || null,
    accountLimit: user.accountLimit,
    expiresAt: user.expiresAt || null,
    // 出厂初始口令尚未修改：前端据此强制跳到改密页
    mustChangePassword: user.mustChangePassword === true,
  };
}

function sendSession(res, createAdminSession, user, refreshTokens) {
  const sessionUser = buildSessionUser(user);
  const token = createAdminSession(sessionUser);
  // 长期 refresh token（落盘保存）：bot 重启后前端凭它换一个新的 session token，
  // 这样用户不会每次重启都被踢去重新登录。
  let refreshToken = '';
  if (refreshTokens) {
    try {
      refreshToken = refreshTokens.issue({ username: sessionUser.username }).token;
    } catch {
      // 落盘失败不应该让登录本身失败，退化为「重启后需要重新登录」
      refreshToken = '';
    }
  }
  return res.json({
    ok: true,
    data: {
      token,
      refreshToken,
      role: sessionUser.role,
      card: sessionUser.card,
      accountLimit: sessionUser.accountLimit,
      expiresAt: sessionUser.expiresAt,
      user: { username: sessionUser.username },
      mustChangePassword: sessionUser.mustChangePassword,
    },
  });
}

// 找回密码失败尝试限制：同一来源 + 用户名 10 分钟内最多 5 次，超出锁定 10 分钟
const FORGOT_ATTEMPT_LIMIT = 5;
const FORGOT_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const FORGOT_LOCKOUT_MS = 10 * 60 * 1000;
const FORGOT_ATTEMPT_MAX_KEYS = 5000;

// 登录失败限制：同一来源 + 同一用户名 10 分钟内 5 次即锁定 10 分钟；
// 另设「同一用户名不限来源 20 次」上限，拦住轮换来源地址对单个账号的分布式爆破
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ACCOUNT_LIMIT = 20;
const LOGIN_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_MAX_KEYS = 5000;

// 两步找回：卡密验证通过后发放的短期重置凭据（内存态，重启即失效）
const FORGOT_RESET_TOKEN_TTL_MS = 5 * 60 * 1000;
const FORGOT_RESET_TOKEN_MAX = 1000;

/**
 * 失败尝试计数器：按 key 累计窗口内失败次数，达到上限后锁定一段时间。
 * key 由调用方决定；内置过期清理 + 条数硬上限，避免来源被伪造时内存无限增长。
 */
function createAttemptLimiter({ limit, windowMs, lockoutMs, maxKeys }) {
  const attempts = new Map();

  function prune(now) {
    for (const [key, attempt] of attempts.entries()) {
      const windowExpired = now - attempt.firstAt > windowMs;
      const lockExpired = !attempt.lockUntil || attempt.lockUntil <= now;
      if (windowExpired && lockExpired) attempts.delete(key);
    }
    if (attempts.size <= maxKeys) return;
    // 兜底：仍超上限时丢弃最早的一批
    const overflow = attempts.size - maxKeys;
    const oldestFirst = [...attempts.entries()].sort((a, b) => a[1].firstAt - b[1].firstAt);
    for (let i = 0; i < overflow; i += 1) attempts.delete(oldestFirst[i][0]);
  }

  function lockRemainingMs(key) {
    const attempt = attempts.get(key);
    if (!attempt || !attempt.lockUntil) return 0;
    return Math.max(0, attempt.lockUntil - Date.now());
  }

  function recordFailure(key) {
    const now = Date.now();
    prune(now);
    const attempt = attempts.get(key);
    if (!attempt || now - attempt.firstAt > windowMs) {
      attempts.set(key, { firstAt: now, count: 1, lockUntil: 0 });
      return;
    }
    attempt.count += 1;
    if (attempt.count >= limit) attempt.lockUntil = now + lockoutMs;
    attempts.set(key, attempt);
  }

  function clear(key) {
    attempts.delete(key);
  }

  return { clear, lockRemainingMs, recordFailure };
}

function lockMessage(lockedMs, prefix) {
  const minutes = Math.max(1, Math.ceil(lockedMs / 60000));
  return `${prefix}，请约 ${minutes} 分钟后再试`;
}

function registerAdminAuthRoutes({ app, createAdminSession, updateAdminSessions, invalidateAdminSessions, refreshTokens }) {
  const forgotLimiter = createAttemptLimiter({
    limit: FORGOT_ATTEMPT_LIMIT,
    windowMs: FORGOT_ATTEMPT_WINDOW_MS,
    lockoutMs: FORGOT_LOCKOUT_MS,
    maxKeys: FORGOT_ATTEMPT_MAX_KEYS,
  });
  const loginAddressLimiter = createAttemptLimiter({
    limit: LOGIN_ATTEMPT_LIMIT,
    windowMs: LOGIN_ATTEMPT_WINDOW_MS,
    lockoutMs: LOGIN_LOCKOUT_MS,
    maxKeys: LOGIN_ATTEMPT_MAX_KEYS,
  });
  const loginAccountLimiter = createAttemptLimiter({
    limit: LOGIN_ACCOUNT_LIMIT,
    windowMs: LOGIN_ATTEMPT_WINDOW_MS,
    lockoutMs: LOGIN_LOCKOUT_MS,
    maxKeys: LOGIN_ATTEMPT_MAX_KEYS,
  });

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

  /** 登录失败的两个计数维度：来源+用户名（拦单点爆破）、用户名（拦换 IP 的分布式爆破） */
  function loginAttemptKeys(req, username) {
    const address = normalizeClientAddress(req.socket?.remoteAddress);
    const name = String(username || '').trim().toLowerCase();
    return {
      pairKey: `${address}::${name}`,
      // 用户名为空时没有可归集的账号，不启用账号维度
      accountKey: name ? `@account::${name}` : '',
    };
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
      const { pairKey, accountKey } = loginAttemptKeys(req, username);

      // 先看是否处于锁定期，避免锁定期间仍然消耗 scrypt 算力
      const lockedMs = Math.max(
        loginAddressLimiter.lockRemainingMs(pairKey),
        accountKey ? loginAccountLimiter.lockRemainingMs(accountKey) : 0,
      );
      if (lockedMs > 0)
        return res.status(429).json({ ok: false, error: lockMessage(lockedMs, '登录尝试次数过多') });

      const user = userStore.verifyPassword(username, password);
      if (!user) {
        loginAddressLimiter.recordFailure(pairKey);
        if (accountKey) loginAccountLimiter.recordFailure(accountKey);
        return res.status(401).json({ ok: false, error: '用户名或密码错误' });
      }
      // 密码正确即清空计数，正常用户不会因为历史输错被后续一次失误带进锁定
      loginAddressLimiter.clear(pairKey);
      if (accountKey) loginAccountLimiter.clear(accountKey);

      if (user.disabled) {
        return res.status(403).json({ ok: false, error: '账号已被禁用，请联系管理员' });
      }
      if (userStore.isUserExpired(user)) {
        return res.status(403).json({ ok: false, error: '账号已过期，请使用卡密续费后重新登录' });
      }
      return sendSession(res, createAdminSession, user, refreshTokens);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 用长期 refresh token 换一个新的 session token。
  // 场景：bot 重启后内存里的 session token 全没了，前端拿落盘的 refresh token
  // 静默换一个新的，用户无需重新登录。refresh token 单次使用（用完即轮换）。
  app.post('/api/auth/refresh', (req, res) => {
    try {
      if (!refreshTokens) {
        return res.status(404).json({ ok: false, error: '未启用长期登录，请重新登录' });
      }
      const raw = req.body && req.body.refreshToken;
      if (!raw) {
        return res.status(400).json({ ok: false, error: '缺少 refreshToken' });
      }
      const rotated = refreshTokens.rotate(String(raw));
      if (!rotated) {
        return res.status(401).json({ ok: false, error: '登录已失效，请重新登录' });
      }
      // 重新查一次用户：禁用 / 过期 / 改密后立即生效，而不是沿用旧快照
      const user = userStore.findUser(rotated.username);
      if (!user || user.disabled || userStore.isUserExpired(user)) {
        refreshTokens.revokeUser(rotated.username);
        return res.status(401).json({ ok: false, error: '账号不可用，请重新登录' });
      }
      const sessionUser = buildSessionUser(user);
      const token = createAdminSession(sessionUser);
      return res.json({
        ok: true,
        data: {
          token,
          // 直接复用 rotate 已经签发好的新 refresh token，不重复签发
          refreshToken: rotated.token,
          role: sessionUser.role,
          card: sessionUser.card,
          accountLimit: sessionUser.accountLimit,
          expiresAt: sessionUser.expiresAt,
          user: { username: sessionUser.username },
          mustChangePassword: sessionUser.mustChangePassword,
        },
      });
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
      // 登录前只接受时效卡密；额度账号卡密必须登录后在应用内激活
      const key = userStore.consumeCardKeyBeforeLogin(cardKey, username);
      const expiresAt = Date.now() + Number(key.days) * 24 * 60 * 60 * 1000;
      const user = userStore.createUser({
        username,
        password,
        role: 'user',
        card: key.code,
        // 额度不通过卡密发放：交给 createUser 的默认额度
        expiresAt,
      });
      return sendSession(res, createAdminSession, user, refreshTokens);
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
      // 登录前只接受时效卡密；额度账号卡密必须登录后在应用内激活
      const key = userStore.consumeCardKeyBeforeLogin(cardKey, username);
      const addMs = Number(key.days) * 24 * 60 * 60 * 1000;
      const base = user.expiresAt && user.expiresAt > Date.now() ? user.expiresAt : Date.now();
      // 这里只叠加有效期；账号额度由应用内的 /api/user/card-redeem 处理
      const updated = userStore.updateUser(username, { expiresAt: base + addMs });
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
          cardKey: key.code,
          type: key.type,
          days: key.days,
        },
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 注册前免费领取试用卡密：同一来源地址或同一设备只能领一次
  app.post('/api/free-card', (req, res) => {
    try {
      const { username, deviceId } = req.body || {};
      // 与找回密码限流一致：用 TCP 对端地址，req.ip 可被 X-Forwarded-For 伪造；
      // deviceId 由前端本地持久化生成，作为与 IP 并行的第二个限制维度
      const address = normalizeClientAddress(req.socket?.remoteAddress);
      const card = userStore.claimFreeCard({ address, deviceId, username });
      return res.json({
        ok: true,
        data: {
          cardKey: card.code,
          type: card.type,
          days: card.days,
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

      const lockedMs = forgotLimiter.lockRemainingMs(attemptKey);
      if (lockedMs > 0)
        return res.status(429).json({ ok: false, error: lockMessage(lockedMs, '尝试次数过多') });
      if (!name || !code || !newPassword) {        return res.status(400).json({ ok: false, error: '请填写用户名、绑定卡密和新密码' });
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
        forgotLimiter.recordFailure(attemptKey);
        return res.status(400).json({ ok: false, error: '用户名或绑定卡密不匹配' });
      }

      forgotLimiter.clear(attemptKey);
      userStore.updateUser(user.username, { password: newPassword });
      // 重置后踢掉该账号的在线会话，必须用新密码重新登录
      if (typeof invalidateAdminSessions === 'function') {
        invalidateAdminSessions(session => session.username === user.username);
      }
      // 同时作废该账号的长期 refresh token，否则旧 token 还能换出新的 session
      if (refreshTokens && typeof refreshTokens.revokeUser === 'function') {
        refreshTokens.revokeUser(user.username);
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
      const lockedMs = forgotLimiter.lockRemainingMs(attemptKey);
      if (lockedMs > 0)
        return res.status(429).json({ ok: false, error: lockMessage(lockedMs, '尝试次数过多') });
      if (!code) {
        return res.status(400).json({ ok: false, error: '请输入卡密' });
      }
      const user = findUserByCardCode(code);
      if (!user) {
        forgotLimiter.recordFailure(attemptKey);
        // 统一报错：不区分「卡密不存在 / 未绑定账号 / 账号被禁用」，避免被用来探测
        return res.status(400).json({ ok: false, error: '卡密不正确或未绑定任何账号' });
      }
      forgotLimiter.clear(attemptKey);
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
      const lockedMs = forgotLimiter.lockRemainingMs(attemptKey);
      if (lockedMs > 0)
        return res.status(429).json({ ok: false, error: lockMessage(lockedMs, '尝试次数过多') });
      if (!resetToken || !newPassword) {
        return res.status(400).json({ ok: false, error: '重置凭据已失效，请重新验证卡密' });
      }
      if (String(newPassword).length < 6) {
        return res.status(400).json({ ok: false, error: '新密码至少 6 位' });
      }
      const entry = consumeForgotResetToken(resetToken);
      if (!entry) {
        forgotLimiter.recordFailure(attemptKey);
        return res.status(400).json({ ok: false, error: '重置凭据已失效，请重新验证卡密' });
      }
      const user = userStore.findUser(entry.username);
      if (!user || user.role === 'super_admin') {
        return res.status(400).json({ ok: false, error: '账号不存在或无权重置，请重新验证卡密' });
      }
      forgotLimiter.clear(attemptKey);
      userStore.updateUser(user.username, { password: newPassword });
      // 重置后踢掉该账号的在线会话，必须用新密码重新登录
      if (typeof invalidateAdminSessions === 'function') {
        invalidateAdminSessions(session => session.username === user.username);
      }
      // 同时作废该账号的长期 refresh token，否则旧 token 还能换出新的 session
      if (refreshTokens && typeof refreshTokens.revokeUser === 'function') {
        refreshTokens.revokeUser(user.username);
      }
      return res.json({ ok: true, data: { username: user.username } });
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminAuthRoutes };
