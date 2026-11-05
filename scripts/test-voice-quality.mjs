import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {synthesizeVoice} from '../packages/voice-studio/synthesis.mjs';
import {pcmToWav,wavToPcm} from '../packages/voice-studio/singing.mjs';
import {mixSong} from '../packages/voice-studio/music.mjs';
import {songRenderSignature} from '../packages/voice-studio/saved-songs.mjs';
import {VOICE_PRESETS} from '../public/console/music.js';

const executable=process.env.VOICE_TEST_FFMPEG;
test('natural reference preset preserves raw speech and bypasses RVC, pitch and tempo processing',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-direct-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'state/voice/references'),{recursive:true});const pcm=tone();fs.writeFileSync(path.join(root,'state/voice/references/cute.wav'),pcmToWav(pcm));let calls=0,output;const stages=[];
 await synthesizeVoice(root,{kind:'speech',style:'cute',text:'自然语音测试'},{feiyuTimbre:true,customVoiceProfile:{id:'e'.repeat(16),...VOICE_PRESETS.reference}},{fetcher:async(url,options)=>{calls++;assert.equal(url,'http://127.0.0.1:19881/v1/audio/speech');assert.equal(options.body.get('cfg_scale'),'1');return new Response(pcm,{headers:{'x-sample-rate':'24000'}});},onProgress:stage=>stages.push(stage),onPcm:value=>{output=value;}});
 assert.equal(calls,1);assert.deepEqual(output,pcm);assert.deepEqual(stages,['speech','encode']);assert.equal(fs.existsSync(path.join(root,'state/voice/tools/ffmpeg.exe')),false);
});
function tone(seconds=2){const pcm=Buffer.alloc(48000*seconds);for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(6500*Math.sin(2*Math.PI*320*i/24000)+3500*Math.sin(2*Math.PI*3000*i/24000)),i*2);return pcm;}
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'voice-quality-'));for(const dir of ['state/voice/tools','state/voice/references','state/voice/feiyu-service/server/.runtime/voice-service'])fs.mkdirSync(path.join(root,dir),{recursive:true});fs.copyFileSync(executable,path.join(root,'state/voice/tools/ffmpeg.exe'));fs.writeFileSync(path.join(root,'state/voice/references/cute.wav'),pcmToWav(tone()));fs.writeFileSync(path.join(root,'state/voice/feiyu-service/server/.runtime/voice-service/api_key.txt'),'synthetic-test-token-only');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
function amplitude(pcm,frequency){let re=0,im=0;const start=12000,end=Math.min(pcm.length/2-12000,36000);for(let i=start;i<end;i++){const sample=pcm.readInt16LE(i*2);re+=sample*Math.cos(2*Math.PI*frequency*i/24000);im+=sample*Math.sin(2*Math.PI*frequency*i/24000);}return Math.hypot(re,im)/(end-start);}

test('built-in reference cloning uses neutral guidance, preserves pace and is polished once on resume',{skip:!executable},async t=>{
 const root=fixture(t),pcm=tone(),job='a'.repeat(32);let requests=0;
 const fetcher=async(url,options)=>{requests++;if(url.endsWith('/v1/audio/speech')){assert.equal(options.body.get('instruction'),'自然清晰地说话。');assert.equal(options.body.get('cfg_scale'),'1');assert.equal(options.body.get('text'),'原创测试短句');assert.equal(options.body.get('ref_text'),'我已经准备好了，我们开始吧。');return new Response(pcm,{headers:{'x-sample-rate':'24000'}});}if(url.endsWith('/v1/capabilities'))return Response.json({});if(url.endsWith('/v1/assets'))return Response.json({id:'b'.repeat(32)});if(url.endsWith('/v1/voice-conversion')){assert.deepEqual(JSON.parse(options.body),{voice:'feiyu',audio_id:'b'.repeat(32)});return Response.json({id:job});}if(url.endsWith('/audio'))return new Response(pcmToWav(pcm));return Response.json({status:'success'});};
 const request={kind:'speech',style:'cute',text:'原创测试短句'},settings={feiyuTimbre:true,cutePitch:3};let normal,resumed,custom;
 const proof=await synthesizeVoice(root,request,settings,{fetcher,onPcm:value=>{normal=value;}});
 assert(Math.abs(proof.durationMs-2000)<30);assert.equal(normal.length,pcm.length);assert(amplitude(normal,320)<amplitude(pcm,320)*0.87);assert(amplitude(normal,3000)>amplitude(pcm,3000)*0.8);
 requests=0;await synthesizeVoice(root,request,settings,{fetcher,remoteJobId:job,onPcm:value=>{resumed=value;}});assert.equal(requests,2);assert.deepEqual(resumed,normal);
 await synthesizeVoice(root,request,{...settings,customVoiceProfile:{id:'c'.repeat(16),name:'自定',baseStyle:'cute',pitch:0,speed:1,feiyu:true,instruction:'保留自定',referenceText:'测试'}},{fetcher,remoteJobId:job,onPcm:value=>{custom=value;}});assert.equal(custom.length,pcm.length);
});

test('singing clarity keeps the melody and duration while reducing vocal body',{skip:!executable},async t=>{
 const root=fixture(t),pcm=tone(),light=await wavToPcm(root,pcmToWav(pcm),{lightVoice:true});assert.equal(light.length,pcm.length);assert(amplitude(light,320)<amplitude(pcm,320)*0.85);assert(amplitude(light,3000)>amplitude(pcm,3000)*0.95);
 const folder=path.join(root,'prepared');fs.mkdirSync(folder);fs.writeFileSync(path.join(folder,'instrumental.wav'),pcmToWav(Buffer.alloc(pcm.length)));
 const mixed=await mixSong(root,pcm,{folder},{clarity:true,backingVolume:0.4});assert(Math.abs(mixed.length-pcm.length)<2400);assert(amplitude(mixed,3000)>100);let peak=0;for(let i=0;i<mixed.length;i+=2)peak=Math.max(peak,Math.abs(mixed.readInt16LE(i)));assert(peak<32768*0.94);
});

test('old clear-song cache is bypassed, while unprocessed songs retain their cache identity',()=>{
 const root=os.tmpdir(),request={style:'cute'},settings={feiyuTimbre:true,cutePitch:3};
 const legacy=clarity=>crypto.createHash('sha256').update(JSON.stringify(['rendered-song-v2',clarity,0.4,'cute',true,3,'FeiyuVoice-RVC-v1.pth:missing','FeiyuVoice-RVC-v1.index:missing'])).digest('hex');
 assert.notEqual(songRenderSignature(root,request,settings),legacy(true));assert.equal(songRenderSignature(root,request,{...settings,singingClarity:false}),legacy(false));
});
