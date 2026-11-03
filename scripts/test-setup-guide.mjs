import test from 'node:test';import assert from 'node:assert/strict';
import {setupProgress,setupConfigured,setupGuideFrame} from '../public/console/dsh-install.mjs';
const config={runtime:{dshDesktop:'C:/DSH/DeepSeek Harness.exe'},dsh:{provider:'provider',model:'chat-model'},wechat:{textTransport:{mode:'native'},whitelist:{private:['123'],groups:[]}}};
const ready={config,reader:{verified:true},status:{ready:true,services:[{id:'dsh',ready:true}]},catalog:{available:true,models:[{provider:'provider',model:'chat-model'}]}};
test('a new account starts at WeChat and saved model text alone does not pass model verification',()=>{
 const empty=setupProgress();assert.equal(empty.completed,0);assert.equal(empty.next,'wechat');assert.equal(empty.canStart,false);
 const noCatalog=setupProgress({...ready,catalog:undefined});assert.equal(noCatalog.steps[2].done,false);assert.equal(noCatalog.complete,false);assert.equal(noCatalog.canStart,false);
 const invalidModel=setupProgress({...ready,catalog:{available:true,models:[{provider:'another-provider',model:'chat-model'}]}});assert.equal(invalidModel.steps[2].done,false);
});
test('real prerequisites are required, and unsaved choices never count as completed setup',()=>{
 assert.equal(setupProgress(ready).complete,true);
 for(const variant of [{readerPending:true},{selectionIncomplete:true},{draft:{...config,dsh:{provider:'provider',model:'unsaved'}}},{draft:{...config,runtime:{dshDesktop:'C:/unsaved.exe'}}},{status:{...ready.status,dshRestartRequired:true}},{status:{...ready.status,pendingApply:true}}])assert.equal(setupProgress({...ready,...variant}).complete,false);
 const draft=structuredClone(config);draft.wechat.whitelist.groups.push('789');assert.equal(setupProgress({...ready,draft}).steps[4].done,false);
});
test('services can start before choosing chats, but the guide remains unfinished until saved scope is active',()=>{
 const noChats=structuredClone(config);noChats.wechat.whitelist.private=[];
 const state=setupProgress({...ready,config:noChats});assert.equal(state.canStart,true);assert.equal(state.steps[3].done,true);assert.equal(state.steps[4].done,false);assert.equal(state.next,'chats');
 assert.equal(setupConfigured(noChats,ready.reader),false);assert.equal(setupConfigured(config,ready.reader),true);
 const stopped=setupProgress({...ready,status:{ready:false,services:[{id:'dsh',ready:true}]}});assert.equal(stopped.next,'start');assert.equal(stopped.complete,false);
});
test('guide navigation is accessible and renderer escapes dynamic descriptions',()=>{
 const progress=setupProgress(ready);progress.steps[0].description='<script>bad</script>';
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html=setupGuideFrame({progress,selected:'wechat',content:'<p>本机配置</p>',esc});
 assert.match(html,/aria-current="step"/);assert.match(html,/aria-label="配置步骤"/);assert.match(html,/&lt;script&gt;bad/);assert(!html.includes('<script>bad'));
});
