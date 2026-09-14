const process = require('node:process');
const path = require('node:path');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');
const { getServerDateKey } = require('../utils/utils');

// ─── 持久化路径 ───

function getStatsFilePath(accountId) {
  const baseDir = process.env.FARM_DATA_DIR || path.join(__dirname, '../../data');
  return path.join(baseDir, 'stats', `${accountId  }.json`);
}

/** 获取 YYYY-MM-DD 格式的当天日期键（服务器时间 UTC+8，与游戏日界一致） */
function getTodayKey() {
  return getServerDateKey();
}

function loadPersistedStats(accountId) {
  const filePath = getStatsFilePath(accountId);
  return readJsonFile(filePath, null);
}

function savePersistedStats(accountId, data) {
  try {
    const filePath = getStatsFilePath(accountId);
    writeJsonFileAtomic(filePath, data);
  } catch {}
}

// ─── 运行状态 ───

/** 每日操作计数（按类型） */
const operations = {
  harvest: 0,
  water: 0,
  weed: 0,
  bug: 0,
  farming: 0,
  fertilize: 0,
  plant: 0,
  steal: 0,
  helpWater: 0,
  helpWeed: 0,
  helpBug: 0,
  goldenBugClear: 0,
  goldenBugPut: 0,
  taskClaim: 0,
  sell: 0,
  upgrade: 0,
  levelUp: 0,
  tongQiGift: 0
};

/** 同气连枝礼包计数 */
let tongQiGiftCount = 0;
/** 当前日期键，跨天时自动重置 */
let currentDateKey = null;

/** 上次记录的金币/经验/点券值（用于计算增量） */
const lastState = {
  gold: -1,
  exp: -1,
  coupon: -1
};

/** 初始值（会话开始时记录） */
const initialState = {
  gold: null,
  exp: null,
  coupon: null
};

/** 会话期间累计增益 */
const session = {
  goldGained: 0,
  expGained: 0,
  couponGained: 0,
  lastExpGain: 0,
  lastGoldGain: 0
};

// ─── 会话消费记录 ───
// “本次在线”语义：仅保存在内存里，账号启动（initStatsWithPersistence）时清零。
// 金币下降在 updateStats 里被观察到时落一条记录；若有“待归因消费上下文”
// （如刚偷菜 → 被护主犬扣款），则带上好友/作物明细，否则记为通用消耗。
const CONSUMPTION_RECORD_MAX = 200;
const PENDING_SPEND_TTL_MS = 2 * 60 * 1000;
const PENDING_SPEND_MAX = 20;

function normalizePendingSpendEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const type = String(entry.type || '').trim();
  if (!type) return null;
  return {
    type,
    title: String(entry.title || '').trim(),
    detail: String(entry.detail || '').trim(),
    friend: String(entry.friend || '').trim(),
    crop: String(entry.crop || '').trim(),
    currency: String(entry.currency || 'gold').trim() || 'gold',
    at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : Date.now(),
  };
}

function prunePendingSpends(now = Date.now()) {
  while (pendingSpends.length > 0 && now - pendingSpends[0].at > PENDING_SPEND_TTL_MS) {
    pendingSpends.shift();
  }
}

/**
 * 标记一笔“即将发生/刚发生”的消费上下文，供金币下降时归因。
 * 例：偷菜前标记 { type: 'steal_dog_fine', friend, crop }，若随后金币减少，
 * 记录为「偷菜被看护犬扣款」并带好友/作物明细。
 */
function markPendingSpend(entry) {
  const normalized = normalizePendingSpendEntry(entry);
  if (!normalized) return;
  pendingSpends.push(normalized);
  while (pendingSpends.length > PENDING_SPEND_MAX) pendingSpends.shift();
}

/** 取最匹配的待归因上下文：优先具体类型（种子/土地/带名手动购买），退回通用「购买商品」，都没有则取最近一笔 */
function takeMatchingPendingSpend(now = Date.now()) {
  prunePendingSpends(now);
  if (pendingSpends.length === 0) return null;
  for (let i = pendingSpends.length - 1; i >= 0; i--) {
    if (pendingSpends[i].type !== 'goods_buy') {
      return pendingSpends.splice(i, 1)[0];
    }
  }
  return pendingSpends.pop();
}

function buildConsumptionTitle(context) {
  if (context && context.type === 'steal_dog_fine') {
    return '偷菜被看护犬扣款';
  }
  if (context && context.title) return context.title;
  return '金币消耗';
}

function buildConsumptionDetail(context) {
  if (!context) return '';
  const parts = [];
  if (context.friend) parts.push(`好友：${context.friend}`);
  if (context.crop) parts.push(`作物：${context.crop}`);
  if (context.detail) parts.push(context.detail);
  return parts.join(' · ');
}

function pushConsumptionRecord(delta, context) {
  const amount = Math.abs(Number(delta) || 0);
  if (!Number.isFinite(amount) || amount <= 0) return;
  const currency = (context && context.currency) || 'gold';
  const currencyLabels = { gold: '金币', coupon: '点券', diamond: '钻石', goldBean: '金豆豆' };
  const currencyLabel = currencyLabels[currency] || currency;
  consumptionRecords.push({
    id: `${Date.now()}-${consumptionSeq++}`,
    title: buildConsumptionTitle(context),
    detail: buildConsumptionDetail(context),
    amount,
    currency,
    currencyLabel,
    ts: Date.now(),
  });
  if (consumptionRecords.length > CONSUMPTION_RECORD_MAX) {
    consumptionRecords.splice(0, consumptionRecords.length - CONSUMPTION_RECORD_MAX);
  }
}

/** 本次在线的消费记录（最新在前） */
function getConsumptionRecords() {
  return [...consumptionRecords].reverse();
}

/**
 * 主动落一笔消费记录。用于点券等不被金币下降观察覆盖的支出（如购买化肥）。
 */
function recordConsumptionSpend(amount, context) {
  pushConsumptionRecord(amount, context);
}

function getConsumptionCount() {
  return consumptionRecords.length;
}

function clearConsumptionRecords() {
  consumptionRecords.length = 0;
  pendingSpends.length = 0;
}

let currentAccountId = null;
let saveTimer = null;
/** 会话消费记录（旧→新），内存态 */
const consumptionRecords = [];
/** 待归因消费上下文队列 */
const pendingSpends = [];
let consumptionSeq = 0;

// ─── 公开 API ───

/**
 * 记录一次操作
 * @param {string} opType - 操作类型（harvest/plant/steal 等）
 * @param {number} count - 次数，默认 1
 */
function recordOperation(opType, count = 1) {
  checkAndResetDailyStats();
  if (operations[opType] !== undefined) {
    operations[opType] += count;
    scheduleSave();
  }
}

/** 记录同气连枝礼包 */
function recordTongQiGift(count = 1) {
  checkAndResetDailyStats();
  tongQiGiftCount += count;
  operations.tongQiGift = tongQiGiftCount;
  scheduleSave();
}

function getTongQiGiftCount() {
  checkAndResetDailyStats();
  return tongQiGiftCount;
}

function getTongQiGiftLimit() {
  return null; // 当前无限制
}

/** 检查是否跨天，若跨天则重置每日统计 */
function checkAndResetDailyStats() {
  if (!currentAccountId) return;
  const todayKey = getTodayKey();
  if (currentDateKey && currentDateKey !== todayKey) {
    console.warn(`[统计] 检测到跨天，重置每日统计 (${currentDateKey} -> ${todayKey})`);
    Object.keys(operations).forEach(k => { operations[k] = 0; });
    tongQiGiftCount = 0;
  }
  currentDateKey = todayKey;
}

/** 延迟 2 秒后保存（防抖） */
function scheduleSave() {
  if (!currentAccountId) return;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    doSave();
  }, 2000);
}

function doSave() {
  if (!currentAccountId) return;
  const todayKey = getTodayKey();
  const ops = { ...operations };
  const init = { ...initialState };
  const data = {
    date: todayKey,
    operations: ops,
    tongQiGiftCount,
    initialState: init,
    savedAt: Date.now()
  };
  savePersistedStats(currentAccountId, data);
}

/**
 * 初始化统计（设置初始金币/经验/点券）
 * @param {number} gold - 当前金币
 * @param {number} exp - 当前经验
 * @param {number} coupon - 当前点券（默认 0）
 */
function initStats(gold, exp, coupon = 0) {
  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  lastState.gold = g;
  lastState.exp = e;
  lastState.coupon = c;
  initialState.gold = g;
  initialState.exp = e;
  initialState.coupon = c;
}

/**
 * 初始化统计并加载持久化数据
 * @param {string} accountId - 账号 ID
 * @param {number} gold - 金币
 * @param {number} exp - 经验
 * @param {number} coupon - 点券（默认 0）
 */
function initStatsWithPersistence(accountId, gold, exp, coupon = 0) {
  currentAccountId = accountId;
  const todayKey = getTodayKey();
  currentDateKey = todayKey;
  // 重置运行时状态
  Object.keys(operations).forEach(k => { operations[k] = 0; });
  tongQiGiftCount = 0;
  lastState.gold = -1;
  lastState.exp = -1;
  lastState.coupon = -1;
  initialState.gold = null;
  initialState.exp = null;
  initialState.coupon = null;
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastExpGain = 0;
  session.lastGoldGain = 0;
  clearConsumptionRecords();

  // 尝试恢复今日持久化数据
  const persisted = loadPersistedStats(accountId);
  if (persisted && persisted.date === todayKey) {
    Object.keys(persisted.operations || {}).forEach(k => {
      if (operations[k] !== undefined) {
        operations[k] = Number(persisted.operations[k]) || 0;
      }
    });
    tongQiGiftCount = Number(persisted.tongQiGiftCount) || Number(operations.tongQiGift) || 0;
    operations.tongQiGift = tongQiGiftCount;
    console.warn(`[统计] 已恢复今日统计数据: ${JSON.stringify(persisted.operations)}, 同气连枝礼包: ${tongQiGiftCount}`);
  } else if (persisted) {
    console.warn(`[统计] 日期已变更，重置统计 (${persisted.date} -> ${todayKey})`);
  } else {
    console.warn('[统计] 新账号初始化，无历史数据');
  }
  initStats(gold, exp, coupon);
}

/**
 * 更新金币/经验差值追踪
 * @param {number} gold - 当前金币
 * @param {number} exp - 当前经验
 */
function updateStats(gold, exp) {
  if (lastState.gold === -1) lastState.gold = gold;
  if (lastState.exp === -1) lastState.exp = exp;

  // 金币增量
  if (gold > lastState.gold) {
    session.lastGoldGain = gold - lastState.gold;
  } else if (gold < lastState.gold) {
    session.lastGoldGain = 0;
    // 金币下降 → 记一笔消费（有偷菜上下文时归因为被护主犬扣款）
    pushConsumptionRecord(gold - lastState.gold, takeMatchingPendingSpend());
  }
  lastState.gold = gold;

  // 经验增量（带同值去重，避免短时间内重复计算）
  if (exp > lastState.exp) {
    const gain = exp - lastState.exp;
    const now = Date.now();
    // 如果和上次增量相同且时间间隔 < 5s，跳过（去重）
    if (gain === session.lastExpGain && now - (session.lastExpTime || 0) < 5000) {
      // skip duplicate
    } else {
      session.lastExpGain = gain;
      session.lastExpTime = now;
    }
  } else {
    session.lastExpGain = 0;
  }
  lastState.exp = exp;
}

function recordGoldExp(gold, exp) {
  updateStats(gold, exp);
}

function setInitialValues(gold, exp, coupon = 0) {
  initStats(gold, exp, coupon);
}

/** 重置会话增益 */
function resetSessionGains() {
  session.goldGained = 0;
  session.expGained = 0;
  session.couponGained = 0;
  session.lastGoldGain = 0;
  session.lastExpGain = 0;
  session.lastExpTime = 0;
}

/** 根据初始值重新计算会话总增益 */
function recomputeSessionTotals(gold, exp, coupon) {
  if (initialState.gold === null || initialState.exp === null || initialState.coupon === null) {
    initialState.gold = gold;
    initialState.exp = exp;
    initialState.coupon = coupon;
  }
  session.goldGained = gold - initialState.gold;
  session.expGained = exp - initialState.exp;
  session.couponGained = coupon - initialState.coupon;
}

/**
 * 获取完整统计快照（供 API 返回）
 * @param {object} farmUser - 农场用户数据
 * @param {object} userState - 用户状态（含 gold/exp/coupon）
 * @param {boolean} connected - 是否连接中
 * @param {object} limits - 操作次数限制
 */
function getStats(farmUser, userState, connected, limits) {
  checkAndResetDailyStats();
  const fu = farmUser && typeof farmUser === 'object' ? farmUser : {};
  const us = userState && typeof userState === 'object' ? userState : {};

  const gold = us.gold ?? fu.gold;
  const exp = us.exp ?? fu.exp;
  const coupon = us.coupon ?? fu.coupon;
  const diamond = us.diamond ?? fu.diamond;
  const goldBean = us.goldBean ?? fu.goldBean;

  const g = Number.isFinite(Number(gold)) ? Number(gold) : 0;
  const e = Number.isFinite(Number(exp)) ? Number(exp) : 0;
  const c = Number.isFinite(Number(coupon)) ? Number(coupon) : 0;
  const d = Number.isFinite(Number(diamond)) ? Number(diamond) : 0;
  const gb = Number.isFinite(Number(goldBean)) ? Number(goldBean) : 0;

  // 如果已连接，更新内部追踪并重新计算会话增益
  if (connected) {
    updateStats(g, e);
    recomputeSessionTotals(g, e, c);
  }

  const ops = { ...operations, tongQiGift: tongQiGiftCount };

  return {
    connection: { connected },
    status: {
      name: us.name || fu.name,
      level: fu.level || us.level || 0,
      gold: g,
      coupon: Number.isFinite(Number(us.coupon)) ? Number(us.coupon) : 0,
      diamond: d,
      goldBean: gb,
      exp: e,
      platform: fu.platform || us.platform || 'qq',
      gid: us.gid || fu.gid || 0,
      openId: us.openId || fu.openId || fu.open_id || '',
      avatar: us.avatar || fu.avatar || fu.avatarUrl || fu.avatar_url || ''
    },
    uptime: process.uptime(),
    operations: ops,
    tongQiGiftCount,
    tongQiGiftLimit: null,
    sessionExpGained: session.expGained,
    sessionGoldGained: session.goldGained,
    sessionCouponGained: session.couponGained,
    lastExpGain: session.lastExpGain,
    lastGoldGain: session.lastGoldGain,
    consumptionCount: consumptionRecords.length,
    limits
  };
}

function saveStats() {
  doSave();
}

module.exports = {
  recordOperation,
  recordTongQiGift,
  getTongQiGiftCount,
  getTongQiGiftLimit,
  initStats,
  initStatsWithPersistence,
  updateStats,
  setInitialValues,
  recordGoldExp,
  resetSessionGains,
  getStats,
  saveStats,
  getTodayKey,
  loadPersistedStats,
  checkAndResetDailyStats,
  markPendingSpend,
  recordConsumptionSpend,
  getConsumptionRecords,
  getConsumptionCount,
  clearConsumptionRecords
};
