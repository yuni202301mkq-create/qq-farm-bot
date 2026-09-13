/**
 * Admin Panel Controller
 * QQ Farm Automation Bot - 管理面板服务器
 *
 * 提供 Express + Socket.IO 管理面板后端：
 * - 默认管理员会话
 * - 账号管理（增删改查/启动停止/备注）
 * - 农场操作（种植/施肥/铲除/收获）
 * - 好友管理（列表/操作/拉黑）
 * - 商店/图鉴/活动/背包
 * - 系统设置/公告/代理/二维码登录
 * - 实时状态推送（WebSocket）
 */
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { Server: SocketIOServer } = require("socket.io");
const {
  CONFIG,
  updateRuntimeConfig,
  getRuntimeConfig,
  getDefaultSystemConfig,
} = require("../config/config");
const { getDataFile, getResourcePath } = require("../config/runtime-paths");
const store = require("../models/store");
const { addOrUpdateAccount, deleteAccount } = store;
const { findAccountByRef } = require("../services/account-resolver");
const { createModuleLogger } = require("../services/logger");
const { createScheduler } = require("../services/scheduler");
const adminScheduler = createScheduler("admin");
const { registerAdminActivityRoutes } = require("./admin-activity-routes");
const {
  registerAdminAccountRuntimeRoutes,
} = require("./admin-account-runtime-routes");
const { registerAdminAccountRoutes } = require("./admin-account-routes");
const { registerAdminAnalyticsRoutes } = require("./admin-analytics-routes");
const { createAdminAccountAccess } = require("./admin-account-access");
const { registerAdminAuthRoutes } = require("./admin-auth-routes");
const { createAdminRefreshTokenStore } = require("../services/admin-refresh-tokens");
const { registerAdminCardKeyRoutes } = require("./admin-card-key-routes");
const { registerAdminBagRoutes } = require("./admin-bag-routes");
const { registerAdminCareerRoutes } = require("./admin-career-routes");
const { registerAdminConsumptionRoutes } = require("./admin-consumption-routes");
const { registerAdminCaptureRoutes, setEmbeddedCapture } = require("./admin-capture-routes");
const { createCaptureCore } = require("../capture/index");
const { registerAdminCurrentUserRoutes } = require("./admin-current-user-routes");
const {
  registerAdminFarmOperationRoutes,
} = require("./admin-farm-operation-routes");
const {
  registerAdminFarmResourceRoutes,
} = require("./admin-farm-resource-routes");
const { registerAdminFriendRoutes } = require("./admin-friend-routes");
const { registerAdminIllustratedRoutes } = require("./admin-illustrated-routes");
const { registerAdminPetRoutes } = require("./admin-pet-routes");
const {
  registerAdminPlantBlacklistRoutes,
} = require("./admin-plant-blacklist-routes");
const { registerAdminSeedLockRoutes } = require("./admin-seed-lock-routes");
const { registerAdminProxyRoutes } = require("./admin-proxy-routes");
const { registerAdminPublicInfoRoutes } = require("./admin-public-info-routes");
const { registerAdminQrLoginRoutes } = require("./admin-qr-login-routes");
const { registerAdminNapcatLoginRoutes } = require("./admin-napcat-login-routes");
const { createAdminRouteHelpers } = require("./admin-route-helpers");
const { registerAdminSettingsRoutes } = require("./admin-settings-routes");
const { registerAdminShopRoutes } = require("./admin-shop-routes");
const { createAdminSessionManager } = require("./admin-session-manager");
const { registerAdminSystemRoutes } = require("./admin-system-routes");
const {
  createSecurityHeaders,
  permissionsPolicyMiddleware,
  noCacheHtmlMiddleware,
} = require("./security-headers");
const userStore = require("../models/user-store");

const adminLogger = createModuleLogger("admin");
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];
const PUBLIC_API_PATHS = new Set([
  "/login",
  "/auto-login",
  "/qr/create",
  "/qr/check",
  "/game-version",
  "/public/login-links",
  "/changelog",
  "/health",
  // 长期登录：用落盘的 refresh token 换新 session token（此时没有有效 session）
  "/auth/refresh",
]);
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const LOG_SNAPSHOT_LIMIT = 100;
const HTTP_REQUEST_TIMEOUT_MS = 120 * 1000;
const HTTP_HEADERS_TIMEOUT_MS = 16 * 1000;
const HTTP_KEEP_ALIVE_TIMEOUT_MS = 5 * 1000;
const HTTP_CONNECTION_IDLE_TIMEOUT_MS = 30 * 1000;
const HTTP_CLOSE_WAIT_SWEEP_MS = 5000;

let app = null;
let server = null;
let provider = null;
let io = null;
let embeddedCaptureCore = null;

function emitRealtimeStatus(accountId, status) {
  if (!io) return;
  accountId = String(accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("status:update", {
    accountId,
    status,
  });
}

function emitRealtimeLog(logEntry) {
  if (!io) return;
  const safeLogEntry = logEntry && typeof logEntry === "object" ? logEntry : {};
  const accountId = String(safeLogEntry.accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("log:new", safeLogEntry);
}

function emitRealtimeAccountLog(logEntry) {
  if (!io) return;
  const safeLogEntry = logEntry && typeof logEntry === "object" ? logEntry : {};
  const accountId = String(safeLogEntry.accountId || "").trim();
  if (!accountId) return;
  io.to(`account:${  accountId}`).emit("account-log:new", safeLogEntry);
}

function configureCorsMiddleware(expressApp) {
  expressApp.use((req, res, next) => {
    const allowedOrigins = CONFIG.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS;
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
    } else if (!origin) {
      res.header("Access-Control-Allow-Origin", "*");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS, PUT");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, x-account-id, x-admin-token",
    );
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Max-Age", "86400");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    return next();
  });
}

/**
 * Vite 产物文件名带内容哈希，可长期强缓存；
 * 入口 HTML 与未带哈希的文件必须每次回源校验，否则用户会长时间停留在旧版本
 * （表现为「改了代码但手机上还是老界面」）。
 */
const HASHED_ASSET_RE = /[/\\]assets[/\\]/;

function configureStaticAssets(expressApp, webDist) {
  if (fs.existsSync(webDist)) {
    expressApp.use(
      express.static(webDist, {
        setHeaders(res, filePath) {
          const name = path.basename(filePath);
          if (name === "index.html" || !HASHED_ASSET_RE.test(filePath)) {
            res.setHeader("Cache-Control", "no-cache");
            return;
          }
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    return;
  }
  adminLogger.warn("web build not found", { webDist });
  expressApp.get("/", (req, res) =>
    res.send("web build not found. Please build the web project."),
  );
}

function registerAuthGate(expressApp, requireAdminToken) {
  expressApp.use("/api", (req, res, next) => {
    if (
      PUBLIC_API_PATHS.has(req.path)
      || req.path.startsWith("/public/capture-certificate/")
      // 头像代理是 <img> 加载用的，浏览器没法带 x-admin-token，放行
      || req.path.startsWith("/avatar/")
    ) return next();
    return requireAdminToken(req, res, next);
  });
}

function registerLogoutRoute(expressApp, invalidateAdminSessionAndDisconnect, refreshTokens) {
  expressApp.post("/api/logout", (req, res) => {
    const token = req.adminToken;
    if (token) invalidateAdminSessionAndDisconnect(token);
    // 登出时一并作废这个长期 refresh token（前端带上才撤销，避免影响其它设备）
    const rawRefresh = req.body && req.body.refreshToken;
    if (refreshTokens && rawRefresh) refreshTokens.revokeToken(String(rawRefresh));
    res.json({ ok: true });
  });
}

function registerHealthRoute(expressApp) {
  expressApp.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      status: "ok",
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  });
}

// 头像代理：腾讯 qlogo.cn 对非 QQ 来源 Referer 返回 0 字节占位图，
// 直接让浏览器拉会全部变成灰色字母（生产 CSP img-src 也只放行同源）。
// 统一改成后端代理，服务端带 Referer: https://im.qq.com/ 拉真实图片后吐给前端。
// 三种入口：
//   GET /api/avatar/:accountId  按账号 id（账号存的 avatar，或 uin 拼 q1.qlogo.cn 兜底）
//   GET /api/avatar/qq/:uin     按 QQ 号（纯数字校验）
//   GET /api/avatar/u/:urlB64   按 base64url 编码的图片 URL（好友列表等远程 avatarUrl）
// SSRF 护栏：所有入口最终都只放行腾讯头像域，且 URL 只来自服务端数据或白名单域校验。
const AVATAR_PROXY_ALLOWED_HOSTS = new Set([
  "thirdqq.qlogo.cn",
  "thirdwx.qlogo.cn",
  "q1.qlogo.cn",
  "q2.qlogo.cn",
  "q3.qlogo.cn",
  "q4.qlogo.cn",
  "wx.qlogo.cn",
  "qlogo.cn",
]);

async function serveProxiedAvatar(res, url) {
  // SSRF 护栏：只放行腾讯头像域
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    res.status(400).end();
    return;
  }
  if (parsed.protocol !== "https:" || !AVATAR_PROXY_ALLOWED_HOSTS.has(parsed.hostname)) {
    res.status(400).end();
    return;
  }

  // 关键：Referer 必须带 QQ 域，否则腾讯返回 0 字节占位图
  try {
    const upstream = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://im.qq.com/",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const contentType = upstream.headers.get("content-type") || "image/jpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());
    // 0 字节 = 腾讯的占位图（被防盗链挡了），按 502 报回去让前端走 fallback
    if (!buf.length) {
      res.status(502).end();
      return;
    }
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=3600");
    res.set("Access-Control-Allow-Origin", "*");
    res.end(buf);
  } catch {
    res.status(502).end();
  }
}

/** 账号头像 URL：优先账号里存的 avatar；没存但有 QQ 号时用 q1.qlogo.cn 兜底 */
function resolveAccountAvatarUrl(acc) {
  const url = String(acc.avatar || "").trim();
  if (url) return url;
  const qq = String(acc.uin || acc.qq || "").trim();
  if (/^\d+$/.test(qq)) {
    return `https://q1.qlogo.cn/g?b=qq&nk=${qq}&s=100`;
  }
  return "";
}

function registerAvatarProxyRoute(expressApp, provider) {
  expressApp.get("/api/avatar/qq/:uin", (req, res) => {
    const uin = String(req.params.uin || "").trim();
    // 纯数字校验后直接拼 q1.qlogo.cn，不接受任何客户端传入的完整 URL
    if (!/^\d{4,12}$/.test(uin)) {
      res.status(400).end();
      return;
    }
    return serveProxiedAvatar(res, `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=100`);
  });

  expressApp.get("/api/avatar/u/:urlB64", (req, res) => {
    const raw = String(req.params.urlB64 || "");
    let url = "";
    try {
      // base64url（无填充），兼容传入标准 base64
      const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
      url = Buffer.from(b64, "base64").toString("utf-8");
    } catch {
      url = "";
    }
    return serveProxiedAvatar(res, String(url).trim());
  });

  expressApp.get("/api/avatar/:accountId", (req, res) => {
    try {
      const accountId = String(req.params.accountId || "").trim();
      if (!accountId) {
        res.status(400).end();
        return;
      }
      const accounts = provider.getAccounts();
      const acc = (accounts && Array.isArray(accounts.accounts) ? accounts.accounts : [])
        .find((a) => String(a.id) === accountId);
      if (!acc) {
        res.status(404).end();
        return;
      }
      const url = resolveAccountAvatarUrl(acc);
      if (!url) {
        res.status(404).end();
        return;
      }
      return serveProxiedAvatar(res, url);
    } catch {
      res.status(502).end();
    }
  });
}

function registerRequestTimeoutGuard(expressApp) {
  expressApp.use((req, res, next) => {
    if (req.path === "/api/health") return next();

    // 超时后若后续 handler 仍继续执行并再次 res.json/res.send（例如慢速 provider
    // 调用在超时后才返回），直接忽略，避免 ERR_HTTP_HEADERS_SENT 抛错刷屏。
    for (const method of ["json", "send"]) {
      const original = res[method];
      res[method] = function guardedSend(...args) {
        if (res.locals.requestTimedOut && res.headersSent) return res;
        return original.apply(this, args);
      };
    }

    const timeout = setTimeout(() => {
      if (res.headersSent || res.writableEnded || res.destroyed) return;
      res.locals.requestTimedOut = true;
      res.status(503).json({
        ok: false,
        error: "Request Timeout",
      });
    }, HTTP_REQUEST_TIMEOUT_MS);

    res.on("finish", () => clearTimeout(timeout));
    res.on("close", () => clearTimeout(timeout));
    return next();
  });
}

function registerSpaFallback(expressApp, webDist) {
  expressApp.get("*", (req, res) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/game-config")) {
      return res.status(404).json({
        ok: false,
        error: "Not Found",
      });
    }
    if (fs.existsSync(webDist)) {
      return res.sendFile(path.join(webDist, "index.html"), {
        headers: { "Cache-Control": "no-cache" },
      });
    }
    return res
      .status(404)
      .send("web build not found. Please build the web project.");
  });
}

function configureHttpServerTimeouts(httpServer) {
  httpServer.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;
  httpServer.headersTimeout = HTTP_HEADERS_TIMEOUT_MS;
  httpServer.keepAliveTimeout = HTTP_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.timeout = HTTP_CONNECTION_IDLE_TIMEOUT_MS;
  httpServer.setTimeout(HTTP_CONNECTION_IDLE_TIMEOUT_MS, (socket) => {
    socket.destroy();
  });
}

function trackHttpConnections(httpServer) {
  const sockets = new Set();
  const sweepTimer = setInterval(() => {
    for (const socket of sockets) {
      if (socket.destroyed) {
        sockets.delete(socket);
        continue;
      }
      if (socket.readableEnded || socket.writableEnded) {
        socket.destroy();
        sockets.delete(socket);
      }
    }
  }, HTTP_CLOSE_WAIT_SWEEP_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();

  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.setNoDelay(true);
    socket.setKeepAlive(false);
    socket.setTimeout(HTTP_CONNECTION_IDLE_TIMEOUT_MS);
    socket.on("end", () => {
      socket.destroy();
      sockets.delete(socket);
    });
    socket.on("timeout", () => socket.destroy());
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => sockets.delete(socket));
  });
  httpServer.on("close", () => {
    clearInterval(sweepTimer);
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
  });
}

function leaveAccountRooms(socket) {
  for (const room of socket.rooms) {
    if (room.startsWith("account:")) socket.leave(room);
  }
}

function hasElevatedAdminRole(session) {
  return session.role === "admin" || session.role === "super_admin";
}

function getSocketHandshakeToken(socket) {
  const authToken =
    socket.handshake.auth && socket.handshake.auth.token
      ? String(socket.handshake.auth.token)
      : "";
  const headerToken =
    socket.handshake.headers && socket.handshake.headers["x-admin-token"]
      ? String(socket.handshake.headers["x-admin-token"])
      : "";
  return authToken || headerToken;
}

/**
 * 启动嵌入本进程的抓包服务核心。
 * 需要 CA 生成与 proto 加载，均在后台上完成（core.ready）。
 */
function startEmbeddedCaptureService() {
  try {
    const captureConfig = store.getCaptureConfig();
    if (captureConfig.enabled !== true) {
      adminLogger.info("抓包服务未启动（enabled=false）");
      return null;
    }
    if (captureConfig.embedded === false) {
      adminLogger.info("抓包服务未嵌入本进程（embedded=false，使用独立服务）");
      return null;
    }
    if (embeddedCaptureCore) return embeddedCaptureCore;
    const captureLog = (level, message, extra) => {
      const fn = adminLogger[level] || adminLogger.info;
      fn.call(adminLogger, message, extra);
    };
    const core = createCaptureCore({ log: captureLog });
    embeddedCaptureCore = core;
    setEmbeddedCapture(core);
    core.ready.catch((error) => {
      adminLogger.warn("抓包服务嵌入初始化失败", { error: error.message });
    });
    adminLogger.info("抓包服务已嵌入本进程：手机代理端口 18000");
    return core;
  } catch (error) {
    adminLogger.warn("抓包服务嵌入启动失败", { error: error.message });
    return null;
  }
}

function ensureEmbeddedCaptureService() {
  return startEmbeddedCaptureService();
}

async function stopEmbeddedCaptureService() {
  const core = embeddedCaptureCore;
  embeddedCaptureCore = null;
  setEmbeddedCapture(null);
  if (!core || typeof core.stop !== "function") return;
  try {
    await core.stop();
  } catch (error) {
    adminLogger.warn("抓包服务嵌入停止失败", { error: error.message });
  }
}

function startAdminServer(dataProvider) {
  if (app) return;
  provider = dataProvider;
  app = express();
  app.set("trust proxy", true);
  // 关闭 Express 标识头，少给攻击者指纹
  app.disable("x-powered-by");
  // 安全响应头（helmet + Permissions-Policy + no-cache for HTML）——
  // 必须放在 CORS 与所有路由最前面，这样后续中间件对头部的覆盖（login-assets 的 CSP）
  // 才能在该响应里生效。
  app.use(createSecurityHeaders({ hsts: false }));
  app.use(permissionsPolicyMiddleware);
  app.use(noCacheHtmlMiddleware);
  app.use(express.json({ limit: "256kb" }));

  const adminSessionManager = createAdminSessionManager({
    logger: adminLogger,
    getIo: () => io,
  });
  const {
    cleanupInvalidAdminSessions,
    createAdminSession,
    getSession: getAdminSession,
    hasToken: hasAdminToken,
    invalidateAdminSessionAndDisconnect,
    invalidateAdminSessions,
    requireAdminToken,
    updateAdminSessions,
  } = adminSessionManager;

  const adminAccountAccess = createAdminAccountAccess({
    store,
    getProvider: () => provider,
  });
  const {
    canAccessAccount,
    getAccessibleAccountIdsForUser,
    getAccessibleAccountIdsFromRequest,
    getAccountIdFromRequest,
    getAccountsForUser,
    resolveAccountReference,
  } = adminAccountAccess;

  const adminRouteHelpers = createAdminRouteHelpers({
    store,
    userStore,
    logger: adminLogger,
    getProvider: () => provider,
  });
  const {
    requireAdminRole,
    requireDangerConfirmation,
    requireSuperAdminRole,
    sendProviderError,
  } = adminRouteHelpers;

  const webDist = path.join(__dirname, "../../../web/dist");
  configureCorsMiddleware(app);
  configureStaticAssets(app, webDist);
  app.use("/game-config", express.static(getResourcePath("gameConfig")));
  const loginAssetsDir = getDataFile("login-assets");
  fs.mkdirSync(loginAssetsDir, { recursive: true });
  app.use(
    "/login-assets",
    express.static(loginAssetsDir, {
      dotfiles: "deny",
      setHeaders(res, filePath) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        if (path.extname(filePath).toLowerCase() === ".svg") {
          res.setHeader(
            "Content-Security-Policy",
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
          );
        }
      },
    }),
  );
  app.use("/login-assets", (req, res) => res.sendStatus(404));
  adminScheduler.setIntervalTask("session_cleanup", FIVE_MINUTES_MS, cleanupInvalidAdminSessions, {
    preventOverlap: true,
  });

  // 长期 refresh token：落盘保存，bot 重启后前端可凭它换新的 session token，
  // 用户不用每次重启都重新登录（短期 session token 仍在内存，重启即失效）。
  const adminRefreshTokens = createAdminRefreshTokenStore({
    filePath: getDataFile("admin-refresh-tokens.json"),
    log: (level, message) => {
      const fn = adminLogger[level] || adminLogger.info;
      fn.call(adminLogger, message);
    },
  });

  registerAdminAuthRoutes({
    app,
    logger: adminLogger,
    userStore,
    requireAdminToken,
    createAdminSession,
    updateAdminSessions,
    invalidateAdminSessions,
    refreshTokens: adminRefreshTokens,
  });
  registerAdminCardKeyRoutes({
    app,
    requireAdminToken,
    requireSuperAdminRole,
    invalidateAdminSessions,
    updateAdminSessions,
  });
  registerHealthRoute(app);
  registerAuthGate(app, requireAdminToken);
  registerRequestTimeoutGuard(app);
  registerAdminPublicInfoRoutes({
    app,
    provider,
    store,
    userStore,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerLogoutRoute(app, invalidateAdminSessionAndDisconnect, adminRefreshTokens);
  registerAvatarProxyRoute(app, provider);

  registerAdminFarmResourceRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminPetRoutes({
    app,
    provider,
    store,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminFriendRoutes({
    app,
    provider,
    store,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminPlantBlacklistRoutes({
    app,
    provider,
    store,
    requireAdminToken,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminSeedLockRoutes({
    app,
    store,
    requireAdminToken,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminShopRoutes({
    app,
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminActivityRoutes({
    app,
    provider,
    requireAdminToken,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminIllustratedRoutes({
    app,
    provider,
    adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminCareerRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminConsumptionRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminBagRoutes({
    app,
    provider,
    store,
    emitRealtimeLog,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminAccountRuntimeRoutes({
    app,
    provider,
    resolveAccountReference,
    canAccessAccount,
  });
  registerAdminFarmOperationRoutes({
    app,
    provider,
    getAccountIdFromRequest,
    canAccessAccount,
    sendProviderError,
  });
  registerAdminAnalyticsRoutes({ app });
  registerAdminSettingsRoutes({
    app,
    provider,
    store,
    logger: adminLogger,
    getAccountIdFromRequest,
    canAccessAccount,
    requireDangerConfirmation,
  });
  registerAdminSystemRoutes({
    app,
    store,
    logger: adminLogger,
    requireAdminToken,
    requireAdminRole,
    requireSuperAdminRole,
    requireDangerConfirmation,
    getDefaultSystemConfig,
    getRuntimeConfig,
    updateRuntimeConfig,
  });
  registerAdminCaptureRoutes({
    app,
    store,
    provider,
    userStore,
    logger: adminLogger,
    requireAdminRole,
    requireDangerConfirmation,
    canAccessAccount,
    resolveAccountReference,
    ensureEmbeddedCaptureService,
    stopEmbeddedCaptureService,
  });
  // 抓包服务默认开启：嵌入模式下随管理面板一起拉起，无需人工到设置页保存一次
  if (ensureEmbeddedCaptureService())
    adminLogger.info("抓包服务已随管理面板启动（默认开启）");
  else
    adminLogger.info("抓包服务未随管理面板启动（已关闭、或使用独立服务）");
  registerAdminCurrentUserRoutes({
    app,
    requireAdminToken,
    requireAdminRole,
    userStore,
    store,
    updateAdminSessions,
    refreshTokens: adminRefreshTokens,
  });
  registerAdminAccountRoutes({
    app,
    provider,
    getIo: () => io,
    addOrUpdateAccount,
    deleteAccount,
    findAccountByRef,
    getAccountsForUser,
    getAccountIdFromRequest,
    resolveAccountReference,
    canAccessAccount,
    getAccessibleAccountIdsFromRequest,
    userStore,
    sendProviderError,
    store,
    updateRuntimeConfig,
  });
  registerAdminQrLoginRoutes({ app });
  registerAdminNapcatLoginRoutes({ app });
  registerAdminProxyRoutes({ app, logger: adminLogger });
  registerSpaFallback(app, webDist);

  // 用户隔离：普通用户不加入全局房间，只订阅自己有权限的账号
  const joinOwnAccountRooms = (socket, session) => {
    const accessibleIds = session ? getAccessibleAccountIdsForUser(session) : [];
    for (const accessibleId of accessibleIds) {
      if (accessibleId) socket.join(`account:${  accessibleId}`);
    }
    socket.data.accountId = "";
  };

  const subscribeSocketToAccount = (socket, accountRef = "") => {
    const rawAccountRef = String(accountRef || "").trim();
    const accountId =
      rawAccountRef && rawAccountRef !== "all"
        ? resolveAccountReference(rawAccountRef)
        : "";
    const token = socket.data.adminToken;
    const session = token ? getAdminSession(token) : null;

    if (accountId && session && !hasElevatedAdminRole(session)) {
      const accounts = getAccountsForUser();
      const account = accounts.find((item) => item.id === accountId);
      if (!account || account.username !== session.username) {
        socket.emit("subscribed", {
          accountId: "all",
          error: "无权访问此账号",
        });
        leaveAccountRooms(socket);
        joinOwnAccountRooms(socket, session);
        return;
      }
    }

    leaveAccountRooms(socket);
    if (accountId) {
      socket.join(`account:${  accountId}`);
      socket.data.accountId = accountId;
    } else if (session && !hasElevatedAdminRole(session)) {
      // 普通用户：全局订阅只覆盖自己的账号，避免收到其他用户的数据
      joinOwnAccountRooms(socket, session);
    } else {
      socket.join("account:all");
      socket.data.accountId = "";
    }
    socket.emit("subscribed", {
      accountId: socket.data.accountId || "all",
    });

    try {
      const subscribedAccountId = socket.data.accountId || "";
      const socketUser = socket.data.user;
      if (
        subscribedAccountId &&
        provider &&
        typeof provider.getStatus === "function"
      ) {
        const status = provider.getStatus(subscribedAccountId);
        socket.emit("status:update", {
          accountId: subscribedAccountId,
          status,
        });
      }
      if (provider && typeof provider.getLogs === "function") {
        let logs = provider.getLogs(subscribedAccountId, {
          limit: LOG_SNAPSHOT_LIMIT,
        });
        if (!Array.isArray(logs)) logs = [];
        if (socketUser) {
          const accessibleAccountIds = getAccessibleAccountIdsForUser(socketUser);
          logs = logs.filter((logEntry) => {
            const logAccountId = logEntry.accountId || logEntry.id;
            if (!logAccountId) return true;
            return accessibleAccountIds.includes(logAccountId);
          });
        }
        socket.emit("logs:snapshot", {
          accountId: subscribedAccountId || "all",
          logs,
        });
      }
      if (provider && typeof provider.getAccountLogs === "function") {
        let accountLogs = provider.getAccountLogs(LOG_SNAPSHOT_LIMIT);
        if (!Array.isArray(accountLogs)) accountLogs = [];
        if (subscribedAccountId) {
          accountLogs = accountLogs.filter((logEntry) => {
            const logAccountId = String(logEntry.accountId || logEntry.id || "");
            return logAccountId === subscribedAccountId;
          });
        }
        if (socketUser) {
          const accessibleAccountIds = getAccessibleAccountIdsForUser(socketUser);
          accountLogs = accountLogs.filter((logEntry) => {
            const logAccountId = logEntry.accountId || logEntry.id;
            return accessibleAccountIds.includes(logAccountId);
          });
        }
        socket.emit("account-logs:snapshot", {
          logs: accountLogs,
        });
      }
    } catch {}
  };

  const adminPort = CONFIG.adminPort || 3007;
  server = app.listen(adminPort, "0.0.0.0", () => {
    adminLogger.info("admin panel started", {
      url: `http://localhost:${  adminPort}`,
      port: adminPort,
    });
  });
  configureHttpServerTimeouts(server);
  trackHttpConnections(server);

  io = new SocketIOServer(server, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    pingInterval: 20000,
    pingTimeout: 10000,
    connectTimeout: 10000,
    maxHttpBufferSize: 256 * 1024,
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      allowedHeaders: ["x-admin-token", "x-account-id"],
    },
  });
  io.use((socket, next) => {
    const token = getSocketHandshakeToken(socket);
    if (!token || !hasAdminToken(token)) {
      return next(new Error("Unauthorized"));
    }
    socket.data.adminToken = token;
    socket.data.user = getAdminSession(token);
    return next();
  });
  io.on("connection", (socket) => {
    const initialAccountId =
      (socket.handshake.auth && socket.handshake.auth.accountId) ||
      (socket.handshake.query && socket.handshake.query.accountId) ||
      "";
    subscribeSocketToAccount(socket, initialAccountId);
    socket.emit("ready", { ok: true, ts: Date.now() });
    socket.on("subscribe", (payload) => {
      const safePayload = payload && typeof payload === "object" ? payload : {};
      subscribeSocketToAccount(socket, safePayload.accountId || "");
    });
  });
}

module.exports = {
  startAdminServer,
  emitRealtimeStatus,
  emitRealtimeLog,
  emitRealtimeAccountLog,
};
