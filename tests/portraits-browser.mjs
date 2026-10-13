import {chromium} from '../runtime/test-tools/node_modules/playwright-core/index.mjs';
import {openDatabase} from '../lib/db.mjs';
import {createServer} from '../server.mjs';
import {register,COOKIE_NAME} from '../lib/auth.mjs';
import {sendRealNote,respondRealNote,sendRealMessage} from '../lib/real-chat.mjs';
import {saveMedia} from '../lib/media.mjs';
import assert from 'node:assert/strict';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII=';
const db=openDatabase(':memory:'),a=register(db,{username:'portrait_viewer',password:'password12'}),b=register(db,{username:'portrait_owner',password:'password12'});
const card={id:b.user.id,kind:'real',name:b.user.name,score:100,tier:'gold',selfIntro:'喜欢分享生活，也喜欢认真交流。',sharedTags:[]};
db.prepare('INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)').run(a.user.id,'real',b.user.id,JSON.stringify(card),Date.now());
const note=sendRealNote(db,a.user.id,b.user.id,'你好，来聊聊今天吧。'),chat=respondRealNote(db,b.user.id,note,'accept','你好，很高兴认识你。');
const server=createServer({configured:false},{db});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
async function pageFor(auth){const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addCookies([{name:COOKIE_NAME,value:auth.token,url:base}]);const page=await context.newPage();page.on('pageerror',err=>{errors.push(err.message);console.log('Browser error:',err.message)});await page.goto(base);if(await page.locator('.entry-skip').count())await page.locator('.entry-skip').click();await page.locator('.daily-encounter').waitFor();return {context,page}}
try{
 const owner=await pageFor(b);await owner.page.locator('.menu-btn').click();await owner.page.locator('[data-action="tab"][data-id="me"]').click();await owner.page.locator('[data-action="appearance"]').first().click();await owner.page.locator('[data-media="portrait"]:not([data-emotion])').setInputFiles({name:'default.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await owner.page.getByRole('button',{name:'移除默认立绘',exact:true}).waitFor();
 for(const emotion of ['happy','sad']){await owner.page.locator(`[data-emotion="${emotion}"]`).setInputFiles({name:emotion+'.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await owner.page.locator(`[data-action="delete-emotion"][data-id="${emotion}"]`).waitFor();}
 for(const width of [320,390,1440]){await owner.page.setViewportSize({width,height:844});assert(!await owner.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));assert(!await owner.page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth));}
 await owner.page.reload();await owner.page.locator('.menu-btn').click();await owner.page.locator('[data-action="tab"][data-id="me"]').click();await owner.page.locator('[data-action="appearance"]').first().click();assert.equal(await owner.page.locator('.emotion-portrait-preview img').count(),2);
 const viewer=await pageFor(a);
 async function show(text,emotion){sendRealMessage(db,b.user.id,chat,text);await viewer.page.reload();await viewer.page.locator('.daily-encounter').waitFor();await viewer.page.locator('.menu-btn').click();await viewer.page.locator('[data-action="tab"][data-id="chat"]').click();await viewer.page.locator(`.vn-character-photo[data-emotion="${emotion}"]`).waitFor();await viewer.page.locator('.vn-character-photo').evaluate(i=>i.decode());}
 await show('今天真的好开心😊','happy');await show('有点难过😢','sad');await show('突然害羞了','default');
 await owner.page.locator('[data-action="delete-emotion"][data-id="happy"]').click();await owner.page.locator('[data-action="delete-emotion"][data-id="happy"]').waitFor({state:'detached'});await show('哈哈好开心','default');
 await owner.context.close();await viewer.context.close();assert.deepEqual(errors,[]);console.log('PASS: emotion upload, persistence, removal, responsive modal, automatic real-chat expressions and default fallback.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
