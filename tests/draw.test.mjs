import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {saveMatchingProfile,storeTags} from '../lib/matching.mjs';
import {draw,decide,remove,drawState,candidates,rarity,drawDay,nextReset,isCollected,seedLegacyCollection} from '../lib/draw.mjs';
import {readState,writeState} from '../lib/state.mjs';
import {runAction} from '../lib/actions.mjs';
import {canViewAvatar,sendRealNote,respondRealNote,sendRealMessage} from '../lib/real-chat.mjs';
import {createServer} from '../server.mjs';
import * as C from '../public/core.mjs';
const now=Date.parse('2026-10-03T12:00:00+08:00');
const intros={selfIntro:'我喜欢自然、音乐和美食，也重视真诚交流。',desiredIntro:'希望遇见温柔、喜欢音乐或者自然的人。'};
const own={selfTags:['真诚','重视沟通','喜欢自然','喜欢音乐','喜欢美食'],desiredTags:['温柔','喜欢音乐','喜欢自然']};
let seq=0;
function user(db,tags=own){const auth=register(db,{username:'draw_test_'+(++seq),password:'password12'});db.prepare('DELETE FROM draw_collection WHERE user_id=?').run(auth.user.id);saveMatchingProfile(db,auth.user.id,intros);storeTags(db,auth.user.id,tags);return auth}
function fixture(t){const db=openDatabase(':memory:');t.after(()=>db.close());return {db,a:user(db)}}
function choose(db,a,id,time=now){const pool=candidates(db,a.user.id,time),index=pool.findIndex(p=>p.id===id);assert(index>=0);const ticket=pool.slice(0,index).reduce((n,p)=>n+p.score,0);return draw(db,a.user.id,time,()=>ticket)}
test('Beijing midnight and tier boundaries are fixed independently of local clock',()=>{
 assert.equal(drawDay(Date.parse('2026-10-03T15:59:59Z')),'2026-10-03');assert.equal(drawDay(Date.parse('2026-10-03T16:00:00Z')),'2026-10-04');assert.equal(nextReset(now),Date.parse('2026-10-04T00:00:00+08:00'));
 for(const [n,tier] of [[60,'blue'],[84,'blue'],[85,'purple'],[94,'purple'],[95,'gold'],[100,'gold']])assert.equal(rarity(n),tier);
});
test('unlimited same-day draws preserve pending results and idempotent decisions',t=>{
 const {db,a}=fixture(t),one=draw(db,a.user.id,now,()=>0);assert.equal(one.remaining,null);assert.equal(one.unlimited,true);
 assert.equal(draw(db,a.user.id,now,()=>100).pending.drawId,one.pending.drawId);
 assert.equal(draw(db,a.user.id,now+86400000).pending.drawId,one.pending.drawId);
 decide(db,a.user.id,one.pending.drawId,'like',now);decide(db,a.user.id,one.pending.drawId,'like',now);
 assert.equal(drawState(db,a.user.id,now).collection.length,1);assert(drawState(db,a.user.id,now).canDraw);
 runAction(db,a.user,'advance',{days:30},now);runAction(db,a.user,'reset',{},now);
 assert.equal(drawState(db,a.user.id,now).remaining,null);assert.equal(drawState(db,a.user.id,now).collection.length,1);
 const two=draw(db,a.user.id,now,()=>0);assert.notEqual(two.pending.drawId,one.pending.drawId);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM draw_records WHERE user_id=? AND day=?').get(a.user.id,drawDay(now)).n,2);
});
test('skip and removal cool down for exactly 30 days and held cards never repeat',t=>{
 const {db,a}=fixture(t);const result=choose(db,a,'lin');decide(db,a.user.id,result.pending.drawId,'skip',now);
 assert(!candidates(db,a.user.id,now+29*86400000).some(p=>p.id==='lin'));assert(candidates(db,a.user.id,now+30*86400000).some(p=>p.id==='lin'));
 const next=choose(db,a,'chen',now+86400000);decide(db,a.user.id,next.pending.drawId,'like',now+86400000);assert(!candidates(db,a.user.id,now+100*86400000).some(p=>p.id==='chen'));
 remove(db,a.user.id,'virtual','chen',now+86400000);assert(!candidates(db,a.user.id,now+30*86400000).some(p=>p.id==='chen'));assert(candidates(db,a.user.id,now+31*86400000).some(p=>p.id==='chen'));
});
test('five same-day likes fill collection and removal allows another draw',t=>{
 const {db,a}=fixture(t);const others=Array.from({length:6},()=>user(db,own));
 for(let i=0;i<5;i++){const at=now,r=choose(db,a,others[i].user.id,at);decide(db,a.user.id,r.pending.drawId,'like',at)}
 const at=now;assert.equal(drawState(db,a.user.id,at).collection.length,5);assert.throws(()=>draw(db,a.user.id,at),e=>e.code==='COLLECTION_FULL');assert.equal(drawState(db,a.user.id,at).remaining,null);
 remove(db,a.user.id,'real',others[0].user.id,at);assert(drawState(db,a.user.id,at).canDraw);assert(draw(db,a.user.id,at).pending);
});
test('empty pool or unprepared profile never uses a chance; only the new cast joins mixed pool',t=>{
 const {db,a}=fixture(t);assert.deepEqual(candidates(db,a.user.id,now).filter(p=>p.kind==='virtual').map(p=>p.id),['lin','chen','tang']);
 storeTags(db,a.user.id,{selfTags:['喜欢科技'],desiredTags:['喜欢游戏']});assert.throws(()=>draw(db,a.user.id,now),e=>e.code==='EMPTY_POOL');assert.equal(drawState(db,a.user.id,now).remaining,null);
 saveMatchingProfile(db,a.user.id,intros);assert.throws(()=>draw(db,a.user.id,now),e=>e.code==='PROFILE_NOT_READY');assert.equal(drawState(db,a.user.id,now).remaining,null);
});
test('weighted selection uses score lengths, excludes closed recipients and hides private expectations',t=>{
 const {db,a}=fixture(t);const b=user(db,own),pool=candidates(db,a.user.id,now);let start=0;
 for(const p of pool){const chosen=draw(db,a.user.id,now,()=>start);assert.equal(chosen.pending.person.id,p.id);assert(!('desiredTags' in chosen.pending.person));assert(!('persona' in chosen.pending.person));db.prepare('DELETE FROM draw_records WHERE user_id=?').run(a.user.id);start+=p.score;}
 db.prepare('UPDATE users SET allow_notes=0 WHERE id=?').run(b.user.id);assert(!candidates(db,a.user.id,now).some(p=>p.id===b.user.id));
});
test('new virtual characters require collecting; old demo characters and previous contacts remain usable',t=>{
 const {db,a}=fixture(t);assert.throws(()=>runAction(db,a.user,'sendNote',{personId:'lin',text:'你好'}),e=>e.code==='NOT_COLLECTED');assert.throws(()=>runAction(db,a.user,'injectNote',{personId:'lin'}),e=>e.code==='NOT_COLLECTED');
 runAction(db,a.user,'sendNote',{personId:'xia',text:'你好'});
 const r=choose(db,a,'lin');decide(db,a.user.id,r.pending.drawId,'like',now);const sent=runAction(db,a.user,'sendNote',{personId:'lin',text:'很高兴认识你'});C.startNoteReply(sent.state,sent.result.id);C.finishReply(sent.state,'lin','你好');writeState(db,a.user.id,sent.state);
 remove(db,a.user.id,'virtual','lin',now);assert.doesNotThrow(()=>runAction(db,a.user,'sendMessage',{personId:'lin',text:'继续聊聊'}));
});
test('real portrait is available only after drawing; saved eligibility survives score changes and chat survives removal',t=>{
 const {db,a}=fixture(t),b=user(db,own);assert(!canViewAvatar(db,a.user.id,b.user.id));assert.throws(()=>sendRealNote(db,a.user.id,b.user.id,'你好',now));
 const r=choose(db,a,b.user.id);assert(canViewAvatar(db,a.user.id,b.user.id));assert.throws(()=>sendRealNote(db,a.user.id,b.user.id,'你好',now));decide(db,a.user.id,r.pending.drawId,'like',now);
 storeTags(db,b.user.id,{selfTags:['喜欢科技'],desiredTags:['喜欢游戏']});assert(isCollected(db,a.user.id,'real',b.user.id));const note=sendRealNote(db,a.user.id,b.user.id,'你好',now);const chat=respondRealNote(db,b.user.id,note,'accept','很高兴认识你',now);remove(db,a.user.id,'real',b.user.id,now);assert.doesNotThrow(()=>sendRealMessage(db,a.user.id,chat,'继续交流',now));assert(canViewAvatar(db,a.user.id,b.user.id));
});
test('old saved states gain only the new cast slots without losing history or accepting old damage',t=>{
 const {db,a}=fixture(t),s=readState(db,a.user.id);C.sendNote(s,'xia','保留记录');for(const p of C.DRAW_PEOPLE){delete s.messages[p.id];delete s.scenarios[p.id]}db.prepare('UPDATE states SET json=? WHERE user_id=?').run(JSON.stringify(s),a.user.id);
 const migrated=readState(db,a.user.id);assert.equal(migrated.notes[0].text,'保留记录');assert(C.validState(migrated));delete s.messages.xia;db.prepare('UPDATE states SET json=? WHERE user_id=?').run(JSON.stringify(s),a.user.id);assert.throws(()=>readState(db,a.user.id),/损坏/);
});
test('concurrent API requests share one result and cannot decide another account’s draw',async t=>{
 const db=openDatabase(':memory:'),a=user(db),b=user(db);const server=createServer({configured:false},{db});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(()=>{db.close();r()})}));const base=`http://127.0.0.1:${server.address().port}`;
 const post=(auth,path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',cookie:'hw_session='+auth.token},body:JSON.stringify(body)});
 const results=await Promise.all(Array.from({length:8},async()=>{const res=await post(a,'/api/draw',{});assert.equal(res.status,200);return res.json()}));assert.equal(new Set(results.map(r=>r.pending.drawId)).size,1);
 const id=results[0].pending.drawId;assert.equal((await post(b,'/api/draw/decision',{drawId:id,decision:'like'})).status,404);
 await Promise.all([post(a,'/api/draw/decision',{drawId:id,decision:'like'}),post(a,'/api/draw/decision',{drawId:id,decision:'like'})]);assert.equal(drawState(db,a.user.id).collection.length,1);assert.equal(drawState(db,b.user.id).collection.length,0);
 assert.equal((await fetch(base+'/api/draw')).status,401);assert.equal((await post(b,'/api/suggestions',{personId:'lin'})).status,403);
});

test('original cast starts in three collection slots without consuming quota and never refills on refresh',t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());const a=register(db,{username:'original_cast',password:'password12'});
 let state=drawState(db,a.user.id,now);assert.deepEqual(state.collection.map(p=>p.id),['xia','yu','ning']);assert(state.collection.every(p=>p.score===null&&p.tier==='legacy'));assert.equal(state.remaining,null);
 remove(db,a.user.id,'virtual','xia',now);seedLegacyCollection(db,a.user.id,now);state=drawState(db,a.user.id,now);assert.equal(state.collection.length,2);assert(!state.collection.some(p=>p.id==='xia'));assert.equal(state.remaining,null);
});
test('existing favorites are preserved and only available slots receive the original cast',t=>{
 const {db,a}=fixture(t);
 for(let i=0;i<3;i++){const b=user(db),card={id:b.user.id,name:b.user.name,kind:'real',score:100,tier:'gold',sharedTags:[],selfIntro:'保留原有收藏'};db.prepare('INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)').run(a.user.id,'real',b.user.id,JSON.stringify(card),i)}
 db.prepare('DELETE FROM draw_onboarding WHERE user_id=?').run(a.user.id);seedLegacyCollection(db,a.user.id,now);const state=drawState(db,a.user.id,now);assert.equal(state.collection.length,5);assert.equal(state.collection.filter(p=>p.kind==='real').length,3);assert.deepEqual(state.collection.filter(p=>p.kind==='virtual').map(p=>p.id),['xia','yu']);assert(!state.canDraw);
});

test('explicit test preferences produce blue Lin, purple Chen and gold Tang with the real formula',t=>{
 const {db,a}=fixture(t);storeTags(db,a.user.id,{selfTags:['真诚','重视沟通','喜欢音乐','喜欢美食'],desiredTags:['真诚','重视沟通','有耐心','喜欢美食']});
 const pool=candidates(db,a.user.id,now).filter(p=>p.kind==='virtual');assert.deepEqual(pool.map(p=>[p.id,p.score,p.tier]),[['lin',71,'blue'],['chen',88,'purple'],['tang',100,'gold']]);
 for(const p of C.DRAW_PEOPLE)assert(p.selfTags.length<=8);
});


test('old daily-unique database migrates without losing pending results or collections',t=>{
 const dir=mkdtempSync(join(tmpdir(),'window-draw-')),file=join(dir,'app.db');t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let db=openDatabase(file);const a=user(db);const one=choose(db,a,'lin');decide(db,a.user.id,one.pending.drawId,'like',now);
 const two=choose(db,a,'chen',now+86400000);
 const schema=db.prepare("SELECT sql FROM sqlite_master WHERE name='draw_records'").get().sql;
 db.exec('BEGIN IMMEDIATE');db.exec(schema.replace('draw_records','draw_records_old').replace(/\)$/,', UNIQUE(user_id,day))'));
 db.exec(`INSERT INTO draw_records_old SELECT * FROM draw_records; DROP TABLE draw_records; ALTER TABLE draw_records_old RENAME TO draw_records; CREATE UNIQUE INDEX draw_one_pending ON draw_records(user_id) WHERE status='pending'; COMMIT`);db.close();
 db=openDatabase(file);assert.equal(drawState(db,a.user.id,now+86400000).pending.drawId,two.pending.drawId);assert.equal(drawState(db,a.user.id,now).collection[0].id,'lin');
 decide(db,a.user.id,two.pending.drawId,'skip',now+86400000);const three=choose(db,a,'tang',now+86400000);assert.notEqual(three.pending.drawId,two.pending.drawId);db.close();
 db=openDatabase(file);assert.equal(drawState(db,a.user.id,now+86400000).pending.drawId,three.pending.drawId);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});
