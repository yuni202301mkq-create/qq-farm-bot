const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// 隔离数据目录，必须在 require stats 之前设置
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'farm-consumption-'));
process.env.FARM_DATA_DIR = dataDir;

const stats = require('../src/services/stats');

test('偷菜上下文 + 金币下降 → 归因为被看护犬扣款', () => {
  stats.initStatsWithPersistence('acc-1', 1000, 10, 0);

  // 无下降时不产生记录
  stats.updateStats(1200, 10);
  assert.equal(stats.getConsumptionCount(), 0);

  stats.markPendingSpend({ type: 'steal_dog_fine', friend: '小果', crop: '蘑菇' });
  stats.updateStats(1118, 10);

  const records = stats.getConsumptionRecords();
  assert.equal(records.length, 1);
  assert.equal(records[0].title, '偷菜被看护犬扣款');
  assert.equal(records[0].amount, 82);
  assert.equal(records[0].currency, 'gold');
  assert.equal(records[0].currencyLabel, '金币');
  assert.ok(records[0].detail.includes('小果'));
  assert.ok(records[0].detail.includes('蘑菇'));
  assert.ok(records[0].ts > 0);
});

test('无上下文的金币下降 → 通用消耗记录', () => {
  stats.updateStats(1100, 10);
  const records = stats.getConsumptionRecords();
  assert.equal(records.length, 2);
  assert.equal(records[0].title, '金币消耗');
  assert.equal(records[0].amount, 18);
  // 最新在前
  assert.ok(records[0].ts >= records[1].ts);
});

test('金币上升不产生消费记录', () => {
  const before = stats.getConsumptionCount();
  stats.updateStats(1500, 10);
  assert.equal(stats.getConsumptionCount(), before);
});

test('getStats 返回消费条数', () => {
  const snapshot = stats.getStats({}, { gold: 1500, exp: 10 }, true, {});
  assert.equal(snapshot.consumptionCount, stats.getConsumptionCount());
  assert.ok(snapshot.consumptionCount >= 2);
});

test('账号重新启动（本次在线）清空消费记录', () => {
  assert.ok(stats.getConsumptionCount() > 0);
  stats.initStatsWithPersistence('acc-1', 1000, 10, 0);
  assert.equal(stats.getConsumptionCount(), 0);
  assert.deepEqual(stats.getConsumptionRecords(), []);
});

test('上下文带 2 分钟 TTL，过期后退化为通用消耗', () => {
  stats.markPendingSpend({ type: 'steal_dog_fine', friend: '旧好友', crop: '旧作物', at: Date.now() - 3 * 60 * 1000 });
  stats.updateStats(900, 10);
  const records = stats.getConsumptionRecords();
  assert.equal(records[0].title, '金币消耗');
});
