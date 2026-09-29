import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
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
 const own=await fetch(base+'/api/media/avatar/'+a.id,{headers:{cookie:a.cookie}});
 assert.equal(own.status,200);assert.equal(own.headers.get('content-type'),'image/png');assert((await own.arrayBuffer()).byteLength>0);
 assert.equal((await fetch(base+'/api/media/avatar/'+a.id,{headers:{cookie:b.cookie}})).status,404);
 assert.equal((await fetch(base+'/api/media/background',{headers:{cookie:b.cookie}})).status,404);
 assert.equal((await post(a.cookie,{action:'delete',kind:'avatar'})).status,200);
 assert.equal((await fetch(base+'/api/media/avatar/'+a.id,{headers:{cookie:a.cookie}})).status,404);
 const me=await(await fetch(base+'/api/me',{headers:{cookie:a.cookie}})).json();
 assert.deepEqual(me.media,{avatar:false,background:true});
});
