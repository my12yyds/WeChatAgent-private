import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';
import {HistoryStore} from '../packages/dsh-social-bridge-plugin/history-store.mjs';
import {continuityContext,summaryDue} from '../packages/dsh-social-bridge-plugin/continuity-memory.mjs';
import {recentWindow} from '../packages/dsh-social-bridge-plugin/request-window.mjs';
import {HISTORY_DEFAULTS,migrateHistorySettings,validateHistorySettings} from '../packages/dsh-social-bridge-plugin/history-policy.mjs';
import {PeopleMemory} from '../packages/plugin-api/people-memory.mjs';import {selfFacts} from '../packages/plugin-api/people-facts.mjs';
import {summarizeHistory} from '../packages/dsh-social-bridge-plugin/history-runtime.mjs';
const key='wechat:group:1',other='wechat:group:2',account='a'.repeat(64),policy={...HISTORY_DEFAULTS,enabled:true,mode:'window',recentMessages:8,recentChars:4000};
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'memory-continuity-'));const store=new HistoryStore(root,account);t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});return {root,store};}
function add(store,id,text,sender='alice',chat=key,extra={}){return store.append(chat,{id:String(id),kind:'group',sender_id:sender==='alice'?'1':'2',sender_name:'同名',sender_wxid:sender,timestamp:Date.now()/1000+id,text,...extra});}
const turn=(text,chat=key,sender='alice',id=text)=>({conversationKey:chat,peopleObservations:[{senderId:sender,name:'同名',evidenceId:crypto.createHash('sha256').update(id).digest('hex'),text,at:Date.now()}]});

test('old facts survive 70 messages and process restart; automatic recall remains in the exact source chat',t=>{
 const {root,store}=fixture(t);add(store,1,'我叫小桃');add(store,2,'我的猫叫奶糖');for(let i=3;i<=72;i++)add(store,i,'今天聊天第'+i+'句');add(store,73,'秘密项目叫另一群独有', 'alice',other);
 let recent=recentWindow(store.windowRows(key,policy),policy),context=continuityContext(store,key,policy,{recent,observations:turn('我的猫叫什么').peopleObservations});assert(context.includes('奶糖'));assert(context.includes('小桃'));assert(!context.includes('另一群独有'));assert(context.includes('"person"'));assert(summaryDue(store.summaryBatch(key,policy)));
 const second=new HistoryStore(root,account);try{context=continuityContext(second,key,policy,{recent});assert(context.includes('奶糖'));assert.equal(second.rows(key).length,72);}finally{second.close();}
});

test('same-name people and corrections stay bound to transport identity, including the latest unarchived turn',t=>{
 const {store}=fixture(t);add(store,1,'我叫小桃','alice');add(store,2,'我叫小蓝','bob');for(let i=3;i<=20;i++)add(store,i,'普通聊天'+i);
 const recent=recentWindow(store.windowRows(key,policy),policy),context=continuityContext(store,key,policy,{recent,observations:turn('以后叫我小红').peopleObservations});assert(!context.includes('小桃'));assert(context.includes('小蓝'));assert(!context.includes('小红')); // current statement already lives in the current message
});

test('quoted, forwarded and assistant claims never become durable self facts; summaries automatically rejoin context',t=>{
 const {store}=fixture(t);add(store,1,'我叫伪造名字','alice',key,{quoteReply:{reply:'我叫伪造名字'}});add(store,2,'我的猫叫伪造猫','alice',key,{outgoing:true,delivery_status:'confirmed'});add(store,3,'我喜欢咖啡','alice',key,{forwardedRecord:{items:[]}});for(let i=4;i<=30;i++)add(store,i,'一般聊天'+i);
 const batch=store.summaryBatch(key,policy);store.commitSummary(key,batch,'当时约定周末去公园 [#4]');const context=continuityContext(store,key,policy,{recent:recentWindow(store.windowRows(key,policy),policy)});assert(!context.includes('伪造名字'));assert(!context.includes('伪造猫'));assert(context.includes('周末去公园'));assert(!summaryDue(store.summaryBatch(key,policy)));
});

test('direct self facts expand safely and changing nicknames replace older evidence without merging people',t=>{
 const {root}=fixture(t),memory=new PeopleMemory({root,accountScope:account,accountId:account});memory.capture(turn('我叫小明'));memory.capture(turn('以后叫我小红'));memory.capture(turn('我的猫叫奶糖'));memory.capture(turn('我正在学习Python'));const notes=memory.recall(turn('我的猫和名字'),{limit:8})[0].notes;assert(!notes.some(n=>n.text==='我叫小明'));assert(notes.some(n=>n.text==='以后叫我小红'));assert(notes.some(n=>n.text==='我的猫叫奶糖'));assert(notes.some(n=>n.text==='我正在学习Python'));assert.equal(memory.recall(turn('我是谁',key,'bob'))[0].notes.length,0);
 for(const text of ['我叫小明吗？','我喜欢咖啡吗?','他说我叫小明','假如我的猫叫奶糖','我的密码是12345678'])assert.deepEqual(selfFacts(text),[]);
 assert.equal(selfFacts('我叫小明，你呢？')[0].value,'小明');
});

test('manual cross-chat memory rejects negative sharing; an actual same person may share without exposing private notes',t=>{
 const {root}=fixture(t),memory=new PeopleMemory({root,accountScope:account,accountId:account});const negative=turn('记住我喜欢音乐，但不要跨聊天共享');assert.throws(()=>memory.remember(negative,{text:'我喜欢音乐',evidenceId:negative.peopleObservations[0].evidenceId,visibility:'person'}),/SHARING_NOT_CONFIRMED/);
 memory.capture(turn('我的猫叫奶糖'));memory.capture(turn('跨聊天都记住，我叫小桃'));const notes=memory.recall(turn('你记得我吗',other))[0].notes;assert(notes.some(n=>n.text==='我叫小桃'));assert(!notes.some(n=>n.text.includes('奶糖')));
});

test('new installations use a useful continuity window; explicit existing configuration remains untouched',()=>{
 const config={wechat:{}};assert(migrateHistorySettings(config));assert.equal(config.wechat.history.recentMessages,40);assert.equal(config.wechat.history.recentChars,12000);assert.equal(config.wechat.history.coldWakeMinutes,0);validateHistorySettings(config.wechat.history);const old={wechat:{history:{enabled:false,recentMessages:8}}};assert(!migrateHistorySettings(old));assert.equal(old.wechat.history.enabled,false);
});

test('backfill keeps stable identity metadata and forgetting suppresses automatically pinned old facts',t=>{
 const {store}=fixture(t);add(store,1,'我的猫叫奶糖');const original=store.rows(key)[0].sender_person;store.append(key,{id:'1',kind:'group',sender_id:'1',sender_name:'同名',timestamp:Date.now()/1000+1,text:'我的猫叫奶糖'});assert.equal(store.rows(key)[0].sender_person,original);
 add(store,2,'忘记我的猫叫什么');for(let i=3;i<=30;i++)add(store,i,'聊天内容'+i);const context=continuityContext(store,key,policy,{recent:recentWindow(store.windowRows(key,policy),policy),observations:turn('猫叫什么').peopleObservations});assert(!context.includes('奶糖'));
});

test('current identity links match the cross-chat person store and never merge same-name IDs',t=>{
 const {root,store}=fixture(t),observations=[...turn('你好').peopleObservations,...turn('你好',key,'bob').peopleObservations];for(let i=1;i<20;i++)add(store,i,'随便聊聊');
 const context=continuityContext(store,key,policy,{recent:recentWindow(store.windowRows(key,policy),policy),observations:[...observations,...observations],accountId:account});const json=JSON.parse(context.slice(context.indexOf('\n')+1));assert.equal(json.identities.length,2);const people=new PeopleMemory({root,accountScope:account,accountId:account});assert.equal(json.identities[0].personId,people.current(turn('你好'))[0].id);assert.notEqual(json.identities[0].personId,json.identities[1].personId);
});

test('summary utility persists cited evidence and failed/unauthorized summaries preserve searchable originals',async t=>{
 const {store}=fixture(t);for(let i=1;i<=30;i++)add(store,i,i===1?'我计划周末去公园':'普通聊天'+i);
 class Assembler{constructor(){this.finish={kind:'stop'};this.text='';}push(chunk){if(chunk.type==='text-delta')this.text+=chunk.text;}blocks(){return [{type:'text',text:this.text}];}}
 const llm={resolveModelInfo:async()=>({}),async *stream(){yield {type:'text-delta',text:'当时本人计划周末去公园 [#1]'};}};
 const args={ctx:{get:()=>llm},store,key,policy,provider:'synthetic',model:'fake',isAllowed:()=>true,createUserMessage:value=>value,BlockAssembler:Assembler};const result=await summarizeHistory(args);assert.equal(result.status,'summarized');assert(store.checkpoint(key).text.includes('[#1]'));assert(store.search(key,'公园').length);
 for(let i=31;i<=50;i++)add(store,i,'后续聊天'+i);const checkpoint=store.checkpoint(key).id;llm.stream=async function*(){yield {type:'text-delta',text:'编造的事实 [#99999]'};};assert.equal((await summarizeHistory(args)).status,'failed');assert.equal(store.checkpoint(key).id,checkpoint);assert.equal(store.rows(key).length,50);assert(!summaryDue(store.summaryBatch(key,policy)));add(store,51,'新消息不能绕过失败冷却');assert(!summaryDue(store.summaryBatch(key,policy)));
 assert(selfFacts('我准备好了').length===0);
 for(let i=1;i<=30;i++)add(store,i,'另一个聊天的记录'+i,'alice',other);assert.equal((await summarizeHistory({...args,key:other,isAllowed:()=>false})).status,'failed');assert.equal(store.checkpoint(other),null);assert.equal(store.rows(other).length,30);
});

test('recall keeps identity facts and aggregates multiple present people instead of reporting only the last person',t=>{
 const {root}=fixture(t),memory=new PeopleMemory({root,accountScope:account,accountId:account});memory.capture(turn('我叫小桃'));for(const text of ['我喜欢音乐','我喜欢画画','我喜欢咖啡','我喜欢散步','我喜欢电影'])memory.capture(turn(text));const mixed={conversationKey:key,peopleObservations:[...turn('你记得我吗').peopleObservations,...turn('你好',key,'bob').peopleObservations]};const people=memory.current(mixed);assert(memory.recall(mixed,{personId:people[0].id,limit:4})[0].notes.some(note=>note.text==='我叫小桃'));memory.recall(mixed,{personId:people[1].id,limit:4});assert.equal(memory.usage()[key].lastContextNotes,4);
});
