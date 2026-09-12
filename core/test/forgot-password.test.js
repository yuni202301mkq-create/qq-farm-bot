const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录，必须在 require user-store 之前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-forgot-password-'));
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

// 第三个参数是 TCP 对端地址；同时给 req.ip 塞一个不同的值，
// 用来确认限流不依赖 req.ip（trust proxy 下它来自可伪造的 X-Forwarded-For）
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

async function registerUser(username, password, cardKey) {
  const result = await post('/api/register', { username, password, cardKey });
  assert.equal(result.status, 200, `注册应成功：${JSON.stringify(result.body)}`);
  return result.body.data;
}

test('注册卡密可以找回密码并使旧会话失效', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30, note: '找回测试' });
  await registerUser('farmer_a', 'oldpass123', card.code);

  const forgot = await post('/api/forgot-password', {
    username: 'farmer_a',
    cardKey: card.code.toLowerCase(),
    newPassword: 'newpass456',
  });
  assert.equal(forgot.status, 200);
  assert.equal(forgot.body.ok, true);

  // 新密码可登录、旧密码失效
  assert.ok(userStore.verifyPassword('farmer_a', 'newpass456'));
  assert.equal(userStore.verifyPassword('farmer_a', 'oldpass123'), null);

  // 成功后踢掉该用户的在线会话
  assert.ok(invalidatedPredicates.length >= 1);
  assert.equal(invalidatedPredicates.at(-1)({ username: 'farmer_a' }), true);
  assert.equal(invalidatedPredicates.at(-1)({ username: 'farmer_b' }), false);
});

test('续费卡密同样可以用于找回密码', async () => {
  const [regCard] = userStore.createCardKeys({ count: 1, days: 30 });
  const [renewCard] = userStore.createCardKeys({ count: 1, days: 15 });
  await registerUser('farmer_b', 'pass111111', regCard.code);

  const renew = await post('/api/renew', { username: 'farmer_b', cardKey: renewCard.code });
  assert.equal(renew.status, 200);

  const forgot = await post('/api/forgot-password', {
    username: 'farmer_b',
    cardKey: renewCard.code,
    newPassword: 'pass222222',
  });
  assert.equal(forgot.status, 200);
  assert.ok(userStore.verifyPassword('farmer_b', 'pass222222'));
});

test('卡密不匹配时统一报错且不修改密码', async () => {
  const [regCard] = userStore.createCardKeys({ count: 1, days: 30 });
  const [otherCard] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('farmer_c', 'pass111111', regCard.code);

  const forgot = await post('/api/forgot-password', {
    username: 'farmer_c',
    cardKey: otherCard.code,
    newPassword: 'pass222222',
  });
  assert.equal(forgot.status, 400);
  assert.equal(forgot.body.error, '用户名或绑定卡密不匹配');
  assert.ok(userStore.verifyPassword('farmer_c', 'pass111111'));

  // 用户名不存在也返回同样错误，避免探测用户名
  const unknown = await post('/api/forgot-password', {
    username: 'no_such_user',
    cardKey: regCard.code,
    newPassword: 'pass222222',
  }, '203.0.113.11');
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, '用户名或绑定卡密不匹配');
});

test('超级管理员不能通过卡密找回密码', async () => {
  const [card] = userStore.createCardKeys({ count: 1, days: 30 });
  const forgot = await post('/api/forgot-password', {
    username: userStore.SUPER_ADMIN_USERNAME,
    cardKey: card.code,
    newPassword: 'pass222222',
  });
  assert.equal(forgot.status, 400);
  assert.equal(forgot.body.error, '用户名或绑定卡密不匹配');
});

test('新密码过短或两次信息缺失时返回明确错误', async () => {
  const [regCard] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('farmer_d', 'pass111111', regCard.code);

  const shortPwd = await post('/api/forgot-password', {
    username: 'farmer_d',
    cardKey: regCard.code,
    newPassword: '12345',
  });
  assert.equal(shortPwd.status, 400);
  assert.equal(shortPwd.body.error, '新密码至少 6 位');

  const missing = await post('/api/forgot-password', { username: 'farmer_d' });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error, '请填写用户名、绑定卡密和新密码');
});

test('连续失败会触发临时锁定', async () => {
  const [regCard] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('farmer_e', 'pass111111', regCard.code);

  for (let i = 0; i < 5; i += 1) {
    const attempt = await post('/api/forgot-password', {
      username: 'farmer_e',
      cardKey: 'FARM-WRNG-KEYS-0000',
      newPassword: 'pass222222',
    }, '203.0.113.12');
    assert.equal(attempt.status, 400);
  }

  // 第 6 次即使卡密正确也会被锁定
  const locked = await post('/api/forgot-password', {
    username: 'farmer_e',
    cardKey: regCard.code,
    newPassword: 'pass222222',
  }, '203.0.113.12');
  assert.equal(locked.status, 429);
  assert.match(locked.body.error, /尝试次数过多/);

  // 其他来源地址不受影响
  const otherKey = await post('/api/forgot-password', {
    username: 'farmer_e',
    cardKey: 'FARM-WRNG-KEYS-0000',
    newPassword: 'pass222222',
  }, '203.0.113.13');
  assert.equal(otherKey.status, 400);
});

test('伪造 X-Forwarded-For 不能绕过失败锁定', async () => {
  const [regCard] = userStore.createCardKeys({ count: 1, days: 30 });
  await registerUser('farmer_f', 'pass111111', regCard.code);

  // 每次失败都换一个伪造的 X-Forwarded-For，来源地址保持不变
  for (let i = 0; i < 5; i += 1) {
    const attempt = await post('/api/forgot-password', {
      username: 'farmer_f',
      cardKey: 'FARM-WRNG-KEYS-0000',
      newPassword: 'pass222222',
    }, '198.51.100.7', `10.0.0.${i + 1}`);
    assert.equal(attempt.status, 400);
  }

  // 换一个伪造来源 + 正确卡密，仍然应该被锁住
  const locked = await post('/api/forgot-password', {
    username: 'farmer_f',
    cardKey: regCard.code,
    newPassword: 'pass222222',
  }, '198.51.100.7', '10.0.0.99');
  assert.equal(locked.status, 429);
  assert.match(locked.body.error, /尝试次数过多/);

  // 真正的另一个来源地址不受影响，正常重置成功
  const otherSource = await post('/api/forgot-password', {
    username: 'farmer_f',
    cardKey: regCard.code,
    newPassword: 'pass222222',
  }, '198.51.100.8');
  assert.equal(otherSource.status, 200);
  assert.ok(userStore.verifyPassword('farmer_f', 'pass222222'));
});
