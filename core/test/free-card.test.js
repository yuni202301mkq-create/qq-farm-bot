const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录，必须在 require user-store 之前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-free-card-'));
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

// remoteAddress 是 TCP 对端地址；spoofedIp 用来验证伪造的 X-Forwarded-For 无效
function post(routePath, body, remoteAddress = '203.0.113.20', spoofedIp = null) {
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

test('首次领取会发放 7 天卡密并记录来源', async () => {
  const result = await post('/api/free-card', { username: 'new_user' }, '198.51.100.1');
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.data.days, 7);
  assert.match(result.body.data.cardKey, /^FARM-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const claim = userStore.findFreeCardClaim('198.51.100.1');
  assert.ok(claim);
  assert.equal(claim.username, 'new_user');
  assert.equal(claim.card, result.body.data.cardKey);

  // 领到的卡密是真实可用的注册卡密
  const key = userStore.findCardKey(result.body.data.cardKey);
  assert.ok(key);
  assert.equal(key.days, 7);
  assert.equal(key.usedBy, null);
});

test('同一来源地址只能领取一次', async () => {
  const first = await post('/api/free-card', { username: 'user_a' }, '198.51.100.2');
  assert.equal(first.status, 200);

  const second = await post('/api/free-card', { username: 'user_b' }, '198.51.100.2');
  assert.equal(second.status, 400);
  assert.match(second.body.error, /仅可领取一次/);

  // 其它来源地址不受影响
  const other = await post('/api/free-card', { username: 'user_b' }, '198.51.100.3');
  assert.equal(other.status, 200);
  assert.notEqual(other.body.data.cardKey, first.body.data.cardKey);
});

test('同一设备换 IP 也只能领取一次', async () => {
  const deviceId = 'device-aaa-1111';
  const first = await post('/api/free-card', { deviceId }, '198.51.100.21');
  assert.equal(first.status, 200);

  // 同一设备换来源地址 → 拒绝
  const second = await post('/api/free-card', { deviceId }, '198.51.100.22');
  assert.equal(second.status, 400);
  assert.match(second.body.error, /仅可领取一次/);

  // 领取记录里存了设备标识
  const claim = userStore.findFreeCardClaimByDevice(deviceId);
  assert.ok(claim);
  assert.equal(claim.address, '198.51.100.21');
});

test('同一 IP 换设备同样只能领取一次', async () => {
  const first = await post('/api/free-card', { deviceId: 'device-bbb-2222' }, '198.51.100.23');
  assert.equal(first.status, 200);

  const second = await post('/api/free-card', { deviceId: 'device-ccc-3333' }, '198.51.100.23');
  assert.equal(second.status, 400);
  assert.match(second.body.error, /仅可领取一次/);
});

test('未带 deviceId 的旧客户端退化为仅按 IP 限制', async () => {
  const first = await post('/api/free-card', {}, '198.51.100.24');
  assert.equal(first.status, 200);
  assert.equal(userStore.findFreeCardClaimByDevice(''), null);

  const second = await post('/api/free-card', {}, '198.51.100.24');
  assert.equal(second.status, 400);
});

test('IPv4-mapped IPv6 与纯 IPv4 视为同一来源', async () => {
  const first = await post('/api/free-card', {}, '::ffff:198.51.100.4');
  assert.equal(first.status, 200);

  const second = await post('/api/free-card', {}, '198.51.100.4');
  assert.equal(second.status, 400);
  assert.match(second.body.error, /仅可领取一次/);
});

test('伪造 X-Forwarded-For 不能重复领取', async () => {
  const first = await post('/api/free-card', {}, '198.51.100.5', '9.9.9.9');
  assert.equal(first.status, 200);

  // 换伪造头、来源地址不变 → 仍视为同一网络
  const spoofed = await post('/api/free-card', {}, '198.51.100.5', '8.8.8.8');
  assert.equal(spoofed.status, 400);
  assert.match(spoofed.body.error, /仅可领取一次/);
});

test('缺少来源地址和设备标识时拒绝领取', async () => {
  const result = await post('/api/free-card', {}, '');
  assert.equal(result.status, 400);
  assert.match(result.body.error, /无法识别来源地址/);
});

test('缺少来源地址但带设备标识时可领取', async () => {
  const result = await post('/api/free-card', { deviceId: 'device-ddd-4444' }, '');
  assert.equal(result.status, 200);
  const claim = userStore.findFreeCardClaimByDevice('device-ddd-4444');
  assert.ok(claim);
  assert.equal(claim.address, '');
});

test('领取到的卡密可以直接用于注册', async () => {
  const free = await post('/api/free-card', { username: 'trial_user' }, '198.51.100.6');
  assert.equal(free.status, 200);

  const registered = await post('/api/register', {
    username: 'trial_user',
    password: 'pass123456',
    cardKey: free.body.data.cardKey,
  });
  assert.equal(registered.status, 200);

  const user = userStore.findUser('trial_user');
  assert.ok(user);
  assert.equal(user.card, free.body.data.cardKey);
  // 7 天有效期
  const days = Math.round((user.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
  assert.equal(days, 7);
});

test('管理员可以清除领取记录后重新领取', async () => {
  await post('/api/free-card', {}, '198.51.100.7');
  assert.ok(userStore.findFreeCardClaim('198.51.100.7'));

  userStore.resetFreeCardClaims('198.51.100.7');
  assert.equal(userStore.findFreeCardClaim('198.51.100.7'), null);

  const again = await post('/api/free-card', {}, '198.51.100.7');
  assert.equal(again.status, 200);

  // 清空全部
  userStore.resetFreeCardClaims();
  assert.equal(userStore.listFreeCardClaims().length, 0);
});
