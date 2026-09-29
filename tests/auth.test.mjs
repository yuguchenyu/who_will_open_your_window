import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register, validateCredentials, newSalt, hashPassword, verifyPassword, hashToken, deviceLabel} from '../lib/auth.mjs';
import {readState} from '../lib/state.mjs';

test('password hashing is salted and verifiable', () => {
  const a = newSalt(), b = newSalt();
  assert.notEqual(a, b, 'each salt must be unique');
  const h = hashPassword('correct horse', a);
  assert.equal(h.length, 128);
  assert(verifyPassword('correct horse', a, h));
  assert(!verifyPassword('wrong horse', a, h));
  assert(!verifyPassword('correct horse', b, h), 'a different salt must not verify');
  // 长度对不上时返回 false，不能抛异常。
  assert.equal(verifyPassword('correct horse', a, 'deadbeef'), false);
});

test('credential rules reject bad input with readable Chinese messages', () => {
  assert.throws(() => validateCredentials('ab', 'password12'), /用户名/);
  assert.throws(() => validateCredentials('a'.repeat(21), 'password12'), /用户名/);
  assert.throws(() => validateCredentials('小安', 'password12'), /用户名/, 'non-ASCII usernames are rejected, not passed to SQLite');
  assert.throws(() => validateCredentials('an🙂', 'password12'), /用户名/);
  assert.throws(() => validateCredentials('an_1', 'short'), /密码/);
  assert.throws(() => validateCredentials('an_1', 'x'.repeat(129)), /密码/);
  validateCredentials('an_1', 'password12');
});

test('register creates an account, a fresh state, and a session in one go', () => {
  const db = openDatabase(':memory:');
  const {token, user} = register(db, {username: 'an_1', password: 'password12', userAgent: 'Mozilla/5.0 (iPhone)', now: 1000});
  assert.match(user.id, /^u_[0-9a-f]{32}$/);
  assert.equal(user.username, 'an_1');
  assert.equal(user.name, 'an_1', 'the display name starts as the username');
  const state = readState(db, user.id);
  assert(C.validState(state));
  assert.equal(state.notes.length, 0);
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hashToken(token));
  assert(row, 'a session must be created so the user is logged in right away');
  assert.equal(row.active, 1);
  assert.equal(row.expires_at, 1000 + 30 * 86400000);
});

test('a duplicate username is refused regardless of case, with a readable message', () => {
  const db = openDatabase(':memory:');
  register(db, {username: 'an_1', password: 'password12', now: 1});
  assert.throws(() => register(db, {username: 'AN_1', password: 'password12', now: 1}),
    (e) => e.status === 409 && e.code === 'USERNAME_TAKEN' && /已经被注册/.test(e.message));
});

test('the password never reaches the database in plaintext', () => {
  const db = openDatabase(':memory:');
  register(db, {username: 'an_1', password: 'hunter2hunter2', now: 1});
  const dump = JSON.stringify(db.prepare('SELECT * FROM users').all());
  assert(!dump.includes('hunter2hunter2'));
});

test('a failed registration leaves nothing behind', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => register(db, {username: 'an_1', password: 'short', now: 1}));
  assert.equal(db.prepare('SELECT count(*) c FROM users').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
});

test('deviceLabel turns a user agent into something worth showing a person', () => {
  assert.match(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1'), /iOS/);
  assert.match(deviceLabel('Mozilla/5.0 (Linux; Android 14) Chrome/120'), /Android/);
  assert.match(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120'), /Windows/);
  assert.equal(deviceLabel(''), '未知设备 · 浏览器');
});

// --- 登录、单设备顶替、登出、限速 -------------------------------------------
import {login, resolveSession, logout, failureKey, isLockedOut, recordFailure, clearFailures, ipFailureKey, pruneFailures, MAX_IP_FAILURES} from '../lib/auth.mjs';

// assert.throws 返回 undefined，拿不到错误对象；这里显式捕获。
function failure(fn) {
  try { fn(); } catch (error) { return error; }
  throw new Error('这一步本该失败，但它成功了。');
}

test('logging in on a second device kicks the first one off', () => {
  const db = openDatabase(':memory:');
  const first = register(db, {username: 'an_1', password: 'password12',
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1', now: 1000});
  assert.equal(resolveSession(db, first.token, 1000).user.username, 'an_1');

  const second = login(db, {username: 'an_1', password: 'password12', userAgent: 'Windows NT 10.0 Chrome', now: 2000});
  assert.equal(second.replacedDevice, 'iOS 设备 · Safari');

  const old = resolveSession(db, first.token, 2000);
  assert.equal(old.reason, 'replaced', 'the displaced device must be told why, not just logged out');
  assert.equal(resolveSession(db, second.token, 2000).user.username, 'an_1');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions WHERE active = 1').get().c, 1);
});

test('bad credentials give one message that does not reveal whether the account exists', () => {
  const db = openDatabase(':memory:');
  register(db, {username: 'an_1', password: 'password12', now: 1});
  const wrongPassword = failure(() => login(db, {username: 'an_1', password: 'nope-nope', now: 1}));
  const noSuchUser = failure(() => login(db, {username: 'zz_9', password: 'nope-nope', now: 1}));
  assert.equal(wrongPassword.code, 'BAD_CREDENTIALS');
  assert.equal(noSuchUser.code, 'BAD_CREDENTIALS');
  assert.equal(wrongPassword.message, noSuchUser.message);
  assert(!/不存在/.test(noSuchUser.message));
});

test('logging out then back in on the same device is not mistaken for a takeover', () => {
  const db = openDatabase(':memory:');
  const first = register(db, {username: 'an_1', password: 'password12', now: 1});
  logout(db, first.token);
  const again = login(db, {username: 'an_1', password: 'password12', now: 2});
  const r = resolveSession(db, again.token, 2);
  assert.equal(r.user.username, 'an_1', 'the fresh session must work, not report "replaced"');
  assert.equal(resolveSession(db, first.token, 2).reason, 'missing');
});

test('an expired session is rejected and cleaned up', () => {
  const db = openDatabase(':memory:');
  const {token} = register(db, {username: 'an_1', password: 'password12', now: 1});
  assert.equal(resolveSession(db, token, 1 + 30 * 86400000 + 1).reason, 'expired');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
});

test('an unknown or absent token is simply missing', () => {
  const db = openDatabase(':memory:');
  assert.equal(resolveSession(db, '', 1).reason, 'missing');
  assert.equal(resolveSession(db, 'not-a-real-token', 1).reason, 'missing');
});

test('repeated failures lock the account out for a window, then it frees up', () => {
  const db = openDatabase(':memory:');
  const key = failureKey('10.0.0.5', 'An_1');
  assert.equal(key, failureKey('10.0.0.5', 'an_1'), 'the key must be case-insensitive to match the username rule');
  assert(!isLockedOut(db, key, 0));
  for (let i = 0; i < 10; i++) recordFailure(db, key, 0);
  assert(isLockedOut(db, key, 0));
  assert(!isLockedOut(db, key, 15 * 60000 + 1), 'the lock must expire on its own');
  clearFailures(db, key);
  assert(!isLockedOut(db, key, 0));
});

// 只按 IP 计数的第二把锁：换用户名重试也躲不开。阈值比单账号那把高。
test('the per-IP counter trips on its own, with its own threshold', () => {
  const db = openDatabase(':memory:');
  const ip = ipFailureKey('10.0.0.5');
  assert.notEqual(ip, failureKey('10.0.0.5', 'anything'), 'the IP key must not collide with a username key');
  assert(!isLockedOut(db, ip, 0, MAX_IP_FAILURES));
  for (let i = 0; i < MAX_IP_FAILURES; i++) recordFailure(db, ip, 0);
  assert(isLockedOut(db, ip, 0, MAX_IP_FAILURES));
  assert(!isLockedOut(db, ip, 15 * 60000 + 1, MAX_IP_FAILURES), 'the IP lock must expire on its own');
});

// 失败行原来只在同一个 key 被再次尝试时才删，于是每换一个用户名就永久多一行。
test('stale failure rows are pruned instead of piling up forever', () => {
  const db = openDatabase(':memory:');
  const count = () => db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n;
  for (let i = 0; i < 25; i++) recordFailure(db, failureKey('10.0.0.5', 'ghost_' + i), 0);
  assert.equal(count(), 25);
  pruneFailures(db, 15 * 60000 + 1);
  assert.equal(count(), 0, 'rows past the lock window must not be kept');
});
