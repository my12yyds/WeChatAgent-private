import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {HookOneBot,onebotId} from './hook-onebot.mjs';import {TextDeliveryStore} from './text-delivery-store.mjs';import {foregroundFavoriteId} from '../packages/wechat-send-policy.mjs';import {VoiceJobs} from '../packages/voice-studio/jobs.mjs';import {VoiceDeliveryWorker} from './voice-delivery-worker.mjs';import {FileDeliveryWorker} from './file-delivery-worker.mjs';import {FileTransfers} from '../packages/dsh-social-bridge-plugin/file-transfers.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'whale-isolation-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'config'));fs.mkdirSync(path.join(root,'state/weflow'),{recursive:true});const config={wechat:{whitelist:{private:['42'],groups:['42']}}};const setMode=mode=>{config.wechat.textTransport={mode};fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify(config));};setMode('native');fs.writeFileSync(path.join(root,'state/weflow/active-account.json'),JSON.stringify({id:'a'.repeat(64)}));fs.writeFileSync(path.join(root,'config/plugins.json'),JSON.stringify({version:1,plugins:{voice:{enabled:true,generation:'g',permissions:['voice'],chats:null,settings:{}}}}));return {root,setMode,config};}
test('foreground mode blocks every Hook route except the read-only health check',async()=>{
 const hook=Object.create(HookOneBot.prototype);let calls=0;Object.assign(hook,{reload(){},project:{wechat:{textTransport:{mode:'foreground'}}},hook:{baseUrl:'http://127.0.0.1:1'},json:async()=>{calls++;return {ok:true};}});
 for(const route of ['/SendTextMsg','/SendTextAtMsg','/SendStickerMsg','/SendVoiceMsg','/SendFileMsg','/SendImageMsg','/FutureSendMethod'])assert.throws(()=>hook.native(route,{}),/HOOK_SEND_DISABLED_IN_FOREGROUND/);
 assert.equal(calls,0);assert.equal((await hook.native('/WeChatAgent/health')).ok,true);assert.equal(calls,1);
 hook.project.wechat.textTransport.mode='native';await hook.native('/SendTextMsg',{});assert.equal(calls,2);
});
test('favorite sticker uses foreground only; replay and switching never click twice',async t=>{
 const f=fixture(t);f.setMode('foreground');let clicks=0,rows=[];
 const hook=Object.create(HookOneBot.prototype);Object.assign(hook,{directory:f.root,project:f.config,hook:{wechatExecutable:'state/Weixin.exe'},reload(){},allowed:()=>true,targetsSending:new Set(),status:{confirmed_sends:0},receiptOverride:3,pollMs:1,textDeliveries:new TextDeliveryStore(path.join(f.root,'deliveries')),checkNative:async()=>({account:'a'}),resolveTarget:async()=> 'recipient',reader:async()=>({sessions:[{username:'recipient',displayName:'Test',conversationId:42}]}),messages:async()=>rows,native:()=>{throw Error('must not call Hook');},foreground:{send:async(body,before)=>{await before();assert.equal(body.favorite,true);clicks++;rows=[{localId:2,localType:47,isSend:true,serverId:'99',createTime:Date.now()/1000}];return {accepted:true,attempted:true};}}});
 assert.equal((await hook.stickerList('private','42')).stickers[0].id,foregroundFavoriteId);
 const first=await hook.sendSticker('private','42',foregroundFavoriteId,'delivery');assert.equal(first.selection,'random-favorite');
 f.config.wechat.textTransport.mode='native';assert.equal((await hook.sendSticker('private','42',foregroundFavoriteId,'delivery')).reused,true);assert.equal(clicks,1);
 f.config.wechat.textTransport.mode='foreground';await assert.rejects(hook.sendSticker('private','42','a'.repeat(64),'other'),/HOOK_STICKER_DISABLED/);assert.equal(clicks,1);
});
test('foreground @ becomes plain naming and never reaches native mention send',async t=>{
 const f=fixture(t);f.setMode('foreground');const hook=Object.create(HookOneBot.prototype);let rows=[];const text='Test，hello';
 Object.assign(hook,{directory:f.root,project:f.config,hook:{wechatExecutable:'state/Weixin.exe'},reload(){},allowed:()=>true,targetsSending:new Set(),status:{confirmed_sends:0,native_mention_send:false},textDeliveries:new TextDeliveryStore(path.join(f.root,'deliveries')),ownWxid:'self',receiptOverride:3,pollMs:1,checkNative:async()=>({account:'a'}),resolveTarget:async()=> 'group@chatroom',reader:async()=>({sessions:[{username:'group@chatroom',displayName:'Test',conversationId:42}]}),messages:async()=>rows,native:()=>{throw Error('must not call Hook');},foreground:{send:async(body,before)=>{await before();assert.equal(body.text,text);rows=[{localId:2,localType:1,isSend:true,serverId:'99',createTime:Date.now()/1000,fullText:text}];return {accepted:true};}}});
 await hook.send('group','42','hello','mention',false,{wxid:'member',id:String(onebotId('member')),name:'Test'});
});
test('switching stops queued voice/file jobs and rejects new requests before preparation',async t=>{
 const f=fixture(t),store=new VoiceJobs(f.root),created=store.queue({key:'wechat:private:42',pluginId:'voice',generation:'g',batchId:'before-switch',request:{kind:'speech',text:'hello'}});f.setMode('foreground');
 assert.throws(()=>store.queue({key:'wechat:private:42',pluginId:'voice',generation:'g',batchId:'after-switch',request:{kind:'speech',text:'hello'}}),/VOICE_DISABLED_IN_FOREGROUND/);
 await assert.rejects(new FileTransfers(f.root).queue({}),/FILE_DISABLED_IN_FOREGROUND/);
 const adapter={directory:f.root,status:{},checkNative:()=>{throw Error('must not inspect or submit Hook for blocked job');}};
 const voice=new VoiceDeliveryWorker(adapter);await voice.run(store.read(created.id),new AbortController().signal);assert.equal(store.read(created.id).error,'VOICE_DISABLED_IN_FOREGROUND');assert.equal(store.read(created.id).state,'failed');
 const file=new FileDeliveryWorker(adapter);let result;file.save=job=>{result=job;};await file.run({state:'queued'});assert.equal(result.error,'FILE_DISABLED_IN_FOREGROUND');assert.equal(result.state,'failed');
 f.setMode('native');assert.equal(store.queue({key:'wechat:private:42',pluginId:'voice',generation:'g',batchId:'restored',request:{kind:'speech',text:'hello'}}).state,'queued');
});
