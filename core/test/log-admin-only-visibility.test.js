/**
 * 日志可见性：adminOnly 的日志（含 serverUrl 等内部配置）只对管理员可见。
 *
 * 背景：`已加载系统配置: serverUrl=wss://...` 这类引擎级日志没有 accountId，
 * 而 socket 订阅快照的过滤里有 `if (!logAccountId) return true;`，
 * 于是普通用户在「系统」日志里也能看到 serverUrl。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createAdminAccountAccess } = require('../src/controllers/admin-account-access');

const ACCOUNTS = [
  { id: '1', username: 'alice' },
  { id: '2', username: 'bob' },
];

function createAccess() {
  return createAdminAccountAccess({
    store: { getAccounts: () => ({ accounts: ACCOUNTS }) },
    getProvider: () => ({ getAccounts: () => ({ accounts: ACCOUNTS }) }),
  });
}

const SYSTEM_CONFIG_LOG = {
  logId: 'a',
  msg: '已加载系统配置: serverUrl=wss://gate-obt.nqf.qq.com/prod/ws, clientVersion=1.14.0.4_20260911, platform=wx',
  adminOnly: true,
};
const PLAIN_SYSTEM_LOG = { logId: 'b', msg: '未发现账号，请访问管理面板添加账号' };
const ALICE_LOG = { logId: 'c', msg: '收获完成', accountId: '1' };
const BOB_LOG = { logId: 'd', msg: '收获完成', accountId: '2' };
const ALICE_ADMIN_LOG = { logId: 'e', msg: '内部诊断', accountId: '1', adminOnly: true };

const ALL_LOGS = [SYSTEM_CONFIG_LOG, PLAIN_SYSTEM_LOG, ALICE_LOG, BOB_LOG, ALICE_ADMIN_LOG];
const ids = (logs) => logs.map((entry) => entry.logId);

test('普通用户看不到 adminOnly 日志，管理员能看到', () => {
  const access = createAccess();
  const forUser = access.filterLogsForUser(ALL_LOGS, { role: 'user', username: 'alice' });
  const forAdmin = access.filterLogsForUser(ALL_LOGS, { role: 'admin', username: 'root' });
  const forSuper = access.filterLogsForUser(ALL_LOGS, { role: 'super_admin', username: 'root' });

  assert.ok(!ids(forUser).includes('a'), '普通用户不应看到含 serverUrl 的日志');
  assert.ok(ids(forAdmin).includes('a'), '管理员应保留该日志');
  assert.ok(ids(forSuper).includes('a'), '超级管理员应保留该日志');
});

test('带 accountId 的 adminOnly 日志对普通用户同样不可见', () => {
  const access = createAccess();
  const forUser = access.filterLogsForUser(ALL_LOGS, { role: 'user', username: 'alice' });
  assert.ok(!ids(forUser).includes('e'), 'adminOnly 优先于账号归属判断');
  assert.ok(ids(access.filterLogsForUser(ALL_LOGS, { role: 'admin' })).includes('e'));
});

test('普通用户只看得到自己账号的日志', () => {
  const access = createAccess();
  const forUser = access.filterLogsForUser(ALL_LOGS, { role: 'user', username: 'alice' });
  assert.deepStrictEqual(ids(forUser), ['b', 'c'], '应只剩系统提示与 alice 自己的日志');
});

test('未标记 adminOnly 的系统级日志对普通用户仍然可见', () => {
  const access = createAccess();
  const forUser = access.filterLogsForUser([PLAIN_SYSTEM_LOG], { role: 'user', username: 'alice' });
  assert.deepStrictEqual(ids(forUser), ['b'], '不能因为这次修复就把所有系统日志一刀切隐藏');
});

test('管理员仍能看到全部账号的日志（账号过滤行为未被放宽或收紧）', () => {
  const access = createAccess();
  const forAdmin = access.filterLogsForUser(ALL_LOGS, { role: 'admin' });
  assert.deepStrictEqual(ids(forAdmin), ['a', 'b', 'c', 'd', 'e']);
});

test('空列表与非法条目不会抛错', () => {
  const access = createAccess();
  assert.deepStrictEqual(access.filterLogsForUser([], { role: 'user', username: 'alice' }), []);
  assert.deepStrictEqual(access.filterLogsForUser(null, { role: 'user', username: 'alice' }), []);
  assert.deepStrictEqual(
    ids(access.filterLogsForUser([null, undefined, PLAIN_SYSTEM_LOG], { role: 'user', username: 'alice' })),
    ['b'],
  );
});

test('「已加载系统配置」这条日志必须带 adminOnly 标记', () => {
  // 标记与过滤是两处配合的契约：谁把标记删了，serverUrl 就会重新出现在普通用户的日志里
  const source = fs.readFileSync(
    path.join(__dirname, '../src/runtime/runtime-engine.js'),
    'utf8',
  );
  const index = source.indexOf('已加载系统配置');
  assert.ok(index > 0, '应能在 runtime-engine 中找到该日志');
  const callText = source.slice(index, source.indexOf('});', index));
  assert.match(callText, /adminOnly:\s*true/, '该日志缺少 adminOnly 标记，普通用户会看到 serverUrl');
});
