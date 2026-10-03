import * as C from '../public/core.mjs';
import {ApiError} from './errors.mjs';

// 注册时资料的初始值：名字取用户名，让用户一眼认得出是自己的账号；
// 习惯与话题沿用 core.mjs 的默认文案。
export function defaultProfile(username) {
  const base = C.freshState().profile;
  return {name: username, habit: base.habit, topic: base.topic, allowNotes: base.allowNotes};
}

export function userById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function profileOf(row) {
  return {name: row.name, habit: row.habit, topic: row.topic, allowNotes: !!row.allow_notes};
}

export function readState(db, userId) {
  const user = userById(db, userId);
  if (!user) throw new ApiError('账号不存在，请重新登录。', 401, 'UNAUTHENTICATED');
  const row = db.prepare('SELECT json FROM states WHERE user_id = ?').get(userId);
  const state = row ? JSON.parse(row.json) : C.freshState();
  // Add only newly introduced cast slots; do not conceal corruption in the original cast.
  for (const p of C.DRAW_PEOPLE) {
    if (state.messages && !Object.hasOwn(state.messages,p.id)) state.messages[p.id]=[];
    if (state.scenarios && !Object.hasOwn(state.scenarios,p.id)) state.scenarios[p.id]={intent:'exploring',authorized:true,cycle:0};
  }
  // 注入必须发生在校验之前 —— core.mjs 的 validState 要求 profile 存在。
  state.profile = profileOf(user);
  if (!C.validState(state)) throw new ApiError('账号数据损坏，请联系管理员。', 500, 'INTERNAL');
  return state;
}

export function writeState(db, userId, state, now = Date.now()) {
  const p = state.profile;
  db.prepare('UPDATE users SET name = ?, habit = ?, topic = ?, allow_notes = ? WHERE id = ?')
    .run(p.name, p.habit, p.topic, p.allowNotes ? 1 : 0, userId);
  const {profile, ...rest} = state;   // profile 不进 JSON，users 表才是唯一真相
  db.prepare('INSERT INTO states (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at')
    .run(userId, JSON.stringify(rest), now);
}
