function registerAdminConsumptionRoutes({
  app,
  provider,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  // 本次在线的消费明细（会话级，账号重启即清零）
  app.get("/api/consumption-records", async (req, res) => {
    const accountId = getAccountIdFromRequest(req);
    if (!accountId) return res.status(400).json({ ok: false, error: "Missing x-account-id" });
    if (!canAccessAccount(req, accountId)) {
      return res.status(403).json({ ok: false, error: "无权访问此账号" });
    }

    try {
      const result = await provider.getConsumptionRecords(accountId);
      res.json({ ok: true, data: result?.records || [] });
    } catch (error) {
      sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminConsumptionRoutes };
