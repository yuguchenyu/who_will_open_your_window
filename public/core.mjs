/**
 * 浏览器与服务端共享的虚拟人物互动规则。
 * 函数操作传入的状态对象，不直接读写数据库或浏览器存储。
 */

// 人物展示资料与模型设定集中维护；对外卡片需由服务端过滤不应公开的字段。
export const PEOPLE = [
  {
    id: 'xia',
    name: '小夏',
    sprite: '/character/xia-watercolor.png',
    age: 25,
    city: '杭州',
    color: 'sage',
    letter: '夏',
    role: '书店编辑',
    interests: ['散步', '老电影', '书店'],
    habit: '我有点慢热，但很欢迎你分享生活里的小事。',
    topic: '周末突然空下来，你会散步，还是窝在家里？',
    bio: '收集傍晚的天空，也收集书页里让人停顿的句子。',
    persona:
      '温和的书店编辑，喜欢傍晚沿河散步和老电影。自然、简短，先了解对方，不主动过度暧昧。'
  },
  {
    id: 'yu',
    name: '阿屿',
    sprite: '/character/yu-watercolor.png',
    age: 27,
    city: '成都',
    color: 'clay',
    letter: '屿',
    role: '独立设计师',
    interests: ['摄影', '咖啡', '旅行'],
    habit: '不太擅长开场，不过会认真听你讲喜欢的事。',
    topic: '如果只能用一张照片介绍今天，你会拍什么？',
    bio: '镜头里留一点空白，生活里也一样。',
    persona:
      '有耐心的设计师，喜欢街头摄影和咖啡。表达克制，有轻微幽默，不编造对用户的了解。'
  },
  {
    id: 'ning',
    name: '小宁',
    sprite: '/character/ning-watercolor.png',
    age: 24,
    city: '南京',
    color: 'blue',
    letter: '宁',
    role: '插画师',
    interests: ['音乐', '植物', '手作'],
    habit: '打字有点慢，偶尔想好了才回复。',
    topic: '最近有没有一首歌，让你一直循环播放？',
    bio: '养一盆慢慢长大的植物，听一首舍不得切掉的歌。',
    persona:
      '慢热的插画师，喜欢音乐、植物和手作。好奇而尊重边界，不将普通问候当作恋爱承诺。'
  }
];
// These three characters join the daily draw pool; the original cast stays directly accessible.
export const LEGACY_IDS = ['xia', 'yu', 'ning'];
export const DRAW_PEOPLE = [
  {
    id: 'lin',
    name: '林澈',
    sprite: '/character/lin-watercolor.png',
    age: 17,
    city: '杭州',
    color: 'sage',
    letter: '澈',
    role: '高中户外社团成员',
    interests: ['徒步', '自然', '运动'],
    habit: '走慢一点也没关系，我喜欢和朋友一起发现路边的小风景。',
    topic: '如果周末天气很好，你最想去哪儿走走？',
    bio: '把走过的小路画进地图，给下次出发留一点期待。',
    persona:
      '17 岁的女高中生林澈，开朗真诚，喜欢户外社团、运动与自然。围绕日常、学习、兴趣和友谊交流，符合年龄，不进行成人或性相关交流，不宣称现实关系。',
    selfTags: [
      '外向',
      '真诚',
      '喜欢运动',
      '喜欢旅行',
      '喜欢自然',
      '有耐心',
      '重视沟通'
    ],
    desiredTags: ['真诚', '重视沟通', '喜欢自然']
  },
  {
    id: 'chen',
    name: '陈序',
    sprite: '/character/chen-watercolor.png',
    age: 20,
    city: '南京',
    color: 'blue',
    letter: '序',
    role: '音乐专业学生',
    interests: ['音乐', '艺术', '散步'],
    habit: '我会认真听，也愿意把今天喜欢的一段旋律分享给你。',
    topic: '有没有一首歌，能让你想起某个特别的时刻？',
    bio: '练习室的窗边，总有几小节还没写完的旋律。',
    persona:
      '20 岁的女音乐专业学生陈序，安静有耐心，重视边界，喜欢音乐与艺术。语气柔和自然，不编造对用户的了解，不把普通交流当作关系承诺。',
    selfTags: [
      '安静',
      '有耐心',
      '有边界感',
      '喜欢音乐',
      '喜欢艺术',
      '真诚',
      '重视沟通'
    ],
    desiredTags: ['真诚', '重视沟通', '喜欢音乐']
  },
  {
    id: 'tang',
    name: '唐梨',
    sprite: '/character/tang-watercolor.png',
    age: 24,
    city: '成都',
    color: 'clay',
    letter: '梨',
    role: '甜点师',
    interests: ['烘焙', '美食', '动物'],
    habit: '甜点可以慢慢做，聊天也是。今天有什么小事值得庆祝？',
    topic: '如果用一道甜点形容今天，你会选什么？',
    bio: '记得每一位常客喜欢的甜度，也喜欢分享新出炉的小惊喜。',
    persona:
      '24 岁的女甜点师唐梨，温柔而有幽默感，喜欢美食与动物。自然简短，愿意认真交流，不主动过度暧昧，不替用户决定感受。',
    selfTags: [
      '温柔',
      '幽默',
      '喜欢美食',
      '喜欢动物',
      '真诚',
      '重视沟通',
      '有耐心'
    ],
    desiredTags: ['真诚', '重视沟通', '喜欢美食']
  }
];
PEOPLE.push(...DRAW_PEOPLE);

// 意愿使用稳定编号保存，中文文案用于展示；积极意愿集合供周期揭晓规则判断。
export const INTENTS = {
  exploring: '还在了解中',
  closer: '想进一步了解',
  affection: '有明确好感',
  stop: '暂不想继续'
};
export const POSITIVE = ['closer', 'affection'];

/**
 * 建立包含全部演示人物的全新状态对象。
 * 时间基点与演示偏移分开保存，消息、纸条和每个人物的周期状态互不共享。
 */
export function freshState(now = Date.now()) {
  // 为每个人物分别创建消息列表和情景配置，避免不同人物共享可变状态。
  return {
    version: 1,
    started: now,
    offsetDays: 0,
    profile: {
      name: '小安',
      habit: '我有点慢热，不过很愿意认真认识你。',
      topic: '今天有什么小事让你开心了一下？',
      allowNotes: true,
      favorabilityEnabled: true
    },
    notes: [],
    messages: Object.fromEntries(PEOPLE.map((p) => [p.id, []])),
    pending: {},
    blocked: [],
    feelings: {},
    reviews: {},
    confirmations: [],
    scenarios: Object.fromEntries(
      PEOPLE.map((p) => [
        p.id,
        { intent: 'exploring', authorized: true, cycle: 0 }
      ])
    ),
    seq: 0
  };
}

/**
 * 检查持久化数据是否满足当前规则层需要的结构。
 * 除顶层字段外，也逐项校验人物编号、消息、记录分数和待处理任务关联。
 */
export function validState(s) {
  // 先检查顶层结构，再校验纸条、确认记录及各人物的嵌套数据。
  const ids = PEOPLE.map((p) => p.id),
    hasId = (id) => ids.includes(id),
    object = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if (
    !(
      s?.version === 1 &&
      Number.isFinite(s.started) &&
      Number.isInteger(s.offsetDays) &&
      s.offsetDays >= 0 &&
      s.offsetDays <= 3650 &&
      object(s.profile) &&
      typeof s.profile.name === 'string' &&
      typeof s.profile.habit === 'string' &&
      typeof s.profile.topic === 'string' &&
      typeof s.profile.allowNotes === 'boolean' &&
      (s.profile.favorabilityEnabled === undefined ||
        typeof s.profile.favorabilityEnabled === 'boolean') &&
      Array.isArray(s.notes) &&
      Array.isArray(s.blocked) &&
      Array.isArray(s.confirmations) &&
      object(s.messages) &&
      object(s.pending) &&
      object(s.feelings) &&
      object(s.reviews) &&
      object(s.scenarios) &&
      Number.isInteger(s.seq)
    )
  )
    return false;
  if (
    !s.blocked.every(hasId) ||
    !s.notes.every(
      (n) =>
        object(n) &&
        typeof n.id === 'string' &&
        hasId(n.personId) &&
        ['in', 'out'].includes(n.direction) &&
        typeof n.text === 'string' &&
        typeof n.topic === 'string' &&
        ['pending', 'saved', 'accepted', 'declined'].includes(n.status) &&
        Number.isFinite(n.at)
    )
  )
    return false;
  if (
    !s.confirmations.every(
      (c) =>
        object(c) &&
        typeof c.id === 'string' &&
        hasId(c.personId) &&
        Number.isInteger(c.cycle) &&
        typeof c.mutual === 'boolean' &&
        Number.isFinite(c.at)
    )
  )
    return false;
  return PEOPLE.every((p) => {
    const id = p.id,
      r = s.reviews[id],
      other = s.scenarios[id],
      pending = s.pending[id];
    return (
      Array.isArray(s.messages[id]) &&
      s.messages[id].every(
        (m) =>
          object(m) &&
          ['user', 'assistant'].includes(m.role) &&
          typeof m.content === 'string' &&
          Number.isFinite(m.at)
      ) &&
      (!s.feelings[id] ||
        (Array.isArray(s.feelings[id]) &&
          s.feelings[id].every(
            (f) =>
              object(f) &&
              Number.isInteger(f.score) &&
              f.score >= 0 &&
              f.score <= 100 &&
              typeof f.memo === 'string' &&
              Number.isFinite(f.at)
          ))) &&
      (!r ||
        (object(r) &&
          Object.hasOwn(INTENTS, r.intent) &&
          typeof r.authorized === 'boolean' &&
          Number.isInteger(r.cycle))) &&
      object(other) &&
      Object.hasOwn(INTENTS, other.intent) &&
      typeof other.authorized === 'boolean' &&
      Number.isInteger(other.cycle) &&
      (!pending ||
        (object(pending) &&
          ['chat', 'note'].includes(pending.kind) &&
          (pending.kind !== 'note' ||
            s.notes.some(
              (n) =>
                n.id === pending.noteId &&
                n.personId === id &&
                n.status === 'pending'
            ))))
    );
  });
}

// 演示时间等于实际时间加偏移天数，业务函数可注入真实时间以验证日期边界。
export const clockNow = (s, real = Date.now()) =>
  real + s.offsetDays * 86400000;

// 从状态开始时间起每七天形成一个周期，负差值统一钳制为第零周期。
export const cycleOf = (s, real = Date.now()) =>
  Math.max(0, Math.floor((clockNow(s, real) - s.started) / (7 * 86400000)));

/**
 * 将演示时间转换为运行环境本地日期标识。
 * 用于虚拟人物纸条的每日额度判断，与状态中保存的日期直接比较。
 */
export function dayOf(s, real = Date.now()) {
  const d = new Date(clockNow(s, real));
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 按编号查找内置演示人物。
 * 未知编号立即报错，让依赖人物资料的后续规则不在空对象上执行。
 */
export function person(id) {
  const p = PEOPLE.find((p) => p.id === id);
  if (!p) throw new Error('找不到这个演示人物。');
  return p;
}
const fail = (message) => {
  throw new Error(message);
};

// 本地互动记录通过状态内序号生成编号，序号随状态一起持久化。
const nextId = (s) => `local-${++s.seq}`;

/**
 * 校验非空文本并按 Unicode 码点限制字符数量。
 * 返回去除首尾空白的结果，供纸条、消息和 AI 回复统一使用。
 */
export function cleanText(value, max = 500) {
  if (typeof value !== 'string' || !value.trim()) fail('请先写一点内容。');
  const text = value.trim();
  if (Array.from(text).length > max) fail(`请控制在 ${max} 字以内。`);
  return text;
}

/**
 * 查询人物是否已加入当前状态的屏蔽列表。
 * 屏蔽结果由其他规则决定是否阻止投递、回复或揭晓。
 */
export function isBlocked(s, id) {
  return s.blocked.includes(id);
}

/**
 * 检查某人物的消息历史是否包含双方发言。
 * 必须同时存在 user 与 assistant 消息，单方记录不视为已建立双向交流。
 */
export function hasContact(s, id) {
  return (
    s.messages[id].some((m) => m.role === 'user') &&
    s.messages[id].some((m) => m.role === 'assistant')
  );
}

/**
 * 返回不能投递纸条的第一条原因，空字符串表示可投递。
 * 检查次序与界面提示一致，包含历史纸条、屏蔽、双向联系和每日额度。
 */
export function noteEligibility(s, id, real = Date.now()) {
  // 投递前统一检查屏蔽、历史纸条、双向联系及当日额度。
  person(id);
  if (isBlocked(s, id)) return '你已屏蔽这个人物。';
  if (
    s.notes.some(
      (n) =>
        n.personId === id && ['pending', 'saved', 'declined'].includes(n.status)
    )
  )
    return '已有待处理或已归档的纸条，不能重复投递。';
  if (hasContact(s, id)) return '你们已经开始聊天，去对话里继续吧。';
  if (
    s.notes.filter((n) => n.direction === 'out' && n.day === dayOf(s, real))
      .length >= 2
  )
    return '今天的两次新纸条机会已用完。';
  return '';
}

/**
 * 校验投递资格后，在状态中追加待回应的发出纸条。
 * 同时记录演示日期与时间，供额度统计及首次回复转入聊天使用。
 */
export function sendNote(s, id, text, real = Date.now()) {
  const reason = noteEligibility(s, id, real);
  if (reason) fail(reason);
  const n = {
    id: nextId(s),
    personId: id,
    direction: 'out',
    text: cleanText(text, 100),
    topic: person(id).topic,
    status: 'pending',
    day: dayOf(s, real),
    at: clockNow(s, real)
  };
  s.notes.push(n);
  return n;
}

/**
 * 为演示加入一张明确标记为预设的收到纸条。
 * 尊重陌生人纸条开关、屏蔽列表及已有互动，避免重复注入同一人物。
 */
export function injectNote(s, id, real = Date.now()) {
  person(id);
  if (!s.profile.allowNotes) fail('你已关闭陌生人纸条。');
  if (isBlocked(s, id)) fail('已屏蔽的人物不能递来纸条。');
  if (s.notes.some((n) => n.personId === id) || hasContact(s, id))
    fail('这个人物已有互动，请选择其他人，或重置演示。');
  const n = {
    id: nextId(s),
    personId: id,
    direction: 'in',
    text: '看到你留下的话题，就想来打个招呼。很高兴在这里遇见你，你今天过得怎么样？',
    topic: s.profile.topic,
    status: 'pending',
    at: clockNow(s, real),
    demo: true
  };
  s.notes.push(n);
  return n;
}

/**
 * 处理收到纸条的暂存、归档或回复。
 * 回复时把双方文字接入聊天，并建立等待 AI 回应的任务。
 */
export function incomingAction(s, noteId, action, text, real = Date.now()) {
  const n = s.notes.find((n) => n.id === noteId);
  if (
    !n ||
    n.direction !== 'in' ||
    !['pending', 'saved'].includes(n.status) ||
    isBlocked(s, n.personId)
  )
    fail('这张纸条当前不能操作。');
  if (action === 'save') {
    n.status = 'saved';
    return n;
  }
  if (action === 'decline') {
    n.status = 'declined';
    return n;
  }
  if (action !== 'reply') fail('未知操作。');
  const content = cleanText(text, 100);
  n.status = 'accepted';
  s.messages[n.personId].push(
    { id: nextId(s), role: 'assistant', content: n.text, at: n.at },
    { id: nextId(s), role: 'user', content, at: clockNow(s, real) }
  );
  s.pending[n.personId] = { kind: 'chat' };
  return n;
}

/**
 * 为发出且仍待回应的纸条登记回复任务。
 * 任务保存原纸条编号，真正收到 AI 回复后再将纸条转为已接受。
 */
export function startNoteReply(s, noteId) {
  const n = s.notes.find((n) => n.id === noteId);
  if (
    !n ||
    n.direction !== 'out' ||
    n.status !== 'pending' ||
    isBlocked(s, n.personId)
  )
    fail('这张纸条当前不能回应。');
  s.pending[n.personId] = { kind: 'note', noteId };
  return n;
}

/**
 * 向已建立双向联系的人物发送消息并登记待回复任务。
 * 屏蔽或已有回复未完成时拒绝发送，保留重试所需的上一轮状态。
 */
export function sendMessage(s, id, text, real = Date.now()) {
  person(id);
  if (isBlocked(s, id)) fail('你已屏蔽这个人物。');
  if (!hasContact(s, id)) fail('请先通过纸条开始交流。');
  if (s.pending[id]) fail('还有一条回复待完成，请先重试。');
  const msg = {
    id: nextId(s),
    role: 'user',
    content: cleanText(text),
    at: clockNow(s, real)
  };
  s.messages[id].push(msg);
  s.pending[id] = { kind: 'chat' };
  return msg;
}

/**
 * 把仍有效的待处理任务完成为一条对方消息。
 * 纸条首轮先补入原始用户文字，写入回复后清除任务，迟到结果可被忽略。
 */
export function finishReply(s, id, content, real = Date.now()) {
  // 只接收仍在等待的回复；屏蔽人物或已清除任务的迟到结果直接忽略。
  const task = s.pending[id];
  if (!task || isBlocked(s, id)) return false;
  const text = cleanText(content, 3000);
  if (task.kind === 'note') {
    const n = s.notes.find((n) => n.id === task.noteId);
    if (!n || n.status !== 'pending') return false;
    n.status = 'accepted';
    s.messages[id].push({
      id: nextId(s),
      role: 'user',
      content: n.text,
      at: n.at
    });
  }
  s.messages[id].push({
    id: nextId(s),
    role: 'assistant',
    content: text,
    at: clockNow(s, real)
  });
  delete s.pending[id];
  return true;
}

/**
 * 保存用户自己填写的分数与备注，并记录演示时间。
 * 这只是私人记录，不会自动改变双方意愿或揭晓授权。
 */
export function recordFeeling(s, id, score, memo = '', real = Date.now()) {
  person(id);
  if (!Number.isInteger(score) || score < 0 || score > 100)
    fail('分数应为 0–100 的整数。');
  if (typeof memo !== 'string' || Array.from(memo).length > 200)
    fail('备注最多 200 字。');
  (s.feelings[id] ??= []).push({
    score,
    memo: memo.trim(),
    at: clockNow(s, real)
  });
}

/**
 * 记录当前周期用户选择的意愿和授权。
 * 周期由状态时钟计算，旧周期记录不会自然成为下一周期的有效授权。
 */
export function review(s, id, intent, authorized, real = Date.now()) {
  person(id);
  if (!Object.hasOwn(INTENTS, intent)) fail('请选择有效的意愿。');
  s.reviews[id] = {
    intent,
    authorized: !!authorized,
    cycle: cycleOf(s, real),
    at: clockNow(s, real)
  };
}

/**
 * 检查本周期能否进行一次双向意愿揭晓。
 * 自己需授权且表达积极意愿，对方需有当期授权，并且本周期机会尚未使用。
 */
export function confirmationReason(s, id, real = Date.now()) {
  // 揭晓要求当期有效授权、自己的积极意愿，以及尚未使用的周期机会。
  person(id);
  const cycle = cycleOf(s, real),
    own = s.reviews[id],
    other = s.scenarios[id];
  if (isBlocked(s, id)) return '你已屏蔽这个人物。';
  if (!hasContact(s, id)) return '需要先有双向交流。';
  if (!other?.authorized || other.cycle !== cycle)
    return '对方未开启功能或缺少当期有效状态。';
  if (!own?.authorized || own.cycle !== cycle || !POSITIVE.includes(own.intent))
    return '请先在回望中确认积极意愿，并授权当期揭晓。';
  if (s.confirmations.some((c) => c.cycle === cycle))
    return '本周期的一次机会已使用。';
  return '';
}

/**
 * 通过资格检查后记录本次揭晓是否互有积极意愿。
 * 机会按整个周期消耗，确认记录保存人物、周期和当时演示时间。
 */
export function confirmHeart(s, id, real = Date.now()) {
  const reason = confirmationReason(s, id, real);
  if (reason) fail(reason);
  const item = {
    id: nextId(s),
    personId: id,
    cycle: cycleOf(s, real),
    mutual: POSITIVE.includes(s.scenarios[id].intent),
    at: clockNow(s, real)
  };
  s.confirmations.push(item);
  return item;
}

/**
 * 屏蔽人物并清除尚在等待的回复任务。
 * 已有回望授权同时撤回，消息历史继续保留以供查看。
 */
export function blockPerson(s, id) {
  person(id);
  if (!s.blocked.includes(id)) s.blocked.push(id);
  delete s.pending[id];
  if (s.reviews[id]) s.reviews[id].authorized = false;
}
