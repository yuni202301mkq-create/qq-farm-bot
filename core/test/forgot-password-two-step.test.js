const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录，必须在 require user-store 之前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-forgot-two-step-'));
process.env.FARM_DATA_DIR = dataDir;

const userStore = require('../src/models/user-store');
const { registerAdminAuthRoutes } = require('../src/controllers/admin-auth-routes');

const handlers = new Map();
const invalidatedPredicates = [];

registerAdminAuthRoutes({
  app: { post: (routePath, handler) => handlers.set(routePath, handler) },
  createAdminSession: user => `token-${user.username}`,
  updateAdminSessions: () => {},
  invalidateAdminSessions: (predicate) => {
    invalidatedPredicates.push(predicate);
  },
});

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

async function registerUser(username, password, cardKey) {
  const result = await post('/api/register', { username, password, cardKey });
  assert.equal(result.status, 200, `注册应成功：${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function verifyCard(cardKey, remoteAddress) {
  return post('/api/forgot-password/verify', { cardKey }, remoteAddress);
}

test('步骤1：注册卡验证通过并返回绑定账号与重置凭据', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30, note: '两步找回-注册卡' });
  await registerUser('twostep_a', 'oldpass123', card.code);

  // 卡密大小写不敏感
  const verify = await verifyCard(card.code.toLowerCase(), '203.0.113.21');
  assert.equal(verify.status, 200);
  assert.equal(verify.body.ok, true);
  assert.equal(verify.body.data.username, 'twostep_a');
  assert.ok(verify.body.data.resetToken, '应返回 resetToken');
  assert.ok(verify.body.data.expiresInSec > 0 && verify.body.data.expiresInSec <= 300);
});

test('步骤1：续费卡同样能反查到绑定账号', async () => {
  const [regCard] = userStore.createCardKeys({ count: 1, days: 30 });
  const [renewCard] = userStore.createCardKeys({ count: 1, days: 15 });
  await registerUser('twostep_b', 'pass111111', regCard.code);
  const renew = await post('/api/renew', { username: 'twostep_b', cardKey: renewCard.code });
  assert.equal(renew.status, 200);

  const verify = await verifyCard(renewCard.code, '203.0.113.22');
  assert.equal(verify.status, 200);
  assert.equal(verify.body.data.username, 'twostep_b');
});

test('步骤1：未绑定或不存在卡密统一报错', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30 });
  const missing = await verifyCard('FARM-NOTREAL-KEYS-0001', '203.0.113.23');
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, '卡密不正确或未绑定任何账号');

  // 存在但未被任何账号使用的卡密同样不能通过
  const unused = await verifyCard(card.code, '203.0.113.23');
  assert.equal(unused.status, 400);

  const empty = await verifyCard('', '203.0.113.23');
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error, '请输入卡密');
});

test('端到端：验证卡密后用重置凭据设置新密码', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('twostep_c', 'oldpass111', card.code);

  const verify = await verifyCard(card.code, '203.0.113.24');
  const { resetToken } = verify.body.data;

  const reset = await post('/api/forgot-password/reset', {
    resetToken,
    newPassword: 'newpass999',
  }, '203.0.113.24');
  assert.equal(reset.status, 200);
  assert.equal(reset.body.data.username, 'twostep_c');

  assert.ok(userStore.verifyPassword('twostep_c', 'newpass999'));
  assert.equal(userStore.verifyPassword('twostep_c', 'oldpass111'), null);
  assert.equal(invalidatedPredicates.at(-1)({ username: 'twostep_c' }), true);
});

test('重置凭据是一次性的，重复使用会失败', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('twostep_d', 'pass111111', card.code);

  const { resetToken } = (await verifyCard(card.code, '203.0.113.25')).body.data;
  const first = await post('/api/forgot-password/reset', { resetToken, newPassword: 'pass222222' }, '203.0.113.25');
  assert.equal(first.status, 200);

  const second = await post('/api/forgot-password/reset', { resetToken, newPassword: 'pass333333' }, '203.0.113.25');
  assert.equal(second.status, 400);
  assert.equal(second.body.error, '重置凭据已失效，请重新验证卡密');
  assert.ok(userStore.verifyPassword('twostep_d', 'pass222222'));
});

test('伪造或过期的重置凭据统一报错且不影响账号', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('twostep_e', 'pass111111', card.code);

  const fake = await post('/api/forgot-password/reset', {
    resetToken: 'deadbeef'.repeat(8),
    newPassword: 'pass222222',
  }, '203.0.113.26');
  assert.equal(fake.status, 400);
  assert.ok(userStore.verifyPassword('twostep_e', 'pass111111'));

  const missing = await post('/api/forgot-password/reset', { newPassword: 'pass222222' }, '203.0.113.26');
  assert.equal(missing.status, 400);

  // 密码过短时凭据不应被消费，修正密码后仍可用
  const { resetToken } = (await verifyCard(card.code, '203.0.113.26')).body.data;
  const shortPwd = await post('/api/forgot-password/reset', { resetToken, newPassword: '12345' }, '203.0.113.26');
  assert.equal(shortPwd.status, 400);
  assert.equal(shortPwd.body.error, '新密码至少 6 位');
  const retry = await post('/api/forgot-password/reset', { resetToken, newPassword: 'pass444444' }, '203.0.113.26');
  assert.equal(retry.status, 200);
});

test('步骤1连续失败会锁定来源地址，换卡密也绕不过', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('twostep_f', 'pass111111', card.code);

  for (let i = 0; i < 5; i += 1) {
    const attempt = await verifyCard(`FARM-WRONG-KEYS-${String(i).padStart(4, '0')}`, '203.0.113.27');
    assert.equal(attempt.status, 400);
  }

  // 第 6 次即使卡密正确也被锁定
  const locked = await verifyCard(card.code, '203.0.113.27');
  assert.equal(locked.status, 429);
  assert.match(locked.body.error, /尝试次数过多/);

  // 锁定同样覆盖步骤 2
  const resetLocked = await post('/api/forgot-password/reset', {
    resetToken: 'x'.repeat(64),
    newPassword: 'pass222222',
  }, '203.0.113.27');
  assert.equal(resetLocked.status, 429);

  // 其他来源不受影响
  const ok = await verifyCard(card.code, '203.0.113.28');
  assert.equal(ok.status, 200);
});

test('伪造 X-Forwarded-For 不能绕过步骤1的失败锁定', async () => {
  for (let i = 0; i < 5; i += 1) {
    const attempt = await verifyCard('FARM-WRONG-KEYS-9999', '198.51.100.9', `10.9.9.${i + 1}`);
    assert.equal(attempt.status, 400);
  }
  const locked = await verifyCard('FARM-WRONG-KEYS-9999', '198.51.100.9', '10.9.9.99');
  assert.equal(locked.status, 429);
});
