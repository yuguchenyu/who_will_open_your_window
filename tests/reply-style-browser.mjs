import {chromium} from '../runtime/test-tools/node_modules/playwright-core/index.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register,COOKIE_NAME} from '../lib/auth.mjs';
import {sendRealNote,respondRealNote} from '../lib/real-chat.mjs';
import {createServer} from '../server.mjs';
import assert from 'node:assert/strict';
const db=openDatabase(':memory:'),a=register(db,{username:'style_viewer',password:'password12'}),b=register(db,{username:'style_partner',password:'password12'});
db.prepare('INSERT INTO draw_collection(user_id,kind,person_id,snapshot,added_at) VALUES(?,?,?,?,?)').run(a.user.id,'real',b.user.id,JSON.stringify({id:b.user.id,kind:'real',name:b.user.name,score:90,tier:'gold',sharedTags:[]}),Date.now());
const note=sendRealNote(db,a.user.id,b.user.id,'刚在路上看见一只小猫。');respondRealNote(db,b.user.id,note,'accept','想看看呀。');
const responses={natural:'好，你接着说。',humorous:'这展开有点意思。',warm:'慢慢说，我在听。',brief:'嗯，说吧。'};
let held=false,release,seen=[];
const server=createServer({configured:true,base:'https://model.test/v1',key:'test',model:'test'},{db,fetchImpl:async(_url,options)=>{
 const prompt=JSON.parse(options.body).messages[0].content,style=prompt.match(/当前风格 (\w+)/)?.[1]||'natural';seen.push(style);
 if(held){held=false;await new Promise(r=>release=r)}
 return Response.json({choices:[{message:{content:JSON.stringify({emotion:{label:'uncertain',confidence:0},interpretations:[{intent:'想看照片',confidence:50,reason:'对方说想看'},{intent:'好奇',confidence:30,reason:'承接上文'},{intent:'礼貌接话',confidence:20,reason:'仅为推测'}],suggestions:[{label:'接话',text:responses[style]},{label:'确认',text:'你想看吗？'},{label:'继续',text:'接着聊聊？'}]})}}]});
}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addCookies([{name:COOKIE_NAME,value:a.token,url:base}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);if(await page.locator('.entry-skip').count())await page.locator('.entry-skip').click();await page.locator('.daily-encounter').waitFor();
 async function openChat(){await page.locator('.menu-btn').click();await page.locator('[data-action="tab"][data-id="chat"]').click();await page.locator('#reply-style').waitFor()}
 await openChat();await page.getByText(responses.natural,{exact:true}).waitFor();
 await page.locator('[data-action="custom-reply"]').click();await page.getByRole('textbox',{name:'聊天消息'}).fill('我自己写的草稿');
 await page.locator('#reply-style').selectOption('warm');await page.getByText(responses.warm,{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'聊天消息'}).inputValue(),'我自己写的草稿');
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert(!await page.locator('.vn-stage').evaluate(el=>el.scrollWidth>el.clientWidth))}
 // Switch twice while the first style is still being generated: only the latest may be displayed.
 held=true;await page.locator('#reply-style').selectOption('humorous');for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,5));assert(release);
 await page.locator('#reply-style').selectOption('brief');release();await page.getByText(responses.brief,{exact:true}).waitFor();assert.equal(await page.getByText(responses.humorous,{exact:true}).count(),0);
 await page.reload();await page.locator('.daily-encounter').waitFor();await openChat();await page.getByText(responses.brief,{exact:true}).waitFor();assert.equal(await page.locator('#reply-style').inputValue(),'brief');
 assert(seen.includes('warm')&&seen.includes('humorous')&&seen.includes('brief'));assert.deepEqual(errors,[]);console.log('PASS: style switching, latest request wins, preserved custom draft, persisted selection, mobile layout.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}
