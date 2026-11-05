import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createVoiceComponents} from './voice-components.mjs';
import {createConsole} from './console-server.mjs';
import {voiceServiceSettings} from './voice-service-settings.mjs';
function fixture(t){const home=fs.mkdtempSync(path.join(os.tmpdir(),'wechatgirl-components-'));const root=path.join(home,'data/workspace');fs.mkdirSync(root,{recursive:true});t.after(()=>{assert.ok(path.resolve(home).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(home,{recursive:true,force:true,maxRetries:5,retryDelay:100});});return root;}
test('component ZIP validation, CRC, locks and non-overwrite behavior use disposable fixtures',()=>{
 const result=spawnSync(process.env.WECHATAGENT_TEST_PYTHON??'python',['-B',fileURLToPath(new URL('./test-voice-components.py',import.meta.url))],{encoding:'utf8',windowsHide:true,timeout:15000});assert.equal(result.status,0,result.stderr||result.error?.message);
});
test('component endpoints require console authorization and reject client-selected paths',async t=>{
 const root=fixture(t),app=createConsole({root,port:0,filePicker:async()=>''});const base='http://127.0.0.1:'+(await app.start()).port;t.after(()=>app.close());
 assert.equal((await fetch(base+'/api/voice-components')).status,401);
 const {token}=await(await fetch(base+'/api/info')).json();const headers={'Content-Type':'application/json','x-console-token':token,Origin:base};
 const state=await(await fetch(base+'/api/voice-components',{headers})).json();assert.equal(state.components.length,2);
 assert.equal((await fetch(base+'/api/voice-components/import',{method:'POST',headers,body:JSON.stringify({path:'C:/unselected.zip'})})).status,400);
 const cancel=await(await fetch(base+'/api/voice-components/select',{method:'POST',headers,body:'{}'})).json();assert.equal(cancel.cancelled,true);
});
test('local service startup reads the encrypted custom port without returning plugin secrets',t=>{
 const root=fixture(t);fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/plugins.json'),JSON.stringify({version:1,plugins:{'voice-studio':{enabled:true,permissions:['voice'],settings:{breezePort:20881,apiKey:'synthetic-secret-not-for-stdout'}}}}));
 assert.deepEqual(voiceServiceSettings(root),{enabled:true,port:20881});assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config/plugins.json'))).version,2);
 const child=spawnSync(process.execPath,[fileURLToPath(new URL('./voice-service-settings.mjs',import.meta.url)),root],{encoding:'utf8',windowsHide:true});assert.equal(child.status,0);assert.deepEqual(JSON.parse(child.stdout),{enabled:true,port:20881});assert.doesNotMatch(child.stdout+child.stderr,/synthetic-secret/);
});
test('the actual published component archive imports without executing its binaries and can be selected again safely',{skip:!process.env.WECHATGIRL_TEST_VOICE_ZIP},async t=>{
 const root=fixture(t),manager=createVoiceComponents({root,pickFile:async()=>process.env.WECHATGIRL_TEST_VOICE_ZIP,python:()=>process.env.WECHATAGENT_TEST_PYTHON});
 const selected=await manager.select();assert.ok(selected.ticket);assert.throws(()=>manager.start({ticket:'invalid'}),{status:409});
 manager.start({ticket:selected.ticket});assert.throws(()=>manager.start({ticket:selected.ticket}),{status:409});await manager.wait();
 let state=manager.snapshot();assert.equal(state.job.phase,'complete',state.job.message);assert.ok(state.components.every(c=>c.status==='present'));assert.equal(state.localFiles.speechModel,false);
 const sentinel=path.join(path.dirname(root),'voice-python/owner-test.txt');fs.writeFileSync(sentinel,'preserve');const repeated=await manager.select();manager.start({ticket:repeated.ticket});await manager.wait();state=manager.snapshot();assert.equal(state.job.phase,'complete');assert.equal(fs.readFileSync(sentinel,'utf8'),'preserve');assert.deepEqual(state.job.installed,[]);
});
