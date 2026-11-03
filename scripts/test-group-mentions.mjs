import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {directedGroupReply,groupMentionPrompt,mentionCandidates,limitGroupMention} from '../components/qq-bridge/src/core/group-mentions.js';
import {parseSocialDecision} from '../components/qq-bridge/src/core/decision-format.js';
import {MessageBuffer,replyDeliveryParts} from '../components/qq-bridge/src/core/message-buffer.js';
import {SocialEngine} from '../components/qq-bridge/src/core/social-engine.js';
import {WechatOneBotAdapter} from '../components/qq-bridge/src/adapters/wechat/wechat-onebot-adapter.js';
import {HookOneBot,onebotId} from './hook-onebot.mjs';
import {TextDeliveryStore} from './text-delivery-store.mjs';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const row=(wxid='wxid_test_a',name='小明')=>({platform:'wechat',kind:'group',conversation_id:'123',sender_id:String(onebotId(wxid)),sender_wxid:wxid,sender_key:hash('wechat-member:'+wxid),sender_name:name,self_id:'9',text:'这个怎么用？',message_id:hash(wxid),timestamp:Date.now()/1000});
function realHealthFixture(t,{capability=true,overwriteStatus=false}={}){
 const a=row(),native=[],rows=[{senderUsername:a.sender_wxid,isSend:false,localId:1}],hook=Object.create(HookOneBot.prototype);
 Object.assign(hook,{targetsSending:new Set(),hook:{expectedVersion:'4.1.10.27',baseUrl:'http://127.0.0.1:1'},project:{wechat:{textTransport:{mode:'native'},whitelist:{private:[],groups:['123']}}},status:{confirmed_sends:0},textDeliveries:new TextDeliveryStore(temporary(t)),pollMs:1,receiptOverride:20,reload(){},async reader(route){if(route==='/api/v1/reader/status')return {backend:'weflow-cli-nt',ownWxid:'wxid_self',accountDirectory:'test-account'};if(route.startsWith('/api/v1/sessions'))return {sessions:[{username:'123@chatroom',displayName:'测试群',conversationId:123}]};if(route.startsWith('/api/v1/messages')){if(overwriteStatus)this.status.native_mention_send=false;return {messages:rows};}throw Error('Unexpected fixture route');},async native(route,body,account){if(route==='/WeChatAgent/health')return {integration:'WeChatAgent-1',backend:'wechat-hook',version:'4.1.10.27',databaseAccounts:['test-account'],nativeMentionSend:capability};assert.equal(account,'test-account');native.push({route,body});rows.push({localId:rows.length+1,isSend:true,localType:1,serverId:'1234',createTime:Date.now()/1000,fullText:body.msg});return {ret:0};}});
 return {hook,native,mention:{id:a.sender_id,wxid:a.sender_wxid,name:a.sender_name}};
}
test('real health capability discovery enables group mentions without manually presetting adapter status',async t=>{const f=realHealthFixture(t);assert.equal(f.hook.status.native_mention_send,undefined);const result=await f.hook.send('group','123','请保存',hash('real-health'),false,f.mention);assert.equal(result.delivered,'database-confirmed');assert.equal(f.hook.status.native_mention_send,true);assert.equal(f.native[0].route,'/SendTextAtMsg');assert.deepEqual(f.native[0].body.atUserIds,[f.mention.wxid]);await f.hook.send('group','123','请保存',hash('real-health'),false,f.mention);assert.equal(f.native.length,1);});
test('an explicitly unsupported mention capability is refused before submission while plain group replies still work',async t=>{const f=realHealthFixture(t,{capability:false});await assert.rejects(f.hook.send('group','123','请保存',hash('unsupported'),false,f.mention),/NATIVE_MENTION_UNAVAILABLE/);assert.equal(f.native.length,0);await f.hook.send('group','123','普通群回复',hash('plain'));assert.equal(f.native.length,1);assert.equal(f.native[0].route,'/SendTextMsg');});
test('group send uses its verified capability snapshot instead of a concurrently overwritten status flag',async t=>{const f=realHealthFixture(t,{overwriteStatus:true});const result=await f.hook.send('group','123','请保存',hash('snapshot'),false,f.mention);assert.equal(result.delivered,'database-confirmed');assert.equal(f.native.length,1);assert.equal(f.native[0].route,'/SendTextAtMsg');});
test('explicit target distinguishes same names and mentions only the first text part',()=>{
 const a=row(),b=row('wxid_test_b');const result=directedGroupReply(parseSocialDecision('RESPOND: [REPLY_TO:'+b.sender_key+'] 可以这样操作\n\n然后保存'),[a,b]);
 assert.equal(result.mention.wxid,b.sender_wxid);assert(!result.text.includes('REPLY_TO'));const parts=replyDeliveryParts(result,hash('delivery'));assert.equal(parts[0].mention.wxid,b.sender_wxid);assert.equal(parts[1].mention,undefined);
 assert(groupMentionPrompt([a,b]).includes(b.sender_key));
 const standalone=directedGroupReply(parseSocialDecision('RESPOND: [REPLY_TO:'+a.sender_key+']\n\n请保存'),[a]);assert.equal(standalone.text,'请保存');assert.equal(standalone.mention.wxid,a.sender_wxid);
});
test('name-first fallback is unique, third-person/private/forwarded/fake identities never become mentions',()=>{
 const a=row();assert.equal(directedGroupReply({decision:'RESPOND',text:'小明，你先保存'},[a]).mention.wxid,a.sender_wxid);
 for(const rows of [[a,row('wxid_test_b')],[],[{...a,outgoing:true}],[{...a,forwardedRecord:{}}],[{...a,sender_wxid:'wxid_fake'}],[{...a,kind:'private'}]])assert.equal(directedGroupReply({decision:'RESPOND',text:'小明，你先保存'},rows).mention,undefined);
 assert.equal(directedGroupReply({decision:'RESPOND',text:'我觉得小明说得对'},[a]).mention,undefined);assert.equal(mentionCandidates([{...a,sender_name:'bad\nname'}]).size,0);
 assert.equal(directedGroupReply({decision:'RESPOND',text:'正文 [REPLY_TO:bad]'},[a]).decision,'INVALID');
});
function temporary(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'group-at-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('continued conversation and restarts retain one reminder per member in ten minutes',t=>{
 const a=row(),result=directedGroupReply({decision:'RESPOND',text:'[REPLY_TO:'+a.sender_key+'] 请保存'},[a]),now=Date.now(),file=path.join(temporary(t),'buffer.json'),buffer=new MessageBuffer(file);
 buffer.recordReplyPart('wechat:group:123',{deliveryId:hash('sent')},{...a,outgoing:true,mention:result.mention,text:result.text,timestamp:now/1000,delivery_status:'confirmed'});
 const history=new MessageBuffer(file).recent('wechat:group:123',100);assert.equal(limitGroupMention(result,history,now+1000).mention,undefined);assert.equal(limitGroupMention(result,history,now+600001).mention.wxid,a.sender_wxid);
 const b=row('wxid_other','小红'),other=directedGroupReply({decision:'RESPOND',text:'[REPLY_TO:'+b.sender_key+'] 收到'},[b]);assert.equal(limitGroupMention(other,history,now+1000).mention.wxid,b.sender_wxid);
 const parts=directedGroupReply({decision:'RESPOND',text:'[REPLY_TO:'+a.sender_key+'] 好的\n\n@小明 再保存',textParts:['[REPLY_TO:'+a.sender_key+'] 好的','@小明 再保存']},[a]);assert.equal(parts.textParts[1],'再保存');
});
test('durable parts preserve mention binding and reject changed recipient',t=>{
 const file=path.join(temporary(t),'buffer.json'),buffer=new MessageBuffer(file),a=row(),result=directedGroupReply({decision:'RESPOND',text:'[REPLY_TO:'+a.sender_key+'] 请保存'},[a]),deliveryId=hash('pending');
 buffer.append(a);buffer.rememberReply('wechat:group:123',{result,deliveryId,parts:replyDeliveryParts(result,deliveryId),throughId:'id',message:a});
 assert.equal(new MessageBuffer(file).pendingReplies.get('wechat:group:123').parts[0].mention.wxid,a.sender_wxid);
 const saved=JSON.parse(fs.readFileSync(file));saved.pendingReplies['wechat:group:123'].parts[0].mention.name='other';fs.writeFileSync(file,JSON.stringify(saved));assert.throws(()=>new MessageBuffer(file),/invalid reply outbox/);
});
test('social reply sends resolved target through adapter with no control-token leak',async t=>{
 const a=row(),sent=[],buffer=new MessageBuffer(path.join(temporary(t),'buffer.json'));
 const engine=new SocialEngine({buffer,decide:async(key,prompt)=>{assert(prompt.includes(a.sender_key));return 'RESPOND: [REPLY_TO:'+a.sender_key+'] 请先保存';},send:async(message,text,options)=>{sent.push({text,...options});return {confirmed:true};},batchMs:1,minIntervalMs:0,maxPerMinute:100,maxPerTenMinutes:100,log:()=>{}});t.after(()=>engine.stop());engine.receive(a);
 const deadline=Date.now()+3000;while(!sent.length&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.equal(sent.length,1);assert.equal(sent[0].mention.wxid,a.sender_wxid);assert.equal(sent[0].text,'请先保存');
});
test('OneBot at segment reaches exact native API; replay never submits again or changes target',async t=>{
 const a=row(),mention={id:a.sender_id,wxid:a.sender_wxid,name:a.sender_name},native=[],dir=temporary(t),deliveryId=hash('native');let submitted=false;
 const hook=Object.create(HookOneBot.prototype);Object.assign(hook,{targetsSending:new Set(),hook:{},project:{wechat:{textTransport:{mode:'native'}}},status:{native_mention_send:true,confirmed_sends:0},textDeliveries:new TextDeliveryStore(dir),ownWxid:'wxid_self',pollMs:1,receiptOverride:20,reload(){},allowed(){return true;},async checkNative(){return {account:'test'};},async resolveTarget(){return '123@chatroom';},async messages(){return [{senderUsername:a.sender_wxid,isSend:false,localId:1},...(submitted?[{localId:2,isSend:true,localType:1,serverId:'1234',createTime:Date.now()/1000,fullText:'@小明\u2005请保存'}]:[])];},async native(route,body){native.push({route,body});submitted=true;return {ret:0};},activeActions:0});
 const adapter=new WechatOneBotAdapter();adapter.server.action=async(action,params)=>{const out=await hook.action({action,params});if(out.status!=='ok')throw Object.assign(Error(out.message),{code:out.message});return out;};
 const send=()=>adapter.sendText({kind:'group',target:'123',text:'请保存',mention,deliveryId});await send();await send();assert.equal(native.length,1);assert.equal(native[0].route,'/SendTextAtMsg');assert.deepEqual(native[0].body.atUserIds,[a.sender_wxid]);
 await assert.rejects(adapter.sendText({kind:'group',target:'123',text:'请保存',mention:{...mention,name:'changed'},deliveryId}),/TEXT_DELIVERY_ID_CONFLICT/);
 await assert.rejects(adapter.sendText({kind:'private',target:'123',text:'请保存',mention}),/invalid WeChat mention/);
 submitted=false;hook.textDeliveries=new TextDeliveryStore(path.join(dir,'new'));hook.messages=async()=>[];await assert.rejects(send(),/MENTION_MEMBER_NOT_IN_CHAT/);assert.equal(native.length,1);
});
