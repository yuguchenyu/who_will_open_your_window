import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {ApiError} from '../lib/errors.mjs';

test('openDatabase creates every table', () => {
  const db = openDatabase(':memory:');
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const t of ['users', 'sessions', 'states', 'login_attempts']) assert(names.includes(t), `missing table ${t}`);
});

test('a user can only ever have one active session', () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run('u1', 'an', 'h', 's', 1, 'an', 'h', 't');
  const add = (token) => db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?,?,?,?,?)')
    .run(token, 'u1', 'dev', 1, 9e12);
  add('t1');
  assert.throws(() => add('t2'), /UNIQUE constraint failed/);
  db.prepare('UPDATE sessions SET active = 0 WHERE user_id = ? AND active = 1').run('u1');
  add('t2');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 2);
});

test('usernames are unique regardless of case', () => {
  const db = openDatabase(':memory:');
  const add = (u) => db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run('u_' + u, u, 'h', 's', 1, u, 'h', 't');
  add('An');
  assert.throws(() => add('an'), /UNIQUE constraint failed/);
});

test('deleting a user removes their sessions and state', () => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run('u1', 'an', 'h', 's', 1, 'an', 'h', 't');
  db.prepare('INSERT INTO sessions (token_hash, user_id, device, created_at, expires_at) VALUES (?,?,?,?,?)').run('t1', 'u1', 'd', 1, 9e12);
  db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?,?,?)').run('u1', '{}', 1);
  db.prepare('DELETE FROM users WHERE id = ?').run('u1');
  assert.equal(db.prepare('SELECT count(*) c FROM sessions').get().c, 0);
  assert.equal(db.prepare('SELECT count(*) c FROM states').get().c, 0);
});

test('ApiError carries status and code', () => {
  const e = new ApiError('不行。', 401, 'NOPE');
  assert.equal(e.message, '不行。');
  assert.equal(e.status, 401);
  assert.equal(e.code, 'NOPE');
  assert(e instanceof Error);
});
