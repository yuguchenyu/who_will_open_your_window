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
let modelEmotion='uncertain',holdAnalysis=false,releaseAnalysis;
const server=createServer({configured:true,base:'https://test.example/v1',key:'test',model:'test'},{db,fetchImpl:async(_url,options)=>{const emotion=modelEmotion;if(JSON.parse(options.body).messages[0].content.includes('对话理解助手')&&holdAnalysis){holdAnalysis=false;await new Promise(r=>releaseAnalysis=r)}return Response.json({choices:[{message:{content:JSON.stringify({emotion:{label:emotion,confidence:90},interpretations:[{intent:'分享心情',confidence:50,reason:'结合上下文'},{intent:'自然接话',confidence:30,reason:'仅供参考'},{intent:'希望确认',confidence:20,reason:'需要更多信息'}],suggestions:[{label:'回应',text:'听起来不错。'},{label:'确认',text:'你想聊聊吗？'},{label:'分享',text:'我愿意听你分享。'}]})}}]})}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
async function pageFor(auth){const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addCookies([{name:COOKIE_NAME,value:auth.token,url:base}]);const page=await context.newPage();page.on('pageerror',err=>{errors.push(err.message);console.log('Browser error:',err.message)});await page.goto(base);if(await page.locator('.entry-skip').count())await page.locator('.entry-skip').click();await page.locator('.daily-encounter').waitFor();return {context,page}}
try{
 const owner=await pageFor(b);await owner.page.locator('.menu-btn').click();await owner.page.locator('[data-action="tab"][data-id="me"]').click();await owner.page.locator('[data-action="appearance"]').first().click();await owner.page.locator('[data-media="portrait"]:not([data-emotion])').setInputFiles({name:'default.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await owner.page.getByRole('button',{name:'移除默认立绘',exact:true}).waitFor();
 for(const emotion of ['happy','sad']){await owner.page.locator(`[data-emotion="${emotion}"]`).setInputFiles({name:emotion+'.png',mimeType:'image/png',buffer:Buffer.from(png.split(',')[1],'base64')});await owner.page.locator(`[data-action="delete-emotion"][data-id="${emotion}"]`).waitFor();}
 for(const width of [320,390,1440]){await owner.page.setViewportSize({width,height:844});assert(!await owner.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));assert(!await owner.page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth));}
 await owner.page.reload();await owner.page.locator('.menu-btn').click();await owner.page.locator('[data-action="tab"][data-id="me"]').click();await owner.page.locator('[data-action="appearance"]').first().click();assert.equal(await owner.page.locator('.emotion-portrait-preview img').count(),2);
 const viewer=await pageFor(a);
 async function show(text,emotion,analysis=emotion==='default'?'uncertain':emotion){modelEmotion=analysis;sendRealMessage(db,b.user.id,chat,text);await viewer.page.reload();await viewer.page.locator('.daily-encounter').waitFor();await viewer.page.locator('.menu-btn').click();await viewer.page.locator('[data-action="tab"][data-id="chat"]').click();await viewer.page.locator(`.vn-character-photo[data-emotion="${emotion}"]`).waitFor();await viewer.page.locator('.vn-character-photo').evaluate(i=>i.decode());const label={happy:'开心',sad:'难过',shy:'害羞',angry:'生气',surprised:'惊讶',thinking:'思考'}[analysis]||'暂难判断';await viewer.page.locator('.vn-emotion').filter({hasText:label}).waitFor();if(analysis!=='uncertain')assert((await viewer.page.locator('.vn-emotion').innerText()).includes('参考置信度 90%'));}
 await show('今天终于等到了那个好消息','happy');
 sendRealMessage(db,a.user.id,chat,'那就继续聊聊吧。');await viewer.page.getByText('那就继续聊聊吧。',{exact:true}).waitFor();assert((await viewer.page.locator('.vn-emotion').innerText()).includes('开心'));
 for(const width of [320,390,1440]){await viewer.page.setViewportSize({width,height:844});assert(!await viewer.page.evaluate(()=>document.documentElement.scrollWidth>innerWidth));assert(!await viewer.page.locator('.vn-emotion').evaluate(el=>el.scrollWidth>el.clientWidth))}
 await show('忙了这么久，结果还是落空了','sad');await show('突然害羞了','default');
 await owner.page.locator('[data-action="delete-emotion"][data-id="happy"]').click();await owner.page.locator('[data-action="delete-emotion"][data-id="happy"]').waitFor({state:'detached'});await show('哈哈好开心','default','happy');assert((await viewer.page.locator('.vn-emotion').innerText()).includes('未上传开心立绘，使用默认立绘'));

 // Receive messages without reloading: AI analyses update the active scene.
 modelEmotion='sad';sendRealMessage(db,b.user.id,chat,'新消息：期待了很久的事情没有实现');
 await viewer.page.getByText('新消息：期待了很久的事情没有实现',{exact:true}).waitFor();
 await viewer.page.locator('.vn-character-photo[data-emotion="sad"]').waitFor();
 modelEmotion='uncertain';sendRealMessage(db,b.user.id,chat,'新消息：随便吧');
 await viewer.page.getByText('新消息：随便吧',{exact:true}).waitFor();
 await viewer.page.locator('.vn-character-photo[data-emotion="default"]').waitFor();
 // A delayed old happy analysis must not replace a newer sad message.
 saveMedia(db,b.user.id,'portrait',png,'happy');modelEmotion='happy';holdAnalysis=true;
 sendRealMessage(db,b.user.id,chat,'第一条：终于等到通知');
 await viewer.page.getByText('第一条：终于等到通知',{exact:true}).waitFor();
 for(let i=0;i<100&&!releaseAnalysis;i++)await new Promise(r=>setTimeout(r,5));assert(releaseAnalysis);
 modelEmotion='sad';sendRealMessage(db,b.user.id,chat,'第二条：原来是通知取消');
 await viewer.page.getByText('第二条：原来是通知取消',{exact:true}).waitFor();
 await viewer.page.evaluate(()=>{window.emotionFrames=[];window.emotionObserver=new MutationObserver(()=>window.emotionFrames.push(document.querySelector('.vn-character-photo')?.dataset.emotion));window.emotionObserver.observe(document.getElementById('app'),{childList:true,subtree:true})});
 releaseAnalysis();await viewer.page.locator('.vn-character-photo[data-emotion="sad"]').waitFor();assert((await viewer.page.locator('.vn-emotion').innerText()).includes('难过'));
 assert(!(await viewer.page.evaluate(()=>window.emotionFrames)).includes('happy'));
 await viewer.page.evaluate(()=>window.emotionObserver.disconnect());
 await owner.context.close();await viewer.context.close();assert.deepEqual(errors,[]);console.log('PASS: emotion upload, persistence, removal, responsive modal, automatic real-chat expressions and default fallback.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
