import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../runtime/test-tools/node_modules/playwright-core/index.mjs';
import {createServer} from '../../server.mjs';
import {openDatabase} from '../../lib/db.mjs';
import {register, COOKIE_NAME} from '../../lib/auth.mjs';
import {runAction} from '../../lib/actions.mjs';
import {saveMatchingProfile, storeTags} from '../../lib/matching.mjs';
import {sendRealNote, respondRealNote, sendRealMessage} from '../../lib/real-chat.mjs';
import {saveMedia} from '../../lib/media.mjs';

const out = new URL('../assets/report/', import.meta.url);
fs.mkdirSync(out, {recursive: true});
const db = openDatabase(':memory:');
let browser, server;
const errors = [];
try {
  const a = register(db, {username: 'report_viewer', password: 'report_demo_123'});
  const b = register(db, {username: 'report_partner', password: 'report_demo_123'});
  for (const [auth, name] of [[a, '报告演示用户'], [b, '演示交流对象']]) {
    runAction(db, auth.user, 'saveProfile', {profile: {
      name, habit: '喜欢阅读与散步，愿意认真分享生活。',
      topic: '你最近读到过什么有趣的故事？', allowNotes: true,
      favorabilityEnabled: true
    }});
    saveMatchingProfile(db, auth.user.id, {
      selfIntro: '喜欢阅读和散步，愿意真诚地分享日常生活。',
      desiredIntro: '希望遇见愿意认真倾听、互相尊重的人。'
    });
    storeTags(db, auth.user.id, {selfTags: ['喜欢阅读', '真诚'], desiredTags: ['喜欢阅读', '真诚']});
  }
  const card = {id: b.user.id, kind: 'real', name: '演示交流对象', score: 100,
    tier: 'gold', selfIntro: '喜欢阅读和散步，愿意真诚地分享日常生活。',
    sharedTags: ['喜欢阅读', '真诚']};
  db.prepare('INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)')
    .run(a.user.id, 'real', b.user.id, JSON.stringify(card), Date.now());
  const note = sendRealNote(db, a.user.id, b.user.id, '你好，最近有没有读到让你印象深刻的故事？');
  const chat = respondRealNote(db, b.user.id, note, 'accept', '你好，很高兴认识你。我最近在读一本旅行随笔。');
  sendRealMessage(db, a.user.id, chat, '听起来很有趣，你最喜欢其中哪一段？');
  sendRealMessage(db, b.user.id, chat, '最喜欢写山间散步的那段，读完之后很想出去走走。');
  // Seed only the isolated demo with the project's existing public illustration.
  const sprite = fs.readFileSync(new URL('../../public/character/yu-watercolor.png', import.meta.url));
  const data = `data:image/png;base64,${sprite.toString('base64')}`;
  saveMedia(db, b.user.id, 'portrait', data);
  saveMedia(db, b.user.id, 'portrait', data, 'happy');
  saveMedia(db, a.user.id, 'portrait', data);
  const guidance = {
    emotion: {label: 'happy', confidence: 82},
    interpretations: [
      {intent: '分享阅读感受', confidence: 50, reason: '对方主动介绍喜欢的段落。'},
      {intent: '自然延续话题', confidence: 30, reason: '回应了关于随笔的问题。'},
      {intent: '表达散步兴趣', confidence: 20, reason: '提到想出去走走，仍需确认。'}
    ],
    suggestions: [
      {label: '接住分享', text: '那段描写一定很有画面感。'},
      {label: '继续了解', text: '你平时也喜欢去山里走走吗？'},
      {label: '轻松回应', text: '一本书就把散步计划安排上了。'}
    ]
  };
  server = createServer({configured: true, base: 'https://report-mock.invalid/v1', key: 'DEMO_ONLY', model: 'mock'}, {
    db, fetchImpl: async () => Response.json({choices: [{message: {content: JSON.stringify(guidance)}}]})
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true});
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}, reducedMotion: 'reduce'});
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const screenshot = async name => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
    });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: horizontal overflow`);
    await page.screenshot({path: fileURLToPath(new URL(`${name}.png`, out))});
  };
  await page.goto(`${base}/login.html`);
  await page.locator('#username').waitFor();
  await screenshot('login');
  await context.addCookies([{name: COOKIE_NAME, value: a.token, url: base}]);
  await page.goto(base);
  await page.locator('.daily-encounter').waitFor();
  await screenshot('meet');
  const tab = async id => {
    if (!await page.locator('.menu-panel.open').count()) await page.locator('.menu-btn').click();
    await page.locator(`[data-action="tab"][data-id="${id}"]:visible`).first().click();
  };
  await tab('notes');
  await page.locator('.real-note').first().waitFor();
  await screenshot('notes');
  await tab('chat');
  await page.locator('.vn-stage.real').waitFor();
  await page.locator('.vn-intents').waitFor();
  await screenshot('chat');
  await tab('me');
  await page.locator('[data-action="appearance"]').first().click();
  await page.locator('dialog[open]').waitFor();
  await screenshot('media');
  assert.deepEqual(errors, []);
  console.log('PASS: five report screenshots; isolated in-memory data; mocked AI; no page errors or desktop horizontal overflow.');
} finally {
  await browser?.close();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  db.close();
}
