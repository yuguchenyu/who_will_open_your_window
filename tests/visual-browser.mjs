import {chromium} from '../runtime/test-tools/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createServer} from '../server.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register} from '../lib/auth.mjs';

const db=openDatabase(':memory:');
register(db,{username:'visual_user',password:'password12'});
const server=createServer({configured:false,model:''},{db});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const out=new URL('../runtime/screenshots/watercolor/',import.meta.url);
fs.mkdirSync(out,{recursive:true});
const errors=[];
try{
 const context=await browser.newContext({viewport:{width:1440,height:900}});
 const page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
 await page.goto(base);
 await page.locator('.window-entry').waitFor();
 assert(await page.locator('#app').evaluate(element=>element.inert));
 await page.screenshot({path:fileURLToPath(new URL('desktop-entry.png',out))});
 await page.locator('.entry-open').press('Enter');
 await page.locator('.window-entry').waitFor({state:'detached'});
 assert(!(await page.locator('#app').evaluate(element=>element.inert)));
 assert.equal(await page.evaluate(()=>document.activeElement.id),'username');
 await page.reload();assert.equal(await page.locator('.window-entry').count(),0);
 await page.locator('#username').fill('visual_user');await page.locator('#password').fill('password12');
 await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL(base+'/');
 assert.equal(await page.locator('.window-entry').count(),0);
 for(const [width,height] of [[1440,900],[390,844],[320,720]]){
  await page.setViewportSize({width,height});
  await page.screenshot({path:fileURLToPath(new URL(`meet-${width}.png`,out)),fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 }
 for(const tab of ['纸条','我的']){
  await page.locator('.menu-btn').click();await page.locator('.menu-nav').getByRole('button',{name:tab,exact:true}).click();
  await page.screenshot({path:fileURLToPath(new URL(tab==='纸条'?'notes.png':'me.png',out)),fullPage:true});
 }
 // New tab, existing login: entrance appears above home, then skips directly to it.
 const fresh=await context.newPage();await fresh.goto(base);await fresh.locator('.entry-skip').click();
 assert.equal(await fresh.locator('.window-entry').count(),0);
 await fresh.goto(base+'/login.html?reason=replaced');assert.equal(await fresh.locator('.window-entry').count(),0);
 const reduced=await browser.newContext({reducedMotion:'reduce',viewport:{width:390,height:844}});
 const quiet=await reduced.newPage();await quiet.goto(base);assert.equal(await quiet.locator('.window-entry').count(),0);
 assert(!(await quiet.locator('#app').evaluate(element=>element.inert)));
 await quiet.screenshot({path:fileURLToPath(new URL('mobile-login.png',out)),fullPage:true});
 const blocked=await browser.newContext({viewport:{width:320,height:720}});const fallback=await blocked.newPage();
 await fallback.addInitScript(()=>{Object.defineProperty(window,'sessionStorage',{get(){throw new Error('storage disabled');}});});
 await fallback.goto(base);await fallback.locator('.entry-skip').click();assert(!(await fallback.locator('#app').evaluate(element=>element.inert)));
 // If CSS animations cannot finish, the timer must still release the gate.
 const timeout=await browser.newContext();const stuck=await timeout.newPage();
 await stuck.route('**/watercolor.css',route=>route.fulfill({contentType:'text/css',body:'.window-entry{position:fixed;inset:0;z-index:100;background:white}'}));
 await stuck.goto(base);await stuck.locator('.entry-open').click();await stuck.locator('.window-entry').waitFor({state:'detached'});
 for(const path of ['/entrance.mjs','/watercolor.css',...['window-day','street-night','room-night','forest-path','lake-dusk'].map(id=>`/bg/${id}-watercolor.png`),...['xia','yu','ning'].map(id=>`/character/${id}-watercolor.png`)]){
  const response=await page.request.get(base+path);assert.equal(response.status(),200,path);
 }
 // Verify real transparency, not a rendered checkerboard or opaque rectangle.
 for(const id of ['xia','yu','ning']){
  const alpha=await page.evaluate(async id=>{
   const image=new Image();image.src=`/character/${id}-watercolor.png`;await image.decode();
   const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
   let min=255,max=0;for(let i=3;i<pixels.length;i+=4){min=Math.min(min,pixels[i]);max=Math.max(max,pixels[i]);}
   return {min,max};
  },id);
  assert.equal(alpha.min,0,id+' transparent background');assert(alpha.max>=250,id+' solid character');
 }
 assert.deepEqual(errors,[]);
 await Promise.all([context.close(),reduced.close(),blocked.close(),timeout.close()]);
 console.log('PASS: entrance, keyboard focus, refresh/login persistence, existing session, reduced motion, storage failure, animation timeout, assets, responsive pages and CSP.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
