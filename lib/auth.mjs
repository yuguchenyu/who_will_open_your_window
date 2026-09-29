import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {defaultProfile, writeState} from './state.mjs';
import * as C from '../public/core.mjs';

export const COOKIE_NAME = 'hw_session';
export const SESSION_MS = 30 * 86400000;              // 30 天
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;

export function newSalt() { return randomBytes(16).toString('hex'); }
export function hashPassword(password, salt) { return scryptSync(password, salt, 64).toString('hex'); }
export function newToken() { return randomBytes(32).toString('base64url'); }
export function hashToken(token) { return createHash('sha256').update(String(token)).digest('hex'); }

export function verifyPassword(password, salt, expectedHex) {
  let actual;
  try { actual = Buffer.from(hashPassword(password, salt), 'hex'); } catch { return false; }
  const expected = Buffer.from(String(expectedHex), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// 用户名限 ASCII：中文名走 profile.name，不走登录名。这样也避免把奇怪字符喂给 SQLite。
export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username))
    throw new ApiError('用户名需为 3–20 位字母、数字或下划线。');
  const length = typeof password === 'string' ? Array.from(password).length : -1;
  if (length < MIN_PASSWORD || length > MAX_PASSWORD)
    throw new ApiError(`密码需为 ${MIN_PASSWORD}–${MAX_PASSWORD} 个字符。`);
}

export function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  const kind = /iPhone|iPad|iPod/i.test(ua) ? 'iOS 设备'
    : /Android/i.test(ua) ? 'Android 设备'
    : /Macintosh|Mac OS X/i.test(ua) ? 'Mac'
    : /Windows/i.test(ua) ? 'Windows 设备'
    : '未知设备';
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox'
    : '浏览器';
  return `${kind} · ${browser}`;
}

export function register(db, {username, password, userAgent = '', now = Date.now()}) {
  validateCredentials(username, password);
  const id = 'u_' + randomBytes(16).toString('hex');
  const salt = newSalt();
  const profile = defaultProfile(username);
  const token = newToken();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, username, hashPassword(password, salt), salt, now, profile.name, profile.habit, profile.topic, profile.allowNotes ? 1 : 0);
    const state = C.freshState(now);
    state.profile = profile;
    writeState(db, id, state, now);
    db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at, active) VALUES (?,?,?,?,?,1)')
      .run(hashToken(token), id, deviceLabel(userAgent), now, now + SESSION_MS);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    if (/UNIQUE constraint failed: users\.username/.test(error.message))
      throw new ApiError('这个用户名已经被注册了，换一个试试。', 409, 'USERNAME_TAKEN');
    throw error;
  }
  return {token, user: db.prepare('SELECT * FROM users WHERE id = ?').get(id)};
}
