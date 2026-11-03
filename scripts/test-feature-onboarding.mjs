import test from 'node:test';import assert from 'node:assert/strict';
import {featureSetupItems,featureSetupMarkup} from '../public/console/feature-setup.mjs';import {setupProgress,setupGuideFrame} from '../public/console/dsh-install.mjs';import {consoleRoute} from '../public/console/layout-model.mjs';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('new configurable plugins automatically receive safe setup instructions without rendering secrets',()=>{
 const items=featureSetupItems({plugins:[{id:'new-feature',name:'<img src=x>',enabled:false,requestedPermissions:['storage'],settings:{token:'SECRET_VALUE'},configSchema:{token:{title:'服务凭据',secret:true}}}]});
 const plugin=items.find(i=>i.pluginId==='new-feature');assert(plugin);assert.deepEqual(plugin.fields,['服务凭据']);const html=featureSetupMarkup(items,esc);assert(html.includes('data-plugin-config-route href="#plugins/new-feature"'));assert(html.includes('配置插件并选择聊天'));assert(html.includes('feature-setup-grid'));assert(!html.includes('SECRET_VALUE'));assert(html.includes('&lt;img src=x&gt;'));assert(!html.includes('<img src=x>'));
});
test('foreground onboarding explains disabled voice and favorite stickers while music remains configurable',()=>{
 const items=featureSetupItems({project:{wechat:{textTransport:{mode:'foreground'}}},plugins:[{id:'voice-studio',enabled:true,requestedPermissions:['voice'],configSchema:{}},{id:'netease-music',requestedPermissions:['web_fetch'],configSchema:{}}],music:{account:{loggedIn:true}}});
 assert(items.find(i=>i.pluginId==='voice-studio').blocked);assert.equal(items.find(i=>i.pluginId==='netease-music').status,'网易云登录已保存');assert(items.find(i=>i.id==='stickers').steps.join('').includes('收藏'));
});
test('saved sending mode is required in guide; optional features do not block completed basic setup',()=>{
 const config={runtime:{dshDesktop:'DSH.exe'},dsh:{provider:'p',model:'m'},wechat:{whitelist:{private:['1'],groups:[]}}},input={config,reader:{verified:true},status:{ready:true,services:[{id:'dsh',ready:true}]},catalog:{available:true,models:[{provider:'p',model:'m'}]}};
 let progress=setupProgress(input);assert.equal(progress.next,'sending');assert.equal(progress.canStart,false);
 config.wechat.textTransport={mode:'foreground'};progress=setupProgress(input);assert.equal(progress.complete,true);assert.equal(progress.total,6);assert.equal(progress.completed,6);assert.equal(progress.next,'features');assert(progress.steps.find(i=>i.id==='features').optional);
 const draft=structuredClone(config);draft.wechat.textTransport.mode='native';assert.equal(setupProgress({...input,draft}).canStart,false);
 const html=setupGuideFrame({progress,selected:'chats',content:'',esc});assert(html.includes('data-guide-step="features">下一步'));
});
test('dedicated sending page and deep-linked setup steps are routed without accepting unknown setup steps',()=>{
 assert.deepEqual(consoleRoute('#sending'),{page:'sending'});assert.deepEqual(consoleRoute('#setup/features'),{page:'setup',section:'features'});assert.deepEqual(consoleRoute('#setup/sending'),{page:'setup',section:'sending'});assert.deepEqual(consoleRoute('#setup/unknown'),{page:'setup'});
 assert.deepEqual(consoleRoute('#plugins/voice-studio'),{page:'plugins',section:'voice-studio'});assert.deepEqual(consoleRoute('#plugins/not_valid'),{page:'plugins'});
});
