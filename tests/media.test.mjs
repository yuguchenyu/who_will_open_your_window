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
 assert.equal((await post(a.cookie,{action:'save',kind:'portrait',data:png})).status,200);
 assert.equal((await post(a.cookie,{action:'save',kind:'avatar',emotion:'happy',data:png})).status,400);
 for(const [emotion] of PORTRAIT_EMOTIONS){
  const response=await post(a.cookie,{action:'save',kind:'portrait',emotion,data:png});assert.equal(response.status,200);
  assert((await response.json()).media.portraitEmotions[emotion]>0);
 }
 assert.equal((await post(a.cookie,{action:'save',kind:'portrait',emotion:'../happy',data:png})).status,400);
 assert.equal((await post(a.cookie,{action:'save',kind:'background',emotion:'happy',data:png})).status,400);
 assert.equal((await post(a.cookie,{action:'save',kind:'portrait',emotion:'happy',data:png.replace('image/png','image/jpeg')})).status,400);
 const moodUrl=base+'/api/media/portrait/'+a.id+'?emotion=happy';
 assert.equal((await fetch(moodUrl,{headers:{cookie:b.cookie}})).status,404);
 assert.equal((await fetch(moodUrl)).status,401);
 assert.equal((await fetch(moodUrl,{headers:{cookie:a.cookie}})).status,200);
 const before=(await(await fetch(base+'/api/me',{headers:{cookie:a.cookie}})).json()).media.portraitEmotions.happy;
 const replaced=await(await post(a.cookie,{action:'save',kind:'portrait',emotion:'happy',data:png})).json();assert(replaced.media.portraitEmotions.happy>before);
 const removed=await(await post(a.cookie,{action:'delete',kind:'portrait',emotion:'happy'})).json();assert(!removed.media.portraitEmotions.happy);assert(removed.media.avatar);assert(removed.media.portraitEmotions.sad);
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

test('AI portrait selection requires confident known emotion and falls back safely',()=>{
 const p={portraitVersion:10,portraitEmotions:{happy:20,sad:30}};
 assert.deepEqual(portraitSelection(p,{label:'happy',confidence:90}),{emotion:'happy',version:20});
 for(const analysis of [undefined,{label:'happy',confidence:69},{label:'neutral',confidence:99},{label:'uncertain',confidence:90},{label:'invalid',confidence:90},{label:'sad',confidence:101},'哈哈好开心'])assert.deepEqual(portraitSelection(p,analysis),{emotion:'default',version:10});
 assert.deepEqual(portraitSelection(p,{label:'shy',confidence:90}),{emotion:'default',version:10});
 assert.deepEqual(portraitSelection({portraitEmotions:{happy:20}},{label:'neutral',confidence:90}),{emotion:'default',version:0});
 assert.equal(portraitEmotion({label:'sad',confidence:70}),'sad');
});
