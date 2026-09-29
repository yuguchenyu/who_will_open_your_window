import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {matchScore, parseTags, recommendations, saveMatchingProfile, storeTags} from '../lib/matching.mjs';
import {createServer} from '../server.mjs';

const intros = {selfIntro: '我喜欢阅读，也重视真诚地交流。', desiredIntro: '希望遇见喜欢运动而且温柔的人。'};
const tags = {selfTags: ['喜欢阅读', '真诚'], desiredTags: ['喜欢运动', '温柔']};
const reverse = {selfTags: ['喜欢运动', '温柔'], desiredTags: ['喜欢阅读', '真诚']};

test('matching requires both directions and excludes the current user', () => {
  const db = openDatabase(':memory:');
  const a = register(db, {username: 'match_a', password: 'password12'}).user;
  const b = register(db, {username: 'match_b', password: 'password12'}).user;
  const c = register(db, {username: 'match_c', password: 'password12'}).user;
  for (const user of [a, b, c]) saveMatchingProfile(db, user.id, intros);
  storeTags(db, a.id, tags);
  storeTags(db, b.id, reverse);
  storeTags(db, c.id, {selfTags: ['喜欢运动'], desiredTags: ['喜欢游戏']});
  assert.equal(matchScore(tags, reverse), 100);
  assert.equal(matchScore(tags, {selfTags: ['喜欢运动'], desiredTags: ['喜欢游戏']}), 0);
  const results = recommendations(db, a.id);
  assert.deepEqual(results.map(x => x.id), [b.id]);
  assert(!JSON.stringify(results).includes(intros.desiredIntro));
});

test('model output must use the fixed matching vocabulary', () => {
  assert.deepEqual(parseTags(JSON.stringify(tags)), tags);
  assert.throws(() => parseTags('{"selfTags":["年龄25"],"desiredTags":["温柔"]}'));
  assert.throws(() => parseTags('{"selfTags":[],"desiredTags":["温柔"]}'));
});

test('registration saves introductions, generates tags, and serves eligible recommendations', async t => {
  const db = openDatabase(':memory:');
  const config = {configured: true, base: 'https://example.invalid/v1', key: 'TEST', model: 'test'};
  const model = async (_url, options) => {
    const body = JSON.parse(options.body);
    const intro = JSON.parse(body.messages[1].content);
    const output = intro.selfIntro.includes('运动') ? reverse : tags;
    return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify(output)}}]}), {status: 200});
  };
  const server = createServer(config, {db, fetchImpl: model});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve)}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const registerUser = async (username, selfIntro) => {
    const response = await fetch(base + '/api/register', {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({username, password: 'password12', ...intros, selfIntro, shareForMatching: true})});
    assert.equal(response.status, 200);
    return response.headers.getSetCookie()[0].split(';')[0];
  };
  const a = await registerUser('match_a', intros.selfIntro);
  await registerUser('match_b', '我喜欢运动，也希望温柔地和对方交流。');
  const me = await (await fetch(base + '/api/me', {headers: {cookie: a}})).json();
  assert.equal(me.matchingProfile.status, 'ready');
  const result = await (await fetch(base + '/api/matches', {headers: {cookie: a}})).json();
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].score, 100);
  assert(!JSON.stringify(result.matches).includes('desiredIntro'));
  assert.equal((await fetch(base + '/api/matches')).status, 401);
  const noConsent = await fetch(base + '/api/match-profile', {method: 'POST', headers: {'Content-Type': 'application/json', cookie: a}, body: JSON.stringify(intros)});
  assert.equal(noConsent.status, 400);
});

test('registration stays usable when the model is unavailable', async t => {
  const server = createServer({configured: false}, {db: openDatabase(':memory:')});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {server.closeAllConnections(); server.close(resolve)}));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/api/register', {method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({username: 'offline_user', password: 'password12', ...intros, shareForMatching: true})});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).matchingProfile.status, 'pending');
});
