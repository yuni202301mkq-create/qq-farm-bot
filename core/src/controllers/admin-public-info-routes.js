const fs = require("node:fs");
const path = require("node:path");
const process = require("node:process");
const fetch = require("node-fetch");
const { version } = require("../../package.json");
const { getRuntimeConfig } = require("../config/config");
const { getDataFile } = require("../config/runtime-paths");
const { getSchedulerRegistrySnapshot } = require("../services/scheduler");

// 本地更新日志优先：直接编辑这些文件即可修改弹窗内容，不必依赖 Gitee
// 1) core/UPDATE_LOG.md（源码开发用） 2) data/UPDATE_LOG.md（打包运行后可写目录）
const LOCAL_CHANGELOG_FILES = [
  path.join(__dirname, "..", "..", "UPDATE_LOG.md"),
  getDataFile("UPDATE_LOG.md"),
];
// 本地文件都不存在或为空时的兜底来源
const CHANGELOG_URL = "https://gitee.com/xlzcandy/qq-classic-farm-update-log/raw/master/README.md";

function readLocalChangelog() {
  for (const file of LOCAL_CHANGELOG_FILES) {
    try {
      if (fs.existsSync(file)) {
        const text = fs.readFileSync(file, "utf-8");
        if (text.trim())
          return text;
      }
    }
    catch {
      void 0;
    }
  }
  return "";
}
const SCHEDULER_UNSUPPORTED_MESSAGE = "DataProvider does not support scheduler status";

function registerAdminPublicInfoRoutes({
  app,
  provider,
  store,
  getAccountIdFromRequest,
  canAccessAccount,
  sendProviderError,
}) {
  app.get("/api/ping", (req, res) => {
    res.json({
      ok: true,
      data: { ok: true, uptime: process.uptime(), version },
    });
  });

  app.get("/api/game-version", (req, res) => {
    const runtimeConfig = getRuntimeConfig();
    res.json({ ok: true, clientVersion: runtimeConfig.clientVersion });
  });

  app.get("/api/changelog", async (req, res) => {
    const localChangelog = readLocalChangelog();
    if (localChangelog)
      return res.json({ ok: true, data: localChangelog, source: "local" });

    try {
      const response = await fetch(CHANGELOG_URL);
      if (!response.ok)
        return res.status(500).json({ ok: false, error: "获取更新日志失败" });

      const data = await response.text();
      res.json({ ok: true, data, source: "remote" });
    }
    catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });

  app.get("/api/auth/validate", (req, res) => {
    res.json({ ok: true, data: { valid: true } });
  });

  app.get("/api/scheduler", async (req, res) => {
    try {
      const accountId = getAccountIdFromRequest(req);
      if (accountId && !canAccessAccount(req, accountId))
        return res.status(403).json({ ok: false, error: "无权访问此账号" });

      if (provider && typeof provider.getSchedulerStatus === "function") {
        const status = await provider.getSchedulerStatus(accountId);
        return res.json({ ok: true, data: status });
      }

      return res.json({
        ok: true,
        data: {
          runtime: getSchedulerRegistrySnapshot(),
          worker: null,
          workerError: SCHEDULER_UNSUPPORTED_MESSAGE,
        },
      });
    }
    catch (error) {
      return sendProviderError(res, error);
    }
  });
}

module.exports = { registerAdminPublicInfoRoutes };
