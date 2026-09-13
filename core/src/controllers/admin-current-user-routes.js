function requireCurrentUser(req, res) {
  const currentUser = req.currentUser;
  if (!currentUser) {
    res.status(401).json({ ok: false, error: "未登录" });
    return null;
  }
  return currentUser;
}

function registerAdminCurrentUserRoutes({
  app,
  requireAdminToken,
  userStore,
  store,
  updateAdminSessions,
  refreshTokens,
}) {
  app.get("/api/user/me", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      // 强制改密标记以用户档案为准，避免会话快照在改密后仍是旧值
      const profile = userStore.findUser(currentUser.username);
      res.json({
        ok: true,
        data: {
          username: currentUser.username,
          role: currentUser.role,
          card: currentUser.card,
          accountLimit:
            currentUser.accountLimit || userStore.DEFAULT_ACCOUNT_LIMIT || 2,
          expiresAt: currentUser.expiresAt || null,
          mustChangePassword: profile ? profile.mustChangePassword === true : false,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 修改自己的密码
  app.post("/api/user/change-password", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const { oldPassword, newPassword } = req.body || {};
      if (!userStore.verifyPassword(currentUser.username, oldPassword)) {
        return res.status(400).json({ ok: false, error: "原密码错误" });
      }
      if (!newPassword || String(newPassword).length < 6) {
        return res.status(400).json({ ok: false, error: "新密码至少 6 位" });
      }
      if (String(newPassword) === String(oldPassword)) {
        return res.status(400).json({ ok: false, error: "新密码不能与原密码相同" });
      }
      const updated = userStore.updateUser(currentUser.username, { password: newPassword });
      // 同步会话快照：updateUser 已清掉 mustChangePassword，这里保持一致
      if (typeof updateAdminSessions === "function") {
        updateAdminSessions(
          session => session.username === updated.username,
          session => Object.assign(session, { mustChangePassword: false }),
        );
      }
      // 改密后作废该账号的长期 refresh token：其它设备（以及泄露的旧 token）
      // 无法再换出 session，必须重新登录
      if (refreshTokens && typeof refreshTokens.revokeUser === "function") {
        refreshTokens.revokeUser(updated.username);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 查询卡密信息（不消耗，仅查看可用性/天数/额度）
  app.post("/api/user/card-inspect", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const { cardKey } = req.body || {};
      const key = userStore.findCardKey(cardKey);
      if (!key) {
        return res.status(400).json({ ok: false, error: "卡密不存在，请检查后重新输入" });
      }
      if (key.usedBy) {
        return res.status(400).json({ ok: false, error: "该卡密已被使用" });
      }
      res.json({
        ok: true,
        data: {
          code: key.code,
          days: key.days,
          accountLimit: key.accountLimit,
          note: key.note || "",
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  // 使用卡密：为当前登录账号续期并/或增加账号额度
  app.post("/api/user/card-redeem", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      if (currentUser.role === "super_admin") {
        return res
          .status(400)
          .json({ ok: false, error: "超级管理员无需使用卡密" });
      }

      const { cardKey } = req.body || {};
      const key = userStore.findCardKey(cardKey);
      if (!key) {
        return res.status(400).json({ ok: false, error: "卡密不存在，请检查后重新输入" });
      }
      if (key.usedBy) {
        return res.status(400).json({ ok: false, error: "该卡密已被使用" });
      }

      userStore.consumeCardKey(key.code, currentUser.username);
      const before = userStore.findUser(currentUser.username);
      let updated = before;
      if (key.days > 0) {
        updated = userStore.extendUserExpiry(currentUser.username, key.days);
      }
      if (key.accountLimit > 0) {
        updated = userStore.updateUser(currentUser.username, {
          accountLimit: (before.accountLimit || 0) + key.accountLimit,
        });
      }

      // 同步会话快照，避免 /api/user/me 等接口读到旧额度/旧有效期
      if (typeof updateAdminSessions === "function") {
        const fresh = userStore.findUser(currentUser.username);
        if (fresh) {
          updateAdminSessions(
            (session) => session.username === currentUser.username,
            (session) => Object.assign(session, fresh),
          );
        }
      }

      res.json({
        ok: true,
        data: {
          code: key.code,
          days: key.days,
          accountLimitAdded: key.accountLimit,
          accountLimit: updated.accountLimit,
          expiresAt: updated.expiresAt || null,
        },
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.post("/api/user/device-protocol", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      const config = store.setUserDeviceProtocol(
        req.body || {},
        currentUser.username,
      );
      res.json({ ok: true, config });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/user/device-protocol", requireAdminToken, (req, res) => {
    try {
      const currentUser = requireCurrentUser(req, res);
      if (!currentUser) return;

      res.json({
        ok: true,
        config: store.getUserDeviceProtocol(currentUser.username),
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerAdminCurrentUserRoutes };
