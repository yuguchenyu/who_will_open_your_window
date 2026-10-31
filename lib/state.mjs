/**
 * 将账号资料与虚拟人物互动状态组合为统一的业务状态。
 * 资料由 users 表维护，其余互动数据作为 JSON 保存在 states 表。
 */

import * as C from '../public/core.mjs';
import { ApiError } from './errors.mjs';

// 注册时资料的初始值：名字取用户名，让用户一眼认得出是自己的账号；
// 习惯与话题沿用 core.mjs 的默认文案。

/**
 * 以用户名建立账号的默认展示资料。
 * 习惯、话题和功能开关沿用共享初始状态，避免前后端默认值不一致。
 */
export function defaultProfile(username) {
  const base = C.freshState().profile;
  return {
    name: username,
    habit: base.habit,
    topic: base.topic,
    allowNotes: base.allowNotes,
    favorabilityEnabled: base.favorabilityEnabled ?? true
  };
}

/**
 * 按内部账号编号读取完整用户记录。
 * 此结果仅供服务端使用，对外响应必须另行选择可公开字段。
 */
export function userById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

/**
 * 把用户表字段映射为业务状态中的 profile。
 * 将 SQLite 整数开关转换为布尔值，供规则层和页面统一使用。
 */
function profileOf(row) {
  return {
    name: row.name,
    habit: row.habit,
    topic: row.topic,
    allowNotes: !!row.allow_notes,
    favorabilityEnabled: row.favorability_enabled !== 0
  };
}

/**
 * 读取互动 JSON，并注入以用户表为准的最新资料。
 * 兼容新增人物槽位后执行完整校验，既有结构损坏时明确报错。
 */
export function readState(db, userId) {
  const user = userById(db, userId);
  if (!user)
    throw new ApiError('账号不存在，请重新登录。', 401, 'UNAUTHENTICATED');
  const row = db
    .prepare('SELECT json FROM states WHERE user_id = ?')
    .get(userId);
  const state = row ? JSON.parse(row.json) : C.freshState();
  // Add only newly introduced cast slots; do not conceal corruption in the original cast.
  for (const p of C.DRAW_PEOPLE) {
    if (state.messages && !Object.hasOwn(state.messages, p.id))
      state.messages[p.id] = [];
    if (state.scenarios && !Object.hasOwn(state.scenarios, p.id))
      state.scenarios[p.id] = {
        intent: 'exploring',
        authorized: true,
        cycle: 0
      };
  }
  // 注入必须发生在校验之前 —— core.mjs 的 validState 要求 profile 存在。
  state.profile = profileOf(user);
  if (!C.validState(state))
    throw new ApiError('账号数据损坏，请联系管理员。', 500, 'INTERNAL');
  return state;
}

/**
 * 把 profile 写回用户表，其余状态序列化到状态表。
 * 两个存储位置各自维护负责的字段，避免 JSON 内的旧资料覆盖用户表。
 */
export function writeState(db, userId, state, now = Date.now()) {
  const p = state.profile;
  const favVal = p.favorabilityEnabled !== false ? 1 : 0;
  db.prepare(
    'UPDATE users SET name = ?, habit = ?, topic = ?, allow_notes = ?, favorability_enabled = ? WHERE id = ?'
  ).run(p.name, p.habit, p.topic, p.allowNotes ? 1 : 0, favVal, userId);
  const { profile, ...rest } = state; // profile 不进 JSON，users 表才是唯一真相
  db.prepare(
    'INSERT INTO states (user_id, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'
  ).run(userId, JSON.stringify(rest), now);
}
