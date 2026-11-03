import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PluginRuntime} from '../packages/plugin-api/index.mjs';
import {PluginInstaller} from '../packages/plugin-api/installer.mjs';
import {configuration, updatePlugin, packageFiles} from '../packages/plugin-api/catalog.mjs';
import {packZip, unpackZip} from '../packages/plugin-api/zip.mjs';
import {generate, validateDraft, markdown} from '../optional-extensions/persona-studio/lib/studio.mjs';

const source = fileURLToPath(new URL('../optional-extensions/persona-studio/', import.meta.url));
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'plugin.json'), 'utf8'));
const chat = 'wechat:private:123', group = 'wechat:group:456';
const draft = {display_name: '小星', description: '温柔的音乐爱好者', system_prompt: '你是小星，温柔且简短地回应，喜欢音乐，尊重对方的边界，不冒充真实人物。', examples: [{role:'assistant', content:'今天想听什么歌呢？'}]};
const turn = (key=chat, actorId='owner') => ({conversationKey:key, actorId, sessionId:'fixture', toolCalls:0, replies:[]});
async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-plugin-'));
  fs.mkdirSync(path.join(root,'config'));
  fs.writeFileSync(path.join(root,'config/wechatagent.json'), JSON.stringify({wechat:{whitelist:{private:['123'],groups:['456']}}}));
  const installer = new PluginInstaller(root), runtimes = [], calls = [];
  t.after(async()=>{for(const runtime of runtimes) await runtime.dispose();installer.dispose();assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});});
  const preview = installer.inspect({name:'persona.zip',zip:packZip(packageFiles(source)).toString('base64')});
  installer.install({ticket:preview.ticket,revision:preview.revision});
  const make = async(accountScope='fixture-account') => {
    const runtime = new PluginRuntime({root,accountScope,generateText:async args=>{calls.push(args);return JSON.stringify(draft);}});
    runtimes.push(runtime);await runtime.sync();return runtime;
  };
  const enable = (enabled=true) => updatePlugin(root,manifest.id,{revision:configuration(root).revision,enabled,permissions:enabled?manifest.permissions:[],chats:[chat,group],settings:{}});
  return {root,make,enable,calls};
}
const run = async(r,args,ctx=turn()) => JSON.parse((await r.execute('persona-studio__draft',args,ctx)).content);

test('edited local previews validate without model consumption or stored drafts',async t=>{
  const f=await fixture(t);f.enable();const runtime=await f.make();
  const preview=await runtime.invokeAction(manifest.id,'preview',{draft},{conversationKey:chat});
  assert.deepEqual(preview.draft,draft);assert.equal(preview.preview,markdown(draft));
  assert.equal(preview.applied,false);assert.equal(preview.saved,false);assert.equal(f.calls.length,0);
  assert.equal((await run(runtime,{action:'view'})).draft,null);
  await assert.rejects(runtime.invokeAction(manifest.id,'preview',{draft:{...draft,display_name:'../bad'}},{conversationKey:chat}),/名称/);
});

test('self-contained ZIP installs disabled without invoking a model', async t=>{
  const files=unpackZip(packZip(packageFiles(source)));
  assert.deepEqual(files.map(f=>f.name).sort(),['README.md','index.mjs','lib/studio.mjs','plugin.json']);
  const f=await fixture(t),r=await f.make();assert.deepEqual(r.toolDefinitions(chat),[]);assert.equal(f.calls.length,0);
  assert.equal(configuration(f.root).config.plugins[manifest.id].enabled,false);
  f.enable();await r.sync();assert.equal(r.toolDefinitions(chat)[0].name,'persona-studio__draft');
});
test('multi-turn draft preview, stale revision, exact Markdown export and confirmed reset',async t=>{
  const f=await fixture(t);f.enable();const r=await f.make();assert.equal((await run(r,{action:'view'})).revision,0);
  assert.equal((await run(r,{action:'save',draft,expectedRevision:0})).revision,1);
  await assert.rejects(run(r,{action:'save',draft,expectedRevision:0}),/版本|变化/);
  const modified={...draft,description:'活泼的音乐爱好者'};
  await run(r,{action:'save',draft:modified,expectedRevision:1});
  const view=await run(r,{action:'view'});assert.deepEqual(view.draft,modified);assert.equal(view.previousVersions,1);
  const exported=await run(r,{action:'export'});assert.equal(exported.filename,'小星.md');assert.equal(exported.markdown,markdown(modified));
  await assert.rejects(run(r,{action:'reset',expectedRevision:2}),/确认/);
  await run(r,{action:'reset',expectedRevision:2,confirm:true});assert.equal((await run(r,{action:'view'})).draft,null);
  assert.equal(f.calls.length,0);
});
test('drafts isolate account, chat and actor; unknown actors cannot write; state survives worker restart',async t=>{
  const f=await fixture(t);f.enable();const r=await f.make();await run(r,{action:'save',draft,expectedRevision:0});
  for(const ctx of [turn(group),turn(chat,'another')])assert.equal((await run(r,{action:'view'},ctx)).draft,null);
  const other=await f.make('another-account');assert.equal((await run(other,{action:'view'})).draft,null);
  await assert.rejects(run(r,{action:'save',draft,expectedRevision:0},turn(chat,'')),/发送者/);
  await r.dispose();const restored=await f.make();assert.deepEqual((await run(restored,{action:'view'})).draft,draft);
  f.enable(false);await assert.rejects(run(restored,{action:'view'}),/UNAVAILABLE/);
});
test('local action generates with configured model budget and never persists or applies',async t=>{
  const f=await fixture(t);f.enable();const r=await f.make();
  const value=await r.invokeAction(manifest.id,'generate',{message:'更活泼',draft},{conversationKey:chat});
  assert.equal(value.applied,false);assert.equal(value.saved,false);assert.deepEqual(value.draft,draft);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].timeoutMs,25000);assert.equal(f.calls[0].maxChars,4000);
  assert.equal((await run(r,{action:'view'})).draft,null);
});
test('malformed, truncated, unsafe names and oversized drafts are rejected; cancellation never writes',async()=>{
  for(const name of ['../x','CON','README','bad/name','.hidden'])assert.throws(()=>validateDraft({...draft,display_name:name}));
  assert.throws(()=>validateDraft({...draft,system_prompt:'x'.repeat(2201)}));
  assert.throws(()=>validateDraft({...draft,examples:Array(5).fill(draft.examples[0])}));
  for(const raw of ['not json',JSON.stringify({...draft,system_prompt:'short'}),'x'.repeat(4001)])await assert.rejects(generate({model:{generate:async()=>raw}}, {message:'生成'}));
  await assert.rejects(generate({model:{generate:async()=>JSON.stringify(draft)},signal:AbortSignal.abort()}, {message:'生成'}));
});
test('preview stays under 12000 characters after repeated maximum-size edits',async t=>{
  const f=await fixture(t);f.enable();const r=await f.make();
  const large={display_name:'长设定',description:'描'.repeat(300),system_prompt:'设'.repeat(2200),examples:Array.from({length:4},()=>({role:'assistant',content:'例'.repeat(180)}))};
  for(let revision=0;revision<6;revision++)assert(JSON.stringify(await run(r,{action:'save',draft:large,expectedRevision:revision})).length<12000);
  const view=await run(r,{action:'view'});assert.equal(view.previousVersions,3);assert(JSON.stringify(view).length<12000);
});
