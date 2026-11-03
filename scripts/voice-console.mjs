import {SpeechApi} from '../packages/voice-studio/speech-api.mjs';
import {CustomVoices} from '../packages/voice-studio/voices.mjs';
import {synthesizeVoice} from '../packages/voice-studio/synthesis.mjs';
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {sendingMode} from '../packages/wechat-send-policy.mjs';
import {VoiceJobs,voiceRequest} from '../packages/voice-studio/jobs.mjs';import {configuration,directory,atomicJson} from '../packages/plugin-api/catalog.mjs';import {wavToPcm} from '../packages/voice-studio/singing.mjs';
const fault=message=>Object.assign(Error(message),{status:400});
const wav=pcm=>{const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(24000,24);header.writeUInt32LE(48000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);};
export function createVoiceConsole(root,{fetcher=fetch,resample=wavToPcm}={}){
 let previewBusy=false;
 const jobs=()=>new VoiceJobs(root);
 async function endpoint(url,headers={}){try{const response=await fetcher(url,{headers,signal:AbortSignal.timeout(2000),redirect:'error'});return response.ok?await response.json():null;}catch{return null;}}
 async function preview(text,profile){if(previewBusy)throw Object.assign(fault('正在制作另一条试听，请稍后再试。'),{status:409});if(typeof text!=='string'||!text.trim()||text.length>100)throw fault('请填写100字以内的试听文字。');const settings=configuration(root).config.plugins['voice-studio']?.settings??{},engine=new SpeechApi(root).snapshot();let pcm;previewBusy=true;try{await synthesizeVoice(root,voiceRequest({kind:'speech',style:profile?.baseStyle??settings.defaultStyle??'cute',text}),{...settings,...(profile?{customVoiceProfile:profile}:{}),speechEngine:{mode:engine.mode,revision:engine.revision}},{signal:AbortSignal.timeout(120000),onPcm:value=>{pcm=value;}});return {b64:wav(pcm).toString('base64')};}catch(error){const messages={VOICE_API_SETTINGS_CHANGED:'语音API配置已变化，请重新试听。',VOICE_API_HTTP_401:'API密钥未通过验证，请检查密钥。',VOICE_API_HTTP_403:'该API拒绝请求，请检查模型和账号权限。',VOICE_API_HTTP_429:'该API请求受限，请检查额度或稍后重试。',VOICE_API_WAV_REQUIRED:'该API没有返回WAV音频，请确认接口兼容音频生成协议。',VOICE_API_CREDENTIAL_UNAVAILABLE:'无法解密API密钥，请重新填写保存。'};throw fault(messages[error.code??error.message]??'试听未完成，请检查所选语音服务的连接与音色配置。');}finally{previewBusy=false;}}
 return {
  voices:()=>new CustomVoices(root).snapshot(),
  changeVoice:body=>new CustomVoices(root).change(body),
  engine:()=>new SpeechApi(root).snapshot(),
  saveEngine:body=>new SpeechApi(root).save(body),
  async previewVoice(body){if(!body||Object.keys(body).some(key=>!['id','text'].includes(key)))throw fault('试听参数无效。');const profile=new CustomVoices(root).snapshot().voices.find(voice=>voice.id===body.id);if(!profile)throw fault('请先保存并选择音色。');return preview(body.text,profile);},
  async previewEngine(body){if(!body||Object.keys(body).some(key=>key!=='text'))throw fault('试听参数无效。');return preview(body.text);},
  async snapshot(){const settings=configuration(root).config.plugins['voice-studio']?.settings??{},project=JSON.parse(fs.readFileSync(path.join(root,'config/wechatagent.json'),'utf8').replace(/^\uFEFF/,''));const keyFile=path.join(root,'state/voice/feiyu-service/server/.runtime/voice-service/api_key.txt');let key='';if(fs.existsSync(keyFile)&&!fs.lstatSync(keyFile).isSymbolicLink())key=fs.readFileSync(keyFile,'utf8').trim();
    const [speech,adapter,singing]=await Promise.all([endpoint('http://127.0.0.1:'+(settings.breezePort??19881)+'/health'),endpoint('http://127.0.0.1:'+project.ports.adapter+'/status'),key?endpoint('http://127.0.0.1:19882/v1/capabilities',{Authorization:'Bearer '+key}):null]);let recent=[];try{const store=jobs(),account=store.account();recent=store.list().filter(job=>job.accountScope===account).slice(-8).map(job=>store.public(job));}catch{}
    const separator=path.join(root,'state/voice/engines/music/models/UVR-MDX-NET-Inst_HQ_3.onnx');
    const blocked=sendingMode(project)==='foreground';let engine;try{engine=new SpeechApi(root).snapshot();}catch{engine={mode:'unavailable'};}
    return {sendingMode:sendingMode(project),sendDisabledReason:blocked?'前台模式已停用原生语音与歌曲语音发送；切换到 Hook 模式后恢复。':'',speechSource:engine.mode,speech:engine.mode==='external'?!!engine.baseUrl&&!!engine.model:engine.mode==='local'&&speech?.status==='ok'&&speech?.sample_rate===24000,nativeVoice:!blocked&&adapter?.native_voice_send===true,feiyuTimbre:engine.mode==='local'&&settings.feiyuTimbre===true,cover:singing?.rvc?.some?.(item=>item?.available===true)||false,score:singing?.singing?.available===true,onlineSongs:settings.onlineSongs!==false,musicReady:fs.existsSync(separator)&&!fs.lstatSync(separator).isSymbolicLink(),songs:jobs().songs(),jobs:recent};
  },
  async importSong(body){
    if(!body||Object.keys(body).some(key=>!['title','b64'].includes(key))||typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>80||typeof body.b64!=='string'||body.b64.length>11300000||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.b64))throw fault('请填写歌曲名称并选择有效音频。');
    const bytes=Buffer.from(body.b64,'base64');if(bytes.length>8*1024*1024||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')throw fault('请导入最长 60 秒的 WAV 人声音频。');
    const pcm=await resample(root,bytes,{signal:AbortSignal.timeout(30000)});if(!Buffer.isBuffer(pcm)||pcm.length<960||pcm.length>24000*2*60||pcm.length%2)throw fault('请使用60秒以内的有效人声音频。');const audio=wav(pcm),id=crypto.createHash('sha256').update(audio).digest('hex').slice(0,24),folder=directory(root,'state/voice/songs');const file=path.join(folder,id+'.wav');if(fs.existsSync(file)&&fs.lstatSync(file).isSymbolicLink())throw fault('歌曲文件异常，请检查本机素材目录。');fs.writeFileSync(file,audio,{mode:0o600});atomicJson(path.join(folder,id+'.json'),{title:body.title.trim(),durationSeconds:pcm.length/48000,source:'owner-imported-vocal'});return {ok:true,id,title:body.title.trim()};
  },
  test(body){if(!body||Object.keys(body).some(key=>!['key','style','text'].includes(key)))throw fault('测试参数无效。');const setting=configuration(root).config.plugins['voice-studio'];if(!setting?.enabled||!setting.permissions?.includes('voice'))throw fault('请先保存插件设置，并允许声音插件运行。');if(setting.chats!==null&&!setting.chats?.includes(body.key))throw fault('请选择插件已经授权的聊天；修改聊天范围后请先保存。');return jobs().queue({key:body.key,pluginId:'voice-studio',generation:setting.generation,batchId:crypto.randomUUID(),request:voiceRequest({kind:'speech',style:body.style,text:body.text})});}
 };
}
