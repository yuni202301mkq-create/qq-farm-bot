const crypto = require('node:crypto');
const fs = require('node:fs');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

const DEFAULT_ACCOUNT_LIMIT = 2;
const SUPER_ADMIN_USERNAME = 'admin';
const USERS_FILE = getDataFile('users.json');
const CARD_KEYS_FILE = getDataFile('card-keys.json');
// 免费试用卡密领取记录：同一来源地址只能领一次
const FREE_CARD_CLAIMS_FILE = getDataFile('free-card-claims.json');
const FREE_CARD_DAYS = 7;
const FREE_CARD_NOTE = '免费试用7天';

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

function loadCardKeys() {
  const data = readJson(CARD_KEYS_FILE, { keys: [] });
  return Array.isArray(data.keys) ? data.keys : [];
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
      ...makePasswordFields('admin'),
    });
    saveUsers(users);
    return;
  }
  if (existing.role !== 'super_admin') {
    existing.role = 'super_admin';
    existing.accountLimit = Number.MAX_SAFE_INTEGER;
    existing.expiresAt = null;
    saveUsers(users);
  }
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
  return /^[a-zA-Z0-9_\u4e00-\u9fa5]{2,24}$/.test(String(username || ''));
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

function createCardKeys({ count = 1, days = 30, accountLimit = DEFAULT_ACCOUNT_LIMIT, note = '' } = {}) {
  const total = Math.max(1, Math.min(100, Number(count) || 1));
  const durationDays = Math.max(1, Math.min(3650, Number(days) || 30));
  const limit = Math.max(1, Math.min(50, Number(accountLimit) || DEFAULT_ACCOUNT_LIMIT));
  const keys = loadCardKeys();
  const created = [];
  for (let i = 0; i < total; i += 1) {
    const key = {
      code: generateCardCode(),
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

function deleteCardKey(code) {
  const keys = loadCardKeys();
  const target = String(code || '').trim().toUpperCase();
  const key = keys.find(item => item.code === target);
  if (!key) throw new Error('卡密不存在');
  if (key.usedBy) throw new Error('已使用的卡密不能删除');
  saveCardKeys(keys.filter(item => item.code !== target));
}

// ============ 免费试用卡密 ============

/** 统一来源地址格式，避免 ::ffff:1.2.3.4 和 1.2.3.4 被当成两个来源 */
function normalizeClaimAddress(address) {
  return String(address || '').trim().toLowerCase().replace(/^::ffff:/, '');
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
  return loadFreeCardClaims().find(claim => claim.address === target) || null;
}

/** 领取免费试用卡密：同一来源地址只能领一次 */
function claimFreeCard({ address, username = '', days = FREE_CARD_DAYS, accountLimit = DEFAULT_ACCOUNT_LIMIT } = {}) {
  const target = normalizeClaimAddress(address);
  if (!target) throw new Error('无法识别来源地址，请稍后重试');
  if (findFreeCardClaim(target)) throw new Error('该网络已领取过免费卡密，请使用卡密注册');

  const [card] = createCardKeys({ count: 1, days, accountLimit, note: FREE_CARD_NOTE });
  const claims = loadFreeCardClaims();
  claims.push({
    address: target,
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
  deleteCardKey,
  FREE_CARD_DAYS,
  listFreeCardClaims,
  findFreeCardClaim,
  claimFreeCard,
  resetFreeCardClaims,
  normalizeClaimAddress,
};
