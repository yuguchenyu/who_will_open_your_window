import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import * as serverApi from '../server.mjs';
import {createServer,makeMessages,parseSuggestions,parseGuidance,completion,readConfig} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
const listenHost=opts=>serverApi.listenHost(opts);
const config={configured:true,base:'https://example.invalid/v1',key:'TEST_SECRET_NOT_FOR_BROWSER',model:'test-model'};
const db=()=>openDatabase(':memory:');
// 注册一个测试账号并返回带 cookie 的请求头。
async function signIn(url,username='tester1'){
 const res=await fetch(url+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'password12',selfIntro:'我喜欢阅读和散步，也很重视真诚沟通。',desiredIntro:'希望遇见喜欢阅读、愿意耐心交流的人。',shareForMatching:true})});
 assert.equal(res.status,200,'test account registration must succeed');
 return res.headers.getSetCookie()[0].split(';')[0];
}
const suggestions={suggestions:[{label:'关心',text:'今天过得怎么样？'},{label:'接话',text:'很高兴听你分享。'},{label:'了解',text:'你喜欢怎样度过周末？'}]};
const guidance={interpretations:[{intent:'确实没有偏好',confidence:45,reason:'没有更多上下文。'},{intent:'希望你提出选项',confidence:35,reason:'回答比较简短。'},{intent:'想看你是否记得偏好',confidence:20,reason:'只是可能，尚无明确证据。'}],suggestions:suggestions.suggestions};
const profile={name:'安',habit:'慢热',topic:'今天如何'};
async function withServer(t,options={}){const server=createServer(config,{db:db(),...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));return `http://127.0.0.1:${server.address().port}`}
test('private data is excluded from upstream messages',()=>{const body={personId:'xia',messages:[],profile,feelings:{xia:99},reviews:{secret:true},confirmations:['private'],context:'greeting'};const built=JSON.stringify(makeMessages(body,'reply'));assert(!built.includes('99'));assert(!built.includes('secret'));assert(!built.includes('private'));assert(!built.includes(config.key))});
test('suggestion validation',()=>{assert.equal(parseSuggestions(JSON.stringify(suggestions)).length,3);assert.equal(parseSuggestions('```json\n'+JSON.stringify(suggestions)+'\n```').length,3);assert.throws(()=>parseSuggestions('{}'));assert.throws(()=>parseSuggestions('{broken'));assert.throws(()=>makeMessages({personId:'unknown',messages:[]},'reply'))});
test('guidance requires bounded hypotheses and relative weights',()=>{assert.equal(parseGuidance(JSON.stringify(guidance)).interpretations.length,3);assert.throws(()=>parseGuidance(JSON.stringify({...guidance,interpretations:guidance.interpretations.map(v=>({...v,confidence:90}))})));assert.throws(()=>parseGuidance('{}'))});
test('guidance uses authenticated server history, not client supplied text',async t=>{let sent='';const url=await withServer(t,{fetchImpl:async(_u,opt)=>{const body=JSON.parse(opt.body);sent=JSON.stringify(body.messages);const content=sent.includes('对话理解助手')?JSON.stringify(guidance):'随便';return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200})}});const cookie=await signIn(url);const post=async(path,body)=>fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(body)});assert.equal((await post('/api/guidance',{personId:'xia',messageId:1})).status,400);const note=await(await post('/api/action',{type:'sendNote',personId:'xia',text:'晚饭吃什么？'})).json();await post('/api/action',{type:'startNoteReply',noteId:note.result.id});const reply=await(await post('/api/reply',{personId:'xia'})).json();const latest=reply.state.messages.xia.at(-1);const response=await post('/api/guidance',{personId:'xia',messageId:latest.id,messages:[{role:'user',content:'FORGED_HISTORY'}],feelings:{xia:'PRIVATE_FEELING'}});assert.equal(response.status,200);const result=await response.json();assert.equal(result.interpretations.length,3);assert.equal(result.messageId,latest.id);assert(sent.includes('晚饭吃什么？'));assert(!sent.includes('FORGED_HISTORY'));assert(!sent.includes('PRIVATE_FEELING'));assert.equal((await post('/api/guidance',{personId:'xia',messageId:-1})).status,400)});
test('HTTP route protections, static files and secret exclusion',async t=>{const url=await withServer(t);const status=await(await fetch(url+'/api/status')).text();assert(!status.includes('test-model'));assert(!status.includes(config.key));assert.equal((await fetch(url+'/.env')).status,404);assert.equal((await fetch(url+'/server.mjs')).status,404);assert.equal((await fetch(url+'/',{redirect:'manual'})).status,302,'logged-out visitors go to the login page');const cross=await fetch(url+'/api/suggestions',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);assert.equal((await fetch(url+'/api/suggestions',{method:'POST',body:'{}'})).status,403)});
test('mock upstream validates authorization and successful API flows',async t=>{let sent;const url=await withServer(t,{fetchImpl:async(u,opt)=>{sent={u,opt};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(suggestions)}}]}),{status:200})}});const cookie=await signIn(url);const r=await fetch(url+'/api/suggestions',{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify({personId:'xia',messages:[],profile})});assert.equal(r.status,200);assert.equal((await r.json()).suggestions.length,3);assert.equal(sent.u,config.base+'/chat/completions');assert.equal(sent.opt.headers.Authorization,'Bearer '+config.key)});
// --- LAN access (ALLOW_LAN) -------------------------------------------------
const lanIps=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address);
function rawRequest(port,pathname,{method='GET',headers={},body,connectTo='127.0.0.1',localAddress}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:connectTo,port,path:pathname,method,headers,localAddress},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text,headers:res.headers}))});
  req.on('error',reject);if(body)req.write(body);req.end();
 });
}
async function withLanServer(t,overrides={},listenOn='127.0.0.1'){
 const server=createServer({...config,...overrides},{db:db(),fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'连接成功'}}]}),{status:200})});
 await new Promise(r=>server.listen(0,listenOn,r));
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 return server.address().port;
}
// 局域网用例里业务 POST 请求需要先有账号。
async function lanCookie(port){
 const res=await rawRequest(port,'/api/register',{method:'POST',headers:{'Content-Type':'application/json',host:`127.0.0.1:${port}`},body:JSON.stringify({username:'lan_user',password:'password12',selfIntro:'我喜欢阅读和散步，也很重视真诚沟通。',desiredIntro:'希望遇见喜欢阅读、愿意耐心交流的人。',shareForMatching:true})});
 assert.equal(res.status,200,'the LAN test account must register');
 return res.headers['set-cookie'][0].split(';')[0];
}
test('ALLOW_LAN is opt-in and defaults to loopback-only binding',()=>{
 assert.equal(readConfig('/nonexistent-root',{}).lan,false);
 assert.equal(readConfig('/nonexistent-root',{ALLOW_LAN:'1'}).lan,true);
 assert.equal(listenHost({lan:false}),'127.0.0.1');
 assert.equal(listenHost({lan:true}),'0.0.0.0');
});
test('a LAN host header is rejected by default and accepted when enabled',async t=>{
 if(!lanIps.length)return t.skip('this machine has no non-internal IPv4 address');
 const off=await withLanServer(t,{lan:false});
 assert.equal((await rawRequest(off,'/api/status',{headers:{host:`${lanIps[0]}:${off}`}})).status,403);
 const on=await withLanServer(t,{lan:true});
 const ok=await rawRequest(on,'/api/status',{headers:{host:`${lanIps[0]}:${on}`}});
 assert.equal(ok.status,200);assert(ok.body.includes('heart-window-demo'));
});
test('enabling LAN still rejects foreign hosts and mismatched ports',async t=>{
 const on=await withLanServer(t,{lan:true});
 assert.equal((await rawRequest(on,'/api/status',{headers:{host:`evil.example:${on}`}})).status,403);
 assert.equal((await rawRequest(on,'/api/status',{headers:{host:'127.0.0.1:1'}})).status,403);
 assert.equal((await rawRequest(on,'/api/status',{headers:{host:`${lanIps[0]??'10.0.0.1'}:1`}})).status,403);
});
test('a LAN Origin is accepted for POST only when LAN is enabled',async t=>{
 if(!lanIps.length)return t.skip('this machine has no non-internal IPv4 address');
 const json={'Content-Type':'application/json'};
 const off=await withLanServer(t,{lan:false});
 const refused=await rawRequest(off,'/api/action',{method:'POST',headers:{...json,host:`127.0.0.1:${off}`,Origin:`http://${lanIps[0]}:${off}`},body:JSON.stringify({type:'advance',days:1})});
 assert.equal(refused.status,403);
 const on=await withLanServer(t,{lan:true});
 const allowed=await rawRequest(on,'/api/action',{method:'POST',headers:{...json,host:`${lanIps[0]}:${on}`,Origin:`http://${lanIps[0]}:${on}`,cookie:await lanCookie(on)},body:JSON.stringify({type:'advance',days:1})});
 assert.equal(allowed.status,200);
 assert.equal(JSON.parse(allowed.body).state.offsetDays,1);
});
// --- client IP whitelist (ALLOW_IPS) ----------------------------------------
test('ALLOW_IPS parses a list, implies LAN mode, and rejects typos',()=>{
 assert.deepEqual(readConfig('/nonexistent-root',{}).allowIps,[]);
 assert.deepEqual(readConfig('/nonexistent-root',{ALLOW_IPS:'10.0.0.5, 10.0.0.6'}).allowIps,['10.0.0.5','10.0.0.6']);
 assert.equal(readConfig('/nonexistent-root',{ALLOW_IPS:'10.0.0.5'}).lan,true,'an IP whitelist without LAN binding would be a silent no-op');
 assert.throws(()=>readConfig('/nonexistent-root',{ALLOW_IPS:'10.0.0.999'}),/ALLOW_IPS/);
});
test('an IP whitelist admits listed devices, refuses others, and never locks out loopback',async t=>{
 if(!lanIps.length)return t.skip('this machine has no non-internal IPv4 address');
 const ip=lanIps[0];
 const listed=await withLanServer(t,{lan:true,allowIps:[ip]},'0.0.0.0');
 assert.equal((await rawRequest(listed,'/api/status',{connectTo:ip,localAddress:ip})).status,200);
 const unlisted=await withLanServer(t,{lan:true,allowIps:['10.99.99.99']},'0.0.0.0');
 const refused=await rawRequest(unlisted,'/api/status',{connectTo:ip,localAddress:ip});
 assert.equal(refused.status,403);
 assert(refused.body.includes(ip),'the refusal must name the client address so a blocked device can be diagnosed');
 assert.equal((await rawRequest(unlisted,'/api/status')).status,200,'the local browser must never be locked out');
});
test('an empty whitelist leaves LAN mode open to the subnet',async t=>{
 if(!lanIps.length)return t.skip('this machine has no non-internal IPv4 address');
 const ip=lanIps[0];
 const open=await withLanServer(t,{lan:true,allowIps:[]},'0.0.0.0');
 assert.equal((await rawRequest(open,'/api/status',{connectTo:ip,localAddress:ip})).status,200);
});
// --- the startup banner must describe the policy actually in force ----------
const policyOf=env=>serverApi.accessPolicy(readConfig('/nonexistent-root',env));
test('startup policy names the whitelist instead of claiming the subnet is open',()=>{
 const restricted=policyOf({ALLOW_IPS:'10.22.28.19'});
 assert(restricted.includes('10.22.28.19'),'the whitelist must be visible in the log');
 assert(!restricted.includes('任何设备都能调用'),'a whitelisted server is not open to the whole subnet');
 const open=policyOf({ALLOW_LAN:'1'});
 assert(open.includes('任何设备都能调用'),'a genuinely open server must still say so');
 const local=policyOf({});
 assert(local.includes('仅本机'));
});
test('an ALLOW_LAN=0 overridden by ALLOW_IPS is reported, not silently ignored',()=>{
 const text=policyOf({ALLOW_LAN:'0',ALLOW_IPS:'10.22.28.19'});
 assert(text.includes('ALLOW_LAN=0'),'the log must admit the explicit 0 was overridden');
 assert(!text.includes('ALLOW_LAN=1'),'it must not claim ALLOW_LAN=1, which the user never set');
 assert.equal(readConfig('/nonexistent-root',{ALLOW_LAN:'0'}).lan,false,'ALLOW_LAN=0 on its own must still work');
});
test('missing config, auth, rate limit, malformed output and network error',async()=>{await assert.rejects(()=>completion({...config,configured:false},[]),e=>e.code==='NOT_CONFIGURED');for(const [status,code] of [[401,'AUTH'],[429,'RATE_LIMIT'],[500,'UPSTREAM']])await assert.rejects(()=>completion(config,[],async()=>new Response('private vendor response '+config.key,{status})),e=>e.code===code&&!e.message.includes(config.key));await assert.rejects(()=>completion(config,[],async()=>new Response('oops')),e=>e.code==='FORMAT');await assert.rejects(()=>completion(config,[],async()=>{throw new Error(config.key)}),e=>e.code==='NETWORK'&&!e.message.includes(config.key));await assert.rejects(()=>completion(config,[],async()=>{throw new DOMException('timeout','TimeoutError')}),e=>e.code==='TIMEOUT')});

// --- 鉴权、单设备顶替、跨账号隔离 ---------------------------------------------
test('everything under /api except status, register and login requires a session', async t => {
  const url = await withServer(t);
  assert.equal((await fetch(url + '/api/status')).status, 200, 'the login page needs status to render');
  const post = (path) => fetch(url + path, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
  for (const path of ['/api/action', '/api/logout', '/api/reply', '/api/suggestions', '/api/guidance', '/api/match-profile', '/api/match-retry']) {
    assert.equal((await post(path)).status, 401, `${path} must not be reachable without a session`);
  }
  assert.equal((await fetch(url + '/api/me')).status, 401, 'GET /api/me must not leak the state either');
  assert.equal((await fetch(url + '/api/matches')).status, 401, 'recommendations need a session');
  // 方法用错时要给出 405，而不是把人绕到 404 上去猜。
  assert.equal((await post('/api/me')).status, 405);
  // 注册和登录本身当然不需要会话。
  assert.equal((await post('/api/login')).status, 401, 'a login attempt with no credentials fails on the credentials, not on the session');
});

test('the login page is served to visitors and skipped once signed in', async t => {
  const url = await withServer(t);
  const root = await fetch(url + '/', {redirect: 'manual'});
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/login.html');
  assert.equal((await fetch(url + '/login.html')).status, 200);
  assert.equal((await fetch(url + '/login.mjs')).status, 200);
  const cookie = await signIn(url);
  const back = await fetch(url + '/login.html', {headers: {cookie}, redirect: 'manual'});
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), '/');
  assert.equal((await fetch(url + '/', {headers: {cookie}})).status, 200);
  // 被顶掉的设备直接刷新页面时，跳转链接里要带上原因，登录页才好解释。
  const kicked = await signIn(url, 'kicked1');
  await fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'kicked1', password: 'password12'})});
  assert.equal((await fetch(url + '/', {headers: {cookie: kicked}, redirect: 'manual'})).headers.get('location'), '/login.html?reason=replaced');
});

test('a displaced device is told why on its next request', async t => {
  const url = await withServer(t);
  const first = await signIn(url, 'tester1');
  const second = await fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'tester1', password: 'password12'})});
  assert.equal(second.status, 200);
  const res = await fetch(url + '/api/me', {headers: {cookie: first}});
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.code, 'SESSION_REPLACED', 'the code is what lets the client explain itself instead of silently logging out');
  assert.match(body.error, /另一台设备/);
});

test('a stale tab cannot roll back another tab’s work', async t => {
  // 同一浏览器开两个标签页时共用同一个 cookie，"一账号一设备"管不到它们。
  // 但客户端只发动作、不发状态，所以后发的那个不会把先发的覆盖掉。
  const url = await withServer(t);
  const cookie = await signIn(url);
  const stale = await (await fetch(url + '/api/me', {headers: {cookie}})).json();
  const post = (payload) => fetch(url + '/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify(payload)});
  await post({type: 'sendNote', personId: 'xia', text: '标签页 A 写的'});
  await post({type: 'sendNote', personId: 'yu', text: '标签页 B 写的'});
  const now = await (await fetch(url + '/api/me', {headers: {cookie}})).json();
  assert.equal(now.state.notes.length, 2, 'both tabs’ notes must survive');
  assert.equal(stale.state.notes.length, 0, 'the stale copy is simply out of date, which is harmless — it is never sent back');
});

test('two accounts cannot see each other', async t => {
  const url = await withServer(t);
  const a = await signIn(url, 'alice1');
  const b = await signIn(url, 'bob_22');
  const post = (cookie, payload) => fetch(url + '/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify(payload)});
  assert.equal((await post(a, {type: 'sendNote', personId: 'xia', text: '爱丽丝的纸条'})).status, 200);
  const seen = await (await fetch(url + '/api/me', {headers: {cookie: b}})).json();
  assert.equal(seen.state.notes.length, 0, 'bob must not see alice notes');
  assert(!JSON.stringify(seen).includes('爱丽丝的纸条'));
});

test('logout drops the session immediately', async t => {
  const url = await withServer(t);
  const cookie = await signIn(url);
  assert.equal((await fetch(url + '/api/logout', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}})).status, 200);
  assert.equal((await fetch(url + '/api/me', {headers: {cookie}})).status, 401);
});

test('a user cannot smuggle in an action the server does not have', async t => {
  const url = await withServer(t);
  const cookie = await signIn(url);
  const res = await fetch(url + '/api/action', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify({type: 'setOffsetDays', offsetDays: 3000})});
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'UNKNOWN_ACTION');
});

test('login failures are rate limited', async t => {
  const url = await withServer(t);
  await signIn(url, 'tester1');
  const attempt = () => fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username: 'tester1', password: 'wrong-password'})});
  for (let i = 0; i < 10; i++) assert.equal((await attempt()).status, 401);
  assert.equal((await attempt()).status, 429, 'the eleventh try must be locked out');
});

// 每个用户名一把锁的话，换着用户名试就永远不会被锁。
test('login throttling counts per IP too, so switching usernames does not dodge it', async t => {
  const url = await withServer(t);
  const attempt = username => fetch(url + '/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({username, password: 'wrong-password'})});
  const seen = [];
  for (let i = 0; i < 40; i++) seen.push((await attempt('ghost_' + i)).status);
  assert(seen.includes(429), 'a run of fresh usernames from one IP must eventually be throttled, saw: ' + [...new Set(seen)].join(','));
});

// 三个演示人物以外的 personId 必须在读状态之前就拒掉：'constructor' 会顺着原型链
// 取到 Object 构造函数（.slice 不是函数），其余无效 id 会在 makeMessages 里抛普通
// Error —— 两条路都汇进外层 catch，变成错误模型承诺不会出现的 500 INTERNAL。
test('an unknown personId on /api/reply is refused, never a 500', async t => {
  const url = await withServer(t, {fetchImpl: async () => new Response(JSON.stringify({choices: [{message: {content: '好'}}]}), {status: 200})});
  const cookie = await signIn(url, 'reply_guard');
  for (const personId of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nobody', '']) {
    const res = await fetch(url + '/api/reply', {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify({personId, context: '打个招呼'})});
    assert.equal(res.status, 400, `personId ${JSON.stringify(personId)} must be a 400`);
    assert.equal((await res.json()).code, 'INVALID_INPUT', `personId ${JSON.stringify(personId)} must not surface INTERNAL`);
  }
});
