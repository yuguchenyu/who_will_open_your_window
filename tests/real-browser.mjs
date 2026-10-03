import {chromium} from '../runtime/test-tools/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';
import {draw,decide} from '../lib/draw.mjs';
import {saveMatchingProfile,storeTags} from '../lib/matching.mjs';

const db=openDatabase(':memory:');
const alice=register(db,{username:'real_alice',password:'password12'}),bob=register(db,{username:'real_bob',password:'password12'});
for(const x of [alice,bob])saveMatchingProfile(db,x.user.id,{selfIntro:'我喜欢阅读和散步，也愿意认真交流。',desiredIntro:'希望遇见愿意分享生活、互相尊重的人。'});
storeTags(db,alice.user.id,{selfTags:['喜欢阅读','真诚'],desiredTags:['喜欢运动','温柔']});
storeTags(db,bob.user.id,{selfTags:['喜欢运动','温柔'],desiredTags:['喜欢阅读','真诚']});
const firstDraw=draw(db,alice.user.id);decide(db,alice.user.id,firstDraw.pending.drawId,'like');
const guidance={interpretations:[{intent:'想继续交流',confidence:50,reason:'主动回应。'},{intent:'礼貌接话',confidence:30,reason:'语气平和。'},{intent:'仍需确认',confidence:20,reason:'信息还不够。'}],suggestions:[{label:'回应',text:'听起来不错。'},{label:'询问',text:'你通常什么时候去？'},{label:'分享',text:'我也喜欢散步。'}]};
const server=createServer({configured:true,base:'https://test.invalid/v1',key:'TEST',model:'test'},
 {db,fetchImpl:async()=>{await new Promise(resolve=>setTimeout(resolve,3000));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(guidance)}}]}),{status:200})}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const contextA=await browser.newContext({viewport:{width:390,height:844}}),contextB=await browser.newContext({viewport:{width:390,height:844}});
const a=await contextA.newPage(),b=await contextB.newPage(),errors=[];
for(const page of [a,b])page.on('pageerror',error=>errors.push(error.message));
async function login(page,name){await page.goto(base+'/login.html');if(await page.locator('.entry-skip').count())await page.locator('.entry-skip').click();await page.locator('#username').fill(name);await page.locator('#password').fill('password12');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(url=>url.pathname==='/')}
try{
 await login(a,'real_alice');await login(b,'real_bob');
 await a.locator('.match-card').filter({hasText:'real_bob'}).getByRole('button',{name:'递张纸条'}).click();
 await a.getByLabel('真人纸条内容').fill('你好，我们都喜欢散步吗？');
 await a.getByRole('button',{name:'递出纸条',exact:true}).click();
 await b.locator('.menu-btn').click();await b.locator('.menu-panel').getByRole('button',{name:'纸条'}).click();
 await b.locator('.real-note').filter({hasText:'你好，我们都喜欢散步吗？'}).getByRole('button',{name:'回信并开始聊天'}).click();
 await b.getByLabel('真人回信内容').fill('你好，我也喜欢散步。');
 await b.getByRole('button',{name:'回信并开始聊天'}).last().click();
 await b.locator('.vn-stage.real').waitFor();
 await a.locator('.menu-btn').click();await a.locator('.menu-panel').getByRole('button',{name:'遇见'}).click();
 await a.locator('.match-card').filter({hasText:'real_bob'}).getByRole('button',{name:'进入真人对话'}).click();
 await a.locator('.vn-stage.real').waitFor();
 await a.getByText('正在理解这句话…').waitFor();
 await a.locator('.vn-choice.custom').click();
 await a.getByLabel('聊天消息').fill('今天先聊聊你喜欢的路线。');
 await a.getByLabel('聊天消息').press('Enter');
 await a.getByRole('button',{name:'回看记录'}).click();
 await a.locator('.vn-history .bubble').filter({hasText:'今天先聊聊你喜欢的路线。'}).waitFor();
 assert.match(await a.locator('.vn-history .message-time').last().innerText(),/\d{1,2}:\d{2}/);
 await a.getByRole('button',{name:'收起记录'}).click();
 await b.locator('.menu-btn').click();await b.locator('.menu-panel').getByRole('button',{name:'对话'}).click();
 await b.locator('.vn-dialogue-text').filter({hasText:'今天先聊聊你喜欢的路线。'}).waitFor();
 await a.locator('.vn-foot-row').getByRole('button',{name:'设置背景'}).click();
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII=','base64');
 await a.locator('[data-media="background"]').setInputFiles({name:'room.png',mimeType:'image/png',buffer:image});
 await a.waitForFunction(()=>{const image=document.querySelector('.profile-media-preview img');return image?.complete&&image.naturalWidth>0});
 await a.getByRole('button',{name:'关闭面板'}).click();
 await a.waitForFunction(()=>{const image=document.querySelector('.vn-background-image');return image?.complete&&image.naturalWidth>0});
 await a.reload();
 await a.locator('.menu-btn').click();await a.locator('.menu-panel').getByRole('button',{name:'对话'}).click();
 await a.waitForFunction(()=>{const image=document.querySelector('.vn-background-image');return image?.complete&&image.naturalWidth>0});
 assert.deepEqual(errors,[]);
 console.log('PASS: matched users exchange notes and real messages; own message sends during guidance; timestamps and custom background survive reload.');
}finally{await contextA.close();await contextB.close();await browser.close();await new Promise(resolve=>{server.closeAllConnections();server.close(resolve)})}
