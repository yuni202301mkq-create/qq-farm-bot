function getAccountOrRespond(req, res, { getAccountIdFromRequest, canAccessAccount }) {
  const accountId = getAccountIdFromRequest(req);
  if (!accountId) {
    res.status(400).json({ ok: false, error: "Missing accountId" });
    return null;
  }
  if (!canAccessAccount(req, accountId)) {
    res.status(403).json({ ok: false, error: "无权访问此账号" });
    return null;
  }
  return accountId;
}

function getSeedLocks(store, accountId) {
  return store.getSeedLocks ? store.getSeedLocks(accountId) : [];
}

function setSeedLocks({ store, accountId, seedIds }) {
  return store.setSeedLocks(accountId, seedIds || []);
}

function registerAdminSeedLockRoutes({
  app,
  store,
  requireAdminToken,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  const access = { getAccountIdFromRequest, canAccessAccount };

  // 查询锁定列表
  app.get("/api/seed-locks", requireAdminToken, (req, res) => {
    try {
      const accountId = getAccountOrRespond(req, res, access);
      if (!accountId) return;

      res.json({ ok: true, data: getSeedLocks(store, accountId) });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 整体覆盖锁定列表（支持单个 / 批量 锁定与解锁）
  app.put("/api/seed-locks", requireAdminToken, (req, res) => {
    try {
      const accountId = getAccountOrRespond(req, res, access);
      if (!accountId) return;

      const seedIds = (req.body || {}).seedIds;
      if (!Array.isArray(seedIds)) {
        return res
          .status(400)
          .json({ ok: false, error: "seedIds must be an array" });
      }

      const data = setSeedLocks({ store, accountId, seedIds });
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 追加锁定（单个或批量）
  app.post("/api/seed-locks", requireAdminToken, (req, res) => {
    try {
      const accountId = getAccountOrRespond(req, res, access);
      if (!accountId) return;

      const body = req.body || {};
      const seedIds = Array.isArray(body.seedIds)
        ? body.seedIds
        : body.seedId !== undefined
          ? [body.seedId]
          : [];
      if (!seedIds.length) {
        return res.status(400).json({ ok: false, error: "Missing seedIds" });
      }

      const next = [
        ...new Set([
          ...getSeedLocks(store, accountId),
          ...seedIds.map(Number).filter((id) => Number.isFinite(id) && id > 0),
        ]),
      ];
      const data = setSeedLocks({ store, accountId, seedIds: next });
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });

  // 解锁（单个或批量；不传 seedIds 则全部解锁）
  app.delete("/api/seed-locks", requireAdminToken, (req, res) => {
    try {
      const accountId = getAccountOrRespond(req, res, access);
      if (!accountId) return;

      const seedIds = (req.body || {}).seedIds;
      if (!Array.isArray(seedIds) || !seedIds.length) {
        const data = setSeedLocks({ store, accountId, seedIds: [] });
        return res.json({ ok: true, data });
      }

      const removeSet = new Set(
        seedIds.map(Number).filter((id) => Number.isFinite(id) && id > 0),
      );
      const next = getSeedLocks(store, accountId).filter(
        (id) => !removeSet.has(id),
      );
      const data = setSeedLocks({ store, accountId, seedIds: next });
      res.json({ ok: true, data });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminSeedLockRoutes };
