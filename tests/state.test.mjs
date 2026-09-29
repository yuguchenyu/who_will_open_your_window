import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {openDatabase} from '../lib/db.mjs';
import {readState, writeState, defaultProfile, userById} from '../lib/state.mjs';

function seedUser(db, id = 'u1', username = '小安') {
  db.prepare('INSERT INTO users (id, username, password_hash, salt, created_at, name, habit, topic, allow_notes) VALUES (?,?,?,?,?,?,?,?,1)')
    .run(id, username, 'h', 's', 1, username, '习惯', '话题');
  return id;
}

test('a brand new user reads back a valid fresh state with their profile injected', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  const s = readState(db, id);
  assert(C.validState(s), 'injected state must satisfy the client state machine');
  assert.equal(s.profile.name, '小安');
  assert.equal(s.profile.habit, '习惯');
  assert.equal(s.profile.topic, '话题');
  assert.equal(s.profile.allowNotes, true);
  assert.equal(s.notes.length, 0);
});

test('profile lives in the users table, not in the state JSON', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  const s = readState(db, id);
  s.profile = {name: '改了', habit: '新习惯', topic: '新话题', allowNotes: false};
  writeState(db, id, s);
  const row = userById(db, id);
  assert.equal(row.name, '改了');
  assert.equal(row.habit, '新习惯');
  assert.equal(row.topic, '新话题');
  assert.equal(row.allow_notes, 0);
  const json = JSON.parse(db.prepare('SELECT json FROM states WHERE user_id = ?').get(id).json);
  assert.equal(json.profile, undefined, 'profile must not be duplicated into the JSON blob');
  assert.equal(readState(db, id).profile.allowNotes, false);
});

test('notes and messages survive a write/read round trip', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  const s = readState(db, id);
  C.sendNote(s, 'xia', '你好，很高兴认识你。');
  C.startNoteReply(s, s.notes[0].id);
  C.finishReply(s, 'xia', '很高兴认识你！');
  C.recordFeeling(s, 'xia', 73, '只给自己看');
  writeState(db, id, s);
  const back = readState(db, id);
  assert.deepEqual(back, s);
  assert.equal(back.feelings.xia[0].score, 73);
});

test('a corrupted stored blob is rejected loudly instead of rendering garbage', () => {
  const db = openDatabase(':memory:');
  const id = seedUser(db);
  db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?,?,?)').run(id, '{"version":1,"messages":{"xia":[null]}}', 1);
  assert.throws(() => readState(db, id), /损坏/);
});

test('reading a state for a user that does not exist is an auth failure, not a crash', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => readState(db, 'nobody'), (e) => e.status === 401 && e.code === 'UNAUTHENTICATED');
});

test('defaultProfile names the account after its username', () => {
  const p = defaultProfile('小安');
  assert.equal(p.name, '小安');
  assert.equal(p.allowNotes, true);
  assert.equal(typeof p.habit, 'string');
  assert.equal(typeof p.topic, 'string');
});
