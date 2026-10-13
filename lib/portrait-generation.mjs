import {randomUUID,createHash} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {PORTRAIT_EMOTIONS} from '../public/portraits.mjs';
import {getMedia,mediaStatus,saveMedia} from './media.mjs';
import {prepareGeneratedPortrait} from './portrait-png.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function portraitPrompt(emotion){
 const label=PORTRAIT_EMOTIONS.find(([id])=>id===emotion)?.[1];
 if(!label)throw new ApiError('请选择有效的情绪。');
 return `Create one visual-novel character sprite based on the supplied reference image. The requested emotion is ${label} (${emotion}).
Keep the SAME character identity, face, age appearance, hairstyle, hair/eye colors, clothing, accessories, proportions, art style and linework. Do not replace the character with a different person.
Show exactly ONE character. Preserve the reference's composition, framing, aspect ratio, pose and position where possible: keep a half-body or bust reference as half-body or bust, and a full-body reference as full-body. Do not invent or extend missing lower-body parts. Change facial expression and only small natural gestures to express the requested emotion.
Use a genuine transparent alpha background, not a white background, not a checkerboard pattern painted into the image. Remove the reference background. No scenery, floor, text, watermark, panels or duplicates. Do not add sexualized details or change age. This should look like another expression of the same character in the original art style, ready to overlay on a game scene.`;
}

async function boundedJson(response){
 let size=0;const chunks=[];
 if(Number(response.headers.get('content-length'))>18_000_000)throw new ApiError('生图结果太大，请重试。',502,'IMAGE_FORMAT');
 for await(const chunk of response.body){size+=chunk.length;if(size>18_000_000)throw new ApiError('生图结果太大，请重试。',502,'IMAGE_FORMAT');chunks.push(chunk)}
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new ApiError('生图返回格式不正确，请重试。',502,'IMAGE_FORMAT')}
}

export function createPortraitGeneration(db,config,{fetchImpl=fetch,timeout=180000}={}){
 const base=config.imageBase||config.base,model=config.imageModel||'gpt-image-2.5-sunburst',key=config.imageKey||config.key;
 const available=!!(config.imageConfigured??config.configured)&&!!base&&!!key;
 let active=0,closed=false;const controllers=new Set();
 db.prepare("UPDATE portrait_generation_jobs SET status='failed',error=?,bytes=NULL WHERE status='running'")
  .run('服务已重启，生成任务已中断；请手动重新生成，不会自动重复扣费。');
 function find(userId,id){
  const row=db.prepare('SELECT * FROM portrait_generation_jobs WHERE id=? AND user_id=?').get(id,userId);
  if(!row)throw new ApiError('生成任务不存在。',404,'NOT_FOUND');return row;
 }
 const publicJob=row=>row?{id:row.id,emotion:row.emotion,status:row.status,error:row.error||'',createdAt:row.created_at,width:row.width,height:row.height}:null;
 function expire(){db.prepare("DELETE FROM portrait_generation_jobs WHERE status<>'running' AND created_at<?").run(Date.now()-7*86400000)}
 function state(userId){expire();return {available,job:publicJob(db.prepare('SELECT * FROM portrait_generation_jobs WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(userId))}}
 async function run(job,reference){
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),timeout);
  try{
   // Reference comes exclusively from the authenticated user's stored default sprite.
   const form=new FormData();
   for(const [name,value] of Object.entries({model,prompt:portraitPrompt(job.emotion),n:'1',size:'auto',quality:'high',background:'transparent',output_format:'png'}))form.set(name,value);
   const extension=reference.mime==='image/jpeg'?'jpg':reference.mime==='image/webp'?'webp':'png';
   form.set('image',new Blob([reference.bytes],{type:reference.mime}),'reference.'+extension);
   const response=await fetchImpl(base.replace(/\/+$/,'')+'/images/edits',{method:'POST',redirect:'error',
    headers:{Authorization:'Bearer '+key},body:form,signal:controller.signal});
   if(!response.ok)throw new ApiError(response.status===401||response.status===403?'生图服务鉴权失败，请联系管理员。':response.status===429?'生图服务额度不足或限流，请稍后手动重试。':'生图服务返回错误，请稍后手动重试。',502,'IMAGE_UPSTREAM');
   const data=await boundedJson(response),encoded=data?.data?.[0]?.b64_json;
   if(typeof encoded!=='string'||encoded.length>16_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new ApiError('生图服务未返回 PNG 图片，请联系管理员检查接口兼容性。',502,'IMAGE_FORMAT');
   const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded)throw new ApiError('生图图片格式无效。',502,'IMAGE_FORMAT');
   const result=prepareGeneratedPortrait(bytes);
   if(!closed)db.prepare("UPDATE portrait_generation_jobs SET status='ready',bytes=?,width=?,height=?,error='' WHERE id=? AND status='running'").run(result.bytes,result.width,result.height,job.id);
  }catch(error){
   if(!closed)db.prepare("UPDATE portrait_generation_jobs SET status='failed',error=?,bytes=NULL WHERE id=? AND status='running'")
    .run(controller.signal.aborted?'生成超时，请稍后手动重试；已有立绘保留。':error instanceof ApiError?error.message:'无法连接生图服务，请稍后手动重试。',job.id);
  }finally{clearTimeout(timer);controllers.delete(controller);active--}
 }
 function start(userId,{emotion,consent,requestId}){
  expire();
  if(consent!==true)throw new ApiError('请确认将默认立绘发送给 AI 服务，并了解生成会消耗额度。');
  if(!/^[a-f0-9-]{36}$/i.test(requestId||''))throw new ApiError('生成请求标识无效。');
  portraitPrompt(emotion);
  const previous=db.prepare('SELECT * FROM portrait_generation_jobs WHERE user_id=? AND request_id=?').get(userId,requestId);
  if(previous){if(previous.emotion!==emotion)throw new ApiError('请求标识已使用，请刷新后再试。',409,'CONFLICT');return publicJob(previous)}
  const pending=db.prepare("SELECT * FROM portrait_generation_jobs WHERE user_id=? AND status IN ('running','ready')").get(userId);
  if(pending)throw new ApiError('请先完成或放弃当前生成结果。',409,'IMAGE_PENDING');
  if(!available)throw new ApiError('生图服务暂不可用，请联系管理员。',503,'NOT_CONFIGURED');
  const reference=getMedia(db,userId,'portrait');
  if(!reference)throw new ApiError('请先上传自己的默认立绘。');
  if(active>=2)throw new ApiError('已有立绘正在生成，请稍后再试。',429,'BUSY');
  const now=Date.now();
  if(db.prepare('SELECT COUNT(*) AS n FROM portrait_generation_jobs WHERE user_id=? AND created_at>?').get(userId,now-86400000).n>=12)throw new ApiError('24 小时内最多生成 12 次，请稍后再来。',429,'RATE_LIMITED');
  db.prepare("DELETE FROM portrait_generation_jobs WHERE status<>'running' AND created_at<?").run(now-7*86400000);
  const job={id:randomUUID(),emotion,status:'running',created_at:now,width:null,height:null};
  const targetVersion=mediaStatus(db,userId).portraitEmotions[emotion]||0;
  db.prepare('INSERT INTO portrait_generation_jobs(id,user_id,request_id,emotion,status,source_hash,target_version,created_at) VALUES(?,?,?,?,?,?,?,?)')
   .run(job.id,userId,requestId,emotion,'running',hash(reference.bytes),targetVersion,now);
  active++;void run(job,reference).catch(()=>{});
  return publicJob(job);
 }
 function apply(userId,id){
  const job=find(userId,id);
  if(job.status==='saved')return {media:mediaStatus(db,userId),...state(userId)};
  if(job.status!=='ready')throw new ApiError('这张立绘尚不能保存。',409,'CONFLICT');
  const current=getMedia(db,userId,'portrait'),version=mediaStatus(db,userId).portraitEmotions[job.emotion]||0;
  if(!current||hash(current.bytes)!==job.source_hash||version!==job.target_version)throw new ApiError('默认立绘或该情绪图片已更换，请放弃旧预览后重新生成。',409,'IMAGE_STALE');
  db.exec('BEGIN IMMEDIATE');
  try{
   saveMedia(db,userId,'portrait','data:image/png;base64,'+Buffer.from(job.bytes).toString('base64'),job.emotion);
   db.prepare("UPDATE portrait_generation_jobs SET status='saved',bytes=NULL WHERE id=?").run(id);db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  return {media:mediaStatus(db,userId),...state(userId)};
 }
 function discard(userId,id){
  const job=find(userId,id);if(job.status==='running')throw new ApiError('请等待当前生成结束。',409,'IMAGE_PENDING');
  if(job.status!=='saved')db.prepare("UPDATE portrait_generation_jobs SET status='discarded',bytes=NULL WHERE id=?").run(id);
  return state(userId);
 }
 function image(userId,id){const job=find(userId,id);if(job.status!=='ready'||!job.bytes)throw new ApiError('预览不存在。',404,'NOT_FOUND');return job.bytes}
 return {available,state,start,apply,discard,image,close(){closed=true;for(const controller of controllers)controller.abort()}};
}
