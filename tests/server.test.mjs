import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import * as serverApi from '../server.mjs';
import {createServer,makeMessages,parseSuggestions,completion,readConfig} from '../server.mjs';
const listenHost=opts=>serverApi.listenHost(opts);
const config={configured:true,base:'https://example.invalid/v1',key:'TEST_SECRET_NOT_FOR_BROWSER',model:'test-model'};
const suggestions={suggestions:[{label:'关心',text:'今天过得怎么样？'},{label:'接话',text:'很高兴听你分享。'},{label:'了解',text:'你喜欢怎样度过周末？'}]};
const profile={name:'安',habit:'慢热',topic:'今天如何'};
async function withServer(t,options={}){const server=createServer(config,options);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));return `http://127.0.0.1:${server.address().port}`}
test('private data is excluded from upstream messages',()=>{const body={personId:'xia',messages:[],profile,feelings:{xia:99},reviews:{secret:true},confirmations:['private'],context:'greeting'};const built=JSON.stringify(makeMessages(body,'reply'));assert(!built.includes('99'));assert(!built.includes('secret'));assert(!built.includes('private'));assert(!built.includes(config.key))});
test('suggestion validation',()=>{assert.equal(parseSuggestions(JSON.stringify(suggestions)).length,3);assert.equal(parseSuggestions('```json\n'+JSON.stringify(suggestions)+'\n```').length,3);assert.throws(()=>parseSuggestions('{}'));assert.throws(()=>parseSuggestions('{broken'));assert.throws(()=>makeMessages({personId:'unknown',messages:[]},'reply'))});
test('HTTP route protections, static files and secret exclusion',async t=>{const url=await withServer(t);const status=await(await fetch(url+'/api/status')).text();assert(status.includes('test-model'));assert(!status.includes(config.key));assert.equal((await fetch(url+'/.env')).status,404);assert.equal((await fetch(url+'/server.mjs')).status,404);assert.equal((await fetch(url+'/')).status,200);const cross=await fetch(url+'/api/check',{method:'POST',headers:{Origin:'https://other.example','Content-Type':'application/json'},body:'{}'});assert.equal(cross.status,403);assert.equal((await fetch(url+'/api/check',{method:'POST',body:'{}'})).status,403)});
test('mock upstream validates authorization and successful API flows',async t=>{let sent;const url=await withServer(t,{fetchImpl:async(u,opt)=>{sent={u,opt};return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(suggestions)}}]}),{status:200})}});const r=await fetch(url+'/api/suggestions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({personId:'xia',messages:[],profile})});assert.equal(r.status,200);assert.equal((await r.json()).suggestions.length,3);assert.equal(sent.u,config.base+'/chat/completions');assert.equal(sent.opt.headers.Authorization,'Bearer '+config.key)});
// --- LAN access (ALLOW_LAN) -------------------------------------------------
const lanIps=Object.values(os.networkInterfaces()).flat().filter(i=>i&&i.family==='IPv4'&&!i.internal).map(i=>i.address);
function rawRequest(port,pathname,{method='GET',headers={},body,connectTo='127.0.0.1',localAddress}={}){
 return new Promise((resolve,reject)=>{
  const req=http.request({host:connectTo,port,path:pathname,method,headers,localAddress},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>resolve({status:res.statusCode,body:text}))});
  req.on('error',reject);if(body)req.write(body);req.end();
 });
}
async function withLanServer(t,overrides={},listenOn='127.0.0.1'){
 const server=createServer({...config,...overrides},{fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'连接成功'}}]}),{status:200})});
 await new Promise(r=>server.listen(0,listenOn,r));
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r)}));
 return server.address().port;
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
 const refused=await rawRequest(off,'/api/check',{method:'POST',headers:{...json,host:`127.0.0.1:${off}`,Origin:`http://${lanIps[0]}:${off}`},body:'{}'});
 assert.equal(refused.status,403);
 const on=await withLanServer(t,{lan:true});
 const allowed=await rawRequest(on,'/api/check',{method:'POST',headers:{...json,host:`${lanIps[0]}:${on}`,Origin:`http://${lanIps[0]}:${on}`},body:'{}'});
 assert.equal(allowed.status,200);
 assert.equal(JSON.parse(allowed.body).ok,true);
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
