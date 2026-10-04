import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {createServer} from '../server.mjs';
import {
  calculateReplySpeed,
  calculateContinuity,
  calculateWordRatio,
  makeFavorabilityMessages,
  parseFavorabilityLlm,
  composeFavorabilityScore,
  getConversationFavorability
} from '../lib/favorability.mjs';

test('factor 1: reply speed rewards fast replies and handles long gaps', () => {
  const targetId = 'u_target';
  const myId = 'u_me';
  const now = Date.now();

  // 1. 秒回测试 (10秒内回复)
  const fastMessages = [
    { sender_id: myId, body: '今天天气真好！', created_at: now },
    { sender_id: targetId, body: '是呀，出来散步吗？', created_at: now + 10 * 1000 },
    { sender_id: myId, body: '好啊，去湖边？', created_at: now + 30 * 1000 },
    { sender_id: targetId, body: '我五分钟后到！', created_at: now + 45 * 1000 }
  ];
  const fastRes = calculateReplySpeed(fastMessages, targetId);
  assert.equal(fastRes.score, 100);
  assert.equal(fastRes.replyCount, 2);
  assert.match(fastRes.desc, /秒回|极速/);

  // 2. 慢回测试 (间隔 5 小时回复)
  const slowMessages = [
    { sender_id: myId, body: '在忙吗？', created_at: now },
    { sender_id: targetId, body: '才看到消息，今天加班。', created_at: now + 5 * 3600 * 1000 }
  ];
  const slowRes = calculateReplySpeed(slowMessages, targetId);
  assert(slowRes.score < 50, '慢回好感度得分应偏低');
  assert.equal(slowRes.replyCount, 1);

  // 3. 无回复测试
  const emptyRes = calculateReplySpeed([], targetId);
  assert.equal(emptyRes.score, 60);
  assert.equal(emptyRes.replyCount, 0);
});

test('factor 2: continuity tracks streak days and session durations', () => {
  const now = new Date('2026-10-04T15:00:00+08:00').getTime();
  const ONE_DAY = 86400000;

  // 连续 3 天聊天，且有单次 40 分钟的长聊
  const day1 = now - 2 * ONE_DAY;
  const day2 = now - 1 * ONE_DAY;
  const day3 = now;

  const messages = [
    // 第一天
    { sender_id: 'a', body: '你好', created_at: day1 },
    { sender_id: 'b', body: '你好呀', created_at: day1 + 5 * 60000 },
    // 第二天
    { sender_id: 'b', body: '今天吃了抹茶千层', created_at: day2 },
    { sender_id: 'a', body: '哇听起来不错', created_at: day2 + 2 * 60000 },
    // 第三天 (40分钟深度畅聊)
    { sender_id: 'a', body: '周末有什么安排？', created_at: day3 },
    { sender_id: 'b', body: '想去看个展，你呢？', created_at: day3 + 10 * 60000 },
    { sender_id: 'a', body: '我也想去看！什么展？', created_at: day3 + 20 * 60000 },
    { sender_id: 'b', body: '印象派水彩画展，在美术馆。', created_at: day3 + 40 * 60000 }
  ];

  const res = calculateContinuity(messages, now);
  assert.equal(res.streakDays, 3, '连续聊天天数应为3天');
  assert(res.streakScore >= 80, '续火花3天应有高分');
  assert.equal(res.maxSessionMinutes, 40, '单次最长持续时间应为40分钟');
  assert(res.durationScore >= 85, '40分钟持续时间应有高分');
  assert(res.score >= 80, '综合连续度得分应表现优异');
  assert.match(res.desc, /火花|连续/);
});

test('factor 3: word ratio asymmetry reflects directional favorability', () => {
  const targetId = 'u_target';
  const myId = 'u_me';

  // 1. 对方字数明显多于我方 (对方长篇大论，我方短句回复)
  const enthusiasticTarget = [
    { sender_id: myId, body: '今天怎么样？', created_at: 1000 }, // 6 字
    { sender_id: targetId, body: '今天遇到了一只特别可爱的橘猫，在书店门口晒太阳，我给它拍了好几张照片，还买了根猫条喂它，太治愈了！你今天过得顺心吗？', created_at: 2000 }, // 65 字
    { sender_id: myId, body: '挺好的。', created_at: 3000 }, // 4 字
    { sender_id: targetId, body: '那就好呀！晚上降温了记得加件外套，别着凉了，明天见哦～', created_at: 4000 } // 26 字
  ];
  const targetWordyRes = calculateWordRatio(enthusiasticTarget, targetId);
  assert(targetWordyRes.ratio >= 85, '对方字数占比应在85%以上');
  assert(targetWordyRes.score >= 90, '对方字数明显偏多时好感度应极高');

  // 2. 对方字数极少 (我方热情长文，对方冷淡敷衍一个字)
  const coldTarget = [
    { sender_id: myId, body: '今天工作忙完好累，不过下班路上看到了特别漂亮的晚霞，拍下来给你看看，希望你今天也开心！', created_at: 1000 }, // 45 字
    { sender_id: targetId, body: '嗯。', created_at: 2000 }, // 2 字
    { sender_id: myId, body: '你晚上吃了什么好吃的呀？我吃了番茄牛腩面，味道绝了。', created_at: 3000 }, // 26 字
    { sender_id: targetId, body: '哦。', created_at: 4000 } // 2 字
  ];
  const coldTargetRes = calculateWordRatio(coldTarget, targetId);
  assert(coldTargetRes.ratio < 10, '对方字数占比极低');
  assert(coldTargetRes.score <= 30, '对方字数极少时好感度评分应偏低');

  // 3. 双方字数相当 (各 20 字)
  const balanced = [
    { sender_id: myId, body: '今天去看了新出的电影，感觉剧情很紧凑。', created_at: 1000 },
    { sender_id: targetId, body: '我也听说了，听说配乐很不错，值得去吗？', created_at: 2000 }
  ];
  const balancedRes = calculateWordRatio(balanced, targetId);
  assert.equal(balancedRes.ratio, 50);
  assert.equal(balancedRes.score, 70, '均衡状态基准分');
});

test('factor 4: LLM analysis prompt creation and format parsing', () => {
  const history = [
    { sender_id: '小夏', body: '很高兴认识你！', created_at: 1000 },
    { sender_id: '小安', body: '我也很高兴认识你。', created_at: 2000 }
  ];
  const msgs = makeFavorabilityMessages(history, '小安', '小夏');
  assert.equal(msgs.length, 2);
  assert(msgs[0].content.includes('好感度'));

  const validJson = JSON.stringify({
    score: 88,
    attitude: '热情温暖',
    summary: '对方交流诚恳，主动延伸话题。',
    highlights: ['语气温柔', '积极主动']
  });
  const parsed = parseFavorabilityLlm(validJson);
  assert.equal(parsed.score, 88);
  assert.equal(parsed.attitude, '热情温暖');
  assert.equal(parsed.highlights.length, 2);

  // Markdown wrapped json
  const wrapped = '```json\n' + validJson + '\n```';
  assert.equal(parseFavorabilityLlm(wrapped).score, 88);

  // Markdown with prefix/suffix commentary
  const wrappedWithText = '分析完成：\n```json\n' + validJson + '\n```\n以上是分析结果。';
  assert.equal(parseFavorabilityLlm(wrappedWithText).score, 88);

  // Real ID mapping test: targetId UUID must map speaker to targetName
  const realHistory = [
    { sender_id: 'u_target_123', body: '很高兴认识你！', created_at: 1000 },
    { sender_id: 'u_my_456', body: '我也很高兴认识你。', created_at: 2000 }
  ];
  const realMsgs = makeFavorabilityMessages(realHistory, '小安', '小夏', 'u_target_123');
  const payload = JSON.parse(realMsgs[1].content);
  assert.equal(payload.dialogue[0].speaker, '小夏', '对方消息的 speaker 必须正确映射为对方昵称');
  assert.equal(payload.dialogue[1].speaker, '小安', '我方消息的 speaker 必须正确映射为我方昵称');

  // Invalid JSON throws ApiError
  assert.throws(() => parseFavorabilityLlm('invalid'), /格式不正确/);
});

test('composite score calculates weighted total and assigns tiers', () => {
  const reply = { score: 90 };
  const continuity = { score: 85 };
  const wordRatio = { score: 80 };
  const llm = { score: 95 };

  // 包含 LLM 四项权重各 25%
  const withLlm = composeFavorabilityScore(reply, continuity, wordRatio, llm);
  // (90 + 85 + 80 + 95) / 4 = 87.5 => 88
  assert.equal(withLlm.score, 88);
  assert.equal(withLlm.tier, '相谈甚欢');
  assert.equal(withLlm.hasLlm, true);

  // 无 LLM 时三项权重 35%, 35%, 30%
  const withoutLlm = composeFavorabilityScore(reply, continuity, wordRatio, null);
  // 90*0.35 + 85*0.35 + 80*0.30 = 31.5 + 29.75 + 24 = 85.25 => 85
  assert.equal(withoutLlm.score, 85);
  assert.equal(withoutLlm.hasLlm, false);
});

test('privacy switch: reciprocal visibility enforcement', () => {
  const db = openDatabase(':memory:');
  const a = register(db, {username: 'user_a', password: 'password12'});
  const b = register(db, {username: 'user_b', password: 'password12'});

  const convId = 'c_test_1';
  db.prepare('INSERT INTO real_notes (id, sender_id, recipient_id, body, status, created_at) VALUES (?,?,?,?,?,?)')
    .run('n_1', a.user.id, b.user.id, '你好', 'accepted', 1000);
  db.prepare('INSERT INTO real_conversations (id, user_a, user_b, note_id, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(convId, a.user.id, b.user.id, 'n_1', 1000, 2000);
  db.prepare('INSERT INTO real_messages (conversation_id, sender_id, body, created_at) VALUES (?,?,?,?)')
    .run(convId, a.user.id, '你好，今天天气不错', 1000);
  db.prepare('INSERT INTO real_messages (conversation_id, sender_id, body, created_at) VALUES (?,?,?,?)')
    .run(convId, b.user.id, '是呀，出来散步吗？', 1050);

  // 1. 双方默认开启好感度系统，可以查看对方对自己的好感度
  const res1 = getConversationFavorability(db, convId, a.user.id);
  assert.equal(res1.canView, true);
  assert.equal(typeof res1.score, 'number');
  assert.equal(res1.targetName, b.user.name);

  // 2. 如果自己关闭好感度系统：自己不能查看他人对自己的好感度
  db.prepare('UPDATE users SET favorability_enabled = 0 WHERE id = ?').run(a.user.id);
  const res2 = getConversationFavorability(db, convId, a.user.id);
  assert.equal(res2.canView, false);
  assert.equal(res2.reason, 'SELF_DISABLED');
  assert.match(res2.message, /你已关闭好感度系统/);

  // 3. 自己重新开启，但对方关闭了好感度系统：自己也不能查看对方对自己的好感度 (保护对方隐私)
  db.prepare('UPDATE users SET favorability_enabled = 1 WHERE id = ?').run(a.user.id);
  db.prepare('UPDATE users SET favorability_enabled = 0 WHERE id = ?').run(b.user.id);
  const res3 = getConversationFavorability(db, convId, a.user.id);
  assert.equal(res3.canView, false);
  assert.equal(res3.reason, 'OTHER_DISABLED');
  assert.match(res3.message, /对方已关闭好感度系统/);

  // 4. 双方均开启，再次恢复可见
  db.prepare('UPDATE users SET favorability_enabled = 1 WHERE id = ?').run(b.user.id);
  const res4 = getConversationFavorability(db, convId, a.user.id);
  assert.equal(res4.canView, true);
});

test('HTTP API: /api/real/favorability and /api/favorability/toggle', async t => {
  const db = openDatabase(':memory:');
  const a = register(db, {username: 'api_a', password: 'password12'});
  const b = register(db, {username: 'api_b', password: 'password12'});

  const convId = 'c_api_1';
  db.prepare('INSERT INTO real_notes (id, sender_id, recipient_id, body, status, created_at) VALUES (?,?,?,?,?,?)')
    .run('n_api_1', a.user.id, b.user.id, '你好', 'accepted', 1000);
  db.prepare('INSERT INTO real_conversations (id, user_a, user_b, note_id, created_at, updated_at) VALUES (?,?,?,?,?,?)')
    .run(convId, a.user.id, b.user.id, 'n_api_1', 1000, 2000);
  db.prepare('INSERT INTO real_messages (conversation_id, sender_id, body, created_at) VALUES (?,?,?,?)')
    .run(convId, a.user.id, '周末有什么安排？', 1000);
  db.prepare('INSERT INTO real_messages (conversation_id, sender_id, body, created_at) VALUES (?,?,?,?)')
    .run(convId, b.user.id, '想去美术馆看画展，你呢？', 1200);

  const mockAi = {
    score: 86,
    attitude: '亲近热络',
    summary: '对方积极回应并询问你的打算。',
    highlights: ['主动反问', '语气轻快']
  };

  let interceptedRequestBody = null;
  const server = createServer(
    {configured: true, base: 'https://test.invalid/v1', key: 'TEST', model: 'test'},
    {
      db,
      fetchImpl: async (url, options) => {
        interceptedRequestBody = JSON.parse(options.body);
        return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(mockAi)}}]}), {status: 200});
      }
    }
  );

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));

  const base = `http://127.0.0.1:${server.address().port}`;
  const cookie = x => 'hw_session=' + x.token;
  const post = (x, path, body) => fetch(base + path, {method: 'POST', headers: {'Content-Type': 'application/json', cookie: cookie(x)}, body: JSON.stringify(body)});
  const get = (x, path) => fetch(base + path, {headers: {cookie: cookie(x)}});

  // 1. GET /api/real/favorability
  const favRes = await (await get(a, `/api/real/favorability?conversationId=${convId}`)).json();
  assert.equal(favRes.canView, true);
  assert.equal(favRes.targetName, 'api_b');
  assert(favRes.score > 0);
  assert(favRes.factors.reply);
  assert(favRes.factors.continuity);
  assert(favRes.factors.wordRatio);

  // 2. POST /api/real/favorability/analyze (触发带 AI 的语义分析)
  const analyzeRes = await (await post(a, '/api/real/favorability/analyze', {conversationId: convId})).json();
  assert.equal(analyzeRes.canView, true);
  assert.equal(analyzeRes.hasLlm, true);
  assert.equal(analyzeRes.factors.llm.score, 86);
  assert.equal(analyzeRes.factors.llm.attitude, '亲近热络');
  assert(interceptedRequestBody, 'AI 请求必须被触发');
  const userContent = JSON.parse(interceptedRequestBody.messages[1].content);
  assert.equal(userContent.dialogue[0].speaker, 'api_a', '第一条消息的发言人');
  assert.equal(userContent.dialogue[1].speaker, 'api_b', '第二条消息的发言人必须为对方');

  // 3. POST /api/favorability/toggle (关闭开关)
  const toggleRes = await (await post(a, '/api/favorability/toggle', {enabled: false})).json();
  assert.equal(toggleRes.favorabilityEnabled, false);

  // 关闭后再查，被阻拦
  const favBlocked = await (await get(a, `/api/real/favorability?conversationId=${convId}`)).json();
  assert.equal(favBlocked.canView, false);
  assert.equal(favBlocked.reason, 'SELF_DISABLED');

  // 打开开关
  await post(a, '/api/favorability/toggle', {enabled: true});
  const favRestored = await (await get(a, `/api/real/favorability?conversationId=${convId}`)).json();
  assert.equal(favRestored.canView, true);
});
