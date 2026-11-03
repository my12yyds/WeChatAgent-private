import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createSettingsCodec} from '../packages/plugin-api/settings-protection.mjs';
import {configuration,saveConfiguration} from '../packages/plugin-api/catalog.mjs';

const legacy={version:1,plugins:{example:{enabled:true,permissions:['web_fetch'],chats:['wechat:private:123'],generation:'unchanged',settings:{apiKey:'synthetic-private-key',headersJson:'{"Authorization":"synthetic-header"}',model:'fixture'}}}};
test('the settings envelope hides all values and preserves activation, permissions and chat scope',()=>{
 const vault=new Map();let count=0;const codec=createSettingsCodec((text,mode)=>{if(mode==='protect'){const id='cipher-'+ ++count;vault.set(id,text);return id;}if(!vault.has(text))throw Error('wrong account');return vault.get(text);});
 const sealed=codec.encode(legacy);assert.equal(sealed.version,2);assert.doesNotMatch(JSON.stringify(sealed),/synthetic-private-key|synthetic-header|fixture/);assert.deepEqual(sealed.plugins.example.settings,{});
 const opened=codec.decode(sealed);assert.deepEqual(opened.plugins,legacy.plugins);assert.equal(codec.encode(opened).protectedSettings.data,sealed.protectedSettings.data);assert.equal(count,1);
});
test('unavailable protection or another user does not produce a plaintext fallback',()=>{
 const codec=createSettingsCodec(()=>{throw Error('must not leak service detail');});
 assert.throws(()=>codec.encode(legacy),e=>e.code==='PLUGIN_SETTINGS_PROTECTION_FAILED'&&!e.message.includes('service detail'));
 assert.throws(()=>codec.decode({version:2,plugins:legacy.plugins,protectedSettings:{scheme:'windows-dpapi-current-user-v1',data:'unavailable'}}),{code:'PLUGIN_SETTINGS_PROTECTION_FAILED'});
 assert.throws(()=>codec.decode({...legacy,protectedSettings:{data:'tampered'}}),{code:'PLUGIN_SETTINGS_PROTECTION_FAILED'});
 assert.equal(legacy.plugins.example.settings.apiKey,'synthetic-private-key');
});
test('real Windows DPAPI migration is atomic and a fresh Node process can decrypt without returning secrets to logs',{skip:process.platform!=='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wechatgirl-settings-dpapi-'));t.after(()=>{assert.ok(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true,maxRetries:5,retryDelay:50});});
 const file=path.join(root,'config/plugins.json');fs.mkdirSync(path.dirname(file));fs.writeFileSync(file,JSON.stringify(legacy));
 const read=configuration(root);assert.equal(read.config.plugins.example.settings.apiKey,'synthetic-private-key');const stored=fs.readFileSync(file,'utf8');assert.doesNotMatch(stored,/synthetic-private-key|synthetic-header/);assert.equal(JSON.parse(stored).version,2);
 const module=new URL('../packages/plugin-api/catalog.mjs',import.meta.url).href;
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {configuration} from ${JSON.stringify(module)};const c=configuration(process.argv[1]);if(c.config.plugins.example.settings.apiKey!=='synthetic-private-key')process.exit(2);console.log('decrypt passed');`,root],{encoding:'utf8',windowsHide:true,timeout:15000});
 assert.equal(child.status,0);assert.equal(child.stdout.trim(),'decrypt passed');assert.doesNotMatch(child.stdout+child.stderr,/synthetic-private-key/);
 const revision=read.revision;fs.writeFileSync(file+'.write.lock','synthetic concurrent writer');assert.throws(()=>saveConfiguration(root,read.config,revision),{status:409});assert.equal(fs.readFileSync(file,'utf8'),stored);fs.unlinkSync(file+'.write.lock');saveConfiguration(root,read.config,revision);assert.throws(()=>saveConfiguration(root,read.config,'stale'),{status:409});
 const bad=JSON.parse(fs.readFileSync(file,'utf8'));bad.protectedSettings.data='corrupt';fs.writeFileSync(file,JSON.stringify(bad));const before=fs.readFileSync(file,'utf8');assert.throws(()=>configuration(root),{code:'PLUGIN_SETTINGS_PROTECTION_FAILED'});assert.equal(fs.readFileSync(file,'utf8'),before);
});
