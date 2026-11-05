import test from 'node:test';
import assert from 'node:assert/strict';
import {clientCatalog,createClientDetector} from './wechat-clients.mjs';
import {renderClientResult,wechatClientsCard} from '../public/console/wechat-clients.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createConsole} from './console-server.mjs';
const verified={path:'C:/WeChatGirl/Weixin.exe',version:'4.1.10.27',coreVersion:'4.1.10.27',architecture:'x64',signed:true,coreSigned:true,bundled:true,configured:true};
test('only the complete signed matching client selects the bundled sender',()=>{
 const result=clientCatalog({nativeReady:true,clients:[verified,{...verified,path:'C:/system/Weixin.exe',version:'4.2.0.21',coreVersion:'4.2.0.21',bundled:false,running:true}]});
 assert.equal(result.bundled.canLaunch,true);assert.equal(result.bundled.tool,'wechat-hook-4.1.10.27');assert.equal(result.conflict,true);assert.equal(result.clients[1].canLaunch,false);assert.equal(result.clients[1].tool,null);
 for(const change of [{signed:false},{coreSigned:false},{coreVersion:'4.1.15.13'},{architecture:'x86'}])assert.equal(clientCatalog({nativeReady:true,clients:[{...verified,...change}]}).bundled.canLaunch,false);
 assert.equal(clientCatalog({nativeReady:false,clients:[verified]}).bundled.canLaunch,false);
});
test('an experimental newer profile cannot enable the old injector and missing clients remain explicit',()=>{
 for(const version of ['4.1.15.13','4.1.15.56']){
  const data=clientCatalog({nativeReady:true,clients:[{...verified,version,coreVersion:version}]});assert.equal(data.bundled.canLaunch,false);assert.equal(data.bundled.tool,null);
  assert.match(data.bundled.status,version==='4.1.15.13'?/基础文字.*语音、表情等尚未适配/:/不能套用上游 4\.1\.15\.13/);
 }
 assert.equal(clientCatalog({clients:[]}).bundled,null);
});
test('detection coalesces concurrent scans, caches results and permits an explicit refresh',async()=>{
 let count=0;const detector=createClientDetector('unused',{scan:async()=>{count++;return {clients:[verified],nativeReady:true}}});
 await Promise.all([detector.inspect(),detector.inspect()]);assert.equal(count,1);await detector.inspect();assert.equal(count,1);await detector.inspect({force:true});assert.equal(count,2);
});
test('version cards escape executable metadata and provide a disabled startup button until verified',()=>{
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const markup=renderClientResult(clientCatalog({clients:[{...verified,path:'<img src=x onerror=bad>'}],nativeReady:true}),esc);
 assert.ok(markup.includes('&lt;img'));assert.ok(!markup.includes('<img'));assert.match(wechatClientsCard(),/data-wechat-bundled-open disabled/);
});
test('the live version-detection endpoint requires the console token and serves its UI module',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechat-client-api-'));
 fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({runtime:{python:'fixture-python'},wechat:{whitelist:{private:[],groups:[]}}}));
 let scans=0;const app=createConsole({root,port:0,wechatClientScan:async()=>{scans++;return {clients:[verified],nativeReady:true}}});
 const address=await app.start(),base='http://127.0.0.1:'+address.port;
 t.after(()=>{app.close();assert.ok(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 assert.equal((await fetch(base+'/api/wechat-clients')).status,401);assert.equal(scans,0);
 const info=await(await fetch(base+'/api/info')).json();
 const reply=await fetch(base+'/api/wechat-clients',{headers:{'x-console-token':info.token}});assert.equal(reply.status,200);assert.equal((await reply.json()).bundled.canLaunch,true);
 const asset=await fetch(base+'/wechat-clients.mjs');assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
});
