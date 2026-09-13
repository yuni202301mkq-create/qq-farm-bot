const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  DEFAULT_TTL_MS,
  createAdminRefreshTokenStore,
  hashToken,
} = require('../src/services/admin-refresh-tokens');

/** 每个用例一个独立临时目录，避免互相干扰 */
function withStore(fn, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-tokens-'));
  const filePath = path.join(dir, 'admin-refresh-tokens.json');
  const store = createAdminRefreshTokenStore({ filePath, ...options });
  try {
    return fn(store, filePath, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('issue 返回明文 token，且落盘文件里只有哈希没有明文', () => {
  withStore((store, filePath) => {
    const { token } = store.issue({ username: 'alice' });
    assert.ok(token && token.length === 64, '明文 token 应为 32 字节 hex');

    const raw = fs.readFileSync(filePath, 'utf8');
    assert.equal(raw.includes(token), false, '落盘文件不能包含明文 token');
    assert.equal(raw.includes(hashToken(token)), true, '落盘文件应包含哈希');
  });
});

test('rotate 用旧 token 换新，且旧 token 立刻失效（单次使用）', () => {
  withStore((store) => {
    const first = store.issue({ username: 'alice' });
    const rotated = store.rotate(first.token);

    assert.ok(rotated, '首次 rotate 应成功');
    assert.equal(rotated.username, 'alice');
    assert.notEqual(rotated.token, first.token, '应返回新的 token');

    // 同一个旧 token 再用一次必须失败（防重放）
    assert.equal(store.rotate(first.token), null, '旧 token 不能二次使用');
    // 新 token 可以用
    assert.ok(store.rotate(rotated.token), '新 token 应可用');
  });
});

test('rotate 遇到不存在的 token 或空值返回 null', () => {
  withStore((store) => {
    assert.equal(store.rotate(''), null);
    assert.equal(store.rotate(null), null);
    assert.equal(store.rotate('not-a-real-token'), null);
  });
});

test('过期的 refresh token 无法再换 session', () => {
  // 有效期设为 -1ms，签发即过期
  withStore((store) => {
    const { token } = store.issue({ username: 'bob' });
    assert.equal(store.rotate(token), null, '过期 token 应失效');
    assert.equal(store.count(), 0, '过期记录应被清理');
  }, { ttlMs: -1 });
});

test('默认 TTL 是 30 天', () => {
  assert.equal(DEFAULT_TTL_MS, 30 * 24 * 60 * 60 * 1000);
});

test('revokeUser 只撤销该用户的 token', () => {
  withStore((store) => {
    const alice = store.issue({ username: 'alice' });
    const bob = store.issue({ username: 'bob' });

    const revoked = store.revokeUser('alice');
    assert.equal(revoked, 1, '应撤销 alice 的 1 条');
    assert.equal(store.rotate(alice.token), null, 'alice 的 token 已失效');
    assert.ok(store.rotate(bob.token), 'bob 的 token 不受影响');
  });
});

test('revokeAll 清空全部 token', () => {
  withStore((store) => {
    const a = store.issue({ username: 'a' });
    const b = store.issue({ username: 'b' });
    assert.equal(store.revokeAll(), 2);
    assert.equal(store.count(), 0);
    assert.equal(store.rotate(a.token), null);
    assert.equal(store.rotate(b.token), null);
  });
});

test('revokeToken 只撤销指定那一个', () => {
  withStore((store) => {
    const a = store.issue({ username: 'a' });
    const b = store.issue({ username: 'b' });
    assert.equal(store.revokeToken(a.token), 1);
    assert.equal(store.rotate(a.token), null);
    assert.ok(store.rotate(b.token));
  });
});

test('重启后（新 store 实例读同一文件）仍能换 session', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-restart-'));
  const filePath = path.join(dir, 'admin-refresh-tokens.json');
  try {
    const before = createAdminRefreshTokenStore({ filePath });
    const { token } = before.issue({ username: 'carol' });

    // 模拟 bot 重启：内存里的东西全丢，重新从文件加载
    const after = createAdminRefreshTokenStore({ filePath });
    assert.equal(after.count(), 1, '重启后应恢复已保存的 token');
    const rotated = after.rotate(token);
    assert.ok(rotated, '重启后应能凭旧 token 换新 session');
    assert.equal(rotated.username, 'carol');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('文件损坏时不会让 bot 起不来（降级为空）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refresh-corrupt-'));
  const filePath = path.join(dir, 'admin-refresh-tokens.json');
  try {
    fs.writeFileSync(filePath, '{ this is not json', 'utf8');
    const store = createAdminRefreshTokenStore({ filePath });
    assert.equal(store.count(), 0, '损坏文件应被忽略');
    // 还能正常签发新的
    assert.ok(store.issue({ username: 'dave' }).token);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('username 为空时签发直接报错', () => {
  withStore((store) => {
    assert.throws(() => store.issue({ username: '' }));
    assert.throws(() => store.issue({}));
  });
});
