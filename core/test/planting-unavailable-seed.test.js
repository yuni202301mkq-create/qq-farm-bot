const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-unavailable-seed-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const MODULE_PATHS = {
  network: require.resolve('../src/utils/network'),
  proto: require.resolve('../src/utils/proto'),
  utils: require.resolve('../src/utils/utils'),
  gameConfig: require.resolve('../src/config/gameConfig'),
  analytics: require.resolve('../src/services/analytics'),
  warehouse: require.resolve('../src/services/warehouse'),
  farmApi: require.resolve('../src/services/farm-api'),
  landAnalyzer: require.resolve('../src/services/farm-land-analyzer'),
  fertilizer: require.resolve('../src/services/farm-fertilizer'),
  service: require.resolve('../src/services/planting-service'),
};

function mockModule(filename, exports) {
  return { id: filename, filename, loaded: true, exports };
}

function seed(seedId, count = 3, name = `种子${seedId}`) {
  return { seedId, name, count, requiredLevel: 0, plantSize: 1, rarity: 0, plantExp: 0 };
}

/**
 * 加载带桩的 planting-service：
 * - reactions: Map<seedId, 'ok' | `error:code=1003005 格子已锁定` | `error:其它错误`>
 * - 返回 attempts 记录每一次真实的 Plant 请求（种植顺序即从这里读出）
 */
function loadService({ bagSeeds, reactions }) {
  const attempts = [];
  const requests = [];
  const logs = [];
  let replyLands = [];
  const previous = new Map(Object.values(MODULE_PATHS).map(item => [item, require.cache[item]]));

  require.cache[MODULE_PATHS.network] = mockModule(MODULE_PATHS.network, {
    sendMsgAsync: async (service, method, payload) => {
      const request = JSON.parse(Buffer.from(payload).toString('utf8'));
      const item = (request.items || [])[0] || {};
      const seedId = Number(item.seed_id);
      const landIds = (item.land_ids || []).map(Number);
      requests.push({ seedId, landIds });
      for (const landId of landIds) attempts.push({ seedId, landId });
      const reaction = reactions.get(seedId);
      if (typeof reaction === 'string' && reaction.startsWith('error:')) {
        throw new Error(`gamepb.plantpb.PlantService.Plant 错误: ${reaction.slice('error:'.length)}`);
      }
      // 2x2 请求（4 块地）需要回包确认主地块与从属关系，否则 plant2x2Seed 会判定失败。
      if (landIds.length > 1) {
        const masterLandId = landIds[0];
        replyLands = [
          { id: masterLandId, land_size: 2, slave_land_ids: landIds.slice(1) },
          ...landIds.slice(1).map(id => ({ id, master_land_id: masterLandId })),
        ];
      }
      else {
        replyLands = landIds.map(id => ({ id }));
      }
      return { body: Buffer.alloc(0) };
    },
    getUserState: () => ({ level: 200, accountId: 'unavailable-seed-account' }),
    getWsErrorState: () => ({}),
  });
  require.cache[MODULE_PATHS.proto] = mockModule(MODULE_PATHS.proto, {
    types: {
      PlantRequest: {
        create: value => value,
        encode: value => ({ finish: () => Buffer.from(JSON.stringify(value)) }),
      },
      PlantReply: { decode: () => ({ land: replyLands }) },
    },
  });
  require.cache[MODULE_PATHS.utils] = mockModule(MODULE_PATHS.utils, {
    toNum: value => Number(value) || 0,
    toLong: value => Number(value) || 0,
    toTimeSec: value => Number(value) || 0,
    getServerTimeSec: () => 0,
    log: (tag, msg, meta) => logs.push({ level: 'info', tag, msg, meta }),
    logWarn: (tag, msg, meta) => logs.push({ level: 'warn', tag, msg, meta }),
    sleep: async () => {},
  });
  require.cache[MODULE_PATHS.gameConfig] = mockModule(MODULE_PATHS.gameConfig, {
    getPlantBySeedId: () => ({ size: 1, exp: 100, land_level_need: 1 }),
    getPlantById: () => null,
    getPlantNameBySeedId: id => `种子${id}`,
    getPlantGrowTime: () => 0,
    formatGrowTime: () => '',
    getAllSeeds: () => [],
  });
  require.cache[MODULE_PATHS.analytics] = mockModule(MODULE_PATHS.analytics, {
    getPlantRankings: () => [],
  });
  require.cache[MODULE_PATHS.warehouse] = mockModule(MODULE_PATHS.warehouse, {
    getBagSeeds: async () => bagSeeds,
  });
  require.cache[MODULE_PATHS.farmApi] = mockModule(MODULE_PATHS.farmApi, {
    getShopInfo: async () => ({ goods_list: [] }),
    buyGoods: async () => ({}),
    getSeedShopId: async () => 1,
    removePlant: async () => ({}),
  });
  require.cache[MODULE_PATHS.landAnalyzer] = mockModule(MODULE_PATHS.landAnalyzer, {
    buildLandMap: lands => new Map((lands || []).map(land => [Number(land.id), land])),
    getDisplayLandContext: land => ({
      occupiedLandIds: [Number(land.id)],
      masterLandId: Number(land.id),
    }),
  });
  require.cache[MODULE_PATHS.fertilizer] = mockModule(MODULE_PATHS.fertilizer, {
    runFertilizerByConfig: async () => {},
  });

  delete require.cache[MODULE_PATHS.service];
  const service = require('../src/services/planting-service');

  return {
    service,
    attempts,
    requests,
    logs,
    restore() {
      delete require.cache[MODULE_PATHS.service];
      for (const [item, cached] of previous.entries()) {
        if (cached) require.cache[item] = cached;
        else delete require.cache[item];
      }
    },
  };
}

function configurePriority(accountId, priority, extra = {}) {
  store.applyConfigSnapshot({ bagSeedPriority: priority, bagSeedExcludedIds: [], ...extra }, { accountId, persist: false });
}

/** 生成 24 块已解锁土地（4 列 × 6 行），2x2 组合锚点为左下角。 */
function unlockedLands() {
  return Array.from({ length: 24 }, (_, index) => ({ id: index + 1, unlocked: true }));
}

function size2Seed(seedId, count = 1, name = `四格种子${seedId}`) {
  return { seedId, name, count, requiredLevel: 0, plantSize: 2, rarity: 0, plantExp: 0 };
}

test('unavailable seed is skipped at once and the next priority seed fills the land', async () => {
  const accountId = 'unavailable-skip-next';
  configurePriority(accountId, [103, 101, 102]);
  const { service, attempts, logs, restore } = loadService({
    bagSeeds: [seed(101, 2), seed(102, 2), seed(103, 2)],
    reactions: new Map([[101, 'error:code=1003005 格子已锁定']]),
  });

  try {
    // 用户顺序 = 103 → 101 → 102，其中 101 被服务端判定为当前不可种植。
    const result = await service.plantFromBagSeeds([1, 2, 3, 4, 5], accountId);

    assert.deepEqual(attempts, [
      { seedId: 103, landId: 1 },
      { seedId: 103, landId: 2 },
      { seedId: 101, landId: 3 },
      { seedId: 102, landId: 3 },
      { seedId: 102, landId: 4 },
    ]);
    assert.equal(result.totalPlanted, 4);
    assert.deepEqual(result.remainingLandIds, [5]);
    // 不可种植的种子不再触发「为避免误购商店种子」的拦截，剩余空地仍可走第二优先策略。
    assert.equal(result.fallbackAllowed, true);
    assert.deepEqual(service.getUnavailableBagSeeds(accountId).map(item => item.seedId), [101]);
    assert.equal(
      logs.some(entry => entry.meta && entry.meta.result === 'skip_seed_unavailable' && entry.meta.seedId === 101),
      true
    );
  } finally {
    restore();
  }
});

test('cooling down seed is not retried on the next round and keeps its list position', async () => {
  const accountId = 'unavailable-cooldown';
  configurePriority(accountId, [103, 101, 102]);
  const { service, attempts, logs, restore } = loadService({
    bagSeeds: [seed(101, 2), seed(102, 2), seed(103, 2)],
    reactions: new Map([[101, 'error:code=1003005 格子已锁定']]),
  });

  try {
    await service.plantFromBagSeeds([1, 2, 3], accountId);
    const firstRoundAttempts = attempts.length;
    attempts.length = 0;

    const second = await service.plantFromBagSeeds([6, 7], accountId);

    // 第二轮里 101 完全不再尝试（冷却中），顺序仍是 103 → 102。
    assert.deepEqual(attempts, [
      { seedId: 103, landId: 6 },
      { seedId: 103, landId: 7 },
    ]);
    assert.equal(firstRoundAttempts, 4);
    assert.equal(second.totalPlanted, 2);
    assert.equal(
      logs.some(entry => entry.meta && entry.meta.result === 'skip_seed_unavailable' && entry.meta.strategy === 'bag_priority'),
      true
    );
  } finally {
    restore();
  }
});

test('cooldown expires so the seed rejoins the priority order automatically', () => {
  const accountId = 'unavailable-cooldown-ttl';
  const { service, restore } = loadService({ bagSeeds: [], reactions: new Map() });
  try {
    service.markBagSeedUnavailable(accountId, 101, 'code=1003005 格子已锁定');
    assert.equal(service.isBagSeedUnavailable(accountId, 101), true);

    service.markBagSeedUnavailable(accountId, 102, 'code=1003005 格子已锁定', Date.now() - 20 * 60 * 1000);
    assert.equal(service.isBagSeedUnavailable(accountId, 102), false);
    assert.deepEqual(service.getUnavailableBagSeeds(accountId).map(item => item.seedId), [101]);

    service.clearBagSeedUnavailable(accountId, 101);
    assert.equal(service.isBagSeedUnavailable(accountId, 101), false);
    assert.deepEqual(service.getUnavailableBagSeeds(accountId), []);
  } finally {
    restore();
  }
});

test('only seed-scoped rejections count as unavailable', () => {
  const { service, restore } = loadService({ bagSeeds: [], reactions: new Map() });
  try {
    assert.equal(service.isSeedUnavailableError(new Error('gamepb.plantpb.PlantService.Plant 错误: code=1003005 格子已锁定')), true);
    assert.equal(service.isSeedUnavailableError(new Error('gamepb.plantpb.PlantService.Plant 错误: code=1003009 等级不足')), true);
    assert.equal(service.isSeedUnavailableError('请求超时'), false);
    assert.equal(service.isSeedUnavailableError(new Error('土地#2 失败: 网络错误')), false);
    assert.equal(service.isSeedUnavailableError(new Error('土地已锁定，请先解锁')), false);
    assert.equal(service.isSeedUnavailableError(null), false);
  } finally {
    restore();
  }
});

test('transient failures still retry every land and keep the shop fallback blocked', async () => {
  const accountId = 'unavailable-transient';
  configurePriority(accountId, [101, 102]);
  const { service, attempts, restore } = loadService({
    bagSeeds: [seed(101, 3), seed(102, 3)],
    reactions: new Map([[101, 'error:网络抖动']]),
  });

  try {
    const result = await service.plantFromBagSeeds([1, 2], accountId);

    // 与「种子不可种植」不同：普通失败仍会逐块重试，并保留原有的保守策略。
    assert.deepEqual(attempts.filter(item => item.seedId === 101).map(item => item.landId), [1, 2]);
    assert.deepEqual(service.getUnavailableBagSeeds(accountId), []);
    assert.equal(result.fallbackAllowed, false);
  } finally {
    restore();
  }
});

test('2x2 seeds take part in the bag priority order when 四格优先 is on', async () => {
  const accountId = 'interleave-order';
  configurePriority(accountId, [29001, 101, 29002], { prioritize2x2Crops: true });
  const { service, requests, logs, restore } = loadService({
    bagSeeds: [size2Seed(29001, 1), seed(101, 2), size2Seed(29002, 1)],
    reactions: new Map(),
  });

  try {
    const result = await service.plantFromBagSeeds([1, 2, 5, 6, 3, 4, 7, 8], accountId, { lands: unlockedLands() });

    // 顺序 = 用户列表顺序：2x2 的 29001 → 单格 101 → 2x2 的 29002（凑不齐四格地，预留等待）。
    assert.deepEqual(requests.map(item => `${item.seedId}:${item.landIds.join('-')}`), [
      '29001:5-6-1-2',
      '101:3',
      '101:4',
    ]);
    assert.equal(result.totalPlanted, 3);
    assert.deepEqual(result.plantedLandIds.slice().sort((a, b) => a - b), [3, 4, 5]);
    assert.deepEqual(result.reservedLandIds.slice().sort((a, b) => a - b), [7, 8]);
    assert.deepEqual(result.remainingLandIds, []);
    assert.equal(
      logs.some(entry => entry.meta && entry.meta.result === 'waiting'),
      true
    );
    assert.equal(
      logs.some(entry => entry.meta && entry.meta.result === 'ok' && entry.meta.event === '种植2x2作物'),
      true
    );
  } finally {
    restore();
  }
});

test('a waiting 2x2 seed reserves its block and lower priority 1x1 seeds still plant', async () => {
  const accountId = 'interleave-reserve';
  configurePriority(accountId, [29001, 101], { prioritize2x2Crops: true });
  const { service, requests, logs, restore } = loadService({
    bagSeeds: [size2Seed(29001, 1), seed(101, 2)],
    reactions: new Map(),
  });

  try {
    const result = await service.plantFromBagSeeds([1, 5, 3, 4], accountId, { lands: unlockedLands() });

    // 29001 还差两块地才能凑成 2x2，于是预留 [1,2,5,6]，101 只用剩下的 3、4。
    assert.deepEqual(requests.map(item => `${item.seedId}:${item.landIds.join('-')}`), ['101:3', '101:4']);
    assert.deepEqual(result.reservedLandIds.slice().sort((a, b) => a - b), [1, 5]);
    assert.deepEqual(result.remainingLandIds, []);
    assert.equal(
      logs.some(entry => entry.meta && entry.meta.result === 'waiting'),
      true
    );
  } finally {
    restore();
  }
});

test('unavailable 2x2 seed enters cooldown and 1x1 seeds continue in order', async () => {
  const accountId = 'interleave-unavailable-2x2';
  configurePriority(accountId, [29001, 101], { prioritize2x2Crops: true });
  const { service, requests, restore } = loadService({
    bagSeeds: [size2Seed(29001, 1), seed(101, 2)],
    reactions: new Map([[29001, 'error:code=1003005 格子已锁定']]),
  });

  try {
    const result = await service.plantFromBagSeeds([1, 2, 5, 6], accountId, { lands: unlockedLands() });

    assert.deepEqual(requests.map(item => `${item.seedId}:${item.landIds.join('-')}`), [
      '29001:5-6-1-2',
      '101:1',
      '101:2',
    ]);
    assert.equal(result.totalPlanted, 2);
    assert.deepEqual(service.getUnavailableBagSeeds(accountId).map(item => item.seedId), [29001]);
  } finally {
    restore();
  }
});

test('2x2 seeds still follow the bag order while 四格优先 is off', async () => {
  const accountId = 'interleave-toggle-off';
  configurePriority(accountId, [29001, 101], { prioritize2x2Crops: false });
  const { service, requests, restore } = loadService({
    bagSeeds: [size2Seed(29001, 1), seed(101, 1)],
    reactions: new Map(),
  });

  try {
    const result = await service.plantFromBagSeeds([1, 2, 5, 6, 3], accountId, { lands: unlockedLands() });

    // 「优先种植四格作物」只控制插队先种；背包优先策略内 2x2 始终按列表顺序参与。
    assert.deepEqual(requests.map(item => `${item.seedId}:${item.landIds.join('-')}`), [
      '29001:5-6-1-2',
      '101:3',
    ]);
    assert.equal(result.totalPlanted, 2);
    assert.deepEqual(result.reservedLandIds, []);
  } finally {
    restore();
  }
});
