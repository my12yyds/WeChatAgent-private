import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {chooseSong,musicFetch,prepareSong,mixSong,runMusicTool} from '../packages/voice-studio/music.mjs';
import {voiceRequest} from '../packages/voice-studio/jobs.mjs';
test('song names and requested artists must match; similar songs are never substituted',()=>{
 const songs=[{id:1,name:'小星星',artists:[{name:'甲'}]},{id:2,name:'小星星',artists:[{name:'乙'}]},{id:3,name:'小星星 Remix',artists:[{name:'乙'}]}];
 assert.equal(chooseSong(songs,'《小星星》','乙').id,2);assert.throws(()=>chooseSong(songs,'星星'));assert.throws(()=>chooseSong(songs,'小星星','丙'));
 assert.equal(voiceRequest({kind:'song',title:' 小星星 ',artist:'乙'}).title,'小星星');assert.throws(()=>voiceRequest({kind:'song',title:'x',path:'private'}));
});
test('G.E.M. credited name matches 邓紫棋 without accepting a different artist or live version',()=>{
 const songs=[{id:233931,name:'泡沫',artists:[{name:'G.E.M.邓紫棋'}]},{id:1,name:'泡沫 (Live)',artists:[{name:'G.E.M.邓紫棋'}]}];
 assert.equal(chooseSong(songs,'泡沫','邓紫棋').id,233931);assert.equal(chooseSong(songs,'泡沫','G.E.M.邓紫棋').id,233931);assert.throws(()=>chooseSong(songs,'泡沫','棋'));assert.throws(()=>chooseSong(songs.slice(1),'泡沫','邓紫棋'));
});
test('media redirects cannot access local addresses or unrelated hosts and streams remain bounded',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}});};
 await assert.rejects(musicFetch('https://m7.music.126.net/a',{media:true,fetcher}),/UNSAFE/);assert.equal(calls,1);
 await assert.rejects(musicFetch('https://music.163.com/api/test',{maxBytes:2,fetcher:async()=>new Response('large')}),/TOO_LARGE/);
});
test('prepared songs reuse verified aligned stems and rebuild corrupted cache',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'song-music-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.mkdirSync(path.join(root,'state/voice/engines/music/venv/Scripts'),{recursive:true});fs.writeFileSync(path.join(root,'state/voice/engines/music/venv/Scripts/python.exe'),'fixture');
 let searches=0;const find=async()=>{searches++;return {id:'1',title:'测试',artist:'甲',durationSeconds:180,url:'https://m7.music.126.net/a'};};
 const run=async(exe,args)=>{if(exe.endsWith('python.exe')){const folder=args[args.indexOf('--output')+1];for(const stem of ['vocals','instrumental'])fs.writeFileSync(path.join(folder,stem+'.wav'),'stem');}};
 const options={find,run,fetcher:async()=>new Response('audio')};const first=await prepareSong(root,{title:'测试'},options);assert.equal(first.startSeconds,30);await prepareSong(root,{title:'测试'},options);assert.equal(searches,1);fs.writeFileSync(path.join(first.folder,'vocals.wav'),'corrupt');await prepareSong(root,{title:'测试'},options);assert.equal(searches,2);
});
test('mix retains converted vocal timing, adds backing and removes temporary files',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'song-mix-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'instrumental.wav'),'fixture');
 let argumentsUsed;const pcm=Buffer.alloc(48000);const mixed=await mixSong(root,pcm,{folder:root},{run:async(_exe,args)=>{argumentsUsed=args;fs.writeFileSync(args.at(-1),pcm);}});
 assert.equal(mixed.length,pcm.length);assert(argumentsUsed.includes('24000'));assert.match(argumentsUsed.join(' '),/duration=first/);assert.deepEqual(fs.readdirSync(root),['instrumental.wav']);
});
test('cancelling a music process stops its owned computation',async()=>{
 await assert.rejects(runMusicTool(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:AbortSignal.timeout(100)}),/VOICE_CANCELLED/);
});
