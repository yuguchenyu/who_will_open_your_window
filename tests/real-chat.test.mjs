import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {saveMatchingProfile,storeTags} from '../lib/matching.mjs';
import {createServer} from '../server.mjs';

const tags={selfTags:['喜欢阅读','真诚'],desiredTags:['喜欢运动','温柔']};
const reverse={selfTags:['喜欢运动','温柔'],desiredTags:['喜欢阅读','真诚']};
const guidance={interpretations:[{intent:'想继续聊',confidence:50,reason:'主动提问。'},{intent:'礼貌接话',confidence:30,reason:'语气平和。'},{intent:'尚不确定',confidence:20,reason:'还需要更多上下文。'}],suggestions:[{label:'回应',text:'我也喜欢。'},{label:'确认',text:'你更喜欢哪种？'},{label:'分享',text:'说说我的想法。'}]};

test('matched users can exchange a note and chat while strangers cannot',async t=>{
 const db=openDatabase(':memory:');
 const a=register(db,{username:'real_a',password:'password12'}),b=register(db,{username:'real_b',password:'password12'}),c=register(db,{username:'real_c',password:'password12'});
 for(const x of [a,b,c])saveMatchingProfile(db,x.user.id,{selfIntro:'我喜欢阅读与散步，也重视真诚交流。',desiredIntro:'希望遇见认真交流、分享生活的人。'});
 storeTags(db,a.user.id,tags);storeTags(db,b.user.id,reverse);storeTags(db,c.user.id,{selfTags:['喜欢游戏'],desiredTags:['喜欢旅行']});
 let upstream='';const server=createServer({configured:true,base:'https://test.invalid/v1',key:'TEST',model:'test'},
  {db,fetchImpl:async(_url,opt)=>{upstream=JSON.stringify(JSON.parse(opt.body).messages);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(guidance)}}]}),{status:200})}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const base=`http://127.0.0.1:${server.address().port}`,cookie=x=>'hw_session='+x.token;
 const post=(x,path,body)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',cookie:cookie(x)},body:JSON.stringify(body)});
 const get=(x,path)=>fetch(base+path,{headers:{cookie:cookie(x)}});
 assert.equal((await post(a,'/api/real/note',{recipientId:c.user.id,text:'你好。'})).status,400);
 assert.equal((await post(a,'/api/real/note',{recipientId:b.user.id,text:'先收藏才能递纸条。'})).status,400);
 const drawn=await (await post(a,'/api/draw',{})).json();
 assert.equal(drawn.pending.person.id,b.user.id);
 assert.equal((await post(a,'/api/draw/decision',{drawId:drawn.pending.drawId,decision:'like'})).status,200);
 assert.equal((await post(a,'/api/real/note',{recipientId:b.user.id,text:'你好，我们都喜欢散步吗？'})).status,200);
 assert.equal((await post(a,'/api/real/note',{recipientId:b.user.id,text:'重复。'})).status,400);
 const incoming=await(await get(b,'/api/real')).json(),note=incoming.notes[0];
 assert.equal(note.person.id,a.user.id);assert.equal(note.direction,'in');
 assert.equal((await post(c,'/api/real/respond',{noteId:note.id,decision:'accept',text:'你好'})).status,400);
 const accepted=await post(b,'/api/real/respond',{noteId:note.id,decision:'accept',text:'你好，我也喜欢散步。'});
 assert.equal(accepted.status,200);const conversationId=(await accepted.json()).conversationId;
 assert(conversationId);
 assert.equal((await post(c,'/api/real/message',{conversationId,text:'偷看'})).status,404);
 assert.equal((await post(a,'/api/real/message',{conversationId,text:'周末一起聊聊散步路线？'})).status,200);
 assert.equal((await post(b,'/api/real/message',{conversationId,text:'好呀，你喜欢哪条路线？'})).status,200);
 const snapshot=await(await get(a,'/api/real')).json(),chat=snapshot.conversations[0];
 assert.equal(chat.messages.length,4);assert.equal(chat.messages.at(-1).role,'assistant');
 assert(chat.messages.every(m=>Number.isFinite(m.at)));
 const result=await post(a,'/api/guidance',{conversationId,messageId:chat.messages.at(-1).id,messages:[{content:'FORGED_PRIVATE'}]});
 assert.equal(result.status,200);assert.equal((await result.json()).suggestions.length,3);
 assert(!upstream.includes('FORGED_PRIVATE'));
 assert.equal((await post(c,'/api/guidance',{conversationId,messageId:chat.messages.at(-1).id})).status,404);
});
