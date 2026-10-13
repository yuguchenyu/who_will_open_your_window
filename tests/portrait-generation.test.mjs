import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {createServer} from '../server.mjs';
import {saveMedia,mediaStatus} from '../lib/media.mjs';
import {createPortraitGeneration} from '../lib/portrait-generation.mjs';
import {encodePortraitPng,decodePortraitPng,prepareGeneratedPortrait} from '../lib/portrait-png.mjs';
const pixels=Buffer.from([0,0,0,0,10,20,30,255,0,0,0,0,50,60,70,255]);
const png=encodePortraitPng({width:2,height:2,pixels});
const dataUrl='data:image/png;base64,'+png.toString('base64');
const config={configured:true,base:'https://images.example.test/v1',key:'test-only-key'};
function fixture(t,fetchImpl,timeout){const db=openDatabase(':memory:'),a=register(db,{username:'gen_a',password:'password12'}),b=register(db,{username:'gen_b',password:'password12'});saveMedia(db,a.user.id,'avatar',dataUrl);const service=createPortraitGeneration(db,config,{fetchImpl,timeout});t.after(()=>{service.close();db.close()});return {db,a:a.user.id,b:b.user.id,service}}
const input=(emotion='happy')=>({emotion,consent:true,requestId:randomUUID()});
async function finished(service,id){for(let i=0;i<100;i++){const job=service.state(id).job;if(job.status!=='running')return job;await new Promise(r=>setTimeout(r,5))}throw Error('job did not finish')}
test('PNG round trip checks actual alpha, corruption, blank and opaque images',()=>{
 assert.deepEqual(decodePortraitPng(png).pixels,pixels);assert(prepareGeneratedPortrait(png).bytes.length>0);
 const corrupt=Buffer.from(png);corrupt[40]^=1;assert.throws(()=>decodePortraitPng(corrupt));
 for(const alpha of [0,255]){const p=Buffer.from(pixels);for(let i=3;i<p.length;i+=4)p[i]=alpha;assert.throws(()=>prepareGeneratedPortrait(encodePortraitPng({width:2,height:2,pixels:p})),e=>e.code==='IMAGE_ALPHA')}
});
test('generation uses stored own reference, remains a private preview, and saves only on confirmation',async t=>{
 let calls=0;const {db,a,b,service}=fixture(t,async(url,options)=>{calls++;assert.equal(url,config.base+'/images/edits');const body=options.body;assert.equal(body.get('model'),'gpt-image-2.5-sunburst');assert.deepEqual(Buffer.from(await body.get('image').arrayBuffer()),png);assert.equal(body.get('background'),'transparent');assert.equal(body.get('output_format'),'png');return Response.json({data:[{b64_json:png.toString('base64')}]})});
 const request=input(),job=service.start(a,request);assert.equal(service.start(a,request).id,job.id);assert.equal(calls,1);
 assert.throws(()=>service.start(a,input()),e=>e.code==='IMAGE_PENDING');
 assert.equal((await finished(service,a)).status,'ready');assert.equal(mediaStatus(db,a).avatarEmotions.happy,undefined);
 assert.throws(()=>service.image(b,job.id),e=>e.status===404);assert.throws(()=>service.apply(b,job.id),e=>e.status===404);
 assert(decodePortraitPng(Buffer.from(service.image(a,job.id))).pixels[3]===0);
 assert(service.apply(a,job.id).media.avatarEmotions.happy);assert.equal(service.apply(a,job.id).job.status,'saved');
 assert.equal(db.prepare('SELECT bytes FROM portrait_generation_jobs WHERE id=?').get(job.id).bytes,null);
});
test('consent, source image and emotion validation prevent upstream calls',t=>{let calls=0;const {a,b,service}=fixture(t,async()=>{calls++;throw Error('unexpected')});assert.throws(()=>service.start(a,{...input(),consent:false}));assert.throws(()=>service.start(b,input()));assert.throws(()=>service.start(a,input('bad')));assert.equal(calls,0)});
test('changed default or manually uploaded target refuses stale preview',async t=>{const {db,a,service}=fixture(t,async()=>Response.json({data:[{b64_json:png.toString('base64')}]}));const job=service.start(a,input());await finished(service,a);saveMedia(db,a,'avatar',dataUrl,'happy');assert.throws(()=>service.apply(a,job.id),e=>e.code==='IMAGE_STALE');assert.equal(service.discard(a,job.id).job.status,'discarded')});
test('upstream opaque image and timeout fail without overwriting existing images',async t=>{
 const p=Buffer.from(pixels);for(let i=3;i<p.length;i+=4)p[i]=255;
 const {db,a,service}=fixture(t,async()=>Response.json({data:[{b64_json:encodePortraitPng({width:2,height:2,pixels:p}).toString('base64')}]}));saveMedia(db,a,'avatar',dataUrl,'happy');const original=mediaStatus(db,a).avatarEmotions.happy;service.start(a,input());assert.equal((await finished(service,a)).status,'failed');assert.equal(mediaStatus(db,a).avatarEmotions.happy,original);
 const timed=fixture(t,async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('abort')))),10);timed.service.start(timed.a,input());assert.match((await finished(timed.service,timed.a)).error,/超时/);
});
test('restart marks in-flight task failed and aged previews expire',async t=>{const {db,a,service}=fixture(t,async()=>Response.json({data:[{b64_json:png.toString('base64')}]}));const job=service.start(a,input());await finished(service,a);db.prepare('UPDATE portrait_generation_jobs SET created_at=? WHERE id=?').run(Date.now()-8*86400000,job.id);assert.equal(service.state(a).job,null);db.prepare("INSERT INTO portrait_generation_jobs(id,user_id,request_id,emotion,status,source_hash,target_version,created_at) VALUES(?,?,?,'happy','running','hash',0,?)").run(randomUUID(),a,randomUUID(),Date.now());const restarted=createPortraitGeneration(db,config);assert.equal(restarted.state(a).job.status,'failed');restarted.close()});
test('image HTTP endpoints require owner session and never expose credentials',async t=>{
 const db=openDatabase(':memory:'),a=register(db,{username:'http_gen_a',password:'password12'}),b=register(db,{username:'http_gen_b',password:'password12'});saveMedia(db,a.user.id,'avatar',dataUrl);
 const server=createServer(config,{db,fetchImpl:async()=>Response.json({data:[{b64_json:png.toString('base64')}]})});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));db.close()});
 const base=`http://127.0.0.1:${server.address().port}`;
 // Use the production cookie name rather than assuming a separate image login.
 const {COOKIE_NAME}=await import('../lib/auth.mjs');
 const headers=auth=>({'Content-Type':'application/json',cookie:COOKIE_NAME+'='+auth.token});
 assert.equal((await fetch(base+'/api/portraits/generation')).status,401);
 const response=await fetch(base+'/api/portraits/generate',{method:'POST',headers:headers(a),body:JSON.stringify(input())});assert.equal(response.status,202);const result=await response.json();assert(!JSON.stringify(result).includes(config.key));
 let job;for(let i=0;i<100;i++){job=(await (await fetch(base+'/api/portraits/generation',{headers:headers(a)})).json()).job;if(job.status!=='running')break;await new Promise(r=>setTimeout(r,5))}assert.equal(job.status,'ready');
 const url=base+'/api/portraits/generation/'+job.id+'/image';assert.equal((await fetch(url,{headers:headers(b)})).status,404);assert.equal((await fetch(url,{headers:headers(a)})).headers.get('Content-Type'),'image/png');
 assert.equal((await fetch(base+'/api/portraits/apply',{method:'POST',headers:headers(b),body:JSON.stringify({jobId:job.id})})).status,404);
 assert.equal((await fetch(base+'/api/portraits/apply',{method:'POST',headers:headers(a),body:JSON.stringify({jobId:job.id})})).status,200);
});
test('image concurrency is two globally, and rolling daily attempt limit is enforced',async t=>{
 const {db,a,b,service}=fixture(t,async(_url,{signal})=>new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('closed')))));
 const c=register(db,{username:'gen_c',password:'password12'}).user.id;for(const id of [b,c])saveMedia(db,id,'avatar',dataUrl);
 service.start(a,input());service.start(b,input());assert.throws(()=>service.start(c,input()),e=>e.code==='BUSY');
 service.close();db.prepare("UPDATE portrait_generation_jobs SET status='failed'").run();
 const fresh=createPortraitGeneration(db,config);t.after(()=>fresh.close());
 for(let i=0;i<12;i++)db.prepare("INSERT INTO portrait_generation_jobs(id,user_id,request_id,emotion,status,source_hash,target_version,created_at) VALUES(?,?,?,'happy','failed','hash',0,?)").run(randomUUID(),c,randomUUID(),Date.now());
 assert.throws(()=>fresh.start(c,input()),e=>e.code==='RATE_LIMITED');
});
