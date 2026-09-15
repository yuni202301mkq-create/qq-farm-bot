const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录，必须在 require user-store 之前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-card-key-types-'));
process.env.FARM_DATA_DIR = dataDir;

const userStore = require('../src/models/user-store');
const { registerAdminAuthRoutes } = require('../src/controllers/admin-auth-routes');
const { registerAdminCardKeyRoutes } = require('../src/controllers/admin-card-key-routes');
const { registerAdminCurrentUserRoutes } = require('../src/controllers/admin-current-user-routes');

// 路由收集：key 为 `METHOD path`
const handlers = new Map();
const app = {
  get: (routePath, ...rest) => handlers.set(`GET ${routePath}`, rest[rest.length - 1]),
  post: (routePath, ...rest) => handlers.set(`POST ${routePath}`, rest[rest.length - 1]),
  patch: (routePath, ...rest) => handlers.set(`PATCH ${routePath}`, rest[rest.length - 1]),
  delete: (routePath, ...rest) => handlers.set(`DELETE ${routePath}`, rest[rest.length - 1]),
};

registerAdminAuthRoutes({
  app,
  createAdminSession: user => `token-${user.username}`,
  updateAdminSessions: () => {},
  invalidateAdminSessions: () => {},
});

registerAdminCardKeyRoutes({
  app,
  requireAdminToken: (_req, _res, next) => next && next(),
  requireSuperAdminRole: (_req, _res, next) => next && next(),
  invalidateAdminSessions: () => {},
  updateAdminSessions: () => {},
});

registerAdminCurrentUserRoutes({
  app,
  requireAdminToken: (_req, _res, next) => next && next(),
  userStore,
  store: {},
  updateAdminSessions: () => {},
  refreshTokens: null,
});

/** 调用已注册路由；currentUser 非空时模拟已登录用户 */
function call(method, routePath, body, { currentUser = null } = {}) {
  return new Promise((resolve) => {
    const req = {
      body: body || {},
      params: {},
      currentUser,
      ip: '203.0.113.9',
      headers: {},
      socket: { remoteAddress: '203.0.113.9' },
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
    handlers.get(`${method} ${routePath}`)(req, res);
  });
}

let seq = 0;
function uniqueName(prefix) {
  seq += 1;
  return `${prefix}_${seq}`;
}

function generateKey(type, extra = {}) {
  return userStore.createCardKeys({ count: 1, type, ...extra })[0];
}

// ---------- 字段互斥 ----------

test('时效卡密只带天数，额度固定为 0', () => {
  const key = generateKey('duration', { days: 45, accountLimit: 9 });
  assert.equal(key.type, 'duration');
  assert.equal(key.days, 45);
  assert.equal(key.accountLimit, 0);
});

test('额度账号卡密只带额度，天数固定为 0', () => {
  const key = generateKey('quota', { days: 45, accountLimit: 3 });
  assert.equal(key.type, 'quota');
  assert.equal(key.days, 0);
  assert.equal(key.accountLimit, 3);
});

test('缺省类型按时效卡密处理', () => {
  const key = userStore.createCardKeys({ count: 1, days: 10 })[0];
  assert.equal(key.type, 'duration');
  assert.equal(key.days, 10);
  assert.equal(key.accountLimit, 0);
});

// ---------- 旧记录归一化 ----------

test('旧记录无 type 时按携带的字段推断类型', () => {
  assert.equal(userStore.normalizeCardKeyType({ days: 30, accountLimit: 2 }), 'duration');
  assert.equal(userStore.normalizeCardKeyType({ days: 0, accountLimit: 2 }), 'quota');
  assert.equal(userStore.normalizeCardKeyType({}), 'duration');

  // 归一化同时把不属于该类型的字段清零，避免激活时串味
  const normalized = userStore.normalizeCardKey({ days: 30, accountLimit: 2 });
  assert.equal(normalized.type, 'duration');
  assert.equal(normalized.days, 30);
  assert.equal(normalized.accountLimit, 0);
});

// ---------- 登录前路径 ----------

test('登录前注册只接受时效卡密', async () => {
  const key = generateKey('duration', { days: 15 });
  const username = uniqueName('reg_duration');
  const result = await call('POST', '/api/register', {
    username,
    password: 'pass123456',
    cardKey: key.code,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);

  const user = userStore.findUser(username);
  const days = Math.round((user.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
  assert.equal(days, 15);
  // 额度不通过卡密发放，取默认值
  assert.equal(user.accountLimit, userStore.DEFAULT_ACCOUNT_LIMIT);
});

test('登录前注册拒绝额度账号卡密，且不消耗该卡密', async () => {
  const key = generateKey('quota', { accountLimit: 5 });
  const result = await call('POST', '/api/register', {
    username: uniqueName('reg_quota'),
    password: 'pass123456',
    cardKey: key.code,
  });
  assert.equal(result.status, 400);
  assert.match(result.body.error, /额度账号卡密只能在登录后激活/);

  // 关键：拒绝时不能把卡密标记为已使用，否则用户手里的卡就废了
  const stored = userStore.findCardKey(key.code);
  assert.equal(stored.usedBy, null);
  assert.equal(stored.usedAt, null);

  // 卡密仍可在登录后正常激活
  const username = uniqueName('reg_quota_later');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });
  const redeem = await call(
    'POST',
    '/api/user/card-redeem',
    { cardKey: key.code },
    { currentUser: userStore.findUser(username) },
  );
  assert.equal(redeem.status, 200);
  assert.equal(redeem.body.data.accountLimitAdded, 5);
});

test('登录前续费只接受时效卡密，额度卡密被拒且不消耗', async () => {
  const username = uniqueName('renew');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });

  const quotaKey = generateKey('quota', { accountLimit: 4 });
  const rejected = await call('POST', '/api/renew', { username, cardKey: quotaKey.code });
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error, /额度账号卡密只能在登录后激活/);
  assert.equal(userStore.findCardKey(quotaKey.code).usedBy, null);

  const durationKey = generateKey('duration', { days: 20 });
  const accepted = await call('POST', '/api/renew', { username, cardKey: durationKey.code });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.type, 'duration');
  assert.equal(accepted.body.data.days, 20);

  const user = userStore.findUser(username);
  const days = Math.round((user.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
  assert.equal(days, 20);
  // 续费不应改动额度
  assert.equal(user.accountLimit, userStore.DEFAULT_ACCOUNT_LIMIT);
});

// ---------- 登录后路径 ----------

test('登录后激活时效卡密只延长有效期，不动额度', async () => {
  const username = uniqueName('redeem_duration');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });
  const before = userStore.findUser(username);

  const key = generateKey('duration', { days: 12 });
  const result = await call(
    'POST',
    '/api/user/card-redeem',
    { cardKey: key.code },
    { currentUser: before },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.data.type, 'duration');
  assert.equal(result.body.data.days, 12);
  assert.equal(result.body.data.accountLimitAdded, 0);

  const after = userStore.findUser(username);
  assert.equal(after.accountLimit, before.accountLimit);
  const days = Math.round((after.expiresAt - Date.now()) / (24 * 60 * 60 * 1000));
  assert.equal(days, 12);
});

test('登录后激活额度账号卡密只增加额度，不动有效期', async () => {
  const username = uniqueName('redeem_quota');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });
  const before = userStore.findUser(username);
  const baseLimit = before.accountLimit;

  const key = generateKey('quota', { accountLimit: 3 });
  const result = await call(
    'POST',
    '/api/user/card-redeem',
    { cardKey: key.code },
    { currentUser: before },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.data.type, 'quota');
  assert.equal(result.body.data.accountLimitAdded, 3);
  assert.equal(result.body.data.accountLimit, baseLimit + 3);

  const after = userStore.findUser(username);
  assert.equal(after.accountLimit, baseLimit + 3);
  // 额度卡密不应顺带延长有效期
  assert.equal(after.expiresAt, before.expiresAt);
});

test('额度账号卡密可叠加，多次激活累加额度', async () => {
  const username = uniqueName('redeem_quota_stack');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });
  const baseLimit = userStore.findUser(username).accountLimit;

  const first = generateKey('quota', { accountLimit: 2 });
  const second = generateKey('quota', { accountLimit: 5 });

  await call('POST', '/api/user/card-redeem', { cardKey: first.code }, { currentUser: userStore.findUser(username) });
  await call('POST', '/api/user/card-redeem', { cardKey: second.code }, { currentUser: userStore.findUser(username) });

  assert.equal(userStore.findUser(username).accountLimit, baseLimit + 7);
});

test('登录后查询卡密会返回类型，且不消耗卡密', async () => {
  const username = uniqueName('inspect');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });
  const currentUser = userStore.findUser(username);

  const quotaKey = generateKey('quota', { accountLimit: 6, note: '季度额度卡' });
  const result = await call(
    'POST',
    '/api/user/card-inspect',
    { cardKey: quotaKey.code },
    { currentUser },
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.data.type, 'quota');
  assert.equal(result.body.data.accountLimit, 6);
  assert.equal(result.body.data.days, 0);
  assert.equal(result.body.data.note, '季度额度卡');

  // 查询不应消耗卡密
  assert.equal(userStore.findCardKey(quotaKey.code).usedBy, null);
});

test('已使用的卡密不能重复激活', async () => {
  const username = uniqueName('redeem_reuse');
  userStore.createUser({ username, password: 'pass123456', role: 'user' });
  const currentUser = userStore.findUser(username);

  const key = generateKey('duration', { days: 5 });
  const first = await call('POST', '/api/user/card-redeem', { cardKey: key.code }, { currentUser });
  assert.equal(first.status, 200);

  const second = await call('POST', '/api/user/card-redeem', { cardKey: key.code }, { currentUser });
  assert.equal(second.status, 400);
  assert.match(second.body.error, /已被使用/);
});

test('超级管理员不能使用卡密', async () => {
  const username = uniqueName('super');
  userStore.createUser({ username, password: 'pass123456', role: 'super_admin' });
  const key = generateKey('quota', { accountLimit: 3 });
  const result = await call(
    'POST',
    '/api/user/card-redeem',
    { cardKey: key.code },
    { currentUser: userStore.findUser(username) },
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /超级管理员无需使用卡密/);
  assert.equal(userStore.findCardKey(key.code).usedBy, null);
});

// ---------- 管理端生成与列表 ----------

test('生成接口按类型透传，并返回 type 与 typeText', async () => {
  const duration = await call('POST', '/api/card-keys/generate', {
    count: 2,
    type: 'duration',
    days: 30,
    accountLimit: 8,
  });
  assert.equal(duration.status, 200);
  assert.equal(duration.body.data.length, 2);
  for (const key of duration.body.data) {
    assert.equal(key.type, 'duration');
    assert.equal(key.typeText, '时效卡密');
    assert.equal(key.days, 30);
    assert.equal(key.accountLimit, 0);
  }

  const quota = await call('POST', '/api/card-keys/generate', {
    count: 1,
    type: 'quota',
    days: 30,
    accountLimit: 8,
  });
  assert.equal(quota.status, 200);
  assert.equal(quota.body.data[0].type, 'quota');
  assert.equal(quota.body.data[0].typeText, '额度账号卡密');
  assert.equal(quota.body.data[0].days, 0);
  assert.equal(quota.body.data[0].accountLimit, 8);
});

test('卡密列表透出类型字段', async () => {
  const quotaKey = generateKey('quota', { accountLimit: 2 });
  const result = await call('GET', '/api/card-keys');
  assert.equal(result.status, 200);
  const row = result.body.data.find(item => item.code === quotaKey.code);
  assert.ok(row);
  assert.equal(row.type, 'quota');
  assert.equal(row.typeText, '额度账号卡密');
});

// ---------- 免费试用卡密 ----------

test('免费试用卡密是时效卡密，不带额度', async () => {
  const card = userStore.claimFreeCard({ address: '198.51.100.77', deviceId: 'dev-card-type' });
  assert.equal(card.type, 'duration');
  assert.equal(card.days, userStore.FREE_CARD_DAYS);
  assert.equal(card.accountLimit, 0);

  const free = await call('POST', '/api/free-card', { deviceId: 'dev-card-type-2' });
  assert.equal(free.status, 200);
  assert.equal(free.body.data.type, 'duration');
  assert.equal(free.body.data.days, 7);
  assert.equal(free.body.data.accountLimit, undefined);
});
