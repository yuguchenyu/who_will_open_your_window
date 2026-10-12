import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
import {portraitEmotion,portraitSelection,PORTRAIT_EMOTIONS} from '../public/portraits.mjs';
import {validateMedia} from '../lib/media.mjs';

const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII=';
test('uploaded images are validated by content and size',()=>{
 assert.equal(validateMedia('avatar',png).mime,'image/png');
 assert.throws(()=>validateMedia('avatar',png.replace('image/png','image/jpeg')));
 assert.throws(()=>validateMedia('avatar','data:image/svg+xml;base64,PHN2Zz4='));
 assert.throws(()=>validateMedia('avatar','data:image/png;base64,'+'A'.repeat(3_000_000)));
});
test('media belongs to the account and can be replaced or removed',async t=>{
 const server=createServer({configured:false,dbPath:':memory:'},{db:openDatabase(':memory:')});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const register=async username=>{
  const response=await fetch(base+'/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'password12',selfIntro:'喜欢看书和散步，也希望能好好交流。',desiredIntro:'希望遇见愿意分享生活的人。',shareForMatching:true})});
  assert.equal(response.status,200);
  return {cookie:response.headers.getSetCookie()[0].split(';')[0],id:(await response.json()).user.id};
 };
 const a=await register('media_a'),b=await register('media_b');
 const post=(cookie,body)=>fetch(base+'/api/media',{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify(body)});
 assert.equal((await post('',{action:'save',kind:'avatar',data:png})).status,401);
 assert.equal((await post(a.cookie,{action:'save',kind:'avatar',data:png.replace('image/png','image/jpeg')})).status,400);
 assert.equal((await post(a.cookie,{action:'save',kind:'avatar',data:png})).status,200);
 assert.equal((await post(a.cookie,{action:'save',kind:'background',data:png})).status,200);
 for(const [emotion] of PORTRAIT_EMOTIONS){
  const response=await post(a.cookie,{action:'save',kind:'avatar',emotion,data:png});assert.equal(response.status,200);
  assert((await response.json()).media.avatarEmotions[emotion]>0);
 }
 assert.equal((await post(a.cookie,{action:'save',kind:'avatar',emotion:'../happy',data:png})).status,400);
 assert.equal((await post(a.cookie,{action:'save',kind:'background',emotion:'happy',data:png})).status,400);
 assert.equal((await post(a.cookie,{action:'save',kind:'avatar',emotion:'happy',data:png.replace('image/png','image/jpeg')})).status,400);
 const moodUrl=base+'/api/media/avatar/'+a.id+'?emotion=happy';
 assert.equal((await fetch(moodUrl,{headers:{cookie:b.cookie}})).status,404);
 assert.equal((await fetch(moodUrl)).status,401);
 assert.equal((await fetch(moodUrl,{headers:{cookie:a.cookie}})).status,200);
 const before=(await(await fetch(base+'/api/me',{headers:{cookie:a.cookie}})).json()).media.avatarEmotions.happy;
 const replaced=await(await post(a.cookie,{action:'save',kind:'avatar',emotion:'happy',data:png})).json();assert(replaced.media.avatarEmotions.happy>before);
 const removed=await(await post(a.cookie,{action:'delete',kind:'avatar',emotion:'happy'})).json();assert(!removed.media.avatarEmotions.happy);assert(removed.media.avatar);assert(removed.media.avatarEmotions.sad);
 assert.equal((await fetch(moodUrl,{headers:{cookie:a.cookie}})).status,200); // 回退默认图
 const own=await fetch(base+'/api/media/avatar/'+a.id,{headers:{cookie:a.cookie}});
 assert.equal(own.status,200);assert.equal(own.headers.get('content-type'),'image/png');assert((await own.arrayBuffer()).byteLength>0);
 assert.equal((await fetch(base+'/api/media/avatar/'+a.id,{headers:{cookie:b.cookie}})).status,404);
 assert.equal((await fetch(base+'/api/media/background',{headers:{cookie:b.cookie}})).status,404);
 assert.equal((await post(a.cookie,{action:'delete',kind:'avatar'})).status,200);
 assert.equal((await fetch(base+'/api/media/avatar/'+a.id,{headers:{cookie:a.cookie}})).status,404);
 const me=await(await fetch(base+'/api/me',{headers:{cookie:a.cookie}})).json();
 assert.equal(me.media.avatar,false);assert.equal(me.media.background,true);
 assert(me.media.backgroundVersion>0);
});

test('portrait expressions follow recent wording and safely fall back to default',()=>{
 for(const [text,emotion] of [['今天好开心😊','happy'],['我有点难过','sad'],['我真的生气了😡','angry'],['突然有点害羞','shy'],['哇！没想到','surprised'],['让我想想🤔','thinking'],['你好，周末去散步吗','default'],['我没有生气','default'],['我并不难过','default'],['今天不开心','sad']])assert.equal(portraitEmotion(text),emotion);
 const p={avatarVersion:10,avatarEmotions:{happy:20,sad:30}};
 assert.deepEqual(portraitSelection(p,'哈哈好开心'),{emotion:'happy',version:20});
 assert.deepEqual(portraitSelection(p,'有点害羞'),{emotion:'default',version:10});
 assert.deepEqual(portraitSelection({avatarEmotions:{happy:20}},'你好'),{emotion:'default',version:0});
 assert.deepEqual(portraitSelection({avatarEmotions:{happy:20}},'好开心'),{emotion:'happy',version:20});
});
