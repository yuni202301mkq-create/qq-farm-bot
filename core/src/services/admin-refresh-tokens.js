/**
 * 管理端长期 refresh token 存储
 *
 * 目的：bot 重启后用户不用重新登录。
 * 短期的 session token 仍然只在内存里（重启即失效），这里额外签发一个长期
 * refresh token 落盘保存；重启后前端拿 refresh token 换一个新的 session token。
 *
 * 安全设计：
 * 1. **落盘只存 sha256 哈希，不存明文**。文件泄露也无法直接拿来换 session。
 * 2. **单次使用轮换（rotation）**：每次 refresh 都删掉旧记录、签发新 token。
 *    旧的 refresh token 立刻失效，被盗用的 token 用过一次就作废。
 * 3. **有效期**：默认 30 天，过期自动清理。
 * 4. **可撤销**：改密码、禁用、登出时按 username 撤销该用户全部 refresh token。
 *
 * 文件格式：<dataDir>/admin-refresh-tokens.json
 *   [{ id, username, tokenHash, createdAt, expiresAt }]
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

/** 默认有效期：30 天 */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function hashToken(raw) {
  return crypto
    .createHash('sha256')
    .update(String(raw || ''))
    .digest('hex');
}

function createId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

/**
 * @param {object} options
 * @param {string} options.filePath - 落盘路径（一般是 getDataFile('admin-refresh-tokens.json')）
 * @param {number} [options.ttlMs] - 有效期，默认 30 天
 * @param {Function} [options.log] - (level, message) 日志
 */
function createAdminRefreshTokenStore(options = {}) {
  const {
    filePath,
    ttlMs = DEFAULT_TTL_MS,
    log = () => {},
  } = options;

  if (!filePath) throw new Error('admin-refresh-tokens: filePath 必填');

  let records = [];

  function load() {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Array.isArray(parsed)) {
          records = parsed.filter(
            r =>
              r
              && typeof r.tokenHash === 'string'
              && typeof r.username === 'string',
          );
        }
      }
    } catch (error) {
      // 文件损坏时从空开始，避免整个 bot 起不来
      log('warn', `refresh token 文件读取失败，已忽略: ${error.message}`);
      records = [];
    }
    pruneExpired();
    return records;
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      // 先写临时文件再 rename，避免写一半崩溃导致文件损坏
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, filePath);
    } catch (error) {
      log('warn', `refresh token 落盘失败: ${error.message}`);
    }
  }

  /** 清掉过期记录，返回清理条数 */
  function pruneExpired() {
    const now = Date.now();
    const before = records.length;
    records = records.filter(r => Number(r.expiresAt) > now);
    return before - records.length;
  }

  /**
   * 签发一个新的 refresh token
   * @returns {{ token: string, expiresAt: number, id: string }} 明文 token 只在这里返回一次
   */
  function issue({ username } = {}) {
    const name = String(username || '').trim();
    if (!name) throw new Error('admin-refresh-tokens: username 必填');
    const raw = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const record = {
      id: createId(),
      username: name,
      tokenHash: hashToken(raw),
      createdAt: now,
      expiresAt: now + Number(ttlMs),
    };
    records.push(record);
    persist();
    return { token: raw, expiresAt: record.expiresAt, id: record.id };
  }

  /**
   * 用 refresh token 换新（单次使用）。
   * 成功会**删掉旧记录**并签发新的，返回新的明文 token；
   * 失败（不存在 / 已过期）返回 null。
   *
   * @returns {{ username: string, token: string, expiresAt: number } | null} 成功返回新凭据，失败返回 null
   */
  function rotate(raw) {
    if (!raw) return null;
    const hash = hashToken(raw);
    const idx = records.findIndex(r => r.tokenHash === hash);
    if (idx < 0) return null;

    const record = records[idx];
    if (Number(record.expiresAt) <= Date.now()) {
      records.splice(idx, 1);
      persist();
      return null;
    }

    // 删旧 + 签新：旧 token 即刻失效（防重放）
    records.splice(idx, 1);
    const fresh = issue({ username: record.username });
    return {
      username: record.username,
      token: fresh.token,
      expiresAt: fresh.expiresAt,
    };
  }

  /** 撤销某个用户的全部 refresh token（改密码 / 禁用 / 删除用户时用） */
  function revokeUser(username) {
    const name = String(username || '').trim();
    if (!name) return 0;
    const before = records.length;
    records = records.filter(r => r.username !== name);
    if (records.length !== before) persist();
    return before - records.length;
  }

  /** 撤销单个 refresh token（登出时用） */
  function revokeToken(raw) {
    if (!raw) return 0;
    const hash = hashToken(raw);
    const before = records.length;
    records = records.filter(r => r.tokenHash !== hash);
    if (records.length !== before) persist();
    return before - records.length;
  }

  /** 撤销全部（紧急止血用） */
  function revokeAll() {
    const count = records.length;
    if (count > 0) {
      records = [];
      persist();
    }
    return count;
  }

  load();

  return {
    count: () => records.length,
    filePath,
    issue,
    pruneExpired,
    records: () => records.slice(),
    revokeAll,
    revokeToken,
    revokeUser,
    rotate,
  };
}

module.exports = {
  DEFAULT_TTL_MS,
  createAdminRefreshTokenStore,
  hashToken,
};
