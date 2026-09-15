const crypto = require('node:crypto');
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

const DEFAULT_ACCOUNT_LIMIT = 1;
const SUPER_ADMIN_USERNAME = 'admin';
// 出厂初始口令：仅用于首次登录，登录后必须立刻改掉（由 mustChangePassword 强制）
const DEFAULT_SUPER_ADMIN_PASSWORD = 'admin';
const USERS_FILE = getDataFile('users.json');
const CARD_KEYS_FILE = getDataFile('card-keys.json');
// 免费试用卡密领取记录：同一来源地址或同一设备只能领一次
const FREE_CARD_CLAIMS_FILE = getDataFile('free-card-claims.json');
const FREE_CARD_DAYS = 7;
const FREE_CARD_NOTE = '免费试用7天';

// 卡密分两类，一种卡密只带一种效果，互不混用：
//   duration（时效卡密）—— 只延长账号有效期，登录前后都可激活
//   quota（额度账号卡密）—— 只增加账号数量上限，必须在登录后激活
const CARD_KEY_TYPE_DURATION = 'duration';
const CARD_KEY_TYPE_QUOTA = 'quota';
const CARD_KEY_TYPES = [CARD_KEY_TYPE_DURATION, CARD_KEY_TYPE_QUOTA];

ensureDataDir();

/** 密码加盐哈希 */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}

function makePasswordFields(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, passwordHash: hashPassword(password, salt) };
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return raw && typeof raw === 'object' ? raw : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function loadUsers() {
  const data = readJson(USERS_FILE, { users: [] });
  return Array.isArray(data.users) ? data.users : [];
}

function saveUsers(users) {
  writeJson(USERS_FILE, { users });
}

/**
 * 卡密类型：新记录直接读 type；旧记录没有 type 时按已有字段推断，
 * 让历史卡密落到「天数优先、其次额度」的确定归属，而不是随机取一个默认值。
 */
function normalizeCardKeyType(key) {
  const raw = String((key && key.type) || '').trim().toLowerCase();
  if (CARD_KEY_TYPES.includes(raw)) return raw;
  if (Number(key && key.days) > 0) return CARD_KEY_TYPE_DURATION;
  if (Number(key && key.accountLimit) > 0) return CARD_KEY_TYPE_QUOTA;
  return CARD_KEY_TYPE_DURATION;
}

/** 归一成「一种卡密只带一种效果」：时效卡密不带额度，额度卡密不带天数 */
function normalizeCardKey(key) {
  const source = key && typeof key === 'object' ? key : {};
  const type = normalizeCardKeyType(source);
  return {
    ...source,
    type,
    days: type === CARD_KEY_TYPE_DURATION ? Math.max(0, Number(source.days) || 0) : 0,
    accountLimit: type === CARD_KEY_TYPE_QUOTA ? Math.max(0, Number(source.accountLimit) || 0) : 0,
  };
}

function loadCardKeys() {
  const data = readJson(CARD_KEYS_FILE, { keys: [] });
  return Array.isArray(data.keys) ? data.keys.map(normalizeCardKey) : [];
}

function saveCardKeys(keys) {
  writeJson(CARD_KEYS_FILE, { keys });
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, salt, ...rest } = user;
  void passwordHash;
  void salt;
  return rest;
}

/** 是否仍在使用出厂初始口令（只有超管初始账号会命中） */
function isUsingDefaultPassword(user) {
  if (!user || !user.passwordHash || !user.salt) return false;
  return hashPassword(DEFAULT_SUPER_ADMIN_PASSWORD, user.salt) === user.passwordHash;
}

function warnDefaultPasswordStillInUse() {
  console.warn(
    '\n' +
    '============================================================\n' +
    `[安全警告] 超级管理员 ${SUPER_ADMIN_USERNAME} 仍在使用出厂初始口令。\n` +
    '  登录后会强制要求修改密码；请勿在改密前把面板暴露到公网。\n' +
    '============================================================\n',
  );
}

function ensureSuperAdmin() {
  const users = loadUsers();
  const existing = users.find(user => user.username === SUPER_ADMIN_USERNAME);
  if (!existing) {
    users.push({
      username: SUPER_ADMIN_USERNAME,
      role: 'super_admin',
      card: null,
      accountLimit: Number.MAX_SAFE_INTEGER,
      expiresAt: null,
      disabled: false,
      createdAt: Date.now(),
      // 强制首次登录改密，避免出厂口令长期有效
      mustChangePassword: true,
      ...makePasswordFields(DEFAULT_SUPER_ADMIN_PASSWORD),
    });
    saveUsers(users);
    warnDefaultPasswordStillInUse();
    return;
  }
  let dirty = false;
  if (existing.role !== 'super_admin') {
    existing.role = 'super_admin';
    existing.accountLimit = Number.MAX_SAFE_INTEGER;
    existing.expiresAt = null;
    dirty = true;
  }
  // 老版本升级上来的实例：口令仍是出厂值时补上强制改密标记，否则这个修复只对新装生效
  if (existing.mustChangePassword !== true && isUsingDefaultPassword(existing)) {
    existing.mustChangePassword = true;
    dirty = true;
  }
  if (dirty) saveUsers(users);
  if (existing.mustChangePassword === true) warnDefaultPasswordStillInUse();
}

ensureSuperAdmin();

function getAllUsers() {
  return loadUsers().map(publicUser);
}

function findUser(username) {
  const target = String(username || '').trim();
  return loadUsers().find(user => user.username === target) || null;
}

function verifyPassword(username, password) {
  const user = findUser(username);
  if (!user || !user.passwordHash || !user.salt) return null;
  const hashed = hashPassword(password, user.salt);
  if (hashed !== user.passwordHash) return null;
  return user;
}

function usernameValid(username) {
  return /^[\w\u4E00-\u9FA5]{2,24}$/.test(String(username || ''));
}

function createUser({
  username,
  password,
  role = 'user',
  card = null,
  accountLimit = DEFAULT_ACCOUNT_LIMIT,
  expiresAt = null,
} = {}) {
  const name = String(username || '').trim();
  if (!usernameValid(name)) {
    throw new Error('用户名需为 2-24 位字母、数字、下划线或中文');
  }
  if (findUser(name)) throw new Error('用户名已存在');
  if (!password || String(password).length < 6) throw new Error('密码至少 6 位');

  const user = {
    username: name,
    role,
    card: card || null,
    accountLimit: Number(accountLimit) || DEFAULT_ACCOUNT_LIMIT,
    expiresAt: expiresAt ? Number(expiresAt) : null,
    disabled: false,
    createdAt: Date.now(),
    ...makePasswordFields(password),
  };
  const users = loadUsers();
  users.push(user);
  saveUsers(users);
  return publicUser(user);
}

function updateUser(username, patch = {}) {
  const users = loadUsers();
  const user = users.find(item => item.username === String(username || '').trim());
  if (!user) throw new Error('用户不存在');

  if (patch.expiresAt !== undefined) {
    user.expiresAt = patch.expiresAt === null ? null : Number(patch.expiresAt) || null;
  }
  if (patch.accountLimit !== undefined) {
    user.accountLimit = Number(patch.accountLimit) || DEFAULT_ACCOUNT_LIMIT;
  }
  if (patch.disabled !== undefined && user.role !== 'super_admin') {
    user.disabled = patch.disabled === true;
  }
  if (patch.password) {
    Object.assign(user, makePasswordFields(patch.password));
    // 已自行设置新密码，解除「必须修改初始口令」的限制
    user.mustChangePassword = false;
  }
  if (patch.role !== undefined && user.role !== 'super_admin') {
    user.role = patch.role === 'super_admin' ? 'super_admin' : 'user';
  }
  saveUsers(users);
  return publicUser(user);
}

function deleteUser(username) {
  const users = loadUsers();
  const target = String(username || '').trim();
  const user = users.find(item => item.username === target);
  if (!user) throw new Error('用户不存在');
  if (user.role === 'super_admin') throw new Error('不能删除超级管理员');
  saveUsers(users.filter(item => item.username !== target));
}

function extendUserExpiry(username, days) {
  const users = loadUsers();
  const user = users.find(item => item.username === String(username || '').trim());
  if (!user) throw new Error('用户不存在');
  const addMs = Number(days) * 24 * 60 * 60 * 1000;
  const base = user.expiresAt && user.expiresAt > Date.now() ? user.expiresAt : Date.now();
  user.expiresAt = base + addMs;
  saveUsers(users);
  return publicUser(user);
}

function isUserExpired(user) {
  if (!user) return false;
  if (user.role === 'super_admin') return false;
  return Boolean(user.expiresAt && Date.now() > Number(user.expiresAt));
}

// ============ 卡密 ============

function generateCardCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const block = () => Array.from(
    { length: 4 },
    () => alphabet[crypto.randomInt(alphabet.length)],
  ).join('');
  return `FARM-${block()}-${block()}-${block()}`;
}

function listCardKeys() {
  return loadCardKeys().sort((a, b) => b.createdAt - a.createdAt);
}

function createCardKeys({ count = 1, type = CARD_KEY_TYPE_DURATION, days = 30, accountLimit = DEFAULT_ACCOUNT_LIMIT, note = '' } = {}) {
  const total = Math.max(1, Math.min(100, Number(count) || 1));
  const keyType = normalizeCardKeyType({ type });
  // 一类卡密只写入自己那一项，另一项固定为 0，避免激活时把另一种效果也带上
  const durationDays = keyType === CARD_KEY_TYPE_DURATION
    ? Math.max(1, Math.min(3650, Number(days) || 30))
    : 0;
  const limit = keyType === CARD_KEY_TYPE_QUOTA
    ? Math.max(1, Math.min(50, Number(accountLimit) || DEFAULT_ACCOUNT_LIMIT))
    : 0;
  const keys = loadCardKeys();
  const created = [];
  for (let i = 0; i < total; i += 1) {
    const key = {
      code: generateCardCode(),
      type: keyType,
      days: durationDays,
      accountLimit: limit,
      note: String(note || '').slice(0, 100),
      createdAt: Date.now(),
      usedBy: null,
      usedAt: null,
    };
    keys.push(key);
    created.push(key);
  }
  saveCardKeys(keys);
  return created;
}

/**
 * 登录前激活路径（注册 / 凭用户名续费）只允许时效卡密。
 * 额度卡密会改变账号数量上限，必须登录后在应用内激活，避免仅凭用户名就替他人消耗额度。
 */
function assertCardKeyActivatableBeforeLogin(key) {
  if (normalizeCardKeyType(key) === CARD_KEY_TYPE_QUOTA) {
    throw new Error('额度账号卡密只能在登录后激活，请先登录再使用');
  }
}

function findCardKey(code) {
  const target = String(code || '').trim().toUpperCase();
  return loadCardKeys().find(key => key.code === target) || null;
}

/** 使用卡密：返回卡密信息；不可用时抛错 */
function consumeCardKey(code, username) {
  const keys = loadCardKeys();
  const target = String(code || '').trim().toUpperCase();
  const key = keys.find(item => item.code === target);
  if (!key) throw new Error('卡密不存在，请检查后重新输入');
  if (key.usedBy) throw new Error('该卡密已被使用');

  key.usedBy = String(username || '').trim();
  key.usedAt = Date.now();
  saveCardKeys(keys);
  return key;
}

/**
 * 登录前使用卡密：先校验类型再消耗。
 * 顺序很关键——consumeCardKey 会把卡密标记为已使用，
 * 若先消耗再拒绝，用户手里那张额度卡密就被白白废掉了。
 */
function consumeCardKeyBeforeLogin(code, username) {
  const key = findCardKey(code);
  if (!key) throw new Error('卡密不存在，请检查后重新输入');
  if (key.usedBy) throw new Error('该卡密已被使用');
  assertCardKeyActivatableBeforeLogin(key);
  return consumeCardKey(code, username);
}

function deleteCardKey(code) {
  const keys = loadCardKeys();
  const target = String(code || '').trim().toUpperCase();
  const key = keys.find(item => item.code === target);
  if (!key) throw new Error('卡密不存在');
  // 已使用的卡密仅作为领取记录，删除不影响已注册账号
  saveCardKeys(keys.filter(item => item.code !== target));
}

// ============ 免费试用卡密 ============

/** 统一来源地址格式，避免 ::ffff:1.2.3.4 和 1.2.3.4 被当成两个来源 */
function normalizeClaimAddress(address) {
  return String(address || '').trim().toLowerCase().replace(/^::ffff:/, '');
}

/** 统一设备标识格式：前端生成的持久化随机 ID，截断防脏数据撑大记录 */
function normalizeDeviceId(deviceId) {
  return String(deviceId || '').trim().toLowerCase().slice(0, 64);
}

function loadFreeCardClaims() {
  const data = readJson(FREE_CARD_CLAIMS_FILE, { claims: [] });
  return Array.isArray(data.claims) ? data.claims : [];
}

function saveFreeCardClaims(claims) {
  writeJson(FREE_CARD_CLAIMS_FILE, { claims });
}

function listFreeCardClaims() {
  return loadFreeCardClaims().sort((a, b) => b.claimedAt - a.claimedAt);
}

function findFreeCardClaim(address) {
  const target = normalizeClaimAddress(address);
  if (!target) return null;
  return loadFreeCardClaims().find(claim => claim.address === target) || null;
}

function findFreeCardClaimByDevice(deviceId) {
  const target = normalizeDeviceId(deviceId);
  if (!target) return null;
  return loadFreeCardClaims().find(claim => claim.deviceId === target) || null;
}

/** 领取免费试用卡密：同一来源地址或同一设备都只能领一次 */
function claimFreeCard({ address, deviceId, username = '', days = FREE_CARD_DAYS } = {}) {
  const target = normalizeClaimAddress(address);
  const device = normalizeDeviceId(deviceId);
  // IP 与设备是两个独立限制维度：换设备刷 IP、换 IP 刷设备都拦住
  if (!target && !device) throw new Error('无法识别来源地址，请稍后重试');
  if (target && findFreeCardClaim(target)) throw new Error('每个IP/设备仅可领取一次免费卡密，感谢您的使用！');
  if (device && findFreeCardClaimByDevice(device)) throw new Error('每个IP/设备仅可领取一次免费卡密，感谢您的使用！');

  // 免费试用只送时长；账号额度由 createUser 的默认额度提供，不通过卡密发放
  const [card] = createCardKeys({ count: 1, type: CARD_KEY_TYPE_DURATION, days, note: FREE_CARD_NOTE });
  const claims = loadFreeCardClaims();
  claims.push({
    address: target,
    deviceId: device,
    username: String(username || '').trim(),
    card: card.code,
    days: Number(card.days),
    claimedAt: Date.now(),
  });
  saveFreeCardClaims(claims);
  return card;
}

/** 清除领取记录：传 address 只清该来源，不传则清空全部 */
function resetFreeCardClaims(address) {
  const target = normalizeClaimAddress(address);
  if (!target) {
    saveFreeCardClaims([]);
    return [];
  }
  const remaining = loadFreeCardClaims().filter(claim => claim.address !== target);
  saveFreeCardClaims(remaining);
  return remaining;
}

module.exports = {
  DEFAULT_ACCOUNT_LIMIT,
  DEFAULT_SUPER_ADMIN_PASSWORD,
  SUPER_ADMIN_USERNAME,
  getAllUsers,
  findUser,
  verifyPassword,
  usernameValid,
  createUser,
  updateUser,
  deleteUser,
  extendUserExpiry,
  isUserExpired,
  listCardKeys,
  createCardKeys,
  findCardKey,
  consumeCardKey,
  consumeCardKeyBeforeLogin,
  deleteCardKey,
  CARD_KEY_TYPE_DURATION,
  CARD_KEY_TYPE_QUOTA,
  CARD_KEY_TYPES,
  normalizeCardKeyType,
  normalizeCardKey,
  assertCardKeyActivatableBeforeLogin,
  FREE_CARD_DAYS,
  listFreeCardClaims,
  findFreeCardClaim,
  findFreeCardClaimByDevice,
  claimFreeCard,
  resetFreeCardClaims,
  normalizeClaimAddress,
  normalizeDeviceId,
};
