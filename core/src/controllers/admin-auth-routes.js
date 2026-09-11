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

function registerAdminAuthRoutes({ app, createAdminSession, updateAdminSessions }) {
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
}

module.exports = { registerAdminAuthRoutes };
