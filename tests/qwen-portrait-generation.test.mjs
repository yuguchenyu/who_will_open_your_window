import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {saveMedia, getMedia, mediaStatus} from '../lib/media.mjs';
import {createPortraitGeneration} from '../lib/portrait-generation.mjs';
import {encodePortraitPng, decodePortraitPng} from '../lib/portrait-png.mjs';

const pixels = Buffer.from([0,0,0,0,10,20,30,255,0,0,0,0,50,60,70,255]);
const png = encodePortraitPng({width:2,height:2,pixels});
const dataUrl = 'data:image/png;base64,' + png.toString('base64');
const imageUrl = 'https://dashscope-result.oss-cn-shanghai.aliyuncs.com/portrait.png?signature=private-test-signature';
const config = {
  configured:false,
  imageConfigured:true,
  imageBase:'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
  imageKey:'private-image-test-key'
};

function fixture(t, fetchImpl, {timeout, imageModel, imageBase} = {}) {
  const db = openDatabase(':memory:');
  const owner = register(db, {username:'qwen_owner',password:'password12'}).user.id;
  const other = register(db, {username:'qwen_other',password:'password12'}).user.id;
  saveMedia(db, owner, 'portrait', dataUrl);
  const service = createPortraitGeneration(db, {...config, ...(imageModel ? {imageModel} : {}), ...(imageBase ? {imageBase} : {})}, {fetchImpl, timeout});
  t.after(() => { service.close(); db.close(); });
  return {db, owner, other, service};
}

const input = () => ({emotion:'happy',consent:true,requestId:randomUUID()});

async function finished(service, owner) {
  for (let i = 0; i < 200; i++) {
    const job = service.state(owner).job;
    if (job.status !== 'running') return job;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw Error('portrait generation did not finish');
}

function assertQwenRequest(call, model = 'qwen-image-2.1-pro') {
  assert.equal(call.url, 'https://test-workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/images/generations');
  assert.equal(call.options.method, 'POST');
  assert.equal(new Headers(call.options.headers).get('authorization'), 'Bearer private-image-test-key');
  assert.match(new Headers(call.options.headers).get('content-type') || '', /^application\/json\b/);
  const body = JSON.parse(call.options.body);
  assert.equal(body.model, model);
  assert.deepEqual(Object.keys(body).sort(), ['image','model','n','prompt','prompt_extend','size','watermark']);
  assert.equal(body.image, dataUrl);
  assert.equal(body.n, 1);
  assert.equal(body.size, 'auto');
  assert.equal(body.prompt_extend, false);
  assert.equal(body.watermark, false);
  assert.match(body.prompt, /Keep the SAME character/);
  assert.match(body.prompt, /happy/);
  assert.match(body.prompt, /genuine transparent alpha background/);
}

// Catches the wrong provider branch, changed reference bytes, leaked credentials,
// and an eager save that replaces the user's emotion before confirmation.
test('default Qwen generation downloads a private preview and saves only after confirmation', async t => {
  const calls = [];
  const {db, owner, other, service} = fixture(t, async (url, options) => {
    calls.push({url,options});
    return calls.length === 1
      ? Response.json({created:1760000000,data:[{url:imageUrl}]})
      : new Response(png, {headers:{'content-type':'image/png'}});
  });
  const avatarPixels = Buffer.from(pixels); avatarPixels[4] = 99;
  saveMedia(db, owner, 'avatar', 'data:image/png;base64,' + encodePortraitPng({width:2,height:2,pixels:avatarPixels}).toString('base64'));
  const request = input();
  const job = service.start(owner, request);
  assert.equal(service.start(owner, request).id, job.id);
  assert.equal((await finished(service, owner)).status, 'ready');
  assert.equal(calls.length, 2);
  assertQwenRequest(calls[0]);
  assert.equal(calls[1].url, imageUrl);
  assert.equal(calls[1].options.method || 'GET', 'GET');
  assert.equal(new Headers(calls[1].options.headers).get('authorization'), null);
  assert.equal(calls[1].options.redirect, 'error');
  assert.equal(calls[1].options.signal, calls[0].options.signal);
  assert.equal(mediaStatus(db, owner).portraitEmotions.happy, undefined);
  assert.deepEqual(decodePortraitPng(Buffer.from(service.image(owner, job.id))).pixels, pixels);
  assert.throws(() => service.image(other, job.id), error => error.status === 404);
  assert.throws(() => service.apply(other, job.id), error => error.status === 404);
  const summary = JSON.stringify(service.state(owner));
  assert(!summary.includes(imageUrl));
  assert(!summary.includes('private-test-signature'));
  assert(!summary.includes(config.imageKey));
  const applied = service.apply(owner, job.id);
  assert.equal(applied.job.status, 'saved');
  assert(applied.media.portraitEmotions.happy);
  assert(!JSON.stringify(applied).includes(imageUrl));
  assert.deepEqual(decodePortraitPng(Buffer.from(getMedia(db, owner, 'portrait', 'happy').bytes)).pixels, pixels);
  assert.equal(db.prepare('SELECT bytes FROM portrait_generation_jobs WHERE id=?').get(job.id).bytes, null);
});

// Catches dispatch that hardcodes just the default instead of supporting the
// qwen-image-* family selected by an explicit deployment configuration.
test('an explicitly configured Qwen image model uses the JSON generation API', async t => {
  const calls = [];
  const {owner, service} = fixture(t, async (url, options) => {
    calls.push({url,options});
    return calls.length === 1 ? Response.json({data:[{url:imageUrl}]}) : new Response(png);
  }, {imageModel:'qwen-image-2.0-pro'});
  service.start(owner, input());
  assert.equal((await finished(service, owner)).status, 'ready');
  assertQwenRequest(calls[0], 'qwen-image-2.0-pro');
});

test('a DashScope image base uses the native editing API and downloads its nested image result', async t => {
  const calls=[];
  const {owner,service}=fixture(t,async(url,options)=>{
    calls.push({url,options});
    return calls.length===1
      ? Response.json({output:{choices:[{message:{role:'assistant',content:[{image:imageUrl}]}}]}})
      : new Response(png);
  },{imageBase:'https://dashscope.aliyuncs.com/api/v1'});
  const job=service.start(owner,input());
  assert.equal((await finished(service,owner)).status,'ready');
  assert.equal(calls[0].url,'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  const body=JSON.parse(calls[0].options.body);
  assert.equal(body.model,'qwen-image-2.1-pro');
  assert.deepEqual(body.parameters,{n:1,prompt_extend:false,watermark:false});
  assert.equal(body.input.messages[0].role,'user');
  assert.equal(body.input.messages[0].content[0].image,dataUrl);
  assert.match(body.input.messages[0].content[1].text,/genuine transparent alpha background/);
  assert.equal(calls[1].url,imageUrl);
  assert.equal(new Headers(calls[1].options.headers).get('authorization'),null);
  assert.deepEqual(decodePortraitPng(Buffer.from(service.image(owner,job.id))).pixels,pixels);
});

// Catches SSRF and lookalike-host mistakes before any returned URL is fetched.
test('Qwen refuses unsafe image URLs before starting a download', async t => {
  const unsafeUrls = [
    'http://dashscope-result.oss-cn-shanghai.aliyuncs.com/portrait.png',
    'https://images.example.com/portrait.png',
    'https://aliyuncs.com/portrait.png',
    'https://aliyuncs.com.attacker.example/portrait.png',
    'https://fakealiyuncs.com/portrait.png',
    'https://dashscope-result.oss-cn-beijing-internal.aliyuncs.com/portrait.png',
    'https://ecs-cn-beijing.aliyuncs.com/portrait.png',
    'https://127.0.0.1/portrait.png',
    'https://169.254.169.254/latest/meta-data',
    'https://user:password@dashscope-result.oss-cn-shanghai.aliyuncs.com/portrait.png',
    'https://dashscope-result.oss-cn-shanghai.aliyuncs.com:8443/portrait.png'
  ];
  for (const unsafeUrl of unsafeUrls) await t.test(unsafeUrl, async child => {
    const calls = [];
    const {db, owner, service} = fixture(child, async (url, options) => {
      calls.push({url,options});
      return calls.length === 1 ? Response.json({data:[{url:unsafeUrl}]}) : new Response(png);
    });
    saveMedia(db, owner, 'portrait', dataUrl, 'happy');
    const original = mediaStatus(db, owner).portraitEmotions.happy;
    const job = service.start(owner, input());
    assert.equal((await finished(service, owner)).status, 'failed');
    assertQwenRequest(calls[0]);
    assert.equal(calls.length, 1);
    assert.equal(mediaStatus(db, owner).portraitEmotions.happy, original);
    assert.throws(() => service.image(owner, job.id), error => error.status === 404);
  });
});

// Catches unbounded downloads, manual redirect following, and accepting opaque
// model output without the existing PNG alpha validation.
test('invalid Qwen downloads fail without replacing the existing emotion', async t => {
  const opaque = Buffer.from(pixels);
  for (let i = 3; i < opaque.length; i += 4) opaque[i] = 255;
  const cases = [
    {name:'declared length above 12 MB', response:() => new Response(png, {headers:{'content-length':'12000001'}})},
    {name:'streamed body above 12 MB without a length header', response:() => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(6_000_000)); controller.enqueue(new Uint8Array(6_000_001)); controller.close(); }
    }))},
    {name:'redirect to another URL', response:() => new Response(null, {status:302,headers:{location:'https://attacker.example/portrait.png'}})},
    {name:'opaque PNG', response:() => new Response(encodePortraitPng({width:2,height:2,pixels:opaque}), {headers:{'content-type':'image/png'}})}
  ];
  for (const entry of cases) await t.test(entry.name, async child => {
    const calls = [];
    const {db, owner, service} = fixture(child, async (url, options) => {
      calls.push({url,options});
      return calls.length === 1 ? Response.json({data:[{url:imageUrl}]}) : entry.response();
    });
    saveMedia(db, owner, 'portrait', dataUrl, 'happy');
    const original = mediaStatus(db, owner).portraitEmotions.happy;
    const job = service.start(owner, input());
    assert.equal((await finished(service, owner)).status, 'failed');
    assertQwenRequest(calls[0]);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.redirect, 'error');
    assert.equal(mediaStatus(db, owner).portraitEmotions.happy, original);
    assert.throws(() => service.apply(owner, job.id), error => error.status === 409);
    assert.equal(db.prepare('SELECT bytes FROM portrait_generation_jobs WHERE id=?').get(job.id).bytes, null);
  });
});

// Catches a download that escapes the generation deadline or receives a new
// timeout instead of the AbortSignal already attached to generation.
test('the Qwen generation deadline also aborts a stalled image download', async t => {
  const calls = [];
  const {db, owner, service} = fixture(t, async (url, options) => {
    calls.push({url,options});
    if (calls.length === 1) return Response.json({data:[{url:imageUrl}]});
    return new Promise((_resolve, reject) => {
      const aborted = () => reject(new DOMException('Aborted', 'AbortError'));
      if (options.signal.aborted) aborted();
      else options.signal.addEventListener('abort', aborted, {once:true});
    });
  }, {timeout:20});
  saveMedia(db, owner, 'portrait', dataUrl, 'happy');
  const original = mediaStatus(db, owner).portraitEmotions.happy;
  service.start(owner, input());
  const failed = await finished(service, owner);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /超时/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.signal, calls[0].options.signal);
  assert.equal(calls[1].options.signal.aborted, true);
  assert.equal(mediaStatus(db, owner).portraitEmotions.happy, original);
});
