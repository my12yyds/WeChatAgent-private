import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {RUNTIME_COMPONENTS,peExports,verifyReaderKey,verifyPackagedComponents} from './runtime-components.mjs';
const {bootstrapDeployment}=createRequire(import.meta.url)('../desktop/deployment.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechatgirl-native-component-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});return root;}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}
function image(names=RUNTIME_COMPONENTS.readerKey.exports){
 const b=Buffer.alloc(4096);b.write('MZ');b.writeUInt32LE(128,60);b.writeUInt32LE(0x4550,128);b.writeUInt16LE(0x8664,132);b.writeUInt16LE(1,134);b.writeUInt16LE(240,148);b.writeUInt16LE(0x2022,150);const o=152;b.writeUInt16LE(0x20b,o);b.writeUInt32LE(0x1000,o+112);
 const s=o+240;b.writeUInt32LE(0x1000,s+12);b.writeUInt32LE(3584,s+16);b.writeUInt32LE(512,s+20);b.writeUInt32LE(names.length,512+24);b.writeUInt32LE(0x1100,512+32);
 names.forEach((name,i)=>{b.writeUInt32LE(0x1200+i*64,768+i*4);b.write(name,1024+i*64,'ascii');});return b;
}
test('reader key checks reject a missing or changed binary before building',t=>{
 const root=fixture(t),file=path.join(root,'wx_key.dll');assert.throws(()=>verifyReaderKey(file),{code:'RELEASE_READER_KEY_MISSING'});write(file,Buffer.from('not-a-reader-library'));assert.throws(()=>verifyReaderKey(file),{code:'RELEASE_READER_KEY_HASH_MISMATCH'});
});
test('a reader component must be an x64 DLL with all required exports',t=>{
 const root=fixture(t),file=path.join(root,'wx_key.dll'),b=image(),spec={...RUNTIME_COMPONENTS.readerKey,bytes:b.length,sha256:hash(b)};write(file,b);assert.equal(verifyReaderKey(file,spec).sha256,spec.sha256);
 const altered=image(['InitializeHook']);write(file,altered);assert.throws(()=>verifyReaderKey(file,{...spec,sha256:hash(altered)}),{code:'RELEASE_READER_KEY_API_MISMATCH'});
 assert.throws(()=>peExports(Buffer.alloc(20)),{code:'RELEASE_COMPONENT_PE_INVALID'});
});
test('having the DLL in the installer template is insufficient without a deployment entry',t=>{
 const project=fixture(t),b=image(),spec={...RUNTIME_COMPONENTS.readerKey,bytes:b.length,sha256:hash(b)};write(path.join(project,spec.path),b);write(path.join(project,'deployment.json'),JSON.stringify({files:[],sourceHashes:{}}));
 assert.throws(()=>verifyPackagedComponents(project,spec),{code:'RELEASE_READER_KEY_NOT_DEPLOYED'});
 write(path.join(project,'deployment.json'),JSON.stringify({files:[spec.path],sourceHashes:{[spec.path]:spec.sha256}}));assert.equal(verifyPackagedComponents(project,spec).sha256,spec.sha256);
});
test('first deployment copies the native reader file into the actual workspace and retains user configuration',async t=>{
 const root=fixture(t),resources=path.join(root,'resources'),project=path.join(resources,'project'),home=path.join(root,'data'),relative=RUNTIME_COMPONENTS.readerKey.path,b=image();
 write(path.join(project,relative),b);write(path.join(project,'config/wechatagent.example.json'),JSON.stringify({runtime:{}}));
 write(path.join(project,'deployment.json'),JSON.stringify({version:'0.5.3',runtimeRevision:'fixture',dshBundled:false,files:[relative,'config/wechatagent.example.json'],sourceHashes:{[relative]:hash(b)}}));
 write(path.join(resources,'runtime/python/python.exe'),'synthetic-python');write(path.join(resources,'runtime/node.exe'),'synthetic-node');write(path.join(resources,'vendor/wechat/Weixin.exe'),'synthetic-client');write(path.join(resources,'vendor/hook/version.dll'),'synthetic-hook');write(path.join(resources,'vendor/hook/build.json'),JSON.stringify({sha256:hash(Buffer.from('synthetic-hook'))}));
 await bootstrapDeployment(resources,home);const deployed=path.join(home,'workspace',relative);assert.deepEqual(fs.readFileSync(deployed),b);
 const settings=path.join(home,'workspace/config/wechatagent.json');const config=JSON.parse(fs.readFileSync(settings));config.userFixture='preserve';write(settings,JSON.stringify(config));fs.unlinkSync(deployed);await bootstrapDeployment(resources,home);assert.deepEqual(fs.readFileSync(deployed),b);assert.equal(JSON.parse(fs.readFileSync(settings)).userFixture,'preserve');
});
