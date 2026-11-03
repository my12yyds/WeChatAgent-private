import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';
import {directory} from '../plugin-api/catalog.mjs';import {voiceError} from './jobs.mjs';
import {prepareSong,mixSong} from './music.mjs';
export function pcmToWav(pcm){const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);}
export async function wavToPcm(root,wav,{signal,pitchSemitones=0,speed=1,volume=1,bassDb=0,trebleDb=0,normalize=false,trimSilence=false}={}){
  if(!Number.isFinite(pitchSemitones)||pitchSemitones<0||pitchSemitones>5)throw voiceError('VOICE_PITCH_INVALID');
  if(!Number.isFinite(speed)||speed<0.75||speed>1.25)throw voiceError('VOICE_SPEED_INVALID');
  const executable=path.join(root,'state/voice/tools/ffmpeg.exe');if(!fs.existsSync(executable))throw voiceError('VOICE_RESAMPLER_NOT_READY');
  for(const [value,min,max]of [[volume,0.5,1.5],[bassDb,-6,6],[trebleDb,-6,6]])if(!Number.isFinite(value)||value<min||value>max)throw voiceError('VOICE_EFFECT_INVALID');
  if(typeof normalize!=='boolean'||typeof trimSilence!=='boolean')throw voiceError('VOICE_EFFECT_INVALID');
  const filters=[];
  if(pitchSemitones||speed!==1)filters.push(`rubberband=pitch=${2**(pitchSemitones/12)}:tempo=${speed}:formant=preserved`);
  if(trimSilence)filters.push('silenceremove=start_periods=1:start_duration=0:start_threshold=-48dB:start_silence=0.08','areverse','silenceremove=start_periods=1:start_duration=0:start_threshold=-48dB:start_silence=0.08','areverse');
  if(bassDb)filters.push('bass=g='+bassDb);if(trebleDb)filters.push('treble=g='+trebleDb);
  if(normalize)filters.push('dynaudnorm=f=150:g=7:p=0.9');if(volume!==1)filters.push('volume='+volume);
  if(volume!==1||bassDb||trebleDb||normalize)filters.push('alimiter=limit=0.95:level=0');
  const filter=filters.length?['-af',filters.join(',')]:[];
  return new Promise((resolve,reject)=>{const child=spawn(executable,['-hide_banner','-loglevel','error','-nostdin','-i','pipe:0',...filter,'-ac','1','-ar','24000','-f','s16le','pipe:1'],{windowsHide:true,stdio:['pipe','pipe','pipe'],signal});const chunks=[];let size=0,failed=false;child.stderr.resume();child.stdout.on('data',bytes=>{size+=bytes.length;if(size>24000*2*60){failed=true;child.kill();reject(voiceError('VOICE_EXCEEDS_60_SECONDS'));}else chunks.push(bytes);});child.on('error',()=>reject(voiceError('VOICE_RESAMPLING_FAILED')));child.on('close',code=>{if(!failed){if(code!==0||size<960)reject(voiceError('VOICE_RESAMPLING_FAILED'));else resolve(Buffer.concat(chunks));}});child.stdin.on('error',()=>{});child.stdin.end(wav);});
}
export async function synthesizeSinging(root,request,{signal,fetcher=fetch,remoteJobId,onRemoteJob=()=>{},sourceWav,onProgress=()=>{},onPreparedSong=()=>{},mixSettings={}}={}){
  let song;
  if(request.kind==='song'){song=await prepareSong(root,request,{signal,fetcher,onProgress});onPreparedSong(song);sourceWav=fs.readFileSync(path.join(song.folder,'vocals.wav'));}
  onProgress('conversion');
  const tokenFile=path.join(root,'state/voice/feiyu-service/server/.runtime/voice-service/api_key.txt');
  if(!fs.existsSync(tokenFile)||fs.lstatSync(tokenFile).isSymbolicLink())throw voiceError('SINGING_ENGINE_NOT_READY');
  const token=fs.readFileSync(tokenFile,'utf8').trim();if(token.length<16||token.length>256)throw voiceError('SINGING_ENGINE_NOT_READY');
  const base='http://127.0.0.1:19882',headers={Authorization:'Bearer '+token};
  async function json(route,options={}){const response=await fetcher(base+route,{...options,headers:{...headers,...options.headers},signal,redirect:'error'});if(!response.ok)throw voiceError('SINGING_API_HTTP_'+response.status);return response.json();}
  async function upload(data,name,type){const form=new FormData();form.set('file',new Blob([data],{type}),name);const result=await json('/v1/assets',{method:'POST',body:form});if(!/^[a-f0-9]{32}$/.test(result.id??''))throw voiceError('SINGING_UPLOAD_INVALID');return result.id;}
  let id=remoteJobId;
  if(!id){const capabilities=await json('/v1/capabilities');if(request.kind==='score'&&capabilities.singing?.available!==true)throw voiceError('SINGING_SCORE_ENGINE_NOT_READY');
    let job;if(request.kind==='cover'||sourceWav){
      let audio=sourceWav;if(!audio){const songs=directory(root,'state/voice/songs'),file=path.join(songs,request.songId+'.wav');if(!fs.existsSync(file)||fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>50*1024*1024)throw voiceError('SINGING_SONG_NOT_PREPARED');audio=fs.readFileSync(file);}
      const audioId=await upload(audio,'vocal.wav','audio/wav');job=await json('/v1/voice-conversion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:'feiyu',audio_id:audioId})});
    }else{const scoreId=await upload(request.score,'score.abc','text/vnd.abc');job=await json('/v1/singing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({voice:'feiyu',score_id:scoreId,lyrics:request.lyrics,segment_seconds:20})});}
    id=job.id;if(!/^[a-f0-9]{32}$/.test(id??''))throw voiceError('SINGING_JOB_INVALID');onRemoteJob(id);
  }
  if(!/^[a-f0-9]{32}$/.test(id??''))throw voiceError('SINGING_JOB_INVALID');
  for(;;){if(signal?.aborted)throw voiceError('VOICE_CANCELLED');const job=await json('/v1/jobs/'+id);if(job.status==='success')break;if(['failed','cancelled','interrupted'].includes(job.status))throw voiceError('SINGING_GENERATION_FAILED');await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(voiceError('VOICE_CANCELLED'));};const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},1000);signal?.addEventListener('abort',abort,{once:true});});}
  const response=await fetcher(base+'/v1/jobs/'+id+'/audio',{headers,signal,redirect:'error'});if(!response.ok)throw voiceError('SINGING_AUDIO_UNAVAILABLE');const chunks=[];let size=0;for await(const bytes of response.body){size+=bytes.length;if(size>50*1024*1024)throw voiceError('SINGING_AUDIO_TOO_LARGE');chunks.push(Buffer.from(bytes));}
  const pcm=await wavToPcm(root,Buffer.concat(chunks),{signal});
  if(song)onProgress('mix');return song?mixSong(root,pcm,song,{signal,clarity:mixSettings.singingClarity!==false,backingVolume:mixSettings.backingVolume??0.4}):pcm;
}
