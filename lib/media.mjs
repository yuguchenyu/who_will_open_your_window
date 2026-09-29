import {ApiError} from './errors.mjs';

const MAX_BYTES={avatar:2_000_000,background:3_000_000};
const MIME={png:'image/png',jpeg:'image/jpeg',webp:'image/webp'};

export function validateMedia(kind,dataUrl){
 if(!Object.hasOwn(MAX_BYTES,kind))throw new ApiError('图片用途不正确。');
 if(typeof dataUrl!=='string')throw new ApiError('请选择图片文件。');
 const match=/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
 if(!match)throw new ApiError('只支持 PNG、JPEG 或 WebP 图片。');
 if(match[2].length>Math.ceil(MAX_BYTES[kind]/3)*4+4)throw new ApiError('图片太大，请压缩后重试。',413,'TOO_LARGE');
 const bytes=Buffer.from(match[2],'base64');
 if(!bytes.length||bytes.length>MAX_BYTES[kind]||bytes.toString('base64')!==match[2])throw new ApiError('图片内容无效或太大。',413,'TOO_LARGE');
 const type=match[1];
 const valid=type===MIME.png?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
  type===MIME.jpeg?bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217:
  bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!valid)throw new ApiError('图片格式与内容不一致。');
 return {mime:type,bytes};
}

export function saveMedia(db,userId,kind,dataUrl){
 const {mime,bytes}=validateMedia(kind,dataUrl);
 db.prepare(`INSERT INTO user_media(user_id,kind,mime,bytes,updated_at) VALUES(?,?,?,?,?)
  ON CONFLICT(user_id,kind) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,updated_at=excluded.updated_at`)
  .run(userId,kind,mime,bytes,Date.now());
}
export function deleteMedia(db,userId,kind){
 if(!Object.hasOwn(MAX_BYTES,kind))throw new ApiError('图片用途不正确。');
 db.prepare('DELETE FROM user_media WHERE user_id=? AND kind=?').run(userId,kind);
}
export function mediaStatus(db,userId){
 const kinds=db.prepare('SELECT kind FROM user_media WHERE user_id=?').all(userId).map(row=>row.kind);
 return {avatar:kinds.includes('avatar'),background:kinds.includes('background')};
}
export function getMedia(db,userId,kind){
 if(!Object.hasOwn(MAX_BYTES,kind))throw new ApiError('图片用途不正确。');
 return db.prepare('SELECT mime,bytes,updated_at FROM user_media WHERE user_id=? AND kind=?').get(userId,kind);
}
