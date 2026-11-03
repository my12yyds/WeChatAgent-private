import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {bindDshAccess,DSH_ACCESS_POLICY} from '../packages/dsh-social-bridge-plugin/dsh-access.mjs';
import {verifiedBatchSender} from '../packages/dsh-social-bridge-plugin/assistant-policy.mjs';
import {validateConversationSettings} from '../packages/dsh-social-bridge-plugin/conversation-policy.mjs';
import {applyChatSettings,chatSettingsSnapshot} from '../public/console/conversation-settings.mjs';
const key='wechat:private:123';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'social-dsh-'));
 fs.mkdirSync(path.join(root,'config'));
 const config={persona:{default:'test',chats:{}},wechat:{whitelist:{private:['123'],groups:[]},assistant:{administrators:['wxid_owner']},workModes:{[key]:'social'},dshAccess:{chats:{[key]:{skills:['office'],tools:['read','pwsh'],chatExecution:true,toolLimit:10}}}}};
 const save=()=>fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify(config));save();
 let turn={actorId:'wxid_owner',controller:new AbortController(),toolCalls:0,skillCalls:0},registered;
 const agentCtx={tools:{register:value=>{registered=value;return ()=>{};}}},agent={session:{header:{cwd:root}}};
 const services={tools:{schemas:()=>['read','write','pwsh','task_board_list'].map(name=>({name}))},skills:{get:async name=>({name,content:'Office instructions'})}};
 const binding=bindDshAccess(agentCtx,{get:name=>services[name]},agent,root,key,()=>turn);
 t.after(()=>{binding.dispose();assert(root.startsWith(os.tmpdir()+path.sep));fs.rmSync(root,{recursive:true,force:true});});
 return {config,save,binding,policy:agentCtx[DSH_ACCESS_POLICY],get turn(){return turn;},set turn(value){turn=value;},loader:()=>registered};
}
test('chat execution exposes only explicitly granted tools to the trusted administrator',async t=>{
 const f=fixture(t);assert.deepEqual([...f.policy.names()].sort(),['pwsh','read','skill']);assert(f.policy.check('read'));assert(!f.policy.check('write'));
 assert.match(await f.binding.instructions(),/聊天模式 DSH 授权/);
 const value=await f.loader().execute({name:'office'});assert.match(value.content,/Office instructions/);
 f.turn.actorId='wxid_guest';assert.equal(f.policy.names().size,0);assert(!f.policy.check('read'));await assert.rejects(f.loader().execute({name:'office'}),/NOT_ALLOWED/);
 f.turn.actorId='';assert.equal(f.policy.names().size,0);
});
test('default off, live permission revocation, administrator revocation and per-turn budgets fail closed',t=>{
 const f=fixture(t);delete f.config.wechat.dshAccess.chats[key].chatExecution;f.save();assert.equal(f.policy.names().size,0);
 f.config.wechat.dshAccess.chats[key].chatExecution=true;f.save();assert(f.policy.check('pwsh'));
 f.config.wechat.dshAccess.chats[key].tools=['read'];f.save();assert(!f.policy.check('pwsh'));
 f.turn.toolCalls=9;assert(f.policy.check('read'));assert(!f.policy.check('read'));
 f.config.wechat.dshAccess.chats[key].chatExecution=false;f.save();assert.equal(f.policy.names().size,0);
 f.config.wechat.dshAccess.chats[key].chatExecution=true;f.config.wechat.assistant.administrators=[];f.save();assert.equal(f.policy.names().size,0);
 f.config.wechat.assistant.administrators=['wxid_owner'];f.save();f.turn.controller.abort();assert.equal(f.policy.names().size,0);
});
test('skill output is rejected if permission is revoked while a skill is loading',async t=>{
 const f=fixture(t),loader=f.loader();const promise=loader.execute({name:'office'});f.config.wechat.dshAccess.chats[key].chatExecution=false;f.save();await assert.rejects(promise,/NOT_ALLOWED/);
});
test('chat permission settings persist independently from assistant settings and reject invalid switches',t=>{
 const f=fixture(t),snapshot=chatSettingsSnapshot(f.config,key);
 applyChatSettings(f.config,key,snapshot.settings,{...snapshot.access,chatExecution:false,toolLimit:15});
 assert.equal(chatSettingsSnapshot(f.config,key).access.chatExecution,false);validateConversationSettings(f.config.wechat);
 assert.throws(()=>applyChatSettings(f.config,key,snapshot.settings,{...snapshot.access,chatExecution:'yes'}),/开关/);
 assert.throws(()=>applyChatSettings(f.config,key,snapshot.settings,{...snapshot.access,mode:'native'}),/助手模式/);
 applyChatSettings(f.config,key,{...snapshot.settings,workMode:'assistant'},{skills:[],tools:[],mode:'native'});
 const social=chatSettingsSnapshot(f.config,key,'social');assert.equal(social.access.chatExecution,false);assert.deepEqual(social.access.tools,['pwsh','read']);
});
test('mixed, forged or missing senders cannot inherit the administrator identity',()=>{
 const id=wxid=>String(Number(crypto.createHash('sha256').update(wxid).digest().readBigUInt64BE(0)%2147483647n+1n));
 const row=wxid=>({platform:'wechat',kind:'group',sender_wxid:wxid,sender_id:id(wxid),conversation_id:'999'});
 assert.equal(verifiedBatchSender([row('wxid_owner'),row('wxid_owner')]),'wxid_owner');
 assert.equal(verifiedBatchSender([row('wxid_owner'),row('wxid_guest')]),'');
 assert.equal(verifiedBatchSender([row('wxid_owner'),{...row('wxid_guest'),sender_wxid:'wxid_owner'}]),'');
 assert.equal(verifiedBatchSender([row('wxid_owner'),{}]),'');assert.equal(verifiedBatchSender([]),'');
});
