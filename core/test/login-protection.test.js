const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录，必须在 require user-store 之前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-login-protection-'));
process.env.FARM_DATA_DIR = dataDir;

const userStore = require('../src/models/user-store');
const { registerAdminAuthRoutes } = require('../src/controllers/admin-auth-routes');

const handlers = new Map();

registerAdminAuthRoutes({
  app: { post: (routePath, handler) => handlers.set(routePath, handler) },
  createAdminSession: user => `token-${user.username}`,
  updateAdminSessions: () => {},
  invalidateAdminSessions: () => {},
});

// 第三个参数是 TCP 对端地址；第四个参数用来伪造 req.ip / X-Forwarded-For，
// 确认限流只认对端地址，不认可伪造的转发头
function post(routePath, body, remoteAddress = '203.0.113.10', spoofedIp = null) {
  return new Promise((resolve) => {
    const req = {
      body,
      ip: spoofedIp || remoteAddress,
      headers: spoofedIp ? { 'x-forwarded-for': spoofedIp } : {},
      socket: { remoteAddress },
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
      },
    };
    handlers.get(routePath)(req, res);
  });
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('连续登录失败会锁定「来源 + 用户名」组合', async () => {
  const address = '198.51.100.1';
  for (let i = 0; i < 5; i += 1) {
    const res = await post('/api/login', { username: 'farmer_login_a', password: 'wrongpass' }, address);
    assert.equal(res.status, 401, `第 ${i + 1} 次失败应返回 401`);
  }
  // 第 6 次即使密码正确也已被锁定
  const locked = await post('/api/login', { username: 'farmer_login_a', password: 'wrongpass' }, address);
  assert.equal(locked.status, 429);
  assert.match(locked.body.error, /登录尝试次数过多/);
});

test('伪造 X-Forwarded-For 不能绕过登录锁定', async () => {
  const address = '198.51.100.2';
  // 每次换一个伪造的转发头，但 TCP 对端地址不变
  for (let i = 0; i < 5; i += 1)
    await post('/api/login', { username: 'farmer_login_b', password: 'wrongpass' }, address, `10.0.0.${i}`);
  const locked = await post('/api/login', { username: 'farmer_login_b', password: 'wrongpass' }, address, '10.0.0.99');
  assert.equal(locked.status, 429);
});

test('轮换来源地址爆破同一账号会被账号维度拦下', async () => {
  const username = 'farmer_login_c';
  // 每个来源只失败一次，单点维度永远到不了阈值
  for (let i = 0; i < 20; i += 1)
    await post('/api/login', { username, password: 'wrongpass' }, `203.0.113.${i}`);
  // 第 21 次换成全新来源，仍应被账号维度锁住
  const locked = await post('/api/login', { username, password: 'wrongpass' }, '203.0.113.200');
  assert.equal(locked.status, 429);
});

test('登录成功后清空失败计数', async () => {
  const address = '198.51.100.3';
  for (let i = 0; i < 4; i += 1)
    await post('/api/login', { username: 'admin', password: 'wrongpass' }, address);

  const ok = await post('/api/login', {
    username: 'admin',
    password: userStore.DEFAULT_SUPER_ADMIN_PASSWORD,
  }, address);
  assert.equal(ok.status, 200, `正确密码应能登录：${JSON.stringify(ok.body)}`);

  // 计数已清空，再连错 4 次仍应返回 401 而不是 429
  for (let i = 0; i < 4; i += 1) {
    const res = await post('/api/login', { username: 'admin', password: 'wrongpass' }, address);
    assert.equal(res.status, 401);
  }
});

test('新装的超级管理员带强制改密标记，改密后解除', async () => {
  const created = userStore.findUser('admin');
  assert.equal(created.mustChangePassword, true, '出厂超管应带 mustChangePassword');

  const login = await post('/api/login', {
    username: 'admin',
    password: userStore.DEFAULT_SUPER_ADMIN_PASSWORD,
  }, '198.51.100.4');
  assert.equal(login.status, 200);
  assert.equal(login.body.data.mustChangePassword, true, '登录响应应回传强制改密标记');

  userStore.updateUser('admin', { password: 'newpass123' });
  assert.equal(userStore.findUser('admin').mustChangePassword, false, '改密后应解除标记');

  const again = await post('/api/login', { username: 'admin', password: 'newpass123' }, '198.51.100.5');
  assert.equal(again.status, 200);
  assert.equal(again.body.data.mustChangePassword, false);
});

test('普通用户不受强制改密影响', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30, note: '登录保护测试' });
  const registered = await post('/api/register', {
    username: 'farmer_normal',
    password: 'userpass123',
    cardKey: card.code,
  });
  assert.equal(registered.status, 200, JSON.stringify(registered.body));
  assert.equal(registered.body.data.mustChangePassword, false);

  const login = await post('/api/login', { username: 'farmer_normal', password: 'userpass123' }, '198.51.100.6');
  assert.equal(login.status, 200);
  assert.equal(login.body.data.mustChangePassword, false);
});
