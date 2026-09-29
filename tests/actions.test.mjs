import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {readState} from '../lib/state.mjs';
import {runAction, ACTIONS} from '../lib/actions.mjs';

function account(patch = {}) {
  const db = openDatabase(':memory:');
  const {user} = register(db, {username: 'an_1', password: 'password12', now: 1000});
  return {db, user: {...user, ...patch}};
}

test('an action persists and the next read sees it', () => {
  const {db, user} = account();
  const {state, result} = runAction(db, user, 'sendNote', {personId: 'xia', text: '你好，很高兴认识你。'});
  assert.equal(state.notes.length, 1);
  assert.equal(result.id, state.notes[0].id, 'the created note is handed back so the client can act on it');
  assert.equal(readState(db, user.id).notes.length, 1, 'it must be on disk, not just in memory');
});

test('the daily note quota is enforced by the server, not the client', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '第一张'});
  runAction(db, user, 'sendNote', {personId: 'yu', text: '第二张'});
  assert.throws(() => runAction(db, user, 'sendNote', {personId: 'ning', text: '第三张'}),
    (e) => e.status === 400 && /机会已用完/.test(e.message));
  assert.equal(readState(db, user.id).notes.length, 2, 'the refused note must not be persisted');
});

test('an action outside the whitelist is refused', () => {
  const {db, user} = account();
  assert.throws(() => runAction(db, user, 'grantMyselfNotes', {count: 99}), (e) => e.code === 'UNKNOWN_ACTION');
  assert.throws(() => runAction(db, user, 'constructor', {}), (e) => e.code === 'UNKNOWN_ACTION');
  assert.throws(() => runAction(db, user, '__proto__', {}), (e) => e.code === 'UNKNOWN_ACTION');
});

test('a client cannot smuggle a whole state in and have it stored', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '真的'});
  runAction(db, user, 'sendNote', {personId: 'yu', text: '真的', state: {notes: [], feelings: {xia: [{score: 99}]}}});
  const s = readState(db, user.id);
  assert.equal(s.notes.length, 2, 'the extra state field must be ignored entirely');
  assert.equal(s.feelings.xia, undefined);
});

test('advance only accepts whole, sane day counts and changes nothing when it refuses', () => {
  const {db, user} = account();
  runAction(db, user, 'advance', {days: 7});
  assert.equal(readState(db, user.id).offsetDays, 7);
  for (const days of ['7', 1.5, -1, NaN, null, Infinity, 3651]) {
    assert.throws(() => runAction(db, user, 'advance', {days}), undefined, `days=${String(days)} must be refused`);
  }
  assert.equal(readState(db, user.id).offsetDays, 7, 'a refused advance must leave the state untouched');
  assert.throws(() => runAction(db, user, 'advance', {days: 3650}), /上限/);
});

test('a feeling score must be a real integer in range', () => {
  const {db, user} = account();
  runAction(db, user, 'recordFeeling', {personId: 'xia', score: 73, memo: '只给自己看'});
  for (const score of ['73', 20.5, -1, 101, null]) {
    assert.throws(() => runAction(db, user, 'recordFeeling', {personId: 'xia', score}), undefined, `score=${String(score)} must be refused`);
  }
  assert.equal(readState(db, user.id).feelings.xia.length, 1);
});

test('a rejected action leaves the stored state exactly as it was', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '你好，很高兴认识你。'});
  const before = JSON.stringify(readState(db, user.id));
  // 越界的分数一定被拒（core.mjs 的 recordFeeling 本来就会挡，服务端再挡一道）。
  assert.throws(() => runAction(db, user, 'recordFeeling', {personId: 'xia', score: 101}));
  assert.throws(() => runAction(db, user, 'sendNote', {personId: 'xia', text: '还没有人回应我呢'}));
  assert.equal(JSON.stringify(readState(db, user.id)), before);
});

test('saveProfile writes through to the users row', () => {
  const {db, user} = account();
  runAction(db, user, 'saveProfile', {profile: {name: '小安', habit: '慢热', topic: '今天如何', allowNotes: false}});
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  assert.equal(row.name, '小安');
  assert.equal(row.allow_notes, 0);
  assert.equal(readState(db, user.id).profile.name, '小安');
});

test('reset clears the interactions but keeps the account and its username', () => {
  const {db, user} = account();
  runAction(db, user, 'sendNote', {personId: 'xia', text: '你好'});
  runAction(db, user, 'reset', {});
  const s = readState(db, user.id);
  assert.equal(s.notes.length, 0);
  assert.equal(s.offsetDays, 0);
  assert.equal(s.profile.name, 'an_1', 'the display name falls back to the username, not to a stranger');
  assert(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id), 'the account itself must survive');
});

test('saveScenario takes the cycle from the server, not from the client', () => {
  const {db, user} = account();
  runAction(db, user, 'saveScenario', {personId: 'xia', intent: 'closer', authorized: true, cycle: 999});
  const s = readState(db, user.id);
  // cycleOf 用真实时间算，所以不能写死 0；要紧的是它等于服务端自己算出来的那个值。
  assert.equal(s.scenarios.xia.cycle, C.cycleOf(s), 'the cycle must come from the server clock');
  assert.notEqual(s.scenarios.xia.cycle, 999, 'the client-supplied cycle must be ignored');
});

test('finishReply exists for the server but cannot be triggered from the client', () => {
  const {db, user} = account();
  // core.mjs 的 finishReply 要求这个人有一条待完成的回复，否则直接返回 false。
  const {state: opened} = runAction(db, user, 'sendNote', {personId: 'xia', text: '你好，很高兴认识你。'});
  runAction(db, user, 'startNoteReply', {noteId: opened.notes[0].id});
  assert.throws(() => runAction(db, user, 'finishReply', {personId: 'xia', text: '我假装是 AI'}),
    (e) => e.code === 'UNKNOWN_ACTION', 'a client must not be able to forge an AI reply');
  const {state} = runAction(db, user, 'finishReply', {personId: 'xia', text: '真的回复'}, Date.now(), {internal: true});
  assert.equal(state.messages.xia.at(-1).content, '真的回复');
});

test('every action name maps to a function', () => {
  for (const [name, fn] of Object.entries(ACTIONS)) assert.equal(typeof fn, 'function', `${name} must be callable`);
});
