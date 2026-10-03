import {randomUUID} from 'node:crypto';
import {ApiError} from './errors.mjs';
import {isCollected,canViewDrawAvatar} from './draw.mjs';

function content(value,max){
 if(typeof value!=='string'||!value.trim()||Array.from(value.trim()).length>max)throw new ApiError(`请输入 1–${max} 字的内容。`);
 return value.trim();
}
function person(db,id){
 const row=db.prepare(`SELECT u.id,u.name,u.allow_notes,m.updated_at AS avatar_version
  FROM users u LEFT JOIN user_media m ON m.user_id=u.id AND m.kind='avatar' WHERE u.id=?`).get(id);
 return row&&{id:row.id,name:row.name,allowNotes:!!row.allow_notes,avatarVersion:row.avatar_version||0};
}
export function conversation(db,userId,id){
 if(typeof id!=='string')throw new ApiError('会话不存在。',404,'NOT_FOUND');
 const row=db.prepare('SELECT * FROM real_conversations WHERE id=? AND (user_a=? OR user_b=?)').get(id,userId,userId);
 if(!row)throw new ApiError('会话不存在。',404,'NOT_FOUND');
 return row;
}
export function canViewAvatar(db,userId,targetId){
 if(userId===targetId)return true;
 if(db.prepare('SELECT 1 FROM real_conversations WHERE (user_a=? AND user_b=?) OR (user_a=? AND user_b=?)').get(userId,targetId,targetId,userId))return true;
 if(db.prepare("SELECT 1 FROM real_notes WHERE status IN ('pending','accepted') AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?)) LIMIT 1").get(userId,targetId,targetId,userId))return true;
 return canViewDrawAvatar(db,userId,targetId);
}
export function realSnapshot(db,userId){
 const notes=db.prepare(`SELECT * FROM real_notes WHERE sender_id=? OR recipient_id=? ORDER BY created_at DESC LIMIT 100`).all(userId,userId)
  .map(n=>({id:n.id,direction:n.sender_id===userId?'out':'in',person:person(db,n.sender_id===userId?n.recipient_id:n.sender_id),text:n.body,status:n.status,at:n.created_at}));
 const conversations=db.prepare(`SELECT * FROM real_conversations WHERE user_a=? OR user_b=? ORDER BY updated_at DESC LIMIT 50`).all(userId,userId)
  .map(row=>({id:row.id,person:person(db,row.user_a===userId?row.user_b:row.user_a),updatedAt:row.updated_at,
   messages:db.prepare('SELECT id,sender_id,body,created_at FROM real_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 50').all(row.id).reverse()
    .map(m=>({id:m.id,role:m.sender_id===userId?'user':'assistant',content:m.body,at:m.created_at}))}));
 return {notes,conversations};
}
export function sendRealNote(db,userId,recipientId,body,now=Date.now()){
 const text=content(body,100);
 if(typeof recipientId!=='string'||recipientId===userId||!isCollected(db,userId,'real',recipientId))throw new ApiError('目前不能给这位用户递纸条。');
 if(!person(db,recipientId)?.allowNotes)throw new ApiError('对方暂不接收陌生人纸条。');
 const [a,b]=[userId,recipientId].sort();
 if(db.prepare('SELECT 1 FROM real_conversations WHERE user_a=? AND user_b=?').get(a,b))throw new ApiError('你们已经可以直接对话。');
 if(db.prepare(`SELECT 1 FROM real_notes WHERE status='pending' AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))`).get(userId,recipientId,recipientId,userId))throw new ApiError('你们之间已有一张待回应的纸条。');
 const day=new Date(now);day.setHours(0,0,0,0);
 if(db.prepare('SELECT COUNT(*) AS n FROM real_notes WHERE sender_id=? AND created_at>=?').get(userId,day.getTime()).n>=2)throw new ApiError('今天已向两位真人递过纸条，请明天再来。');
 const id=randomUUID();db.prepare('INSERT INTO real_notes(id,sender_id,recipient_id,body,status,created_at) VALUES(?,?,?,?,?,?)').run(id,userId,recipientId,text,'pending',now);
 return id;
}
export function respondRealNote(db,userId,noteId,decision,reply,now=Date.now()){
 const note=typeof noteId==='string'?db.prepare('SELECT * FROM real_notes WHERE id=? AND recipient_id=?').get(noteId,userId):null;
 if(!note||note.status!=='pending')throw new ApiError('这张纸条已不能回应。');
 if(!['accept','decline'].includes(decision))throw new ApiError('纸条操作不正确。');
 if(decision==='decline'){db.prepare(`UPDATE real_notes SET status='declined',responded_at=? WHERE id=?`).run(now,note.id);return null}
 const text=content(reply,100),[a,b]=[userId,note.sender_id].sort(),id=randomUUID();
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare(`UPDATE real_notes SET status='accepted',responded_at=? WHERE id=? AND status='pending'`).run(now,note.id);
  db.prepare('INSERT INTO real_conversations(id,user_a,user_b,note_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,a,b,note.id,now,now);
  db.prepare('INSERT INTO real_messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)').run(id,note.sender_id,note.body,note.created_at);
  db.prepare('INSERT INTO real_messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)').run(id,userId,text,now);
  db.exec('COMMIT');return id;
 }catch(error){db.exec('ROLLBACK');throw error}
}
export function sendRealMessage(db,userId,conversationId,body,now=Date.now()){
 const text=content(body,500),row=conversation(db,userId,conversationId);
 const result=db.prepare('INSERT INTO real_messages(conversation_id,sender_id,body,created_at) VALUES(?,?,?,?)').run(row.id,userId,text,now);
 db.prepare('UPDATE real_conversations SET updated_at=? WHERE id=?').run(now,row.id);
 return Number(result.lastInsertRowid);
}
