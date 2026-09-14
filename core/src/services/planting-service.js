const { sendMsgAsync, getUserState, getWsErrorState } = require('../utils/network');
const { types } = require('../utils/proto');
const { toNum, toLong, toTimeSec, getServerTimeSec, log, logWarn, sleep } = require('../utils/utils');
const { compareBagSeedGameOrder } = require('../utils/bag-seed-order');
const { getPlantNameBySeedId, getPlantGrowTime, formatGrowTime, getAllSeeds, getPlantBySeedId, getPlantById } = require('../config/gameConfig');
const { markPendingSpend } = require('./stats');
const {
  getPlantingStrategy,
  syncBagSeedPriority,
  getBagSeedPriority,
  getBagSeedExcludedIds,
  getBagSeedFallbackStrategy,
  getPrioritize2x2Crops,
  getPrioritizeGrowthTasks,
  getSeedLocks,
} = require('../models/store');
const { getPlantRankings } = require('./analytics');
const { getBagSeeds } = require('./warehouse');
const { getShopInfo, buyGoods, getSeedShopId } = require('./farm-api');
const { buildLandMap, getDisplayLandContext } = require('./farm-land-analyzer');
const { runFertilizerByConfig } = require('./farm-fertilizer');
const { removePlant } = require('./farm-api');

const FARM_COLUMNS = 4;
const FARM_ROWS = 6;
let reserved2x2GroupKeys = [];
let last2x2WaitingSignature = '';
const failed2x2Retries = new Map();
const TWO_BY_TWO_RETRY_DELAY_MS = 30_000;
// 同一批种下的普通作物会因请求间隔产生少量成熟时间偏差。
// 这类偏差不应让 2x2 预留区向后排漂移；一分钟内视为同时清空。
const TWO_BY_TWO_CLEAR_TIME_TOLERANCE_SEC = 60;

// ─── 种植策略标签 ───

const PLANTING_STRATEGY_LABELS = {
  level: '最高等级作物',
  max_exp: '最大经验/时',
  max_fert_exp: '最大普通肥经验/时',
  max_profit: '最大净利润/时',
  max_fert_profit: '最大普通肥净利润/时',
  bag_priority: '背包种子优先',
  task_priority: '任务作物优先'
};

function getPlantingStrategyLabel(strategy) {
  return PLANTING_STRATEGY_LABELS[strategy] || strategy;
}

function getCurrentAccountId() {
  const userState = getUserState();
  return String((userState && userState.accountId) || process.env.FARM_ACCOUNT_ID || '').trim();
}

// ─── 编码/解码 ───

/** 编码种植请求 */
function encodePlantRequest(seedId, landIds) {
  return types.PlantRequest.encode(types.PlantRequest.create({
    items: [{
      seed_id: toLong(seedId),
      land_ids: (landIds || []).map(id => toLong(id)),
    }],
  })).finish();
}

/** 根据种子 ID 获取植物占地大小（用于合并种植） */
function getPlantSizeBySeedId(seedId) {
  const plant = getPlantBySeedId(toNum(seedId));
  return Math.max(1, toNum(plant && plant.size) || 1);
}

function isSeedLockedByLevel(seed, userLevel) {
  const requiredLevel = Number(seed && seed.requiredLevel);
  // 项目约定：配置为大于等于 200 级的种子不参与本地种植等级限制，保留原始配置值。
  if (requiredLevel >= 200) return false;
  return Number.isFinite(requiredLevel) && requiredLevel > Number(userLevel || 0);
}

function isLockedPlantError(error) {
  const message = String(error && error.message || error || '').toLowerCase();
  return /锁定|未解锁|等级不足|level|lock|unlock/.test(message);
}

// 服务端明确拒绝「该种子在当前状态下不可种植」（实测 code=1003005「格子已锁定」）。
// 这类错误与地块无关：换一块地、同一颗种子仍会被拒。
// 因此必须立刻停止这颗种子在剩余地块上的尝试，并在一段时间内不再重试——
// 否则每轮种植都会对每块空地重试一遍，既刷掉大量必然失败的请求，
// 又会让「背包种子优先顺序」看起来完全没生效（其实是靠前的种子都被服务端挡住了）。
const SEED_UNAVAILABLE_ERROR_CODES = new Set([1003005]);
// 只匹配「种子自身不可种植」的文案；刻意不匹配泛化的「锁定 / 未解锁」，
// 避免把「某块地临时被占用」这类与种子无关的失败误判成种子不可用。
const SEED_UNAVAILABLE_ERROR_PATTERN = /格子已锁定|种子已锁定|种子未解锁|等级不足/;
// 从 `... 错误: code=1003005 格子已锁定` 里取出服务端错误码。
const PROTO_ERROR_CODE_PATTERN = /code=(-?\d+)/;
// 冷却期内不再重试：游戏内解锁 / 状态恢复后，最多等待这么久就会重新纳入种植顺序。
const SEED_UNAVAILABLE_COOLDOWN_MS = 15 * 60 * 1000;

// `${accountId}:${seedId}` → { until, reason }
const unavailableBagSeeds = new Map();

/** 判断是否为「该种子当前不可种植」的服务端拒绝 */
function isSeedUnavailableError(error) {
  const message = String((error && error.message) || error || '').trim();
  if (!message) return false;
  const codeMatch = PROTO_ERROR_CODE_PATTERN.exec(message);
  if (codeMatch && SEED_UNAVAILABLE_ERROR_CODES.has(Number(codeMatch[1]))) return true;
  return SEED_UNAVAILABLE_ERROR_PATTERN.test(message);
}

function bagSeedUnavailableKey(accountId, seedId) {
  return `${String(accountId || '')}:${toNum(seedId)}`;
}

/** 标记种子当前不可种植，冷却期内不再尝试 */
function markBagSeedUnavailable(accountId, seedId, reason, now = Date.now()) {
  const id = toNum(seedId);
  if (id <= 0) return;
  unavailableBagSeeds.set(bagSeedUnavailableKey(accountId, id), {
    until: now + SEED_UNAVAILABLE_COOLDOWN_MS,
    reason: String(reason || ''),
  });
}

/** 种子是否处于「当前不可种植」冷却期 */
function isBagSeedUnavailable(accountId, seedId, now = Date.now()) {
  const entry = unavailableBagSeeds.get(bagSeedUnavailableKey(accountId, seedId));
  if (!entry) return false;
  if (entry.until <= now) {
    unavailableBagSeeds.delete(bagSeedUnavailableKey(accountId, seedId));
    return false;
  }
  return true;
}

/** 种植成功后清除标记，让种子立刻回到优先顺序里 */
function clearBagSeedUnavailable(accountId, seedId) {
  unavailableBagSeeds.delete(bagSeedUnavailableKey(accountId, seedId));
}

/** 当前被标记为不可种植的种子（供日志 / 面板观察） */
function getUnavailableBagSeeds(accountId, now = Date.now()) {
  const prefix = `${String(accountId || '')}:`;
  const result = [];
  for (const [key, entry] of unavailableBagSeeds.entries()) {
    if (!key.startsWith(prefix) || entry.until <= now) continue;
    result.push({
      seedId: toNum(key.slice(prefix.length)),
      reason: entry.reason,
      retryAt: entry.until,
    });
  }
  return result;
}

function groupKey(landIds) {
  return [...landIds].map(Number).sort((a, b) => a - b).join('-');
}

/** 构建所有合法 2x2 组合；协议锚点为左下角。 */
function build2x2LandGroups(lands) {
  const unlockedIds = new Set(
    (Array.isArray(lands) ? lands : [])
      .filter(land => land?.unlocked)
      .map(land => toNum(land.id))
      .filter(Boolean)
  );
  const groups = [];

  for (let bottomRow = 1; bottomRow < FARM_ROWS; bottomRow++) {
    for (let column = 0; column < FARM_COLUMNS - 1; column++) {
      const masterLandId = bottomRow * FARM_COLUMNS + column + 1;
      const landIds = [
        masterLandId,
        masterLandId + 1,
        masterLandId - FARM_COLUMNS,
        masterLandId - FARM_COLUMNS + 1,
      ];
      if (!landIds.every(id => unlockedIds.has(id))) continue;
      groups.push({
        key: groupKey(landIds),
        masterLandId,
        landIds,
      });
    }
  }
  return groups;
}

function getActive2x2Footprints(lands) {
  return (Array.isArray(lands) ? lands : [])
    .map((land) => {
      const masterLandId = toNum(land?.id);
      const slaves = Array.isArray(land?.slave_land_ids)
        ? land.slave_land_ids.map(toNum).filter(Boolean)
        : [];
      const landIds = [masterLandId, ...slaves].filter(Boolean);
      return slaves.length === 3
        ? { key: groupKey(landIds), landIds: new Set(landIds) }
        : null;
    })
    .filter(Boolean);
}

function overlapsLandIds(left, right) {
  return left.some(id => right.has(id));
}

function selectMaximumNonOverlappingGroups(groups, limit) {
  const candidates = [...groups].sort((a, b) => a.masterLandId - b.masterLandId);
  let best = [];

  function search(index, selected, occupied) {
    if (selected.length > best.length) best = [...selected];
    if (selected.length >= limit || index >= candidates.length) return;
    if (selected.length + candidates.length - index <= best.length) return;

    const group = candidates[index];
    if (!group.landIds.some(id => occupied.has(id))) {
      const nextOccupied = new Set(occupied);
      group.landIds.forEach(id => nextOccupied.add(id));
      search(index + 1, [...selected, group], nextOccupied);
    }
    search(index + 1, selected, occupied);
  }

  search(0, [], new Set());
  return best;
}

function getEstimatedLandClearAt(land, emptySet) {
  const landId = toNum(land?.id);
  if (emptySet.has(landId)) return 0;

  const plant = land?.plant;
  const phases = Array.isArray(plant?.phases) ? plant.phases : [];
  // 不在已确认空地集合内且缺少生长阶段时，不能乐观地当作立即清空。
  if (phases.length === 0) return Number.MAX_SAFE_INTEGER;

  const maturePhase = phases.find(phase => toNum(phase?.phase) === 6);
  const matureAt = toTimeSec(maturePhase?.begin_time);
  if (matureAt <= 0) return Number.MAX_SAFE_INTEGER;

  const plantConfig = getPlantById(toNum(plant.id));
  const currentSeason = Math.max(1, toNum(plant.season) || 1);
  const totalSeasons = Math.max(currentSeason, toNum(plantConfig?.seasons) || currentSeason);
  const remainingSeasons = Math.max(0, totalSeasons - currentSeason);
  const growSeconds = Math.max(0, toNum(getPlantGrowTime(toNum(plant.id))));

  return Math.max(getServerTimeSec(), matureAt) + remainingSeasons * growSeconds;
}

function get2x2GroupMetrics(group, landMap, emptySet, previousReservations) {
  const clearTimes = group.landIds.map(id => getEstimatedLandClearAt(landMap.get(id), emptySet));
  const clearAt = Math.max(...clearTimes);
  const now = getServerTimeSec();
  const lockCost = clearAt >= Number.MAX_SAFE_INTEGER
    ? Number.MAX_SAFE_INTEGER
    : clearTimes.reduce((sum, time) => {
        const normalized = time === 0 ? now : time;
        return Math.min(Number.MAX_SAFE_INTEGER, sum + Math.max(0, clearAt - normalized));
      }, 0);
  return {
    group,
    level: toNum(landMap.get(group.masterLandId)?.level),
    clearAt,
    lockCost,
    waiting: !group.landIds.every(id => emptySet.has(id)),
    reserved: previousReservations.has(group.key),
  };
}

function compareNumberArrays(left, right, direction = 1) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) return direction * (left[index] - right[index]);
  }
  return 0;
}

function compareClearTimeArrays(left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = left[index] - right[index];
    if (Math.abs(difference) > TWO_BY_TWO_CLEAR_TIME_TOLERANCE_SEC) return -difference;
  }
  return 0;
}

/** 返回正数表示 left 方案优于 right。 */
function compare2x2Plans(left, right) {
  const leftLevels = left.map(item => item.level).sort((a, b) => b - a);
  const rightLevels = right.map(item => item.level).sort((a, b) => b - a);
  const levelResult = compareNumberArrays(leftLevels, rightLevels, 1);
  if (levelResult !== 0) return levelResult;

  if (left.length !== right.length) return left.length - right.length;

  const leftClearTimes = left.map(item => item.clearAt).sort((a, b) => a - b);
  const rightClearTimes = right.map(item => item.clearAt).sort((a, b) => a - b);
  const clearResult = compareClearTimeArrays(leftClearTimes, rightClearTimes);
  if (clearResult !== 0) return clearResult;

  const leftLockCost = left.reduce((sum, item) => Math.min(Number.MAX_SAFE_INTEGER, sum + item.lockCost), 0);
  const rightLockCost = right.reduce((sum, item) => Math.min(Number.MAX_SAFE_INTEGER, sum + item.lockCost), 0);
  if (leftLockCost !== rightLockCost) return rightLockCost - leftLockCost;

  const leftReserved = left.filter(item => item.reserved).length;
  const rightReserved = right.filter(item => item.reserved).length;
  if (leftReserved !== rightReserved) return leftReserved - rightReserved;

  const leftIds = left.map(item => item.group.masterLandId).sort((a, b) => a - b);
  const rightIds = right.map(item => item.group.masterLandId).sort((a, b) => a - b);
  return compareNumberArrays(leftIds, rightIds, -1);
}

/**
 * 全局选择互不重叠的 2x2 区域。左下锚点品级最高优先，同品级再减少等待与锁地浪费；
 * 已完全空闲的区域可以选择多组，需要等待清空的区域最多预留一组。
 */
function select2x2Reservations(groups, emptyLandIds, desiredCount, lands) {
  const emptySet = new Set((emptyLandIds || []).map(toNum).filter(Boolean));
  const landMap = buildLandMap(lands);
  const activeFootprints = getActive2x2Footprints(lands);
  const candidates = (groups || []).filter((group) => {
    return !activeFootprints.some(
      footprint => overlapsLandIds(group.landIds, footprint.landIds)
    );
  });
  const previousReservations = new Set(reserved2x2GroupKeys);
  const metrics = candidates.map(group => get2x2GroupMetrics(
    group,
    landMap,
    emptySet,
    previousReservations,
  ));
  const limit = Math.max(0, Math.min(toNum(desiredCount), metrics.length));
  let best = [];

  function search(index, chosen, occupied, waitingCount) {
    if (compare2x2Plans(chosen, best) > 0) best = [...chosen];
    if (index >= metrics.length || chosen.length >= limit) return;

    const item = metrics[index];
    if ((!item.waiting || waitingCount === 0)
      && !item.group.landIds.some(id => occupied.has(id))) {
      const nextOccupied = new Set(occupied);
      item.group.landIds.forEach(id => nextOccupied.add(id));
      search(index + 1, [...chosen, item], nextOccupied, waitingCount + (item.waiting ? 1 : 0));
    }
    search(index + 1, chosen, occupied, waitingCount);
  }

  search(0, [], new Set(), 0);
  const selected = best.map(item => item.group);

  reserved2x2GroupKeys = selected
    .filter(group => !group.landIds.every(id => emptySet.has(id)))
    .map(group => group.key);
  return selected;
}

function expandRemoved2x2Lands(emptyLandIds, removedLandIds, lands) {
  const result = new Set((emptyLandIds || []).map(toNum).filter(Boolean));
  const landMap = buildLandMap(lands);
  for (const rawId of removedLandIds || []) {
    const landId = toNum(rawId);
    if (!landId) continue;
    result.add(landId);
    const land = landMap.get(landId);
    for (const slaveId of land?.slave_land_ids || []) {
      const id = toNum(slaveId);
      if (id) result.add(id);
    }
  }
  return [...result];
}

async function plant2x2Seed(seedId, group) {
  const payload = encodePlantRequest(seedId, group.landIds);
  const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Plant', payload);
  const reply = types.PlantReply.decode(body);
  const landMap = buildLandMap(reply?.land || []);
  const master = landMap.get(group.masterLandId);
  const actualSlaves = new Set(
    (master?.slave_land_ids || []).map(toNum).filter(Boolean)
  );
  const expectedSlaves = group.landIds.filter(id => id !== group.masterLandId);
  const linked = expectedSlaves.every((id) => {
    return actualSlaves.has(id) && toNum(landMap.get(id)?.master_land_id) === group.masterLandId;
  });
  if (!master || toNum(master.land_size) !== 2 || !linked) {
    throw new Error(`服务器未确认 2x2 土地关联: ${group.landIds.join(',')}`);
  }
  return {
    masterLandId: group.masterLandId,
    occupiedLandIds: [...group.landIds],
  };
}

async function plantPrioritized2x2Crops(emptyLandIds, lands, accountId) {
  if (!getPrioritize2x2Crops(accountId)) {
    reserved2x2GroupKeys = [];
    last2x2WaitingSignature = '';
    return { reservedLandIds: [], plantedMasterIds: [], plantedCount: 0, occupiedCount: 0 };
  }

  let bagSeeds;
  try {
    bagSeeds = await getBagSeeds();
  } catch (err) {
    logWarn('种植', `读取四格种子失败，继续普通种植: ${err.message}`, {
      module: 'farm',
      event: '读取2x2种子',
      result: 'error',
    });
    return { reservedLandIds: [], plantedMasterIds: [], plantedCount: 0, occupiedCount: 0 };
  }
  const userState = getUserState();
  const userLevel = Number(userState && userState.level) || 0;
  const { plantable: unlockedBagSeeds, locked: lockedBagSeeds } = splitLockedBagSeeds(bagSeeds, accountId);
  if (lockedBagSeeds.length > 0) {
    log('种植', `已跳过被锁定的背包种子: ${lockedBagSeeds.map(seed => seed.name || seed.seedId).join('，')}`, {
      module: 'farm',
      event: '种植2x2作物',
      result: 'skip_seed_locked',
      seedIds: lockedBagSeeds.map(seed => seed.seedId),
    });
  }
  // 2x2 种子同样按「背包种子优先顺序」消耗：优先列表内的按用户顺序，
  // 未入列的（如新种子）按游戏内背包顺序兜底。被移出优先列表的种子不参与种植。
  const size2PriorityIndex = new Map(
    (typeof getBagSeedPriority === 'function' ? (getBagSeedPriority(accountId) || []) : [])
      .map((id, index) => [Number(id), index])
  );
  const size2ExcludedSet = new Set(
    (typeof getBagSeedExcludedIds === 'function' ? (getBagSeedExcludedIds(accountId) || []) : [])
      .map(id => Number(id))
      .filter(id => id > 0)
  );
  const sortedSize2Seeds = unlockedBagSeeds
    .filter(seed => Number(seed?.count) > 0 && Number(seed?.plantSize) === 2)
    .filter(seed => !size2ExcludedSet.has(Number(seed?.seedId)))
    .sort((a, b) => {
      const pa = size2PriorityIndex.has(Number(a.seedId)) ? size2PriorityIndex.get(Number(a.seedId)) : Number.MAX_SAFE_INTEGER;
      const pb = size2PriorityIndex.has(Number(b.seedId)) ? size2PriorityIndex.get(Number(b.seedId)) : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return compareBagSeedGameOrder(a, b);
    })
    .map(seed => ({ ...seed, count: Number(seed.count) || 0 }));
  const lockedByLevelSeeds = sortedSize2Seeds.filter(seed => isSeedLockedByLevel(seed, userLevel));
  const size2Seeds = sortedSize2Seeds.filter(seed => !isSeedLockedByLevel(seed, userLevel));

  if (lockedByLevelSeeds.length > 0) {
    log('种植', `已跳过当前等级未解锁的 2x2 背包种子: ${lockedByLevelSeeds.map(seed => seed.name || seed.seedId).join('，')}`, {
      module: 'farm',
      event: '种植2x2作物',
      result: 'skip_locked',
      seedIds: lockedByLevelSeeds.map(seed => seed.seedId),
      userLevel,
    });
  }

  const totalSeedCount = size2Seeds.reduce((sum, seed) => sum + seed.count, 0);
  if (totalSeedCount <= 0) {
    reserved2x2GroupKeys = [];
    last2x2WaitingSignature = '';
    return { reservedLandIds: [], plantedMasterIds: [], plantedCount: 0, occupiedCount: 0 };
  }

  const groups = build2x2LandGroups(lands);
  const reservations = select2x2Reservations(
    groups,
    emptyLandIds,
    Math.min(totalSeedCount, groups.length),
    lands
  );
  const reservedLandIdSet = new Set(reservations.flatMap(group => group.landIds));
  const emptySet = new Set((emptyLandIds || []).map(toNum).filter(Boolean));
  const readyGroups = reservations.filter(group => group.landIds.every(id => emptySet.has(id)));
  const plantedMasterIds = [];
  let occupiedCount = 0;

  function release2x2Reservation(group) {
    for (const landId of group.landIds) reservedLandIdSet.delete(landId);
  }

  function hasRetryBlocked2x2Seed(group) {
    const now = Date.now();
    return size2Seeds.some((seed) => {
      if (Number(seed.count || 0) <= 0) return false;
      const retryKey = `${group.key}:${seed.seedId}`;
      const retryAt = failed2x2Retries.get(retryKey) || 0;
      return retryAt > now;
    });
  }

  function pickNext2x2Seed(group) {
    const now = Date.now();
    return size2Seeds.find((seed) => {
      if (Number(seed.count || 0) <= 0) return false;
      const retryKey = `${group.key}:${seed.seedId}`;
      const retryAt = failed2x2Retries.get(retryKey) || 0;
      return retryAt <= now;
    }) || null;
  }

  for (const group of readyGroups) {
    let seed = pickNext2x2Seed(group);
    if (!seed && !hasRetryBlocked2x2Seed(group)) {
      release2x2Reservation(group);
      continue;
    }

    while (seed) {
      const retryKey = `${group.key}:${seed.seedId}`;
      try {
        const result = await plant2x2Seed(seed.seedId, group);
        failed2x2Retries.delete(retryKey);
        seed.count -= 1;
        plantedMasterIds.push(result.masterLandId);
        occupiedCount += result.occupiedLandIds.length;
        result.occupiedLandIds.forEach(id => emptySet.delete(id));
        log('种植', `已优先种植 2x2 作物 ${seed.name}，主地块#${result.masterLandId}，占地 ${result.occupiedLandIds.join(',')}`, {
          module: 'farm',
          event: '种植2x2作物',
          result: 'ok',
          seedId: seed.seedId,
          masterLandId: result.masterLandId,
          landIds: result.occupiedLandIds,
        });
        break;
      } catch (err) {
        if (isLockedPlantError(err)) {
          seed.count = 0;
          failed2x2Retries.delete(retryKey);
          const nextSeed = pickNext2x2Seed(group);
          logWarn('种植', nextSeed
            ? `2x2 作物 ${seed.name} 当前不可种植，已切换其他 2x2 作物: ${err.message}`
            : `2x2 作物 ${seed.name} 当前不可种植，且没有其他可切换的 2x2 作物: ${err.message}`, {
            module: 'farm',
            event: '种植2x2作物',
            result: 'seed_locked',
            seedId: seed.seedId,
            landIds: group.landIds,
          });
          if (!nextSeed && !hasRetryBlocked2x2Seed(group))
            release2x2Reservation(group);
          seed = nextSeed;
          continue;
        }

        failed2x2Retries.set(retryKey, Date.now() + TWO_BY_TWO_RETRY_DELAY_MS);
        logWarn('种植', `2x2 作物 ${seed.name} 种植失败: ${err.message}`, {
          module: 'farm',
          event: '种植2x2作物',
          result: 'error',
          seedId: seed.seedId,
          landIds: group.landIds,
        });
        break;
      }
    }
    await sleep(200, 400);
  }

  if (reservations.length > readyGroups.length) {
    const readyKeys = new Set(readyGroups.map(group => group.key));
    const waiting = reservations
      .filter(group => !readyKeys.has(group.key))
      .map(group => group.landIds.join(','));
    const waitingSignature = waiting.join('|');
    if (waiting.length > 0 && waitingSignature !== last2x2WaitingSignature) {
      log('种植', `已为 2x2 作物预留土地，等待区域清空: ${waiting.join(' | ')}`, {
        module: 'farm',
        event: '预留2x2土地',
        result: 'waiting',
        groups: waiting,
      });
    }
    last2x2WaitingSignature = waitingSignature;
  } else {
    last2x2WaitingSignature = '';
  }

  return {
    reservedLandIds: [...reservedLandIdSet],
    plantedMasterIds,
    plantedCount: plantedMasterIds.length,
    occupiedCount
  };
}

// ─── 种植核心 ───

/**
 * 在指定地块种植指定种子
 * @param {number} seedId - 种子 ID
 * @param {number[]} landIds - 地块 ID 列表
 * @param {object} options - { maxPlantCount }
 * @returns {{ planted, plantedLandIds, occupiedLandIds }} 种植结果
 */
async function plantSeeds(seedId, landIds, options = {}) {
  let planted = 0;
  let unavailableReason = '';
  const plantedLandIds = [];
  const occupiedSet = new Set();
  const maxPlantCount = Math.max(1, toNum(options.maxPlantCount) || 1) || Number.POSITIVE_INFINITY;
  const remainingLandIds = new Set(
    (Array.isArray(landIds) ? landIds : []).map(id => toNum(id)).filter(Boolean)
  );

  for (const rawLandId of landIds) {
    const landId = toNum(rawLandId);
    if (!landId || !remainingLandIds.has(landId)) continue;
    if (planted >= maxPlantCount) break;

    try {
      const payload = encodePlantRequest(seedId, [landId]);
      const { body } = await sendMsgAsync('gamepb.plantpb.PlantService', 'Plant', payload);
      const reply = types.PlantReply.decode(body);
      const replyLands = Array.isArray(reply && reply.land) ? reply.land : [];
      const landMap = buildLandMap(replyLands);
      const tempLand = landMap.get(landId) || { id: landId };
      const displayCtx = getDisplayLandContext(tempLand, landMap);
      const occupiedIds = displayCtx.occupiedLandIds.length > 1
        ? displayCtx.occupiedLandIds
        : [landId];

      planted++;
      plantedLandIds.push(displayCtx.masterLandId || landId);

      for (const occId of occupiedIds) {
        occupiedSet.add(occId);
        remainingLandIds.delete(occId);
      }
    } catch (err) {
      if (isSeedUnavailableError(err)) {
        // 种子被服务端拒绝：换任何一块地结果都一样，立即结束这颗种子的尝试，
        // 由调用方换下一颗种子，避免对每块地重复发起必然失败的请求。
        unavailableReason = err.message;
        break;
      }
      logWarn('种植', `土地#${landId} 失败: ${err.message}`);
    }
    // 多地种植时加间隔
    if (landIds.length > 1) await sleep(200, 400);
  }

  const result = {
    planted,
    plantedLandIds,
    occupiedLandIds: [...occupiedSet]
  };
  if (unavailableReason) {
    result.unavailable = true;
    result.unavailableReason = unavailableReason;
  }
  return result;
}

// ─── 背包种子种植 ───

/**
 * 过滤掉被用户在「我的背包」里锁定的种子——锁定的种子不参与任何自动种植。
 * @param {Array} seeds
 * @param {string} [accountId]
 * @returns {{plantable: Array, locked: Array}}
 */
function splitLockedBagSeeds(seeds, accountId) {
  const list = Array.isArray(seeds) ? seeds : [];
  const lockedIds = new Set(
    (typeof getSeedLocks === 'function' ? (getSeedLocks(accountId) || []) : [])
      .map(id => Number(id))
      .filter(id => id > 0)
  );
  if (lockedIds.size === 0)
    return { plantable: list, locked: [] };
  return {
    plantable: list.filter(seed => !lockedIds.has(Number(seed && seed.seedId))),
    locked: list.filter(seed => lockedIds.has(Number(seed && seed.seedId))),
  };
}

/**
 * 按背包优先级排序背包种子
 * @param {Array} bagSeeds - 背包种子列表
 * @param {Array} priorityList - 优先级种子 ID 列表
 * @param {Array} [excludedSeedIds] - 被移出优先顺序的种子 ID（完全不参与背包优先种植）
 */
function sortBagSeedsForPlanting(bagSeeds, priorityList, excludedSeedIds) {
  const priorityMap = new Map();
  const priorities = Array.isArray(priorityList) ? priorityList : [];
  priorities.forEach((seedId, index) => {
    const num = Number(seedId);
    if (num > 0) priorityMap.set(num, index);
  });

  const excludedSet = new Set(
    (Array.isArray(excludedSeedIds) ? excludedSeedIds : [])
      .map(id => Number(id))
      .filter(id => id > 0)
  );

  return [...(Array.isArray(bagSeeds) ? bagSeeds : [])]
    .filter(seed => !excludedSet.has(Number(seed && seed.seedId)))
    .sort((a, b) => {
      const priorityA = priorityMap.has(a.seedId) ? priorityMap.get(a.seedId) : Number.MAX_SAFE_INTEGER;
      const priorityB = priorityMap.has(b.seedId) ? priorityMap.get(b.seedId) : Number.MAX_SAFE_INTEGER;
      if (priorityA !== priorityB) return priorityA - priorityB;

      const levelA = Number(a.requiredLevel || 0);
      const levelB = Number(b.requiredLevel || 0);
      if (levelA !== levelB) return levelB - levelA;

      return Number(a.seedId || 0) - Number(b.seedId || 0);
    });
}

/**
 * 使用背包种子种植（bag_priority 策略）
 *
 * 1x1 与 2x2 种子统一按「背包种子优先顺序」交错消耗：轮到某颗种子时，
 * 2x2 需要一整块空闲四格地，暂时凑不齐就预留该区域并继续下一颗。
 * 2x2 是否参与由「优先种植四格作物」开关决定（总闸）。
 *
 * @param {number[]} emptyLandIds - 空地 ID 列表
 * @param {string} [accountId] - 账号 ID
 * @param {object} [options] - { lands } 完整土地列表，用于 2x2 组合与预留判断
 */
async function plantFromBagSeeds(emptyLandIds, accountId = getCurrentAccountId(), options = {}) {
  const landIds = (Array.isArray(emptyLandIds) ? emptyLandIds : [])
    .map(id => Number(id))
    .filter(id => id > 0);
  const lands = Array.isArray(options && options.lands) ? options.lands : [];

  if (landIds.length === 0) {
    return {
      remainingLandIds: [], reservedLandIds: [], fallbackAllowed: false,
      plantedLandIds: [], totalPlanted: 0, occupiedCount: 0
    };
  }

  const bagSeeds = await getBagSeeds();
  const allSeeds = Array.isArray(bagSeeds) ? bagSeeds : [];
  const { plantable: plantableBagSeeds, locked: lockedBagSeeds } = splitLockedBagSeeds(allSeeds, accountId);
  if (lockedBagSeeds.length > 0) {
    log('种植', `已跳过被锁定的背包种子: ${lockedBagSeeds.map(seed => seed.name || seed.seedId).join('，')}`, {
      module: 'farm',
      event: '种植种子',
      result: 'skip_seed_locked',
      strategy: 'bag_priority',
      seedIds: lockedBagSeeds.map(seed => seed.seedId),
    });
  }
  // sync 用全量种子：锁定种子仍在背包、仍在优先列表里占位（解锁后按原顺序恢复），
  // 只是种植时被过滤。
  const syncedPriority = syncBagSeedPriority(accountId, allSeeds, { persist: false });
  if (syncedPriority.changed && typeof process.send === 'function') {
    try {
      process.send({
        type: 'bag_seed_priority_sync',
        priority: syncedPriority.priority,
        knownIds: syncedPriority.knownIds,
      });
    } catch { }
  }
  const seedPriority = syncedPriority.priority;
  const excludedSeedIds = typeof getBagSeedExcludedIds === 'function'
    ? (getBagSeedExcludedIds(accountId) || [])
    : [];

  // The synchronized list is the same order shown in the settings page.
  // 1x1 与 2x2 共用同一份顺序；只要能拿到土地布局，2x2 就按列表顺序参与。
  // 「优先种植四格作物」开关只控制“插队先种”，不影响背包优先策略内的参与权。
  const size2Enabled = lands.length > 0;
  const orderedSeeds = sortBagSeedsForPlanting(
    plantableBagSeeds.filter((seed) => {
      if (Number(seed && seed.count) <= 0) return false;
      const plantSize = Number(seed && seed.plantSize) || 1;
      if (plantSize === 1) return true;
      return plantSize === 2 && size2Enabled;
    }),
    seedPriority,
    excludedSeedIds
  );

  // 等级未解锁的种子直接跳过（200 级按项目约定不参与本地等级判断）。
  // 取不到用户等级时不做过滤，避免误伤。
  const userState = getUserState();
  const userLevel = Number(userState && userState.level) || 0;
  const lockedByLevelSeeds = userLevel > 0
    ? orderedSeeds.filter(seed => isSeedLockedByLevel(seed, userLevel))
    : [];
  const levelUsableSeeds = userLevel > 0
    ? orderedSeeds.filter(seed => !isSeedLockedByLevel(seed, userLevel))
    : orderedSeeds;
  if (lockedByLevelSeeds.length > 0) {
    log('种植', `已跳过当前等级未解锁的背包种子: ${lockedByLevelSeeds.map(seed => seed.name || seed.seedId).join('，')}`, {
      module: 'farm', event: '种植种子', result: 'skip_locked',
      strategy: 'bag_priority',
      seedIds: lockedByLevelSeeds.map(seed => seed.seedId),
      userLevel,
    });
  }

  // 冷却期内的种子（上一轮被服务端判定为不可种植）本轮直接跳过，
  // 冷却结束后自动回到原来的优先顺序里，不会打乱用户排的顺序。
  const coolingDownSeeds = levelUsableSeeds.filter(seed => isBagSeedUnavailable(accountId, seed.seedId));
  const availableSeeds = levelUsableSeeds.filter(seed => !isBagSeedUnavailable(accountId, seed.seedId));
  if (coolingDownSeeds.length > 0) {
    log('种植', `已跳过 ${coolingDownSeeds.length} 个当前不可种植的背包种子: ${coolingDownSeeds.map(seed => seed.name || seed.seedId).join('，')}`, {
      module: 'farm', event: '种植种子', result: 'skip_seed_unavailable',
      strategy: 'bag_priority',
      seedIds: coolingDownSeeds.map(seed => seed.seedId),
      retryAfterMinutes: Math.round(SEED_UNAVAILABLE_COOLDOWN_MS / 60000),
    });
  }

  if (availableSeeds.length === 0) {
    const hasAnySeeds = plantableBagSeeds.some(s => Number(s && s.count) > 0);
    log('种植', hasAnySeeds
      ? '背包中没有可用的种子，准备按第二优先策略补种'
      : '背包种子已用完，准备按第二优先策略补种', {
      module: 'farm', event: '种植种子', result: 'fallback_ready', strategy: 'bag_priority'
    });
    return {
      remainingLandIds: landIds, reservedLandIds: [], fallbackAllowed: true,
      plantedLandIds: [], totalPlanted: 0, occupiedCount: 0
    };
  }

  let remainingIds = [...landIds];
  const emptySet = new Set(landIds);
  const reservedLandIdSet = new Set();
  const size2Groups = size2Enabled ? build2x2LandGroups(lands) : [];
  const waitingGroups = [];
  let fallbackAllowed = true;
  let totalPlanted = 0;
  let totalOccupied = 0;
  const allPlantedIds = [];
  const batches = [];

  for (const seed of availableSeeds) {
    if (remainingIds.length === 0) break;

    // ── 2x2 种子：需要一整块空闲四格地，凑不齐就预留并继续下一颗 ──
    if (Number(seed.plantSize) === 2) {
      let count = Number(seed.count) || 0;
      let plantedForSeed = 0;
      let unavailableReason = '';

      while (count > 0) {
        const group = select2x2Reservations(size2Groups, remainingIds, 1, lands)[0];
        if (!group) break;
        const retryAt = failed2x2Retries.get(`${group.key}:${seed.seedId}`) || 0;
        if (retryAt > Date.now()) break;

        if (!group.landIds.every(id => emptySet.has(Number(id)))) {
          // 还没凑齐：为这颗（更高优先级的）2x2 种子预留区域，继续按顺序尝试后面的种子。
          const waitingLands = group.landIds.filter(id => remainingIds.includes(Number(id)));
          if (waitingLands.length === 0) break;
          waitingLands.forEach(id => reservedLandIdSet.add(Number(id)));
          waitingGroups.push(group.landIds.join(','));
          break;
        }

        try {
          const planted = await plant2x2Seed(seed.seedId, group);
          failed2x2Retries.delete(`${group.key}:${seed.seedId}`);
          count -= 1;
          plantedForSeed += 1;
          totalOccupied += planted.occupiedLandIds.length;
          allPlantedIds.push(planted.masterLandId);
          planted.occupiedLandIds.forEach((id) => {
            emptySet.delete(Number(id));
            reservedLandIdSet.delete(Number(id));
          });
          remainingIds = remainingIds.filter(id => !planted.occupiedLandIds.includes(Number(id)));
          log('种植', `已按背包优先顺序种植 2x2 作物 ${seed.name}，主地块#${planted.masterLandId}，占地 ${planted.occupiedLandIds.join(',')}`, {
            module: 'farm', event: '种植2x2作物', result: 'ok',
            strategy: 'bag_priority', seedId: seed.seedId,
            masterLandId: planted.masterLandId, landIds: planted.occupiedLandIds,
          });
        } catch (err) {
          if (isLockedPlantError(err)) {
            // 与旧的 2x2 行为一致：该种子本轮不再尝试，直接换下一优先种子。
            // 仅当服务端明确判定「种子本身不可种植」时才进入冷却，避免把地块级失败误判。
            if (isSeedUnavailableError(err)) unavailableReason = err.message;
            count = 0;
            logWarn('种植', `2x2 作物 ${seed.name} 当前不可种植，已切换其他优先种子: ${err.message}`, {
              module: 'farm', event: '种植2x2作物', result: 'seed_locked',
              strategy: 'bag_priority', seedId: seed.seedId, landIds: group.landIds,
            });
            break;
          }
          failed2x2Retries.set(`${group.key}:${seed.seedId}`, Date.now() + TWO_BY_TWO_RETRY_DELAY_MS);
          logWarn('种植', `2x2 作物 ${seed.name} 种植失败: ${err.message}`, {
            module: 'farm', event: '种植2x2作物', result: 'error',
            seedId: seed.seedId, landIds: group.landIds,
          });
          break;
        }
      }

      if (plantedForSeed > 0) {
        totalPlanted += plantedForSeed;
        batches.push(`${seed.name  }x${  plantedForSeed}`);
        clearBagSeedUnavailable(accountId, seed.seedId);
      } else if (unavailableReason) {
        markBagSeedUnavailable(accountId, seed.seedId, unavailableReason);
        log('种植', `2x2 背包种子 ${seed.name} 已进入不可种植冷却（${Math.round(SEED_UNAVAILABLE_COOLDOWN_MS / 60000)} 分钟内不再重试），冷却结束后按原顺序恢复`, {
          module: 'farm', event: '种植2x2作物', result: 'skip_seed_unavailable',
          strategy: 'bag_priority', seedId: seed.seedId, reason: unavailableReason,
        });
      }
      continue;
    }

    // ── 1x1 种子：避开为更高优先级 2x2 种子预留的区域 ──
    const targetLands = reservedLandIdSet.size > 0
      ? remainingIds.filter(id => !reservedLandIdSet.has(Number(id)))
      : remainingIds;
    if (targetLands.length === 0) continue;

    const maxCount = Math.min(
      Number(seed.count || 0),
      targetLands.length
    );
    if (maxCount <= 0) continue;

    const plantResult = await plantSeeds(seed.seedId, targetLands, { maxPlantCount: maxCount });
    const occupiedIds = (Array.isArray(plantResult.occupiedLandIds) ? plantResult.occupiedLandIds : [])
      .map(Number).filter(id => id > 0);
    const plantedIds = (Array.isArray(plantResult.plantedLandIds) ? plantResult.plantedLandIds : [])
      .map(Number).filter(id => id > 0);

    if (plantResult.planted > 0) {
      totalPlanted += plantResult.planted;
      totalOccupied += occupiedIds.length > 0 ? occupiedIds.length : plantResult.planted;
      allPlantedIds.push(...plantedIds);
      // emptySet 必须跟着一起更新：后面的 2x2 种子靠它判断四格地是否真的空着，
      // 否则会把刚种下 1x1 的地当成空的，凑出并不存在的 2x2 区域。
      occupiedIds.forEach((id) => {
        emptySet.delete(Number(id));
        reservedLandIdSet.delete(Number(id));
      });
      remainingIds = remainingIds.filter(id => !occupiedIds.includes(id));
      batches.push(`${seed.name  }x${  plantResult.planted}`);
      clearBagSeedUnavailable(accountId, seed.seedId);
    }

    // 服务端判定该种子当前不可种植（如「格子已锁定」）：换种子继续，而不是
    // 每轮对每块地重试。冷却期内不再尝试，也不会因此关闭第二优先策略。
    if (plantResult.unavailable && plantResult.planted === 0) {
      markBagSeedUnavailable(accountId, seed.seedId, plantResult.unavailableReason);
      logWarn('种植', `背包种子 ${seed.name} 当前不可种植，已跳过并继续下一优先种子（${Math.round(SEED_UNAVAILABLE_COOLDOWN_MS / 60000)} 分钟内不再重试）: ${plantResult.unavailableReason}`, {
        module: 'farm', event: '种植种子', result: 'skip_seed_unavailable',
        seedId: seed.seedId, reason: plantResult.unavailableReason,
      });
      continue;
    }

    // 如果实际种植数少于请求数，避免误购商店种子
    if (plantResult.planted < maxCount && remainingIds.length > 0) {
      fallbackAllowed = false;
      logWarn('种植', `背包种子 ${seed.name} 实际种植 ${plantResult.planted}/${maxCount}，为避免误购商店种子，本轮不执行第二优先策略`, {
        module: 'farm', event: '种植种子', result: 'partial_bag_failure',
        seedId: seed.seedId, requested: maxCount, planted: plantResult.planted
      });
    }
  }

  const waitingSignature = [...new Set(waitingGroups)].sort().join('|');
  if (waitingGroups.length > 0) {
    if (waitingSignature !== last2x2WaitingSignature) {
      log('种植', `已为 2x2 作物预留土地，等待区域清空: ${[...new Set(waitingGroups)].join(' | ')}`, {
        module: 'farm', event: '预留2x2土地', result: 'waiting',
        groups: [...new Set(waitingGroups)],
      });
    }
    last2x2WaitingSignature = waitingSignature;
  } else {
    last2x2WaitingSignature = '';
  }

  if (batches.length > 0) {
    log('种植', `已按背包优先策略种植: ${batches.join('，')}`, {
      module: 'farm', event: '种植种子', result: 'ok',
      strategy: 'bag_priority', count: totalPlanted
    });
  }

  return {
    // 交给第二优先策略的空地不包含 2x2 预留区，避免把等待中的四格地填成单格作物。
    remainingLandIds: remainingIds.filter(id => !reservedLandIdSet.has(Number(id))),
    reservedLandIds: [...reservedLandIdSet],
    fallbackAllowed,
    plantedLandIds: [...new Set(allPlantedIds)],
    totalPlanted,
    occupiedCount: totalOccupied
  };
}

// ─── 商店购买种植 ───

/**
 * 根据种植策略查找最佳种子
 * @param {string} overrideStrategy - 覆盖策略（可选）
 */
async function findBestSeed(overrideStrategy, accountId = getCurrentAccountId()) {
  const seedShopId = await getSeedShopId();
  let shopInfo;
  try {
    shopInfo = await getShopInfo(seedShopId);
  } catch (err) {
    logWarn('商店', `查询种子商店失败: ${err.message}，使用本地备选列表`);
    // 回退到本地种子数据
    return await findBestSeedFromLocal(overrideStrategy, accountId);
  }
  if (!shopInfo.goods_list || shopInfo.goods_list.length === 0) {
    logWarn('商店', '种子商店无商品');
    return null;
  }

  const userState = getUserState();
  const candidates = [];

  // 筛选可购买的种子
  for (const goods of shopInfo.goods_list) {
    if (!goods.unlocked) continue;

    let requiredLevel = 0;
    const conds = goods.conds || [];
    for (const cond of conds) {
      if (toNum(cond.type) === 1) {
        requiredLevel = toNum(cond.param);
        if (userState.level < requiredLevel) { requiredLevel = -1; break; }
      }
    }
    if (requiredLevel === -1) continue;

    // 检查限购
    const limitCount = toNum(goods.limit_count);
    const boughtNum = toNum(goods.bought_num);
    if (limitCount > 0 && boughtNum >= limitCount) continue;

    const seedId = toNum(goods.item_id);
    if (getPlantSizeBySeedId(seedId) !== 1) continue;
    candidates.push({
      goods, goodsId: toNum(goods.id), seedId,
      price: toNum(goods.price), requiredLevel
    });
  }

  if (candidates.length === 0) {
    logWarn('商店', '没有可购买的种子');
    return null;
  }

  const strategy = overrideStrategy || getPlantingStrategy(accountId);
  const rankingStrategies = {
    max_exp: 'exp',
    max_fert_exp: 'fert',
    max_profit: 'profit',
    max_fert_profit: 'fert_profit'
  };

  const rankingType = rankingStrategies[strategy];

  // 使用排行榜策略
  if (rankingType) {
    try {
      const rankings = getPlantRankings(rankingType);
      const candidateMap = new Map(candidates.map(c => [c.seedId, c]));
      for (const rank of rankings) {
        const seedId = Number(rank && rank.seedId) || 0;
        if (seedId <= 0) continue;

        const level = Number(rank && rank.level);
        if (Number.isFinite(level) && level > userState.level) continue;

        const match = candidateMap.get(seedId);
        if (match) return match;
      }
      logWarn('商店', `策略 ${strategy} 未找到可购买作物，回退最高等级`);
    } catch (err) {
      logWarn('商店', `策略 ${strategy} 计算失败: ${err.message}，回退最高等级`);
    }
    // 回退：按所需等级降序
    return candidates.sort((a, b) => b.requiredLevel - a.requiredLevel)[0];
  }

  candidates.sort((a, b) => b.requiredLevel - a.requiredLevel);

  return candidates[0];
}

/**
 * 从背包库存中查找最佳种子（商店不可用时的回退）
 */
async function findBestSeedFromLocal(overrideStrategy, accountId = getCurrentAccountId()) {
  const userState = getUserState();
  const allSeeds = getAllSeeds();
  if (!allSeeds || allSeeds.length === 0) return null;

  let bagSeeds = [];
  try {
    bagSeeds = await getBagSeeds();
  } catch (err) {
    logWarn('商店', `商店不可用且读取背包种子失败: ${err.message}，已跳过本轮自动种植`);
    return null;
  }

  const { plantable: plantableBagSeeds } = splitLockedBagSeeds(bagSeeds, accountId);
  const ownedSeedMap = new Map(
    plantableBagSeeds
      .filter(seed => Number(seed && seed.count) > 0)
      .map(seed => [Number(seed.seedId), seed])
  );

  if (ownedSeedMap.size === 0) {
    logWarn('商店', '商店不可用且背包中没有可种植的种子，已跳过本轮自动种植');
    return null;
  }

  const availableSeeds = allSeeds.reduce((list, seed) => {
    const seedId = Number(seed && seed.seedId) || 0;
    if (seedId <= 0 || !ownedSeedMap.has(seedId)) return list;
    if (getPlantSizeBySeedId(seedId) !== 1) return list;

    const owned = ownedSeedMap.get(seedId);
    list.push({
      ...seed,
      count: Math.max(0, Number(owned && owned.count) || 0),
    });
    return list;
  }, []);

  if (availableSeeds.length === 0) {
    logWarn('商店', '商店不可用且本地种子库与背包库存未匹配到可种植种子，已跳过本轮自动种植');
    return null;
  }

  const strategy = overrideStrategy || getPlantingStrategy(accountId);

  const rankingStrategies = {
    max_exp: 'exp',
    max_fert_exp: 'fert',
    max_profit: 'profit',
    max_fert_profit: 'fert_profit'
  };

  const rankingType = rankingStrategies[strategy];
  if (rankingType) {
    try {
      const rankings = getPlantRankings(rankingType);
      for (const rank of rankings) {
        const seedId = Number(rank && rank.seedId) || 0;
        if (seedId <= 0) continue;
        const level = Number(rank && rank.level);
        if (Number.isFinite(level) && level > userState.level) continue;
        const match = availableSeeds.find(s => s.seedId === seedId);
        if (match && match.requiredLevel <= userState.level) return match;
      }
    } catch { /* fall through */ }
  }

  // 回退策略：按等级降序，选当前等级以下最高等级种子
  const candidates = availableSeeds.filter(s => s.requiredLevel <= userState.level);
  candidates.sort((a, b) => b.requiredLevel - a.requiredLevel);
  return candidates[0] || null;
}

/**
 * 获取所有可用种子列表（供前端展示）
 */
async function getAvailableSeeds() {
  const seedShopId = await getSeedShopId();
  const userState = getUserState();
  let seeds = [];

  try {
    const shopInfo = await getShopInfo(seedShopId);
    if (shopInfo.goods_list) {
      for (const goods of shopInfo.goods_list) {
        let requiredLevel = 0;
        for (const cond of (goods.conds || [])) {
          if (toNum(cond.type) === 1) requiredLevel = toNum(cond.param);
        }
        const limitCount = toNum(goods.limit_count);
        const boughtNum = toNum(goods.bought_num);
        const soldOut = limitCount > 0 && boughtNum >= limitCount;

        seeds.push({
          seedId: toNum(goods.item_id),
          goodsId: toNum(goods.id),
          name: getPlantNameBySeedId(toNum(goods.item_id)),
          price: toNum(goods.price),
          requiredLevel,
          locked: !goods.unlocked || userState.level < requiredLevel,
          soldOut
        });
      }
    }
  } catch (err) {
    const wsError = getWsErrorState();
    if (!wsError || Number(wsError.code) !== 400) {
      logWarn('商店', `获取商店失败: ${err.message}，使用本地备选列表`);
    }
  }

  // 商店不可用时回退到本地种子库
  if (seeds.length === 0) {
    const allSeeds = getAllSeeds();
    seeds = allSeeds.map(s => ({
      ...s, goodsId: 0, price: null,
      unknownMeta: true, locked: false, soldOut: false
    }));
  }

  return seeds.sort((a, b) => {
    const levelA = a.requiredLevel ?? 999;
    const levelB = b.requiredLevel ?? 999;
    return levelA - levelB;
  });
}

/**
 * 自动在空地上种植（主入口）
 * @param {number[]} deadLandIds - 枯死地块（需先铲除）
 * @param {number[]} emptyLandIds - 空地
 */
async function autoPlantEmptyLands(deadLandIds, emptyLandIds, lands = []) {
  let allEmptyLands = [...emptyLandIds];
  const userState = getUserState();
  const accountId = getCurrentAccountId();
  const result = {
    plantedLands: [],
    plantedCount: 0,
    occupiedCount: 0,
    removedCount: 0,
    reservedLandIds: []
  };

  // 铲除枯死作物
  if (deadLandIds.length > 0) {
    try {
      await removePlant(deadLandIds);
      log('铲除', `已铲除 ${deadLandIds.length} 块 (${deadLandIds.join(',')})`, {
        module: 'farm', event: '铲除植物', result: 'ok', count: deadLandIds.length
      });
      result.removedCount += deadLandIds.length;
      allEmptyLands.push(...deadLandIds);
    } catch (err) {
      logWarn('铲除', `批量铲除失败: ${err.message}`, {
        module: 'farm', event: '铲除植物', result: 'error'
      });
      allEmptyLands.push(...deadLandIds);
    }
  }

  allEmptyLands = expandRemoved2x2Lands(allEmptyLands, deadLandIds, lands);
  const strategy = String(getPlantingStrategy(accountId) || '').trim();
  const growthTaskPriorityEnabled = strategy === 'task_priority' || getPrioritizeGrowthTasks(accountId);
  if (allEmptyLands.length && growthTaskPriorityEnabled) {
    try {
      const { getTaskInfo, buildGrowthTasks } = require('./task');
      const { plantGrowthTasks } = require('./growth-planting');
      const taskResult = await plantGrowthTasks(allEmptyLands, {
        getTasks: async () => {
          const reply = await getTaskInfo();
          if (!reply.task_info) throw new Error('任务响应缺少任务信息');
          return buildGrowthTasks(reply.task_info);
        },
        getBagSeeds,
        getPlant: getPlantBySeedId,
        isLocked: plant => isSeedLockedByLevel({ requiredLevel: plant.land_level_need }, userState.level),
        plantSeeds,
        warn: message => logWarn('成长种植', message),
        buySeed: async (seedId, count, previousOwned) => {
          const shopId = await getSeedShopId();
          const shop = await getShopInfo(shopId);
          const goods = (shop.goods_list || []).find(item => toNum(item.item_id) === seedId && item.unlocked);
          if (!goods || (goods.conds || []).some(cond => toNum(cond.type) !== 1 || toNum(cond.param) > userState.level)) return 0;
          if (toNum(goods.item_count) !== 1) return 0;
          const price = toNum(goods.price);
          if (price <= 0) return 0;
          const limit = toNum(goods.limit_count);
          const available = limit > 0 ? Math.max(0, limit - toNum(goods.bought_num)) : count;
          const buyCount = Math.min(count, available, Math.max(0, Math.floor(userState.gold / price)));
          if (!buyCount) return 0;
          const seedName = getPlantNameBySeedId(seedId) || '';
          markPendingSpend({
            type: 'seed_buy',
            title: seedName ? `购买${seedName}种子` : '购买种子',
            detail: `x${buyCount}`,
          });
          // The seed shop uses gold; no activity shop or premium-resource purchasing is used.
          await buyGoods(toNum(goods.id), buyCount, price);
          userState.gold = Math.max(0, userState.gold - buyCount * price);
          // Verify the delivered inventory instead of assuming purchase success means all seeds arrived.
          const bag = await getBagSeeds();
          const owned = Number(bag.find(seed => Number(seed.seedId) === seedId)?.count) || 0;
          return Math.min(buyCount, Math.max(0, owned - previousOwned));
        },
      });
      allEmptyLands = taskResult.remainingLandIds;
      result.plantedLands.push(...taskResult.plantedLandIds);
      result.plantedCount += taskResult.plantedLandIds.length;
      result.occupiedCount += taskResult.plantedLandIds.length;
      if (taskResult.plantedLandIds.length) {
        log('成长种植', `已优先种植 ${taskResult.plantedLandIds.length} 块任务作物`);
        await runFertilizerByConfig(taskResult.plantedLandIds);
      }
      if (!allEmptyLands.length) return result;
    } catch (error) {
      logWarn('成长种植', `任务种植中断，下轮重试: ${error.message}`);
      return result;
    }
  }
  // 背包优先策略：1x1 与 2x2 统一按「背包种子优先顺序」交错种植
  // （2x2 是否参与由「优先种植四格作物」开关决定），因此这里不再单独跑一遍 2x2 优先。
  if (strategy === 'bag_priority') {
    let bagResult;
    try {
      bagResult = await plantFromBagSeeds(allEmptyLands, accountId, { lands });
    } catch (err) {
      logWarn('种植', `读取背包种子失败，本轮跳过第二优先策略以避免误购: ${err.message}`, {
        module: 'farm', event: '种植种子', result: 'bag_load_error'
      });
      return result;
    }

    result.reservedLandIds = [...(bagResult.reservedLandIds || [])];
    const plantedLands = bagResult.plantedLandIds || [];
    result.plantedLands.push(...plantedLands);
    result.plantedCount += Number(bagResult.totalPlanted || 0);
    result.occupiedCount += Number(bagResult.occupiedCount || 0);

    // 背包种完后还有空地 → 使用第二优先策略
    if (bagResult.fallbackAllowed && bagResult.remainingLandIds.length > 0) {
      const fallbackStrategy = getBagSeedFallbackStrategy(accountId) || 'level';
      log('种植', `开始按第二优先策略"${getPlantingStrategyLabel(fallbackStrategy)}"补种剩余空地`, {
        module: 'farm', event: '种植种子', result: 'fallback_start',
        strategy: fallbackStrategy, remainingCount: bagResult.remainingLandIds.length
      });
      const shopResult = await plantFromShop(bagResult.remainingLandIds, userState, fallbackStrategy, accountId);
      const shopPlantedLands = shopResult.plantedLands || [];
      plantedLands.push(...shopPlantedLands);
      result.plantedLands.push(...shopPlantedLands);
      result.plantedCount += Number(shopResult.plantedCount || 0);
      result.occupiedCount += Number(shopResult.occupiedCount || 0);
    }

    // 种植后补肥
    if (plantedLands.length > 0) {
      await runFertilizerByConfig(plantedLands);
    }
    return result;
  }

  const size2Result = await plantPrioritized2x2Crops(allEmptyLands, lands, accountId);
  const reservedLandSet = new Set(size2Result.reservedLandIds || []);
  const normalEmptyLands = allEmptyLands.filter(id => !reservedLandSet.has(Number(id)));
  result.reservedLandIds = [...reservedLandSet];
  result.plantedLands.push(...(size2Result.plantedMasterIds || []));
  result.plantedCount += Number(size2Result.plantedCount || 0);
  result.occupiedCount += Number(size2Result.occupiedCount || 0);

  if (size2Result.plantedMasterIds.length > 0) {
    await runFertilizerByConfig(size2Result.plantedMasterIds);
  }

  if (allEmptyLands.length === 0) return result;
  if (normalEmptyLands.length === 0) return result;

  // 商店购买种植
  const fallbackStrategy = strategy === 'task_priority' ? getBagSeedFallbackStrategy(accountId) : undefined;
  const shopResult = await plantFromShop(normalEmptyLands, userState, fallbackStrategy, accountId);
  result.plantedLands.push(...(shopResult.plantedLands || []));
  result.plantedCount += Number(shopResult.plantedCount || 0);
  result.occupiedCount += Number(shopResult.occupiedCount || 0);
  if (shopResult.plantedLands && shopResult.plantedLands.length > 0) {
    await runFertilizerByConfig(shopResult.plantedLands);
  }
  return result;
}

/**
 * 从商店购买种子并种植
 * @param {number[]} landIds - 目标地块
 * @param {object} userState - 用户状态
 * @param {string} overrideStrategy - 覆盖策略
 */
async function plantFromShop(landIds, userState, overrideStrategy, accountId = getCurrentAccountId()) {
  let bestSeed;
  try {
    bestSeed = await findBestSeed(overrideStrategy, accountId);
  } catch (err) {
    logWarn('商店', `查询失败: ${err.message}`);
    return { plantedLands: [], plantedCount: 0, occupiedCount: 0 };
  }

  const result = { plantedLands: [], plantedCount: 0, occupiedCount: 0 };
  if (!bestSeed) return result;

  const plantName = getPlantNameBySeedId(bestSeed.seedId);
  const growTime = getPlantGrowTime(bestSeed.seedId);
  const growTimeStr = growTime > 0 ? ` 生长${formatGrowTime(growTime)}` : '';
  const plantSize = getPlantSizeBySeedId(bestSeed.seedId);
  const footprint = plantSize * plantSize;
  const hasShopData = toNum(bestSeed.goodsId) > 0; // 来自真实商店数据才走购买流程

  log('商店', `最佳种子: ${plantName} (${bestSeed.seedId})${hasShopData ? ` 价格=${bestSeed.price}金币` : ' (本地回退)'}${growTimeStr}`, {
    module: 'warehouse', event: '选择种子', seedId: bestSeed.seedId, price: bestSeed.price, fromShop: hasShopData
  });

  // 合并种植需要占用 footprint 块地
  let plantCount = landIds.length;
  if (footprint > 1) {
    plantCount = Math.floor(landIds.length / footprint);
    if (plantCount <= 0) {
      log('种植', `${plantName} 需要至少 ${footprint} 块空地才能合并种植，当前仅 ${landIds.length} 块可用，已跳过`, {
        module: 'farm', event: '种植种子', result: 'skip',
        seedId: bestSeed.seedId, landFootprint: footprint, emptyCount: landIds.length
      });
      return result;
    }
  }

  const totalCost = (bestSeed.price || 0) * plantCount;
  // 金币检查（仅在来自商店数据时）
  if (hasShopData && totalCost > 0 && totalCost > userState.gold) {
    logWarn('商店', `金币不足! 需要 ${totalCost} 金币, 当前 ${userState.gold} 金币`, {
      module: 'farm', event: '购买种子跳过', result: 'insufficient_gold',
      need: totalCost, current: userState.gold
    });
    const affordable = Math.floor(userState.gold / bestSeed.price);
    if (affordable <= 0) return result;
    plantCount = affordable;
    const sizeMsg = plantSize > 1
      ? `金币有限，只尝试种植 ${affordable} 组 ${plantSize}x${plantSize} 作物`
      : `金币有限，只种 ${affordable} 块地`;
    log('商店', sizeMsg);
  }

  if (!hasShopData) {
    const availableCount = Math.max(0, Number(bestSeed.count) || 0);
    if (availableCount <= 0) {
      logWarn('种植', `${plantName} 在本地回退候选中无可用库存，已跳过本轮种植`, {
        module: 'farm', event: '种植种子', result: 'skip', seedId: bestSeed.seedId
      });
      return result;
    }
    if (plantCount > availableCount) {
      plantCount = availableCount;
      const stockMsg = plantSize > 1
        ? `背包仅剩 ${availableCount} 颗 ${plantName} 种子，本轮只尝试种植 ${availableCount} 组 ${plantSize}x${plantSize} 作物`
        : `背包仅剩 ${availableCount} 颗 ${plantName} 种子，本轮只尝试种植 ${availableCount} 块地`;
      log('种植', stockMsg, {
        module: 'farm', event: '种植种子', result: 'stock_limit',
        seedId: bestSeed.seedId, count: availableCount
      });
    }
  }

  let finalSeedId = bestSeed.seedId;
  if (hasShopData) {
    try {
      markPendingSpend({
        type: 'seed_buy',
        title: `${plantName ? `购买${plantName}种子` : '购买种子'}`,
        detail: `x${plantCount}`,
      });
      const buyResult = await buyGoods(bestSeed.goodsId, plantCount, bestSeed.price);
      // 从购买结果中提取实际种子 ID（可能是获取物品后得到的真实 ID）
      if (buyResult.get_items && buyResult.get_items.length > 0) {
        const item = buyResult.get_items[0];
        const itemId = toNum(item.id);
        if (itemId > 0) finalSeedId = itemId;
      }
      // 更新金币（扣除花费）
      if (buyResult.cost_items) {
        for (const costItem of buyResult.cost_items) {
          userState.gold -= toNum(costItem.count);
        }
      }
      const boughtName = getPlantNameBySeedId(finalSeedId);
      log('购买', `已购买 ${boughtName}种子 x${plantCount}, 花费 ${bestSeed.price * plantCount} 金币`, {
        module: 'warehouse', event: '购买种子', result: 'ok',
        seedId: finalSeedId, count: plantCount, cost: bestSeed.price * plantCount
      });
    } catch (err) {
      logWarn('购买', err.message);
      return { plantedLands: [], plantedCount: 0, occupiedCount: 0 };
    }
  }

  // 执行种植
  let plantedLands = [];
  try {
    const plantResult = await plantSeeds(finalSeedId, landIds, { maxPlantCount: plantCount });
    const { planted, plantedLandIds, occupiedLandIds } = plantResult;
    const occupiedCount = occupiedLandIds.length > 0 ? occupiedLandIds.length : planted;
    if (plantResult.unavailable && planted === 0) {
      logWarn('种植', `${getPlantNameBySeedId(finalSeedId)} 当前不可种植，本轮跳过: ${plantResult.unavailableReason}`, {
        module: 'farm', event: '种植种子', result: 'skip_seed_unavailable',
        seedId: finalSeedId, reason: plantResult.unavailableReason
      });
    }
    if (planted > 0) {
      if (plantSize > 1) {
        log('种植', `已种植 ${planted} 组 ${plantSize}x${plantSize} 作物，占用 ${occupiedCount} 块地 (${occupiedLandIds.join(',')})`, {
          module: 'farm', event: '种植种子', result: 'ok',
          seedId: finalSeedId, count: planted, occupiedCount
        });
      } else {
        log('种植', `已在 ${planted} 块地种植 (${landIds.slice(0, planted).join(',')})`, {
          module: 'farm', event: '种植种子', result: 'ok',
          seedId: finalSeedId, count: planted
        });
      }
      plantedLands = plantedLandIds;
      result.plantedCount = planted;
      result.occupiedCount = occupiedCount;
    }
  } catch (err) {
    logWarn('种植', err.message);
  }

  result.plantedLands = plantedLands;
  return result;
}

module.exports = {
  isSeedLockedByLevel,
  encodePlantRequest,
  getPlantSizeBySeedId,
  build2x2LandGroups,
  selectMaximumNonOverlappingGroups,
  select2x2Reservations,
  expandRemoved2x2Lands,
  plant2x2Seed,
  plantPrioritized2x2Crops,
  plantSeeds,
  PLANTING_STRATEGY_LABELS,
  getPlantingStrategyLabel,
  sortBagSeedsForPlanting,
  splitLockedBagSeeds,
  isSeedUnavailableError,
  markBagSeedUnavailable,
  isBagSeedUnavailable,
  clearBagSeedUnavailable,
  getUnavailableBagSeeds,
  plantFromBagSeeds,
  findBestSeed,
  getAvailableSeeds,
  autoPlantEmptyLands,
  plantFromShop
};
