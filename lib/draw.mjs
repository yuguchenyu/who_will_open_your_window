/**
 * 真人与虚拟人物的相遇抽取、收藏和冷却管理。
 * 候选先满足双向标签条件，再按匹配分数加权抽取；结果由事务持久化。
 */

import { randomUUID, randomInt } from 'node:crypto';
import { ApiError } from './errors.mjs';
import { matchingProfile, matchScore } from './matching.mjs';
import { readState } from './state.mjs';
import { DRAW_PEOPLE, PEOPLE, LEGACY_IDS } from '../public/core.mjs';

// 收藏容量由服务端统一限制，页面展示的空位数量不作为写入依据。
export const CAPACITY = 5;
// 跳过或移除的人选进入 30 天冷却期，避免短时间内再次出现。
const COOLDOWN = 30 * 86400000;
// 抽取记录的日期统一按 UTC+8 计算，不依赖服务器所在时区。
export const drawDay = (now) =>
  new Date(now + 8 * 3600000).toISOString().slice(0, 10);

// 保留日期边界辅助函数；当前不限次数模式的状态响应不使用每日重置倒计时。
export const nextReset = (now) =>
  Date.parse(drawDay(now) + 'T00:00:00+08:00') + 86400000;

// 匹配分数只决定卡片展示档位，是否进入候选池仍受其他筛选条件约束。
export const rarity = (score) =>
  score >= 95 ? 'gold' : score >= 85 ? 'purple' : 'blue';
// Called within the startup/registration transaction once per account. Never refill removed slots.

/**
 * 为尚未完成初始收藏导入的账号填充原有演示人物。
 * 已有收藏占用容量，完成后写入标记，后续移除不会自动补回。
 */
export function seedLegacyCollection(db, userId, now = Date.now()) {
  if (db.prepare('SELECT 1 FROM draw_onboarding WHERE user_id=?').get(userId))
    return;
  let count = db
    .prepare('SELECT COUNT(*) AS n FROM draw_collection WHERE user_id=?')
    .get(userId).n;
  for (const id of LEGACY_IDS) {
    if (count >= CAPACITY) break;
    if (isCollected(db, userId, 'virtual', id)) continue;
    const p = PEOPLE.find((p) => p.id === id),
      { persona, ...card } = p;
    const snapshot = {
      ...card,
      kind: 'virtual',
      source: 'legacy',
      score: null,
      tier: 'legacy',
      selfIntro: p.habit,
      sharedTags: p.interests
    };
    db.prepare(
      'INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)'
    ).run(
      userId,
      'virtual',
      id,
      JSON.stringify(snapshot),
      now + LEGACY_IDS.indexOf(id)
    );
    count++;
  }
  db.prepare('INSERT INTO draw_onboarding(user_id) VALUES(?)').run(userId);
}

/**
 * 按账号、人物类型和人物编号查询收藏关系。
 * 真人与虚拟人物的编号分别属于各自类型，不能只按编号判断。
 */
export function isCollected(db, userId, kind, personId) {
  return !!db
    .prepare(
      'SELECT 1 FROM draw_collection WHERE user_id=? AND kind=? AND person_id=?'
    )
    .get(userId, kind, personId);
}

/**
 * 判断收藏或尚未决定的真人抽取结果是否允许访问形象。
 * 此函数只检查抽取关系，其余会话与纸条权限由真人模块补充。
 */
export function canViewDrawAvatar(db, userId, personId) {
  return (
    isCollected(db, userId, 'real', personId) ||
    !!db
      .prepare(
        "SELECT 1 FROM draw_records WHERE user_id=? AND kind='real' AND person_id=? AND status='pending'"
      )
      .get(userId, personId)
  );
}

/**
 * 从保存的卡片快照恢复展示数据。
 * 虚拟人物沿用快照，真人额外刷新当前姓名、头像版本和账号存在状态。
 */
function hydrate(db, snapshot) {
  const p = JSON.parse(snapshot);
  // 卡片保留抽取时的快照；真人姓名、头像版本和账号可用性读取最新值。
  if (p.kind === 'real') {
    const user = db.prepare('SELECT name FROM users WHERE id=?').get(p.id);
    p.name = user?.name || '已离开的用户';
    p.unavailable = !user;
    p.avatarVersion =
      db
        .prepare(
          "SELECT updated_at FROM user_media WHERE user_id=? AND kind='avatar'"
        )
        .get(p.id)?.updated_at || 0;
  }
  return p;
}

/**
 * 按收藏时间及稳定的类型、编号顺序返回收藏列表。
 * 每张卡片都经过展示数据补全，不把数据库行直接交给页面。
 */
export function collection(db, userId) {
  return db
    .prepare(
      'SELECT * FROM draw_collection WHERE user_id=? ORDER BY added_at,kind,person_id'
    )
    .all(userId)
    .map((row) => hydrate(db, row.snapshot));
}

/**
 * 合并符合条件的真人与未屏蔽虚拟人物，计算候选卡片。
 * 排除已收藏、冷却中和低于匹配阈值的人选，并移除私有标签及人物设定。
 */
export function candidates(db, userId, now = Date.now()) {
  // 只有标签提取完成的资料才能参与双向匹配评分。
  const own = matchingProfile(db, userId);
  if (own?.status !== 'ready') return [];
  const state = readState(db, userId);
  const real = db
    .prepare(
      `SELECT u.id,u.name,m.self_intro,m.self_tags,m.desired_tags FROM matching_profiles m JOIN users u ON u.id=m.user_id
 WHERE m.status='ready' AND u.id<>? AND u.allow_notes=1
 AND NOT EXISTS(SELECT 1 FROM real_conversations c WHERE (c.user_a=? AND c.user_b=u.id) OR (c.user_b=? AND c.user_a=u.id))
 AND NOT EXISTS(SELECT 1 FROM real_notes n WHERE n.status='pending' AND ((n.sender_id=? AND n.recipient_id=u.id) OR (n.recipient_id=? AND n.sender_id=u.id)))`
    )
    .all(userId, userId, userId, userId, userId)
    .map((p) => ({
      id: p.id,
      name: p.name,
      kind: 'real',
      selfIntro: p.self_intro,
      selfTags: JSON.parse(p.self_tags),
      desiredTags: JSON.parse(p.desired_tags)
    }));
  const virtual = DRAW_PEOPLE.filter((p) => !state.blocked.includes(p.id)).map(
    (p) => ({ ...p, kind: 'virtual', selfIntro: p.habit })
  );
  // 用类型和编号组合标识人选，分别排除已收藏与冷却中的对象。
  const held = new Set(collection(db, userId).map((p) => p.kind + ':' + p.id));
  const cooling = new Set(
    db
      .prepare(
        'SELECT kind,person_id FROM draw_cooldowns WHERE user_id=? AND until_at>?'
      )
      .all(userId, now)
      .map((p) => p.kind + ':' + p.person_id)
  );
  return [...real, ...virtual]
    .map((p) => {
      const score = matchScore(own, p);
      // Do not send the other person's desired tags or private descriptions to the browser.
      const { selfTags, desiredTags, persona, ...card } = p;
      return {
        ...card,
        score,
        tier: rarity(score),
        sharedTags: own.desiredTags.filter((t) => selfTags.includes(t))
      };
    })
    .filter(
      (p) =>
        p.score >= 60 &&
        !held.has(p.kind + ':' + p.id) &&
        !cooling.has(p.kind + ':' + p.id)
    );
}

/**
 * 汇总收藏、待决定结果和当前是否允许继续抽取。
 * 返回兼容字段时明确不限次数，页面据此显示禁用原因及收藏容量。
 */
export function drawState(db, userId, now = Date.now()) {
  // 按待决定结果、收藏容量、资料状态、人选池的顺序给出不可抽取原因。
  const pending = db
    .prepare("SELECT * FROM draw_records WHERE user_id=? AND status='pending'")
    .get(userId);
  const cards = collection(db, userId),
    ready = matchingProfile(db, userId)?.status === 'ready';
  const reason = pending
    ? '请先决定这次相遇。'
    : cards.length >= CAPACITY
      ? '收藏已满，请先移除一位再抽取。'
      : !ready
        ? '请先完成匹配资料和标签提取。'
        : !candidates(db, userId, now).length
          ? '暂时没有新的合适人选。'
          : '';
  return {
    remaining: null,
    unlimited: true,
    canDraw: !reason,
    reason,
    nextReset: null,
    capacity: CAPACITY,
    collection: cards,
    pending: pending
      ? { drawId: pending.id, person: hydrate(db, pending.snapshot) }
      : null
  };
}

/**
 * 为同步抽取操作包裹立即写事务。
 * 回调成功才提交，抛错时完整回滚，避免只写入部分收藏或结果。
 */
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const value = fn();
    db.exec('COMMIT');
    return value;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

/**
 * 在事务内复用待决定结果，或按匹配分数抽取新的人选。
 * 可注入抽签函数用于边界验证，默认使用加密随机整数选择票号。
 */
export function draw(
  db,
  userId,
  now = Date.now(),
  pick = (total) => randomInt(total)
) {
  transaction(db, () => {
    // 重复请求复用尚未决定的结果，决定后可以继续抽取。
    if (
      db
        .prepare(
          "SELECT 1 FROM draw_records WHERE user_id=? AND status='pending'"
        )
        .get(userId)
    )
      return;
    if (collection(db, userId).length >= CAPACITY)
      throw new ApiError(
        '收藏已满，请先移除一位再抽取。',
        409,
        'COLLECTION_FULL'
      );
    if (matchingProfile(db, userId)?.status !== 'ready')
      throw new ApiError(
        '请先完成匹配资料和标签提取。',
        409,
        'PROFILE_NOT_READY'
      );
    const pool = candidates(db, userId, now);
    if (!pool.length)
      throw new ApiError('暂时没有新的合适人选。', 409, 'EMPTY_POOL');
    // 匹配分数作为抽中权重；逐项扣减票号，落入的区间对应本次人选。
    const total = pool.reduce((n, p) => n + p.score, 0);
    let ticket = pick(total),
      chosen = pool.at(-1);
    for (const p of pool) {
      ticket -= p.score;
      if (ticket < 0) {
        chosen = p;
        break;
      }
    }
    db.prepare(
      'INSERT INTO draw_records(id,user_id,day,kind,person_id,snapshot,created_at) VALUES(?,?,?,?,?,?,?)'
    ).run(
      randomUUID(),
      userId,
      drawDay(now),
      chosen.kind,
      chosen.id,
      JSON.stringify(chosen),
      now
    );
  });
  return drawState(db, userId, now);
}

/**
 * 写入或更新某个人选对当前账号的冷却截止时间。
 * 截止时间以本次跳过或移除的时间为起点，候选查询仅排除尚未到期记录。
 */
function cooldown(db, userId, kind, personId, now) {
  db.prepare(
    'INSERT INTO draw_cooldowns(user_id,kind,person_id,until_at) VALUES(?,?,?,?) ON CONFLICT(user_id,kind,person_id) DO UPDATE SET until_at=excluded.until_at'
  ).run(userId, kind, personId, now + COOLDOWN);
}

/**
 * 把一次待决定结果处理为收藏或跳过。
 * 校验结果归属并在事务中更新状态，重复提交已处理结果不会重复写入。
 */
export function decide(db, userId, drawId, decision, now = Date.now()) {
  if (!['like', 'skip'].includes(decision))
    throw new ApiError('请选择喜欢或不喜欢。');
  transaction(db, () => {
    const row =
      typeof drawId === 'string'
        ? db
            .prepare('SELECT * FROM draw_records WHERE id=? AND user_id=?')
            .get(drawId, userId)
        : null;
    if (!row) throw new ApiError('抽取结果不存在。', 404, 'NOT_FOUND');
    // 已处理结果直接返回，使重复提交同一次决定不会重复添加收藏。
    if (row.status !== 'pending') return;
    if (decision === 'like') {
      if (collection(db, userId).length >= CAPACITY)
        throw new ApiError('收藏已满，请先移除一位。', 409, 'COLLECTION_FULL');
      if (hydrate(db, row.snapshot).unavailable)
        throw new ApiError(
          '这位用户已离开，请跳过本次结果。',
          409,
          'UNAVAILABLE'
        );
      db.prepare(
        'INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)'
      ).run(userId, row.kind, row.person_id, row.snapshot, now);
    } else cooldown(db, userId, row.kind, row.person_id, now);
    db.prepare('UPDATE draw_records SET status=? WHERE id=?').run(
      decision === 'like' ? 'liked' : 'skipped',
      row.id
    );
  });
  return drawState(db, userId, now);
}

/**
 * 移除指定收藏，实际删除成功后才建立冷却记录。
 * 不会在这里删除已经建立的聊天会话或消息历史。
 */
export function remove(db, userId, kind, personId, now = Date.now()) {
  if (!['real', 'virtual'].includes(kind) || typeof personId !== 'string')
    throw new ApiError('收藏对象不正确。');
  transaction(db, () => {
    const result = db
      .prepare(
        'DELETE FROM draw_collection WHERE user_id=? AND kind=? AND person_id=?'
      )
      .run(userId, kind, personId);
    if (result.changes) cooldown(db, userId, kind, personId, now);
  });
  return drawState(db, userId, now);
}
