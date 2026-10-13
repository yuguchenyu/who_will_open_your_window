import {chromium} from '../runtime/test-tools/node_modules/playwright-core/index.mjs';
import {openDatabase} from '../lib/db.mjs';
import {register,COOKIE_NAME} from '../lib/auth.mjs';
import {saveMedia,mediaStatus} from '../lib/media.mjs';
import {createServer} from '../server.mjs';
import {encodePortraitPng} from '../lib/portrait-png.mjs';
import assert from 'node:assert/strict';
const png=encodePortraitPng({width:2,height:2,pixels:Buffer.from([0,0,0,0,40,50,60,255,0,0,0,0,60,70,80,255])});
const db=openDatabase(':memory:'),auth=register(db,{username:'image_browser',password:'password12'});saveMedia(db,auth.user.id,'portrait','data:image/png;base64,'+png.toString('base64'));
let release,calls=0;const server=createServer({configured:false,imageConfigured:true,imageBase:'https://images.test/v1',imageKey:'test-key'},{db,fetchImpl:async()=>{calls++;await new Promise(r=>release=r);return Response.json({data:[{b64_json:png.toString('base64')}]})}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});await context.addCookies([{name:COOKIE_NAME,value:auth.token,url:base}]);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function appearance(){await page.locator('.menu-btn').click();await page.locator('[data-action="tab"][data-id="me"]').click();await page.locator('[data-action="appearance"]').first().click()}
 await page.goto(base);if(await page.locator('.entry-skip').count())await page.locator('.entry-skip').click();await page.locator('.daily-encounter').waitFor();await appearance();
 const generate=page.locator('[data-action="generate-portrait"][data-id="happy"]');assert(await generate.isDisabled());await page.locator('#generation-consent').check();await generate.click();await page.getByText('正在生成开心立绘…',{exact:false}).waitFor();assert.equal(calls,1);
 await page.locator('[data-action="close"]').first().click();await page.locator('.menu-btn').click();await page.locator('[data-action="tab"][data-id="chat"]').click();await page.locator('main.fullscreen').waitFor(); // navigation remains usable during generation
 release();await page.reload();await page.locator('.menu-btn').waitFor();await appearance();await page.locator('.generation-preview img').waitFor();await page.locator('.generation-preview img').evaluate(img=>img.decode());assert.equal(mediaStatus(db,auth.user.id).portraitEmotions.happy,undefined);
 for(const width of [320,390,1440]){await page.setViewportSize({width,height:844});assert(!await page.locator('dialog').evaluate(el=>el.scrollWidth>el.clientWidth));}
 await page.getByRole('button',{name:'保存为开心立绘',exact:true}).click();await page.locator('[data-action="delete-emotion"][data-id="happy"]').waitFor();assert(mediaStatus(db,auth.user.id).portraitEmotions.happy);assert.deepEqual(errors,[]);console.log('PASS: consent, background task, restored transparent preview, explicit save, responsive modal.');
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}
