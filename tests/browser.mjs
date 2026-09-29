import {chromium} from '../runtime/test-tools/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createServer} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out=path.join(ROOT,'runtime','screenshots');fs.mkdirSync(out,{recursive:true});
let failNextReply=false;const requests=[];
const server=createServer({configured:true,base:'https://test.invalid/v1',key:'TEST_ONLY_KEY',model:'test-model'},{db:openDatabase(':memory:'),fetchImpl:async(url,options)=>{
 const body=JSON.parse(options.body);requests.push(body);
 const suggestion=body.messages[0].content.includes('表达助手');
 const guidance=body.messages[0].content.includes('对话理解助手');
 if(failNextReply&&!suggestion&&!guidance&&body.messages.length>1){failNextReply=false;return new Response('{}',{status:500})}
 const content=guidance?JSON.stringify({interpretations:[{intent:'想继续了解',confidence:50,reason:'主动提问。'},{intent:'轻松接话',confidence:35,reason:'语气平和。'},{intent:'只是礼貌回应',confidence:15,reason:'仅凭文字无法确认。'}],suggestions:[{label:'分享自己',text:'我也喜欢傍晚散步。'},{label:'确认偏好',text:'你更喜欢怎样的散步路线？'},{label:'轻松回应',text:'听起来很舒服。'}]}):suggestion?JSON.stringify({suggestions:[{label:'自然招呼',text:'看到你留下的话题，就想来打个招呼。你会怎么安排这样的周末？'},{label:'继续了解',text:'你平时有喜欢散步的地方吗？'},{label:'轻松接话',text:'有一个不用赶时间的周末就很好。你呢？'}]}):body.messages.length===1?'连接成功':'很高兴收到你的消息。我喜欢傍晚沿河散步，你平时会怎么度过周末？';
 return new Response(JSON.stringify({choices:[{message:{content}}]}),{status:200,headers:{'Content-Type':'application/json'}});
}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[];let context;const unconfigured=createServer({configured:false,model:''},{db:openDatabase(':memory:')});await new Promise(r=>unconfigured.listen(0,'127.0.0.1',r));
try{
 // 首页现在会跳到登录页，所以每个测试服务器都要先有个账号。
 async function register(page,base,username){
  await page.goto(base+'/login.html');
  // 登录页默认是登录模式，注册得先切一下，否则根本没有"注册并进入"这个按钮。
  await page.getByRole('button',{name:'还没有账号？注册一个'}).click();
  await page.locator('#username').fill(username);
  await page.locator('#password').fill('password12');
  await page.locator('#self-intro').fill('我喜欢阅读和散步，也很重视真诚沟通。');
  await page.locator('#desired-intro').fill('希望遇见喜欢阅读、愿意耐心交流的人。');
  await page.locator('#share-matching').check();
  await page.getByRole('button',{name:'注册并进入'}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
 }
 async function signIn(page,base,username){
  await page.goto(base+'/login.html');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill('password12');
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.waitForURL(u=>!u.pathname.startsWith('/login'));
 }
 // 用户名规则是 3–20 位字母、数字或下划线，所以时间戳要转成 36 进制再截。
 const account='ua_'+Date.now().toString(36).slice(-8);
 context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();page.on('pageerror',err=>errors.push(err.message));page.on('console',msg=>{if(msg.type()==='error'&&/Content Security Policy|Refused to execute|Refused to apply/.test(msg.text()))errors.push(msg.text())});
 await register(page,url,account);await page.getByText('AI 服务可用',{exact:true}).waitFor();
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
 await page.screenshot({path:path.join(out,'mobile-meet.png'),fullPage:true});
 await page.getByRole('button',{name:'递张纸条',exact:false}).first().click();
 await page.getByLabel('纸条内容').fill('我喜欢散步，想和你聊聊。');
 await page.getByRole('button',{name:'拾言 · 三个建议',exact:true}).click();
 await page.getByRole('button',{name:/自然招呼/}).click();
 assert((await page.getByLabel('纸条内容').inputValue()).includes('打个招呼'));
 await page.getByLabel('纸条内容').fill('我喜欢散步，很高兴认识你。');
 await page.getByRole('button',{name:/^递出纸条/}).click();
 await page.getByRole('button',{name:'让 AI 回应这张纸条',exact:true}).click();
 await page.locator('.bubble').filter({hasText:'很高兴收到你的消息'}).waitFor();
 await page.locator('.guidance .interpretation').first().waitFor();
 assert.equal(await page.locator('.guidance .interpretation').count(),3);
 await page.locator('.guidance-option').first().click();
 assert.equal(await page.getByLabel('聊天消息').inputValue(),'我也喜欢傍晚散步。');
 await page.getByLabel('聊天消息').fill('今天心情不错。');failNextReply=true;
 await page.getByRole('button',{name:/^发送/}).click();
 await page.getByRole('button',{name:'重试回复',exact:true}).waitFor();
 assert.equal(await page.locator('.bubble').filter({hasText:'今天心情不错。'}).count(),1);
 await page.getByRole('button',{name:'重试回复',exact:true}).click();
 await page.getByLabel('聊天消息').waitFor();
 assert.equal(await page.locator('.bubble').filter({hasText:'今天心情不错。'}).count(),1);
 // 发出去的那句不能留在输入框里：重绘会把它填回来，再点一次发送就重复发一遍。
 assert.equal(await page.getByLabel('聊天消息').inputValue(),'','发送成功后输入框必须清空');
 await page.screenshot({path:path.join(out,'mobile-chat.png'),fullPage:true});
 await page.getByRole('button',{name:'心笺',exact:true}).click();
 await page.locator('#score-input').fill('73');await page.locator('#score-input').dispatchEvent('input');
 await page.locator('#memo').fill('PRIVATE_FEELING_73');await page.getByRole('button',{name:'保存这次感受'}).click();
 await page.getByRole('button',{name:'回望 · 确认意愿'}).click();
 await page.locator('#review-intent').selectOption('closer');await page.locator('#review-auth').check();
 await page.getByRole('button',{name:'确认本周期意愿'}).click();
 await page.getByRole('button',{name:'打开 Demo 控制面板'}).click();
 await page.locator('#demo-intent').selectOption('closer');await page.locator('#demo-auth').check();await page.getByRole('button',{name:'保存为本周期状态'}).click();await page.getByRole('button',{name:'关闭面板'}).click();
 await page.locator('.bottom-nav').getByRole('button',{name:'我的',exact:true}).click();
 assert((await page.locator('.score').first().innerText()).includes('73'));
 await page.locator('.feeling-card').first().getByRole('button',{name:'轻叩窗扉',exact:true}).click();
 await page.locator('#knock-consent').check();await page.getByRole('button',{name:'确认轻叩'}).click();
 await page.locator('#dialog').getByRole('heading',{name:'你的心意，有了回响。',exact:true}).waitFor();
 await page.screenshot({path:path.join(out,'mobile-mutual.png')});
 await page.getByRole('button',{name:'回到我的心笺'}).click();
 await page.reload();await page.getByText('AI 服务可用',{exact:true}).waitFor();await page.locator('.bottom-nav').getByRole('button',{name:'我的',exact:true}).click();
 assert((await page.locator('.score').first().innerText()).includes('73'));assert.equal(await page.locator('.result-card').count(),1);
 await page.getByRole('button',{name:'打开 Demo 控制面板'}).click();await page.getByRole('button',{name:'推进 7 天',exact:true}).click();await page.locator('#demo-intent').selectOption('exploring');await page.getByRole('button',{name:'保存为本周期状态'}).click();await page.getByRole('button',{name:'关闭面板'}).click();
 await page.locator('.feeling-card').first().getByRole('button',{name:'回望',exact:true}).click();await page.locator('#review-auth').check();await page.getByRole('button',{name:'确认本周期意愿'}).click();
 await page.locator('.feeling-card').first().getByRole('button',{name:'轻叩窗扉',exact:true}).click();await page.locator('#knock-consent').check();await page.getByRole('button',{name:'确认轻叩'}).click();await page.locator('#dialog').getByRole('heading',{name:'本次暂未确认双向心意。',exact:true}).waitFor();await page.getByRole('button',{name:'回到我的心笺'}).click();
 await page.getByRole('button',{name:'打开 Demo 控制面板'}).click();await page.locator('#demo-person').selectOption('yu');await page.getByRole('button',{name:'模拟收到纸条',exact:true}).click();
 await page.getByRole('button',{name:'稍后再看',exact:true}).last().click();await page.locator('.tabs').getByRole('button',{name:'稍后再看',exact:true}).click();await page.getByRole('button',{name:'暂不接话',exact:true}).click();await page.getByRole('button',{name:'已归档',exact:true}).click();await page.locator('.note-card').filter({hasText:'已归档 · 不通知对方'}).waitFor();
 assert(!JSON.stringify(requests).includes('PRIVATE_FEELING_73'));
 await page.getByRole('button',{name:'打开 Demo 控制面板'}).click();await page.getByRole('button',{name:'重置全部演示数据'}).click();await page.getByRole('button',{name:'确认清除并重新开始'}).click();
 await page.locator('.person-card').first().waitFor();assert.equal(await page.locator('.person-card').count(),3);
 await page.locator('.bottom-nav').getByRole('button',{name:'我的',exact:true}).click();
 assert((await page.locator('.smallprint').filter({hasText:'数据保存在服务端'}).count())>0,'the account must survive a demo reset');
 // 截图要拍的是"遇见"页，切回去。
 await page.locator('.bottom-nav').getByRole('button',{name:'遇见',exact:true}).click();
 await page.setViewportSize({width:320,height:720});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'narrow mobile overflow');
 await page.setViewportSize({width:1440,height:1000});await page.mouse.move(0,0);await page.locator('#toast.show').waitFor({state:'hidden'});await page.screenshot({path:path.join(out,'desktop-meet.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'desktop overflow');
 // —— 被另一台设备顶掉 + 草稿抢救 ---------------------------------------------
 // 这一段要放在换成未配置服务器之前：cookie 只按主机划分、不区分端口，
 // 两个测试服务器都在 127.0.0.1 上，谁后登录谁的 hw_session 就会盖掉另一个。
 await page.setViewportSize({width:390,height:844});
 // 整页刷新后，服务端会自动告知 AI 是否可用。
 await page.getByText('AI 服务可用',{exact:true}).waitFor();
 // 重置把联系人清空了，先跟 xia 重新建立一段对话，才有聊天输入框可用。
 await page.getByRole('button',{name:'递张纸条',exact:false}).first().click();
 await page.getByLabel('纸条内容').fill('先把对话建立起来。');
 await page.getByRole('button',{name:/^递出纸条/}).click();
 await page.getByRole('button',{name:'让 AI 回应这张纸条',exact:true}).click();
 await page.locator('[data-draft="chat:xia"]').waitFor();
 await page.locator('[data-draft="chat:xia"]').fill('这句话不能被弄丢');
 // 注意要用独立的 context：同一个 context 共用 cookie，那样顶不掉自己。
 const other=await browser.newContext({viewport:{width:390,height:844}});
 const second=await other.newPage();
 await signIn(second,url,account);
 await page.locator('.bottom-nav').getByRole('button',{name:'遇见',exact:true}).click();
 await page.waitForURL(u=>u.pathname.startsWith('/login'),{timeout:10000});
 assert((await page.locator('.notice').innerText()).includes('另一台设备'),'the displaced device must be told why');
 // 被顶掉前写在输入框里的话，重新登录后要回来 —— 整页跳转会让它消失，所以先存了 sessionStorage。
 await signIn(page,url,account);
 await page.locator('.bottom-nav').getByRole('button',{name:'对话',exact:true}).click();
 assert.equal(await page.locator('[data-draft="chat:xia"]').inputValue(),'这句话不能被弄丢','an unsent draft must survive being signed out');
 await other.close();
 // Separate unconfigured test server; never use real keys or change the running demo.
 // 这是另一个服务器、另一个库，要在它上面单独注册一个账号。
 const coldBase=`http://127.0.0.1:${unconfigured.address().port}`;
 await register(page,coldBase,'cfg_1');await page.getByText('AI 服务暂不可用',{exact:true}).waitFor();await page.getByRole('button',{name:'递张纸条',exact:false}).first().click();await page.locator('#toast.show').getByText('AI 服务暂不可用，请稍后再试。').waitFor();
 await page.screenshot({path:path.join(out,'ai-unavailable.png')});
 assert.deepEqual(errors,[]);console.log('PASS: mobile + desktop overflow, login gate, server-managed AI availability, suggestions, editable note, AI reply, failure retry without duplicate, private feelings, authorization, both outcomes, persistence, cycle advance, inbox save/archive, reset, single-device takeover, draft survival.');
 console.log('Screenshots saved in runtime/screenshots. All model responses in this test were explicitly mocked.');
}finally{await context?.close();await browser.close();server.closeAllConnections();unconfigured.closeAllConnections();await Promise.all([new Promise(r=>server.close(r)),new Promise(r=>unconfigured.close(r))])}
