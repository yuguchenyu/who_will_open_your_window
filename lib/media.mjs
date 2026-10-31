/**
 * 账号头像、聊天立绘与背景图片的校验和存取。
 * 头像及背景存入 user_media，默认与情绪立绘独立存入 user_sprites。
 */

import {PORTRAIT_EMOTIONS} from '../public/portraits.mjs';
import {ApiError} from './errors.mjs';

// 头像和立绘各限 2 MB，背景限 3 MB；同一限制同时约束编码和解码检查。
const MAX_BYTES={avatar:2_000_000,portrait:2_000_000,background:3_000_000};
const MIME={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'};

/**
 * 校验用途、Data URL、Base64 编码与实际文件签名。
 * 编码长度和解码后的字节数都有限制，声明的 MIME 必须与图片内容一致。
 */
export function validateMedia(kind,dataUrl){
 if(!Object.hasOwn(MAX_BYTES,kind))throw new ApiError('图片用途不正确。');
 if(typeof dataUrl!=='string')throw new ApiError('请选择图片文件。');
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
 if(!match)throw new ApiError('只支持 PNG、JPEG 或 WebP 图片。');
 if(match[2].length>Math.ceil(MAX_BYTES[kind]/3)*4+4)throw new ApiError('图片太大，请压缩后重试。',413,'TOO_LARGE');
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length||bytes.length>MAX_BYTES[kind]||bytes.toString('base64')!==match[2])throw new ApiError('图片内容无效或太大。',413,'TOO_LARGE');
 const type=match[1];

 // 文件签名用于核对声明格式；这里不执行 PNG 像素解码，生成结果另有严格处理。
 const valid=type===MIME.png?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
  type===MIME.jpeg?bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217:
  bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid)throw new ApiError('图片格式与内容不一致。');
 return {mime:type,bytes};
}

/**
 * 检查媒体用途与情绪编号是否能够组合使用。
 * 头像和背景只允许 default，情绪变体只属于个人立绘。
 */
function validateEmotion(kind,emotion){
 if(emotion!=='default'&&(kind!=='portrait'||!PORTRAIT_EMOTIONS.some(([id])=>id===emotion)))throw new ApiError('只有个人立绘可以设置情绪。');
}

/**
 * 将校验后的图片写入对应媒体表，已有记录则替换。
 * 立绘版本至少递增一，避免同一毫秒替换导致前端继续使用旧缓存。
 */
export function saveMedia(db,userId,kind,dataUrl,emotion='default'){
 validateEmotion(kind,emotion);
 const {mime,bytes}=validateMedia(kind,dataUrl);
 if(kind==='portrait'){
  db.prepare(`INSERT INTO user_sprites(user_id,emotion,mime,bytes,updated_at) VALUES(?,?,?,?,?)
   ON CONFLICT(user_id,emotion) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,updated_at=MAX(excluded.updated_at,user_sprites.updated_at+1)`)
   .run(userId,emotion,mime,bytes,Date.now());return;
 }
 db.prepare(`INSERT INTO user_media(user_id,kind,mime,bytes,updated_at) VALUES(?,?,?,?,?)
  ON CONFLICT(user_id,kind) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,updated_at=excluded.updated_at`)
  .run(userId,kind,mime,bytes,Date.now());
}

/**
 * 按当前账号、用途及情绪删除单张媒体记录。
 * 默认立绘和不同情绪分别存储，不在此处连带删除其他资源。
 */
export function deleteMedia(db,userId,kind,emotion='default'){
 validateEmotion(kind,emotion);
 if(kind==='portrait'){db.prepare('DELETE FROM user_sprites WHERE user_id=? AND emotion=?').run(userId,emotion);return;}
 if(!Object.hasOwn(MAX_BYTES,kind))throw new ApiError('图片用途不正确。');
 db.prepare('DELETE FROM user_media WHERE user_id=? AND kind=?').run(userId,kind);
}

/**
 * 只汇总资源存在状态与版本号，不返回图片二进制。
 * 页面按这些字段生成图片地址，并决定哪些上传、移除入口可用。
 */
export function mediaStatus(db,userId){
 const rows=db.prepare('SELECT kind,updated_at FROM user_media WHERE user_id=?').all(userId);
 const avatar=rows.find(row=>row.kind==='avatar'),background=rows.find(row=>row.kind==='background');
 const portraits=db.prepare('SELECT emotion,updated_at FROM user_sprites WHERE user_id=?').all(userId);
 const portraitVersion=portraits.find(p=>p.emotion==='default')?.updated_at||0;
 const portraitEmotions=Object.fromEntries(portraits.filter(p=>p.emotion!=='default').map(row=>[row.emotion,row.updated_at]));
 return {portraitEmotions,portrait:!!portraitVersion,portraitVersion,avatar:!!avatar,background:!!background,avatarVersion:avatar?.updated_at||0,backgroundVersion:background?.updated_at||0};
}

/**
 * 读取账号指定媒体；情绪立绘缺失时可回退默认立绘。
 * 权限校验由路由层完成，本函数仅负责正确选择存储位置和资源。
 */
export function getMedia(db,userId,kind,emotion='default'){
 validateEmotion(kind,emotion);
 if(kind==='portrait'){
  return db.prepare('SELECT mime,bytes,updated_at FROM user_sprites WHERE user_id=? AND emotion=?').get(userId,emotion)
   ||(emotion!=='default'?db.prepare("SELECT mime,bytes,updated_at FROM user_sprites WHERE user_id=? AND emotion='default'").get(userId):undefined);
 }
 if(!Object.hasOwn(MAX_BYTES,kind))throw new ApiError('图片用途不正确。');
 return db.prepare('SELECT mime,bytes,updated_at FROM user_media WHERE user_id=? AND kind=?').get(userId,kind);
}
