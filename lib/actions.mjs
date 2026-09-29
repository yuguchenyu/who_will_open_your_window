import * as C from '../public/core.mjs';
import {ApiError} from './errors.mjs';
import {readState, writeState, defaultProfile} from './state.mjs';

const str = (value, name) => {
  if (typeof value !== 'string') throw new ApiError(`${name} 必须是文本。`);
  return value;
};
const int = (value, name) => {
  if (!Number.isInteger(value)) throw new ApiError(`${name} 必须是整数。`);
  return value;
};

// 白名单。前端只能发这里列出的动作 —— 服务端不接受"整份状态"上传，
// 所以纸条额度、周期、屏蔽这些规则由 core.mjs 在服务端执行，客户端改不动。
export const ACTIONS = {
  sendNote:       (s, b) => C.sendNote(s, str(b.personId, 'personId'), str(b.text, 'text')),
  sendMessage:    (s, b) => C.sendMessage(s, str(b.personId, 'personId'), str(b.text, 'text')),
  startNoteReply: (s, b) => C.startNoteReply(s, str(b.noteId, 'noteId')),
  incomingAction: (s, b) => C.incomingAction(s, str(b.noteId, 'noteId'), str(b.op, 'op'), b.text),
  blockPerson:    (s, b) => C.blockPerson(s, str(b.personId, 'personId')),
  injectNote:     (s, b) => C.injectNote(s, str(b.personId, 'personId')),
  review:         (s, b) => C.review(s, str(b.personId, 'personId'), str(b.intent, 'intent'), !!b.authorized),
  confirmHeart:   (s, b) => C.confirmHeart(s, str(b.personId, 'personId')),
  recordFeeling:  (s, b) => {
    const score = int(b.score, 'score');
    // 自己挡一道，不依赖 core.mjs 内部怎么判 —— 这样负数也是明确的 400 而不是别的什么。
    if (score < 0 || score > 100) throw new ApiError('好感度需为 0–100 的整数。');
    return C.recordFeeling(s, str(b.personId, 'personId'), score, typeof b.memo === 'string' ? b.memo : '');
  },
  saveScenario:   (s, b) => {
    s.scenarios[str(b.personId, 'personId')] = {
      intent: str(b.intent, 'intent'),
      authorized: !!b.authorized,
      cycle: C.cycleOf(s),          // 周期由服务端取，不信客户端传的值
    };
  },
  saveProfile:    (s, b) => {
    const p = b.profile || {};
    s.profile = {
      name: C.cleanText(p.name, 20),
      habit: C.cleanText(p.habit, 100),
      topic: C.cleanText(p.topic, 100),
      allowNotes: !!p.allowNotes,
    };
  },
  advance:        (s, b) => {
    const days = int(b.days, 'days');
    if (days < 0) throw new ApiError('天数不能为负。');
    const next = s.offsetDays + days;
    if (next > 3650) throw new ApiError('演示时间已达上限，请重置。');
    s.offsetDays = next;
  },
  reset:          (s, b, user) => {
    const fresh = C.freshState();
    fresh.profile = defaultProfile(user.username);
    // 不 return —— 这里返回什么，响应里就会多带一份什么，而整份状态已经在 state 字段里了。
    Object.assign(s, fresh);
  },
  // 由服务端在 AI 回复返回后调用。前端直接发它会得到"不支持的操作"——
  // 否则任何人都能伪造一条 AI 回复塞进自己的对话里。
  finishReply:    (s, b) => C.finishReply(s, str(b.personId, 'personId'), str(b.text, 'text')),
};

// 只允许服务端内部调用的动作。
const SERVER_ONLY = new Set(['finishReply']);

export function runAction(db, user, type, body, now = Date.now(), {internal = false} = {}) {
  // 用 hasOwn 挡住 constructor / __proto__ 这类原型链上的名字。
  if (typeof type !== 'string' || !Object.hasOwn(ACTIONS, type) || (SERVER_ONLY.has(type) && !internal))
    throw new ApiError('不支持的操作。', 400, 'UNKNOWN_ACTION');
  const state = readState(db, user.id);
  let result;
  try {
    result = ACTIONS[type](state, body && typeof body === 'object' ? body : {}, user);
  } catch (error) {
    // core.mjs 的校验失败抛的是普通 Error，带中文文案。转成 400，否则会变成 500。
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || '操作没有成功。', 400, 'INVALID_INPUT');
  }
  writeState(db, user.id, state, now);
  return {state, result};
}
