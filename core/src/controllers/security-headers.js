/**
 * 安全响应头中间件
 *
 * 集中配置 helmet（含 CSP / X-Frame-Options / Referrer-Policy 等），
 * 以及项目自定义的 Permissions-Policy。
 *
 * 设计原则：
 * 1. CSP 默认同源 + 必要的 ws/wss（Socket.IO）+ data/blob 图片；
 * 2. SPA 在生产构建后不需要 unsafe-inline（Vite 产物都是外部脚本/样式）；
 *    仅在 Vite dev server（HMR）跑的时候需要 unsafe-eval，部署里用不上。
 * 3. frame-ancestors 'none' 阻止面板被任何 iframe 嵌套（防点击劫持）；
 *    login-assets 那条更严格的 CSP 通过静态中间件的 setHeaders 在后面覆盖。
 * 4. HSTS 仅在 HTTPS 部署下有意义：检测 req.secure 决定要不要带 max-age。
 *    HTTP 部署下浏览器忽略此头，加了也不影响功能但容易误导用户。
 * 5. Permissions-Policy 关闭用不到的硬件 API，缩小攻击面。
 */
const helmet = require("helmet");

/**
 * 构建生产环境 SPA + API 通用的 CSP。
 *
 * 资源来源分析：
 * - 脚本：Vite 7 生产构建产物，所有 JS 都是 /assets/*.js 外链；
 * - 样式：UnoCSS + Vite 产物都是外链 CSS；
 * - 图片：用户上传（blob/data URL）+ 游戏图鉴资源（/assets/* 同源）+ 内联 svg data URI；
 * - 连接：同源 /api + ws://localhost / wss://localhost（Socket.IO）；
 *   HTTPS 部署时 Socket.IO 自动升级 wss，浏览器允许 ws: wss: 通配；
 *   严格部署可改 'self'，但抓包登录服务走 HTTP 时 ws://localhost 不能少。
 * - 字体：UnoCSS presetWebFonts 已在构建时下载，无外链字体。
 * - frame-ancestors 'none' 阻止被嵌套（点击劫持防御）；
 *   frame-src 'self' 允许 SPA 内自身 iframe（dist/index.html 里有 <iframe src="/icon.svg">）。
 */
function buildCspDirectives() {
    // helmet 8.x 要求把每个 source 用双引号包起来传给字符串数组，
    // 它内部会拆掉外壳、序列化时再加单引号。
    // 因此数组元素形如 `"'self'"`、`"'unsafe-inline'"`、`"data:"`、`"blob:"`。
    const self = "'self'";
    const unsafeInline = "'unsafe-inline'";
    const none = "'none'";
    return {
        "default-src": [self],
        "script-src": [self],
        "style-src": [self, unsafeInline],
        "img-src": [self, "data:", "blob:"],
        // font-src 同时放行 fonts.gstatic.com —— UnoCSS presetWebFonts 把
        // DM Sans / DM Mono / DM Serif Display 的 @font-face 内联到 CSS，
        // src 直接指向 fonts.gstatic.com 的 woff2。
        // 走自托管需要改 uno.config.ts 重新 build，短期内放行最稳妥；
        // 后续如要彻底同源化再单独改造。
        "font-src": [self, "data:", "https://fonts.gstatic.com"],
        "connect-src": [self, "ws:", "wss:"],
        "media-src": [self],
        "object-src": [none],
        "frame-src": [self],
        "frame-ancestors": [none],
        "form-action": [self],
        "base-uri": [self],
        "manifest-src": [self],
    };
}

/**
 * helmet 中间件：所有响应统一加安全头。
 *
 * @param {object} [options]
 * @param {boolean} [options.hsts] 是否启用 HSTS（仅 HTTPS 部署下应开启）
 * @returns {Function} Express 中间件
 */
function createSecurityHeaders(options = {}) {
    const enableHsts = options.hsts === true;

    return helmet({
        // X-Content-Type-Options: nosniff — 阻止浏览器猜 MIME
        // 防止上传的 .txt 被当成 JS 执行
        noSniff: true,
        // X-Frame-Options 已由 CSP frame-ancestors 取代，关掉避免重复
        frameguard: false,
        // X-XSS-Protection 在现代浏览器里只是兼容性字段，关掉减少噪音
        xssFilter: false,
        // 不强制 HTTPS（HTTP 部署加上 max-age 会失效又留痕）
        strictTransportSecurity: enableHsts ? {
            maxAge: 15552000, // 180 天
            includeSubDomains: true,
        } : false,
        // Referer 不外泄给跨域请求
        referrerPolicy: { policy: "no-referrer" },
        // X-Permitted-Cross-Domain-Policies 默认 none（防 Flash/PDF 跨域）
        permittedCrossDomainPolicies: { permittedPolicies: "none" },
        // Cross-Origin-* 给静态资源更稳的跨源隔离提示
        crossOriginResourcePolicy: { policy: "same-origin" },
        crossOriginOpenerPolicy: { policy: "same-origin" },
        originAgentCluster: true,
        // CSP 主体
        contentSecurityPolicy: {
            useDefaults: false, // 自己完整列，避免 helmet 默认值覆盖
            directives: buildCspDirectives(),
        },
    });
}

/**
 * Permissions-Policy：关闭用不到的硬件 API / 跨域 iframe 行为。
 * 单独写一份是因为 helmet 8 仍未内置该头。
 */
function permissionsPolicyMiddleware(req, res, next) {
    res.setHeader("Permissions-Policy", [
        "accelerometer=()",
        "autoplay=()",
        "camera=()",
        "display-capture=()",
        "fullscreen=(self)",
        "geolocation=()",
        "gyroscope=()",
        "magnetometer=()",
        "microphone=()",
        "payment=()",
        "picture-in-picture=()",
        "publickey-credentials-get=(self)",
        "screen-wake-lock=()",
        "sync-xhr=()",
        "usb=()",
        "xr-spatial-tracking=()",
    ].join(", "));
    return next();
}

/**
 * 阻止浏览器/中间件缓存 HTML 与敏感响应（auth 路由自己再覆盖）。
 * helmet 不管这个，但放在同一处配置更直观。
 */
function noCacheHtmlMiddleware(req, res, next) {
    const acceptsHtml = (req.headers.accept || "").includes("text/html");
    const isSpaRoute = !req.path.startsWith("/api/")
      && !req.path.startsWith("/socket.io/")
      && !req.path.startsWith("/game-config/")
      && !req.path.startsWith("/login-assets/");
    if (acceptsHtml && isSpaRoute) {
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
    }
    return next();
}

module.exports = {
    buildCspDirectives,
    createSecurityHeaders,
    permissionsPolicyMiddleware,
    noCacheHtmlMiddleware,
};