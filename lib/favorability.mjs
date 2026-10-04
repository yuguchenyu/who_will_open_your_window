import {ApiError} from './errors.mjs';

/**
 * 因子 1: 对方回你信息的时间
 * 回得越快，好感度越高
 */
export function calculateReplySpeed(messages, targetSenderId) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { score: 60, avgMinutes: null, medianMinutes: null, replyCount: 0, desc: '暂无消息往来' };
  }

  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at);
  const intervals = [];
  let lastPromptTime = null;

  for (const msg of sorted) {
    if (msg.sender_id !== targetSenderId) {
      // 我方发送的消息，记录作为对方回复的基准时间
      lastPromptTime = msg.created_at;
    } else if (lastPromptTime !== null) {
      // 对方回复了我方的上一条消息
      const deltaMs = msg.created_at - lastPromptTime;
      const deltaMinutes = Math.max(0.1, deltaMs / 60000);
      intervals.push(deltaMinutes);
      lastPromptTime = null; // 本轮回复结算完毕，重置
    }
  }

  if (intervals.length === 0) {
    return {
      score: 60,
      avgMinutes: null,
      medianMinutes: null,
      replyCount: 0,
      desc: '对方尚未开始回应'
    };
  }

  // 计算单个回复时长的得分 (0 - 100)
  function scoreForDelta(mins) {
    if (mins <= 1) return 100;
    if (mins <= 5) return 90 + 10 * ((5 - mins) / 4);
    if (mins <= 15) return 80 + 10 * ((15 - mins) / 10);
    if (mins <= 60) return 65 + 15 * ((60 - mins) / 45);
    if (mins <= 240) return 50 + 15 * ((240 - mins) / 180);
    if (mins <= 720) return 35 + 15 * ((720 - mins) / 480);
    if (mins <= 1440) return 20 + 15 * ((1440 - mins) / 720);
    return Math.max(10, 20 - ((mins - 1440) / 1440) * 5);
  }

  const scores = intervals.map(scoreForDelta);
  const sumScores = scores.reduce((sum, s) => sum + s, 0);
  const avgScore = Math.round(sumScores / scores.length);

  const sumMinutes = intervals.reduce((sum, m) => sum + m, 0);
  const avgMinutes = Math.round((sumMinutes / intervals.length) * 10) / 10;

  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const mid = Math.floor(sortedIntervals.length / 2);
  const medianMinutes = sortedIntervals.length % 2 === 0
    ? Math.round(((sortedIntervals[mid - 1] + sortedIntervals[mid]) / 2) * 10) / 10
    : Math.round(sortedIntervals[mid] * 10) / 10;

  let desc = '平均回复适中';
  if (avgMinutes <= 2) desc = '极速秒回，关注度极高';
  else if (avgMinutes <= 10) desc = '回复非常迅速，积极主动';
  else if (avgMinutes <= 60) desc = '回复较为及时，互动稳定';
  else if (avgMinutes <= 360) desc = '回复有一定间隔，从容交流';
  else desc = '回复间隔较长，节奏较慢';

  return {
    score: avgScore,
    avgMinutes,
    medianMinutes,
    replyCount: intervals.length,
    desc
  };
}

/**
 * 因子 2: 连续聊天的时间
 * 包含两个维度:
 * 1) 连续聊天的天数 (类似于 QQ 续火花)
 * 2) 每次聊天的持续时间
 */
export function calculateContinuity(messages, now = Date.now()) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      score: 50,
      streakDays: 0,
      streakScore: 40,
      sessionCount: 0,
      maxSessionMinutes: 0,
      avgSessionMinutes: 0,
      durationScore: 50,
      desc: '暂无连续交流'
    };
  }

  const sorted = [...messages].sort((a, b) => a.created_at - b.created_at);

  // 1) 连续聊天天数计算 (以北京时间/本地日期自然日计算)
  const toDayString = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  const daySet = new Set(sorted.map(m => toDayString(m.created_at)));
  const uniqueDays = Array.from(daySet).sort().reverse(); // 降序

  const todayStr = toDayString(now);
  const yesterdayStr = toDayString(now - 86400000);

  let streakDays = 0;
  if (uniqueDays.length > 0) {
    let checkDate;
    if (uniqueDays[0] === todayStr) {
      checkDate = new Date(now);
    } else if (uniqueDays[0] === yesterdayStr) {
      checkDate = new Date(now - 86400000);
    } else {
      // 最近一次聊天在前天或更早，连续天数暂时归0
      streakDays = 0;
    }

    if (checkDate) {
      while (true) {
        const dStr = toDayString(checkDate.getTime());
        if (daySet.has(dStr)) {
          streakDays++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }
  }

  // 连续天数得分
  let streakScore = 50;
  if (streakDays === 0) streakScore = 40;
  else if (streakDays === 1) streakScore = 60;
  else if (streakDays === 2) streakScore = 70;
  else if (streakDays === 3) streakScore = 80;
  else if (streakDays <= 5) streakScore = 88;
  else if (streakDays <= 7) streakScore = 93;
  else streakScore = Math.min(100, 93 + (streakDays - 7));

  // 2) 每次聊天的持续时间计算 (连续消息间隔不超过 25 分钟算作同一次会话)
  const GAP_MS = 25 * 60 * 1000;
  const sessions = [];
  let currentSession = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (curr.created_at - prev.created_at <= GAP_MS) {
      currentSession.push(curr);
    } else {
      sessions.push(currentSession);
      currentSession = [curr];
    }
  }
  if (currentSession.length > 0) sessions.push(currentSession);

  const durations = sessions.map(sess => {
    const durMs = sess.at(-1).created_at - sess[0].created_at;
    return Math.max(0, durMs / 60000);
  });

  const maxSessionMinutes = Math.round(Math.max(...durations) * 10) / 10;
  const nonZeroDurations = durations.filter(d => d > 0);
  const avgSessionMinutes = nonZeroDurations.length > 0
    ? Math.round((nonZeroDurations.reduce((a, b) => a + b, 0) / nonZeroDurations.length) * 10) / 10
    : 0;

  // 持续时长得分
  let durationScore = 50;
  if (maxSessionMinutes >= 60) durationScore = 95;
  else if (maxSessionMinutes >= 30) durationScore = 85;
  else if (maxSessionMinutes >= 15) durationScore = 75;
  else if (maxSessionMinutes >= 5) durationScore = 65;
  else if (sessions.length >= 3) durationScore = 58;

  // 综合两项
  const score = Math.round(streakScore * 0.5 + durationScore * 0.5);

  let desc = '日常短时交流';
  if (streakDays >= 3 && maxSessionMinutes >= 20) desc = '连续热聊中，火花闪烁 🔥';
  else if (streakDays >= 3) desc = `连续畅聊 ${streakDays} 天，习惯有彼此`;
  else if (maxSessionMinutes >= 30) desc = '单次深聊持久，话题投机';
  else if (streakDays > 0) desc = '刚刚开启连续交流';

  return {
    score,
    streakDays,
    streakScore,
    sessionCount: sessions.length,
    maxSessionMinutes,
    avgSessionMinutes,
    durationScore,
    desc
  };
}

/**
 * 因子 3: 聊天字数差异
 * 在所有的聊天记录中一方的聊天字数明显高于另一方，
 * 说明字多的对字少的更有好感，而字少的可能对字多的没有那么多好感
 */
export function calculateWordRatio(messages, targetSenderId) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      score: 60,
      targetWords: 0,
      myWords: 0,
      totalWords: 0,
      ratio: 50,
      desc: '尚无交流记录'
    };
  }

  let targetWords = 0;
  let myWords = 0;

  for (const m of messages) {
    const len = Array.from(String(m.body || '').trim()).length;
    if (m.sender_id === targetSenderId) {
      targetWords += len;
    } else {
      myWords += len;
    }
  }

  const totalWords = targetWords + myWords;
  if (totalWords === 0) {
    return { score: 60, targetWords: 0, myWords: 0, totalWords: 0, ratio: 50, desc: '尚无实质文字交流' };
  }

  const ratio = Math.round((targetWords / totalWords) * 100);

  // 针对对方对你的好感度：对方占比越高，说明对方更有好感；反之对方输出极少，说明好感较低
  let score;
  if (ratio >= 50) {
    // 50% 对应基准 70分，100% 对应 100分
    score = Math.min(100, Math.round(70 + 60 * ((ratio - 50) / 50)));
  } else {
    // 0% 对应 20分，50% 对应 70分
    score = Math.max(15, Math.round(20 + 100 * (ratio / 100)));
  }

  let desc = '双方表达字数均衡';
  if (ratio >= 70) desc = '对方表达欲极为旺盛，字数明显占优，好感度充沛';
  else if (ratio >= 55) desc = '对方字数略多，态度热情且倾注心思';
  else if (ratio >= 45) desc = '双向字数平衡，来往互动自如';
  else if (ratio >= 30) desc = '对方字数略少，表达较为克制';
  else desc = '对方字数明显偏少，回应较为简短';

  return {
    score,
    targetWords,
    myWords,
    totalWords,
    ratio,
    desc
  };
}

/**
 * 因子 4: 大模型分析聊天的具体内容来分析好感度
 */
export function makeFavorabilityMessages(conversationHistory, myName, targetName, targetId = null) {
  const safety = '你是交友应用“拾言”的好感度与情感态度分析助手。根据真实聊天记录客观分析双方互动。不编造不存在的事实，尊重用户边界。';
  const format = `分析【${targetName}】对【${myName}】的好感程度，输出严格合法的 JSON 对象，不要附加 Markdown 标记。格式如下：
{
  "score": 85,
  "attitude": "热情亲近",
  "summary": "对方在对话中积极接话，多次主动分享生活趣事并关心你的日常，流露出明确的好感。",
  "highlights": ["主动分享生活细节", "语气温暖真诚且频繁使用积极情绪表达"]
}
说明：
- score 必须是 0 到 100 之间的整数；
- attitude 不超过 12 个字；
- summary 不超过 150 个字；
- highlights 为 1 到 3 条简短亮点观察，每条不超过 30 个字。`;

  const recentMessages = conversationHistory.slice(-20).map(m => {
    const isTarget = targetId
      ? (m.sender_id === targetId || m.sender_id === targetName)
      : (m.sender_id === targetName);
    return {
      speaker: isTarget ? targetName : myName,
      text: m.body
    };
  });

  return [
    { role: 'system', content: `${safety}\n${format}` },
    {
      role: 'user',
      content: JSON.stringify({
        targetName,
        myName,
        dialogue: recentMessages
      })
    }
  ];
}

export function parseFavorabilityLlm(raw) {
  let cleaned = String(raw || '').trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonMatch) cleaned = jsonMatch[1].trim();

  let obj;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        obj = JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
  }

  if (!obj || typeof obj !== 'object') {
    throw new ApiError('AI 好感度分析返回格式不正确。', 502, 'FORMAT');
  }

  const score = Number(obj?.score);
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new ApiError('AI 未提供有效的好感度评分。', 502, 'FORMAT');
  }

  const attitude = String(obj?.attitude || '温和自然').trim().slice(0, 20);
  const summary = String(obj?.summary || '对话气氛融洽。').trim().slice(0, 200);
  const highlights = Array.isArray(obj?.highlights)
    ? obj.highlights.map(h => String(h || '').trim().slice(0, 50)).filter(Boolean).slice(0, 3)
    : [];

  return {
    score,
    attitude,
    summary,
    highlights: highlights.length > 0 ? highlights : ['自然日常交流']
  };
}

/**
 * 汇总四项因素生成总分与等级评价
 */
export function composeFavorabilityScore(reply, continuity, wordRatio, llm) {
  let totalScore;
  let hasLlm = false;

  if (llm && Number.isInteger(llm.score)) {
    hasLlm = true;
    totalScore = Math.round(
      reply.score * 0.25 +
      continuity.score * 0.25 +
      wordRatio.score * 0.25 +
      llm.score * 0.25
    );
  } else {
    totalScore = Math.round(
      reply.score * 0.35 +
      continuity.score * 0.35 +
      wordRatio.score * 0.30
    );
  }

  totalScore = Math.max(0, Math.min(100, totalScore));

  let tier = '初识微光';
  let badge = '🍃';
  let title = '初相识 · 慢热起步';
  let desc = '双方还在了解阶段，好感如春水初生，可以顺着话题慢慢畅聊。';

  if (totalScore >= 90) {
    tier = '怦然心动';
    badge = '💖💖💖';
    title = '极度热络 · 满格好感';
    desc = '对方对你表现出强烈的关注与分享欲，回信极速、字数充沛且气氛热烈！';
  } else if (totalScore >= 80) {
    tier = '相谈甚欢';
    badge = '💖💖';
    title = '明显好感 · 投缘靠近';
    desc = '你们有着很好的默契，对方互动积极，愿意主动倾听和表达。';
  } else if (totalScore >= 70) {
    tier = '渐入佳境';
    badge = '💖';
    title = '融洽畅聊 · 兴致盎然';
    desc = '对话节奏舒适顺畅，对方表现出持续的交流兴趣。';
  } else if (totalScore >= 60) {
    tier = '礼貌探索';
    badge = '🌱';
    title = '礼貌试探 · 温和破冰';
    desc = '双方保持着友好的礼貌距离，正在慢慢发现共同话题。';
  }

  return {
    score: totalScore,
    tier,
    badge,
    title,
    desc,
    hasLlm,
    factors: {
      reply,
      continuity,
      wordRatio,
      llm: llm || null
    }
  };
}

/**
 * 完整的单对单好感度计算与缓存检索
 */
export function getConversationFavorability(db, conversationId, currentUserId) {
  // 校验当前会话及双方用户
  const conv = db.prepare('SELECT * FROM real_conversations WHERE id = ?').get(conversationId);
  if (!conv) throw new ApiError('会话不存在。', 404, 'NOT_FOUND');
  if (conv.user_a !== currentUserId && conv.user_b !== currentUserId) {
    throw new ApiError('无权查看该会话。', 403, 'FORBIDDEN');
  }

  const otherUserId = conv.user_a === currentUserId ? conv.user_b : conv.user_a;
  const me = db.prepare('SELECT id, name, favorability_enabled FROM users WHERE id = ?').get(currentUserId);
  const other = db.prepare('SELECT id, name, favorability_enabled FROM users WHERE id = ?').get(otherUserId);

  if (!me || !other) throw new ApiError('用户不存在。', 404, 'NOT_FOUND');

  // 双向隐私开关校验：
  // 1. 如果我关闭了好感度系统，我不能看到他人对我的好感度
  if (me.favorability_enabled === 0) {
    return {
      canView: false,
      reason: 'SELF_DISABLED',
      message: '你已关闭好感度系统。开启后可查看与对方的好感度分析。',
      targetName: other.name
    };
  }

  // 2. 如果对方关闭了好感度系统，对方不想让别人看到TA对其他人的好感度，我也不能看到
  if (other.favorability_enabled === 0) {
    return {
      canView: false,
      reason: 'OTHER_DISABLED',
      message: '对方已关闭好感度系统，好感度信息已隐藏。',
      targetName: other.name
    };
  }

  // 双方均已开启，查询消息记录
  const messages = db.prepare(
    'SELECT id, sender_id, body, created_at FROM real_messages WHERE conversation_id = ? ORDER BY id ASC'
  ).all(conv.id);

  const lastMsgId = messages.length > 0 ? messages.at(-1).id : 0;

  // 检查缓存
  const cached = db.prepare(
    'SELECT score, factors, last_message_id, updated_at FROM conversation_favorability WHERE conversation_id = ? AND target_user_id = ?'
  ).get(conv.id, otherUserId);

  if (cached && cached.last_message_id === lastMsgId) {
    try {
      const parsedFactors = JSON.parse(cached.factors);
      return {
        canView: true,
        targetName: other.name,
        targetId: other.id,
        score: cached.score,
        tier: parsedFactors.tier,
        badge: parsedFactors.badge,
        title: parsedFactors.title,
        desc: parsedFactors.desc,
        hasLlm: parsedFactors.hasLlm,
        factors: parsedFactors.factors,
        updatedAt: cached.updated_at
      };
    } catch {}
  }

  // 没有有效缓存，执行规则计算（对方对我的好感度）
  const reply = calculateReplySpeed(messages, otherUserId);
  const continuity = calculateContinuity(messages);
  const wordRatio = calculateWordRatio(messages, otherUserId);

  // 如果之前缓存中有 LLM 结果，可复用 LLM 部分
  let previousLlm = null;
  if (cached) {
    try {
      const prev = JSON.parse(cached.factors);
      if (prev.factors?.llm?.score) previousLlm = prev.factors.llm;
    } catch {}
  }

  const result = composeFavorabilityScore(reply, continuity, wordRatio, previousLlm);

  // 写入/更新缓存
  const now = Date.now();
  db.prepare(`
    INSERT INTO conversation_favorability (conversation_id, target_user_id, score, factors, last_message_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id, target_user_id) DO UPDATE SET
      score = excluded.score,
      factors = excluded.factors,
      last_message_id = excluded.last_message_id,
      updated_at = excluded.updated_at
  `).run(conv.id, otherUserId, result.score, JSON.stringify(result), lastMsgId, now);

  return {
    canView: true,
    targetName: other.name,
    targetId: other.id,
    ...result,
    updatedAt: now
  };
}
