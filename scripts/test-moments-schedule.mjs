import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {PluginRuntime} from '../packages/plugin-api/index.mjs';
import {dailyScheduleIdentity,scheduleCompleted} from '../packages/plugin-api/daily-schedule.mjs';
import {manifest} from '../packages/plugin-api/catalog.mjs';
import {run,sourceDay} from '../optional-extensions/persona-moments/index.mjs';
const persona={personaName:'测试人设',persona:'测试人格'},key='wechat:private:123',date='2026-11-02',now=Date.parse('2026-11-02T12:00:00+08:00');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'moments-schedule-'));fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{private:['123'],groups:[]}}}));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('schedule mode and time changes invalidate draft completion, legacy plugins keep original identity',()=>{
 const record={schedule:{personaScoped:true,completionSettings:['mode','writeTime']}},a=dailyScheduleIdentity(record,{mode:'draft',writeTime:'00:00'},date,persona),b=dailyScheduleIdentity(record,{mode:'publish',writeTime:'00:00'},date,persona);assert.notEqual(a,b);assert.equal(dailyScheduleIdentity({schedule:{}},{},date,null),date);
 const item=JSON.parse(fs.readFileSync(new URL('../optional-extensions/persona-moments/plugin.json',import.meta.url)));assert(manifest(item));assert.throws(()=>manifest({...item,schedule:{...item.schedule,completionSettings:['missing']}}));
 assert.equal(scheduleCompleted({ok:false,status:'failed_before_commit'}),false);assert.equal(scheduleCompleted({ok:false,status:'unknown'}),true);
});
test('real scheduler retries precommit failures, never repeats uncertain submissions, and honors activation boundary',async t=>{
 const root=fixture(t),runtime=Object.create(PluginRuntime.prototype),record={id:'test',schedule:{timeSetting:'writeTime',completionSettings:['mode']},settings:{writeTime:'00:00',mode:'draft'},process:{scheduled:true}},local={settings:{writeTime:'00:00',mode:'draft'}};let clock=now,calls=0,result={ok:true,status:'draft_only'};
 Object.assign(runtime,{root,accountScope:'test-account',records:new Map([['test',record]]),scheduleRetry:new Map(),isAllowed:()=>true,canSchedule:()=>true,isBusy:()=>false,sync:async()=>{},policy:()=>({config:{plugins:{test:local}}}),active:()=>true,now:()=>clock,invoke:async()=>{calls++;return result;},log:()=>{}});
 await runtime.tick();await runtime.tick();assert.equal(calls,1);local.settings.mode='publish';result={ok:false,status:'failed_before_commit'};await runtime.tick();assert.equal(calls,2);await runtime.tick();assert.equal(calls,2);
 clock+=15*60000;result={ok:false,status:'unknown'};await runtime.tick();await runtime.tick();assert.equal(calls,3);
 const file=path.join(root,'state/plugin-schedules/test-account/test.json'),receipts=JSON.parse(fs.readFileSync(file));receipts._deferUntil=clock+3600000;delete receipts[key];fs.writeFileSync(file,JSON.stringify(receipts));await runtime.tick();assert.equal(calls,3);clock+=3600001;await runtime.tick();assert.equal(calls,4);
});
function context(settings={mode:'draft',writeTime:'00:00'}){const values=new Map(),dates=[];return {values,dates,ctx:{account:{id:'a'.repeat(64)},chat:{key,kind:'private'},now,config:()=>settings,persona:async()=>persona,storage:{get:async k=>values.get(k),set:async(k,v)=>values.set(k,v),delete:async k=>values.delete(k)},history:{day:async args=>{dates.push(args.date);return [{text:'昨天聊了音乐'}];},today:async args=>{dates.push(args.date);return [{text:'今天聊了音乐'}];}},model:{generate:async()=> '今天也收获了一些有趣的想法。'}}};}
test('bounded history-day service stays in the authorized chat and rejects older or future dates',async t=>{
 const runtime=Object.create(PluginRuntime.prototype),seen=[];Object.assign(runtime,{root:fixture(t),now:()=>now,active:(record,k,permission)=>k===key&&permission==='history_read',rowsForDate:async(k,d)=>{seen.push([k,d]);return [{text:'authorized test history'}];}});
 const service=runtime.service({}, {conversationKey:key},new AbortController().signal);
 assert.equal((await service('history.day',[{date:'2026-11-01'}])).length,1);assert.deepEqual(seen,[[key,'2026-11-01']]);
 for(const d of ['2026-10-31','2026-11-03'])await assert.rejects(service('history.day',[{date:d}]),/PLUGIN_HISTORY_DAY_INVALID/);
 await assert.rejects(service('history.today',[{date:'2026-11-01'}]),/PLUGIN_HISTORY_DAY_INVALID/);
 await assert.rejects(runtime.service({},{conversationKey:'wechat:group:456'},new AbortController().signal)('history.day',[{date:'2026-11-01'}]),/PLUGIN_PERMISSION_DENIED/);
});
test('midnight uses previous day and records draft-only outcome; publishing honors configured daily limit',async()=>{
 assert.equal(sourceDay(Date.parse('2026-11-01T16:00:00Z'),{writeTime:'00:00'}),'2026-11-01');const f=context();const draft=await run(f.ctx);assert.equal(draft.status,'draft_only');assert.deepEqual(f.dates,['2026-11-01']);assert.equal(f.values.get('last-result').published,false);
 const p=context({mode:'publish',writeTime:'21:30',maxPostsPerDay:3});let request;await run(p.ctx,{transport:async(ctx,req)=>{request=req;await req.check();return {ok:true,status:'submitted_unverified'};}});assert.equal(request.maxPosts,3);assert.deepEqual(p.dates,['2026-11-02']);
});
test('clear failures are recorded for retry, while lost commit results remain uncertain',async()=>{
 const f=context({mode:'publish',writeTime:'21:30'});await assert.rejects(run(f.ctx,{transport:async()=>{throw Error('precommit failure');}}),/precommit/);assert.equal(f.values.get('last-result').status,'failed_before_commit');
 const g=context({mode:'publish',writeTime:'21:30'});const result=await run(g.ctx,{transport:async()=>{throw Object.assign(Error('lost commit response'),{commitAttempted:true});}});assert.equal(result.status,'unknown');assert.equal(result.retryLater,false);
});
