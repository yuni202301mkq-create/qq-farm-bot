const userStore = require('../models/user-store');

function formatDate(ms) {
  if (!ms) return '永久';
  const d = new Date(Number(ms));
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function serializeKey(key) {
  return {
    ...key,
    used: Boolean(key.usedBy),
    createdAtText: formatDate(key.createdAt),
    usedAtText: key.usedAt ? formatDate(key.usedAt) : '',
  };
}

function registerAdminCardKeyRoutes({
  app,
  requireAdminToken,
  requireSuperAdminRole,
  invalidateAdminSessions,
  updateAdminSessions,
}) {
  // 卡密列表
  app.get('/api/card-keys', requireAdminToken, requireSuperAdminRole, (_req, res) => {
    try {
      res.json({ ok: true, data: userStore.listCardKeys().map(serializeKey) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 批量生成卡密
  app.post('/api/card-keys/generate', requireAdminToken, requireSuperAdminRole, (req, res) => {
    try {
      const { count, days, accountLimit, note } = req.body || {};
      const created = userStore.createCardKeys({ count, days, accountLimit, note });
      res.json({ ok: true, data: created.map(serializeKey) });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 删除未使用的卡密
  app.delete('/api/card-keys/:code', requireAdminToken, requireSuperAdminRole, (req, res) => {
    try {
      userStore.deleteCardKey(req.params.code);
      res.json({ ok: true, data: userStore.listCardKeys().map(serializeKey) });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 免费试用卡密领取记录
  app.get('/api/free-card-claims', requireAdminToken, requireSuperAdminRole, (_req, res) => {
    try {
      res.json({
        ok: true,
        data: userStore.listFreeCardClaims().map(claim => ({
          ...claim,
          claimedAtText: formatDate(claim.claimedAt),
        })),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 清除领取记录：带 address 只清该来源，不带则清空全部
  app.post('/api/free-card-claims/reset', requireAdminToken, requireSuperAdminRole, (req, res) => {
    try {
      const { address } = req.body || {};
      const remaining = userStore.resetFreeCardClaims(address);
      res.json({
        ok: true,
        data: remaining.map(claim => ({ ...claim, claimedAtText: formatDate(claim.claimedAt) })),
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 用户列表
  app.get('/api/users', requireAdminToken, requireSuperAdminRole, (_req, res) => {
    try {
      const users = userStore.getAllUsers().map(user => ({
        ...user,
        expired: userStore.isUserExpired(user),
        expiresAtText: formatDate(user.expiresAt),
        createdAtText: formatDate(user.createdAt),
      }));
      res.json({ ok: true, data: users });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 重置用户密码
  app.post('/api/users/:username/reset-password', requireAdminToken, requireSuperAdminRole, (req, res) => {
    try {
      const { password } = req.body || {};
      if (!password || String(password).length < 6) {
        return res.status(400).json({ ok: false, error: '新密码至少 6 位' });
      }
      const user = userStore.updateUser(req.params.username, { password });
      // 密码被重置后强制该用户重新登录
      invalidateAdminSessions(session => session.username === user.username);
      res.json({ ok: true, data: user });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 续期 / 修改额度 / 启用禁用
  app.patch('/api/users/:username', requireAdminToken, requireSuperAdminRole, (req, res) => {
    try {
      const body = req.body || {};
      let user;
      if (body.extendDays) {
        user = userStore.extendUserExpiry(req.params.username, body.extendDays);
      }
      const patch = {};
      if (body.accountLimit !== undefined) patch.accountLimit = body.accountLimit;
      if (body.disabled !== undefined) patch.disabled = body.disabled;
      if (Object.keys(patch).length) {
        user = userStore.updateUser(req.params.username, patch);
      }
      if (!user) return res.status(400).json({ ok: false, error: '没有需要更新的字段' });
      // 同步该用户的在线会话快照，额度/有效期立即生效
      if (typeof updateAdminSessions === 'function') {
        updateAdminSessions(
          session => session.username === user.username,
          session => Object.assign(session, user),
        );
      }
      res.json({ ok: true, data: user });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // 删除用户
  app.delete('/api/users/:username', requireAdminToken, requireSuperAdminRole, (req, res) => {
    try {
      const target = String(req.params.username || '');
      userStore.deleteUser(target);
      invalidateAdminSessions(session => session.username === target);
      res.json({ ok: true, data: userStore.getAllUsers() });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminCardKeyRoutes };
