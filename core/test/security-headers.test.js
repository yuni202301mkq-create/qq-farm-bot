/**
 * 安全响应头中间件测试
 *
 * 覆盖：
 * - helmet 中间件正确安装，CSP 头在响应里
 * - frame-ancestors 'none' 防止点击劫持
 * - 静态资源（/login-assets）的 CSP 不会被全局 CSP 覆盖（走 setHeaders）
 * - JSON 响应也带安全头（不仅是 HTML）
 * - Permissions-Policy 头存在
 * - noCacheHtmlMiddleware 只在 HTML SPA 路由上生效，不影响 /api / socket.io
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const {
    createSecurityHeaders,
    permissionsPolicyMiddleware,
    noCacheHtmlMiddleware,
    buildCspDirectives,
} = require('../src/controllers/security-headers');

function makeRequest(server, options = {}) {
    const { method = 'GET', path = '/', headers = {} } = options;
    return new Promise((resolve, reject) => {
        const req = http.request({
            host: '127.0.0.1',
            port: server.address().port,
            method,
            path,
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf-8'),
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

function startServer(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('helmet 安装：基本安全头存在', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.get('/', (req, res) => res.send('ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server);
        // X-Content-Type-Options: nosniff
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        // Referrer-Policy: no-referrer
        assert.equal(res.headers['referrer-policy'], 'no-referrer');
        // X-Permitted-Cross-Domain-Policies: none
        assert.equal(res.headers['x-permitted-cross-domain-policies'], 'none');
        // Cross-Origin-Resource-Policy
        assert.equal(res.headers['cross-origin-resource-policy'], 'same-origin');
        // X-Powered-By 不应该出现（admin.js 已 disable，这里中间件没动它但 helmet 也不加）
        assert.equal(res.headers['x-powered-by'], undefined);
        // CSP 头
        const csp = res.headers['content-security-policy'];
        assert.ok(csp, '应该有 CSP 头');
    } finally {
        server.close();
    }
});

test('CSP 包含所有必需指令', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.get('/', (req, res) => res.send('ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server);
        const csp = res.headers['content-security-policy'];
        // 顺序与值都由 helmet 决定；逐项断言关键指令
        assert.match(csp, /default-src 'self'/);
        assert.match(csp, /script-src 'self'/);
        assert.match(csp, /style-src 'self' 'unsafe-inline'/);
        assert.match(csp, /img-src 'self' data: blob:/);
        assert.match(csp, /connect-src 'self' ws: wss:/);
        assert.match(csp, /object-src 'none'/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.match(csp, /base-uri 'self'/);
        assert.match(csp, /form-action 'self'/);
    } finally {
        server.close();
    }
});

test('X-Frame-Options 不应出现（被 CSP frame-ancestors 取代）', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.get('/', (req, res) => res.send('ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server);
        // frameguard: false ⇒ 不输出 X-Frame-Options（CSP frame-ancestors 已覆盖）
        assert.equal(res.headers['x-frame-options'], undefined,
            'X-Frame-Options 不该出现，由 CSP frame-ancestors 取代');
    } finally {
        server.close();
    }
});

test('HSTS 默认关闭（HTTP 部署）', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.get('/', (req, res) => res.send('ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server);
        assert.equal(res.headers['strict-transport-security'], undefined,
            'HTTP 部署不应输出 HSTS');
    } finally {
        server.close();
    }
});

test('HSTS 可显式开启', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: true }));
    app.get('/', (req, res) => res.send('ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server);
        const hsts = res.headers['strict-transport-security'];
        assert.ok(hsts, '开启后应该有 HSTS');
        assert.match(hsts, /max-age=/);
        assert.match(hsts, /includeSubDomains/);
    } finally {
        server.close();
    }
});

test('Permissions-Policy 头存在并禁用不需要的 API', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.use(permissionsPolicyMiddleware);
    app.get('/', (req, res) => res.send('ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server);
        const policy = res.headers['permissions-policy'];
        assert.ok(policy, '应该有 Permissions-Policy 头');
        assert.match(policy, /camera=\(\)/);
        assert.match(policy, /microphone=\(\)/);
        assert.match(policy, /geolocation=\(\)/);
        assert.match(policy, /payment=\(\)/);
    } finally {
        server.close();
    }
});

test('JSON /api 响应也带安全头（不仅是 HTML）', async () => {
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.get('/api/health', (req, res) => res.json({ ok: true }));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server, { path: '/api/health' });
        assert.equal(res.headers['x-content-type-options'], 'nosniff');
        assert.ok(res.headers['content-security-policy']);
        assert.equal(res.status, 200);
        assert.deepEqual(JSON.parse(res.body), { ok: true });
    } finally {
        server.close();
    }
});

test('noCacheHtmlMiddleware：HTML SPA 路由加 no-store', async () => {
    const app = express();
    app.use(noCacheHtmlMiddleware);
    app.get('/', (req, res) => res.send('<!doctype html>ok'));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server, {
            headers: { accept: 'text/html' },
        });
        const cc = res.headers['cache-control'];
        assert.ok(cc, '应该有 Cache-Control');
        assert.match(cc, /no-store/);
        assert.match(cc, /no-cache/);
    } finally {
        server.close();
    }
});

test('noCacheHtmlMiddleware：/api 路由不受影响', async () => {
    const app = express();
    app.use(noCacheHtmlMiddleware);
    app.get('/api/health', (req, res) => res.json({ ok: true }));
    const server = await startServer(app);
    try {
        const res = await makeRequest(server, {
            path: '/api/health',
            headers: { accept: 'application/json' },
        });
        // /api 路由不该被强制 no-cache
        assert.equal(res.headers['cache-control'], undefined);
    } finally {
        server.close();
    }
});

test('buildCspDirectives 返回完整指令集', () => {
    const directives = buildCspDirectives();
    assert.ok(directives['default-src']);
    assert.ok(directives['script-src']);
    assert.ok(directives['style-src']);
    assert.ok(directives['img-src']);
    assert.ok(directives['font-src']);
    assert.ok(directives['connect-src']);
    assert.ok(directives['object-src']);
    assert.ok(directives['frame-src']);
    assert.ok(directives['frame-ancestors']);
    assert.ok(directives['base-uri']);
    assert.ok(directives['form-action']);
});

test('/login-assets 静态中间件的 CSP 不被全局 CSP 覆盖', async () => {
    // 模拟 admin.js：先 helmet（全局 CSP），再 express.static(loginAssetsDir)
    // 静态中间件用 setHeaders 给 svg 资源设置 sandbox CSP —— 这个 CSP 会
    // 覆盖全局的 CSP（因为 helmet 在前）。
    const app = express();
    app.use(createSecurityHeaders({ hsts: false }));
    app.use('/login-assets', (req, res) => {
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Content-Security-Policy',
            "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
        res.send('<svg></svg>');
    });
    const server = await startServer(app);
    try {
        const res = await makeRequest(server, { path: '/login-assets/icon.svg' });
        const csp = res.headers['content-security-policy'];
        assert.match(csp, /sandbox/);
        assert.match(csp, /default-src 'none'/);
        assert.doesNotMatch(csp, /frame-ancestors/, 'login-assets 的 CSP 不需要 frame-ancestors');
    } finally {
        server.close();
    }
});