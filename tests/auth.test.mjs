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
