import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {voiceRequest} from '../packages/voice-studio/jobs.mjs';import {songById,findSong,prepareSong} from '../packages/voice-studio/music.mjs';
test('signed v1 player retains exact ID and distinguishes login, trial and account restrictions',async()=>{
 const fetcher=async()=>new Response(JSON.stringify({code:200,songs:[{id:233931,name:'泡沫',fee:1,artists:[{name:'G.E.M.邓紫棋'}],duration:259000}]}));
 let loggedIn=false,item={id:233931,code:-110,fee:1,url:null};const routes=[];
 const neteaseClient={status:()=>({loggedIn}),request:async route=>{routes.push(route);return {data:{code:200,data:[item]}};}};
 await assert.rejects(songById('233931',{fetcher,neteaseClient}),/SONG_LOGIN_REQUIRED/);
 loggedIn=true;await assert.rejects(songById('233931',{fetcher,neteaseClient}),/SONG_ACCOUNT_AUDIO_UNAVAILABLE/);
 item={id:233931,code:200,fee:1,url:'https://m7.music.126.net/audio.mp3',freeTrialInfo:{start:0,end:30000}};await assert.rejects(songById('233931',{fetcher,neteaseClient}),/SONG_TRIAL_ONLY/);
 item.freeTrialInfo=null;assert.equal((await songById('233931',{fetcher,neteaseClient})).id,'233931');assert.ok(routes.every(route=>route.endsWith('/url/v1')));
});
test('song links normalize and cannot introduce arbitrary URLs, playlists or paths',()=>{
 assert.equal(voiceRequest({kind:'song',sourceUrl:'https://music.163.com/#/song?id=123&userid=9'}).sourceUrl,'https://music.163.com/song?id=123');
 for(const sourceUrl of ['https://music.163.com/playlist?id=1','http://127.0.0.1/audio','https://music.163.com.evil.test/song?id=123'])assert.throws(()=>voiceRequest({kind:'song',sourceUrl}));assert.throws(()=>voiceRequest({kind:'speech',text:'test',sourceUrl:'https://music.163.com/song?id=123'}));
});
test('source IDs bind metadata and public audio; trial, mismatched, restricted or private results fail closed',async()=>{
 const calls=[],fetcher=async url=>{calls.push(url);return new Response(JSON.stringify(url.includes('/detail?')?{code:200,songs:[{id:123,name:'小星星',artists:[{name:'甲'}],duration:60000}]}:{code:200,data:[{id:123,code:200,fee:0,url:'https://m7.music.126.net/a'}]}));};assert.equal((await songById('123',{fetcher})).id,'123');assert(!calls.some(url=>url.includes('/search/')));
 for(const data of [[{id:999,code:200,url:'https://m7.music.126.net/a'}],[{id:123,code:200,url:'https://m7.music.126.net/a',freeTrialInfo:{}}],[{id:123,code:200,url:'http://127.0.0.1/a'}],{}])await assert.rejects(songById('123',{fetcher:async url=>new Response(JSON.stringify(url.includes('/detail?')?{code:200,songs:[{id:123,name:'测试'}]}:{code:200,data}))}));
});
test('name search verifies full metadata and the explicit artist',async()=>{
 const fetcher=async url=>new Response(JSON.stringify(url.includes('/search/')?{code:200,result:{songs:[{id:123,name:'小星星',artists:[{name:'甲'}]}]}}:url.includes('/detail?')?{code:200,songs:[{id:123,name:'小星星',artists:[{name:'甲'}],duration:60000}]}:{code:200,data:[{id:123,code:200,fee:0,url:'https://m7.music.126.net/a'}]}));assert.equal((await findSong('小星星','甲',{fetcher})).id,'123');await assert.rejects(findSong('小星星','乙',{fetcher}),/EXACT_MATCH/);
});
test('link preparation uses exact-ID cache; old verified public stems work offline but corrupt stems do not',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'song-link-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'state/voice/engines/music/venv/Scripts'),{recursive:true});fs.writeFileSync(path.join(root,'state/voice/engines/music/venv/Scripts/python.exe'),'fixture');let lookups=0;
 const options={find:async()=>{throw Error('must not search');},findById:async id=>{lookups++;return {id,title:'正确版本',artist:'甲',durationSeconds:70,url:'https://m7.music.126.net/a'};},fetcher:async()=>new Response('audio'),run:async(exe,args)=>{if(exe.endsWith('python.exe'))for(const name of ['vocals.wav','instrumental.wav'])fs.writeFileSync(path.join(args[args.indexOf('--output')+1],name),'stem');}};
 const first=await prepareSong(root,{sourceUrl:'https://music.163.com/song?id=123'},options);const renamed=path.join(root,'state/voice/music-cache','f'.repeat(64));fs.renameSync(first.folder,renamed);await prepareSong(root,{sourceUrl:'https://music.163.com/#/song?id=123'},options);assert.equal(lookups,1);fs.writeFileSync(path.join(renamed,'vocals.wav'),'bad');await prepareSong(root,{sourceUrl:'https://music.163.com/song?id=123'},options);assert.equal(lookups,2);
});
