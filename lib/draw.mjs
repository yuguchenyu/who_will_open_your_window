import {randomUUID,randomInt} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {matchingProfile,matchScore} from './matching.mjs';
import {readState} from './state.mjs';
import {DRAW_PEOPLE,PEOPLE,LEGACY_IDS} from '../public/core.mjs';
export const CAPACITY=5;
const COOLDOWN=30*86400000;
export const drawDay=now=>new Date(now+8*3600000).toISOString().slice(0,10);
export const nextReset=now=>Date.parse(drawDay(now)+'T00:00:00+08:00')+86400000;
export const rarity=score=>score>=95?'gold':score>=85?'purple':'blue';
// Called within the startup/registration transaction once per account. Never refill removed slots.
export function seedLegacyCollection(db,userId,now=Date.now()){
 if(db.prepare('SELECT 1 FROM draw_onboarding WHERE user_id=?').get(userId))return;
 let count=db.prepare('SELECT COUNT(*) AS n FROM draw_collection WHERE user_id=?').get(userId).n;
 for(const id of LEGACY_IDS){
  if(count>=CAPACITY)break;
  if(isCollected(db,userId,'virtual',id))continue;
  const p=PEOPLE.find(p=>p.id===id),{persona,...card}=p;
  const snapshot={...card,kind:'virtual',source:'legacy',score:null,tier:'legacy',selfIntro:p.habit,sharedTags:p.interests};
  db.prepare('INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)').run(userId,'virtual',id,JSON.stringify(snapshot),now+LEGACY_IDS.indexOf(id));count++;
 }
 db.prepare('INSERT INTO draw_onboarding(user_id) VALUES(?)').run(userId);
}
export function isCollected(db,userId,kind,personId){return !!db.prepare('SELECT 1 FROM draw_collection WHERE user_id=? AND kind=? AND person_id=?').get(userId,kind,personId)}
export function canViewDrawAvatar(db,userId,personId){return isCollected(db,userId,'real',personId)||!!db.prepare("SELECT 1 FROM draw_records WHERE user_id=? AND kind='real' AND person_id=? AND status='pending'").get(userId,personId)}
function hydrate(db,snapshot){
 const p=JSON.parse(snapshot);
 if(p.kind==='real'){
  const user=db.prepare('SELECT name FROM users WHERE id=?').get(p.id);
  p.name=user?.name||'已离开的用户';p.unavailable=!user;
  p.avatarVersion=db.prepare("SELECT updated_at FROM user_media WHERE user_id=? AND kind='avatar'").get(p.id)?.updated_at||0;
 }
 return p;
}
export function collection(db,userId){return db.prepare('SELECT * FROM draw_collection WHERE user_id=? ORDER BY added_at,kind,person_id').all(userId).map(row=>hydrate(db,row.snapshot))}
export function candidates(db,userId,now=Date.now()){
 const own=matchingProfile(db,userId);if(own?.status!=='ready')return [];
 const state=readState(db,userId);
 const real=db.prepare(`SELECT u.id,u.name,m.self_intro,m.self_tags,m.desired_tags FROM matching_profiles m JOIN users u ON u.id=m.user_id
 WHERE m.status='ready' AND u.id<>? AND u.allow_notes=1
 AND NOT EXISTS(SELECT 1 FROM real_conversations c WHERE (c.user_a=? AND c.user_b=u.id) OR (c.user_b=? AND c.user_a=u.id))
 AND NOT EXISTS(SELECT 1 FROM real_notes n WHERE n.status='pending' AND ((n.sender_id=? AND n.recipient_id=u.id) OR (n.recipient_id=? AND n.sender_id=u.id)))`).all(userId,userId,userId,userId,userId)
 .map(p=>({id:p.id,name:p.name,kind:'real',selfIntro:p.self_intro,selfTags:JSON.parse(p.self_tags),desiredTags:JSON.parse(p.desired_tags)}));
 const virtual=DRAW_PEOPLE.filter(p=>!state.blocked.includes(p.id)).map(p=>({...p,kind:'virtual',selfIntro:p.habit}));
 const held=new Set(collection(db,userId).map(p=>p.kind+':'+p.id));
 const cooling=new Set(db.prepare('SELECT kind,person_id FROM draw_cooldowns WHERE user_id=? AND until_at>?').all(userId,now).map(p=>p.kind+':'+p.person_id));
 return [...real,...virtual].map(p=>{
  const score=matchScore(own,p);
  // Do not send the other person's desired tags or private descriptions to the browser.
  const {selfTags,desiredTags,persona,...card}=p;
  return {...card,score,tier:rarity(score),sharedTags:own.desiredTags.filter(t=>selfTags.includes(t))};
 }).filter(p=>p.score>=60&&!held.has(p.kind+':'+p.id)&&!cooling.has(p.kind+':'+p.id));
}
export function drawState(db,userId,now=Date.now()){
 const pending=db.prepare("SELECT * FROM draw_records WHERE user_id=? AND status='pending'").get(userId);
 const cards=collection(db,userId),ready=matchingProfile(db,userId)?.status==='ready';
 const reason=pending?'请先决定这次相遇。':cards.length>=CAPACITY?'收藏已满，请先移除一位再抽取。':!ready?'请先完成匹配资料和标签提取。':!candidates(db,userId,now).length?'暂时没有新的合适人选。':'';
 return {remaining:null,unlimited:true,canDraw:!reason,reason,nextReset:null,capacity:CAPACITY,collection:cards,pending:pending?{drawId:pending.id,person:hydrate(db,pending.snapshot)}:null};
}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(e){db.exec('ROLLBACK');throw e}}
export function draw(db,userId,now=Date.now(),pick=total=>randomInt(total)){
 transaction(db,()=>{
  // 重复请求复用尚未决定的结果，决定后可以继续抽取。
  if(db.prepare("SELECT 1 FROM draw_records WHERE user_id=? AND status='pending'").get(userId))return;
  if(collection(db,userId).length>=CAPACITY)throw new ApiError('收藏已满，请先移除一位再抽取。',409,'COLLECTION_FULL');
  if(matchingProfile(db,userId)?.status!=='ready')throw new ApiError('请先完成匹配资料和标签提取。',409,'PROFILE_NOT_READY');
  const pool=candidates(db,userId,now);if(!pool.length)throw new ApiError('暂时没有新的合适人选。',409,'EMPTY_POOL');
  const total=pool.reduce((n,p)=>n+p.score,0);let ticket=pick(total),chosen=pool.at(-1);
  for(const p of pool){ticket-=p.score;if(ticket<0){chosen=p;break}}
  db.prepare('INSERT INTO draw_records(id,user_id,day,kind,person_id,snapshot,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),userId,drawDay(now),chosen.kind,chosen.id,JSON.stringify(chosen),now);
 });return drawState(db,userId,now);
}
function cooldown(db,userId,kind,personId,now){db.prepare('INSERT INTO draw_cooldowns(user_id,kind,person_id,until_at) VALUES(?,?,?,?) ON CONFLICT(user_id,kind,person_id) DO UPDATE SET until_at=excluded.until_at').run(userId,kind,personId,now+COOLDOWN)}
export function decide(db,userId,drawId,decision,now=Date.now()){
 if(!['like','skip'].includes(decision))throw new ApiError('请选择喜欢或不喜欢。');
 transaction(db,()=>{
  const row=typeof drawId==='string'?db.prepare('SELECT * FROM draw_records WHERE id=? AND user_id=?').get(drawId,userId):null;
  if(!row)throw new ApiError('抽取结果不存在。',404,'NOT_FOUND');
  if(row.status!=='pending')return;
  if(decision==='like'){
   if(collection(db,userId).length>=CAPACITY)throw new ApiError('收藏已满，请先移除一位。',409,'COLLECTION_FULL');
   if(hydrate(db,row.snapshot).unavailable)throw new ApiError('这位用户已离开，请跳过本次结果。',409,'UNAVAILABLE');
   db.prepare('INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)').run(userId,row.kind,row.person_id,row.snapshot,now);
  }else cooldown(db,userId,row.kind,row.person_id,now);
  db.prepare('UPDATE draw_records SET status=? WHERE id=?').run(decision==='like'?'liked':'skipped',row.id);
 });return drawState(db,userId,now);
}
export function remove(db,userId,kind,personId,now=Date.now()){
 if(!['real','virtual'].includes(kind)||typeof personId!=='string')throw new ApiError('收藏对象不正确。');
 transaction(db,()=>{const result=db.prepare('DELETE FROM draw_collection WHERE user_id=? AND kind=? AND person_id=?').run(userId,kind,personId);if(result.changes)cooldown(db,userId,kind,personId,now)});
 return drawState(db,userId,now);
}
