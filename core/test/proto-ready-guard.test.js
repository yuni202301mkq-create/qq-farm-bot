/**
 * protobuf 消息类型的就绪守卫。
 *
 * 回归背景：worker 在 spawn 后立刻被注册进 worker-manager，而 proto 是异步加载的。
 * 旧实现里 waitForProtoReady() 用 `if (root) return true` 判断就绪，但 root 在
 * `await root.load([...])` 返回时就已经非空，而 types 要到之后逐个 lookupType 才填满。
 * 窗口内 types.ShopInfoRequest 是 undefined，farm-api 的
 * `types.ShopInfoRequest.encode(...)` 会抛
 * "Cannot read properties of undefined (reading 'encode')"，
 * 并被 planting-service 的 catch 吞掉、静默回退到本地备选种子列表。
 *
 * 注意：本文件内的用例共享同一个模块单例，且「未就绪」状态只在模块首次加载时存在，
 * 因此用例之间有顺序依赖，必须按文件中的书写顺序执行。
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const protobuf = require('protobufjs');

// 隔离日志与数据目录，避免测试污染真实 data 目录
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-proto-ready-'));
process.env.FARM_DATA_DIR = tmpDir;

const proto = require('../src/utils/proto');

test('proto 就绪前：等待超时给出明确错误，而不是永久挂起', async () => {
  assert.equal(proto.isProtoReady(), false, '模块刚加载时不应处于就绪状态');
  assert.deepStrictEqual(Object.keys(proto.types), [], '模块刚加载时不应有任何消息类型');
  assert.equal(proto.getRoot(), null);

  await assert.rejects(
    () => proto.waitForProtoReady(20),
    /等待 Protobuf 定义加载超时/,
  );
});

test('proto 加载失败：等待方拿到可读错误', async () => {
  const originalLoad = protobuf.Root.prototype.load;
  protobuf.Root.prototype.load = () => Promise.reject(new Error('mock proto load failure'));

  try {
    // 等待方必须在加载进行中注册，才验证得到「失败时被唤醒」这条路径
    const loading = proto.loadProto();
    const waiting = proto.waitForProtoReady();

    await assert.rejects(() => loading, /mock proto load failure/);
    assert.equal(proto.isProtoReady(), false, '加载失败后不应被标记为就绪');

    // 关键：失败也必须唤醒等待方，不能让它一直挂着直到超时
    await assert.rejects(
      () => waiting,
      /Protobuf 定义加载失败，无法编解码消息/,
    );
  } finally {
    protobuf.Root.prototype.load = originalLoad;
  }
});

test('proto 加载窗口内：waitForProtoReady 不会提前放行', async () => {
  const loading = proto.loadProto();

  // loadProto 是 async，调用后会同步执行到第一个 await（root.load）。
  // 此刻 root 已经非空、types 仍为空 —— 这正是旧守卫 `if (root) return true` 的误判窗口。
  assert.ok(proto.getRoot(), '窗口内 root 应已非空（旧守卫的误判点）');
  assert.deepStrictEqual(Object.keys(proto.types), [], '窗口内 types 应仍为空');
  assert.equal(proto.isProtoReady(), false);

  let readyAtResolve = null;
  const guard = proto.waitForProtoReady().then(() => {
    readyAtResolve = proto.isProtoReady();
  });

  await loading;
  await guard;

  // 旧实现会在这里拿到 false：它在 root 非空时就直接放行了
  assert.equal(readyAtResolve, true, 'waitForProtoReady 放行时必须已经真正就绪');
});

test('proto 就绪后：类型可用且编解码往返正确', async () => {
  await proto.loadProto();

  assert.equal(proto.isProtoReady(), true);
  assert.equal(await proto.waitForProtoReady(), true, '就绪后应同步放行');
  assert.equal(typeof proto.types.ShopInfoRequest.encode, 'function');
  assert.equal(typeof proto.types.ShopInfoReply.decode, 'function');

  // 种子商店 ID 在协议与管理面板中都固定为 2，这里顺带确认编码路径可跑通
  const payload = proto.types.ShopInfoRequest.encode(
    proto.types.ShopInfoRequest.create({ shop_id: 2 }),
  ).finish();
  const decoded = proto.types.ShopInfoRequest.decode(payload);
  assert.equal(Number(decoded.shop_id), 2);
});
