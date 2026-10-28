/**
 * 账号认证、单设备会话与登录失败计数。
 * 浏览器持有会话令牌，数据库保存令牌摘要；密码使用独立随机盐派生摘要。
 */

import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash
} from 'node:crypto';
import { seedLegacyCollection } from './draw.mjs';
import { ApiError } from './errors.mjs';
import { defaultProfile, writeState } from './state.mjs';
import * as C from '../public/core.mjs';

export const COOKIE_NAME = 'hw_session';
export const SESSION_MS = 30 * 86400000; // 30 天
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

/**
 * 为每个账号生成独立的随机密码盐。
 * 同一密码配合不同盐会得到不同摘要，盐与摘要一起保存在账号记录中。
 */
export function newSalt() {
  return randomBytes(16).toString('hex');
}

/**
 * 使用 scrypt 派生固定长度的密码摘要。
 * 调用方负责传入账号自己的盐，返回十六进制文本便于数据库存储。
 */
export function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

/**
 * 生成供浏览器持有的高熵会话令牌。
 * 使用 URL 安全编码，避免普通 Base64 中的特殊字符进入 Cookie 值。
 */
export function newToken() {
  return randomBytes(32).toString('base64url');
}

/**
 * 将会话令牌转换为固定长度 SHA-256 摘要。
 * 保存和查找会话均使用此摘要，原始令牌只交给浏览器。
 */
export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/**
 * 派生候选密码摘要并与已保存摘要比较。
 * 派生失败时按验证不通过处理，避免异常打断普通登录失败流程。
 */
export function verifyPassword(password, salt, expectedHex) {
  let actual;
  try {
    actual = Buffer.from(hashPassword(password, salt), 'hex');
  } catch {
    return false;
  }
  const expected = Buffer.from(String(expectedHex), 'hex');
  // timingSafeEqual 要求两侧长度一致，先检查长度再进行恒定时间比较。
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 用户名限 ASCII：中文名走 profile.name，不走登录名。这样也避免把奇怪字符喂给 SQLite。

/**
 * 检查登录名格式及密码的字符数量。
 * 用户名使用 ASCII 规则，展示名称仍可独立保存中文等文本。
 */
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    throw new ApiError('用户名需为 3–20 位字母、数字或下划线。');
  const length =
    typeof password === 'string' ? Array.from(password).length : -1;
  if (length < MIN_PASSWORD || length > MAX_PASSWORD)
    throw new ApiError(`密码需为 ${MIN_PASSWORD}–${MAX_PASSWORD} 个字符。`);
}

/**
 * 从浏览器 User-Agent 提取可读的设备和浏览器名称。
 * 只用于提示会话被哪个设备替换，不把它当作可信设备身份。
 */
export function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  const kind = /iPhone|iPad|iPod/i.test(ua)
    ? 'iOS 设备'
    : /Android/i.test(ua)
      ? 'Android 设备'
      : /Macintosh|Mac OS X/i.test(ua)
        ? 'Mac'
        : /Windows/i.test(ua)
          ? 'Windows 设备'
          : '未知设备';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : '浏览器';
  return `${kind} · ${browser}`;
}

/**
 * 创建账号、默认资料、初始收藏和登录会话。
 * 所有初始记录在同一事务中写入，用户名重复时返回明确的业务错误。
 */
export function register(
  db,
  { username, password, userAgent = '', now = Date.now() }
) {
  validateCredentials(username, password);
  const id = 'u_' + randomBytes(16).toString('hex');
  const salt = newSalt();
  const profile = defaultProfile(username);
  const token = newToken();
  // 账号、初始收藏、状态和首个会话共同组成一次完整注册。
  db.exec('BEGIN');
  try {
    db.prepare(
      'INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes, favorability_enabled) VALUES (?,?,?,?,?,?,?,?,?,?)'
    ).run(
      id,
      username,
      hashPassword(password, salt),
      salt,
      now,
      profile.name,
      profile.habit,
      profile.topic,
      profile.allowNotes ? 1 : 0,
      profile.favorabilityEnabled !== false ? 1 : 0
    );
    seedLegacyCollection(db, id, now);
    const state = C.freshState(now);
    state.profile = profile;
    writeState(db, id, state, now);
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at, active) VALUES (?,?,?,?,?,1)'
    ).run(hashToken(token), id, deviceLabel(userAgent), now, now + SESSION_MS);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (/UNIQUE constraint failed: users\.username/.test(error.message))
      throw new ApiError(
        '这个用户名已经被注册了，换一个试试。',
        409,
        'USERNAME_TAKEN'
      );
    throw error;
  }
  return {
    token,
    user: db.prepare('SELECT * FROM users WHERE id = ?').get(id)
  };
}

export const MAX_FAILURES = 10;
export const MAX_IP_FAILURES = 30;
const LOCK_MS = 15 * 60000;

// 用户不存在时用它跑一次等价的 scrypt，让响应时间不泄露账号是否存在。
const DUMMY_SALT = newSalt();
const DUMMY_HASH = hashPassword('this password is never valid', DUMMY_SALT);

/**
 * 验证账号后建立新的单设备会话。
 * 旧会话记录替换来源，以便原设备在下次请求时得到具体退出原因。
 */
export function login(
  db,
  { username, password, userAgent = '', now = Date.now() }
) {
  const row =
    typeof username === 'string'
      ? db.prepare('SELECT * FROM users WHERE username = ?').get(username) // COLLATE NOCASE 生效
      : undefined;
  const ok = verifyPassword(
    typeof password === 'string' ? password : '',
    row ? row.salt : DUMMY_SALT,
    row ? row.password_hash : DUMMY_HASH
  );
  if (!row || !ok)
    throw new ApiError('用户名或密码不正确。', 401, 'BAD_CREDENTIALS');

  const device = deviceLabel(userAgent);
  const previous = db
    .prepare('SELECT device FROM sessions WHERE user_id = ? AND active = 1')
    .get(row.id);
  const token = newToken();
  db.exec('BEGIN');
  try {
    // 顶替：把旧会话标成 active = 0 并记下是谁顶的，用户下次操作时才能看到有用的提示。
    db.prepare(
      'UPDATE sessions SET active = 0, replaced_by = ? WHERE user_id = ? AND active = 1'
    ).run(device, row.id);
    db.prepare(
      'DELETE FROM sessions WHERE expires_at < ? OR (active = 0 AND created_at < ?)'
    ).run(now, now - 7 * 86400000);
    db.prepare(
      'INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at, active) VALUES (?,?,?,?,?,1)'
    ).run(hashToken(token), row.id, device, now, now + SESSION_MS);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { token, user: row, replacedDevice: previous ? previous.device : '' };
}

/**
 * 依据令牌查询有效会话及其所属账号。
 * 缺失、过期和被替换分别返回原因，由 HTTP 层决定跳转或响应方式。
 */
export function resolveSession(db, token, now = Date.now()) {
  // 浏览器持有原始令牌，数据库仅通过摘要查找对应会话。
  if (!token) return { reason: 'missing' };
  const row = db
    .prepare('SELECT * FROM sessions WHERE token_hash = ?')
    .get(hashToken(token));
  if (!row) return { reason: 'missing' };
  if (row.expires_at <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash);
    return { reason: 'expired' };
  }
  if (!row.active)
    return { reason: 'replaced', replacedBy: row.replaced_by || '' };
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  return user ? { user, session: row } : { reason: 'missing' };
}

// 删除而不是置 active = 0：否则用户重新登录时会被自己那条旧记录误判成"被顶掉"。

/**
 * 删除令牌对应的会话记录，使后续请求立即失效。
 * 没有令牌时无需处理，保持重复退出操作可安全调用。
 */
export function logout(db, token) {
  if (token)
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(
      hashToken(token)
    );
}

/**
 * 将客户端 IP 与规范化用户名组合成失败计数键。
 * 用户名统一转为小写，与账号不区分大小写的登录规则一致。
 */
export function failureKey(ip, username) {
  return `${ip}|${String(username || '').toLowerCase()}`;
}

// 第二把锁只认 IP：只按"IP + 用户名"计数的话，每次换一个用户名就是一把新锁，
// 谁也锁不住。阈值比单账号那把高，因为同一个 IP 后面可能是同一个人的多次手误。

/**
 * 为同一 IP 的全部账号尝试建立共享计数键。
 * 它与单账号计数共同生效，限制通过不断更换用户名绕过阈值。
 */
export function ipFailureKey(ip) {
  return `${ip}|*`;
}

// 失败记录原来只在同一个 key 被再次尝试时才删，于是每换一个用户名就永久多一行，
// 全由请求方挑选的字符串堆积。每次登录/注册顺手清一次过期的。

/**
 * 清理已经超出锁定窗口的失败记录。
 * 由认证入口定期调用，避免大量不同用户名产生长期无用记录。
 */
export function pruneFailures(db, now = Date.now()) {
  db.prepare('DELETE FROM login_attempts WHERE first_at < ?').run(
    now - LOCK_MS
  );
}

/**
 * 判断指定计数键是否达到当前窗口的失败阈值。
 * 已超时的记录就地删除，下一次尝试重新开始累计。
 */
export function isLockedOut(db, key, now = Date.now(), max = MAX_FAILURES) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  if (!row) return false;
  if (now - row.first_at > LOCK_MS) {
    db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
    return false;
  }
  return row.failures >= max;
}

/**
 * 记录一次失败，窗口不存在或已过期时从一次重新计数。
 * 仍在同一窗口内时只递增次数，不改变窗口起始时间。
 */
export function recordFailure(db, key, now = Date.now()) {
  const row = db.prepare('SELECT * FROM login_attempts WHERE key = ?').get(key);
  if (!row || now - row.first_at > LOCK_MS)
    db.prepare(
      'INSERT INTO login_attempts (key, failures, first_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures = 1, first_at = excluded.first_at'
    ).run(key, now);
  else
    db.prepare(
      'UPDATE login_attempts SET failures = failures + 1 WHERE key = ?'
    ).run(key);
}

/**
 * 清除指定计数键的记录。
 * 登录成功时由入口选择清除账号维度，IP 维度计数另行保留。
 */
export function clearFailures(db, key) {
  db.prepare('DELETE FROM login_attempts WHERE key = ?').run(key);
}
