import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {directory,atomicJson} from './catalog.mjs';
import {selfFacts,sharingConfirmed} from './people-facts.mjs';
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const HEX=/^[a-f0-9]{64}$/,KEY=/^wechat:(private|group):[1-9]\d{0,15}$/;
const rememberRequest=/记住|记一下|记得|以后叫我|请叫我|我喜欢|我习惯|我的偏好|我叫|remember|call me|i prefer/i;
const publicRequest=/跨聊天|跨群|所有聊天|所有群|每个群|各个群|任何聊天|可以公开|share across chats/i;
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
export function peopleObservations(key,rows){
  return rows.filter(row=>!row.outgoing&&!row.forwardedRecord&&!row.quoteReply&&row.interaction!=='pat'&&typeof row.sender_wxid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(row.sender_wxid))
    .slice(-20).map(row=>({senderId:row.sender_wxid,name:clean(row.sender_name).slice(0,80),evidenceId:hash(JSON.stringify([key,row.sender_wxid,row.message_id||row.id])),text:String(row.text??'').slice(0,1000),at:Math.floor(row.timestamp*1000)}));
}
export class PeopleMemory{
  constructor({root,accountScope,accountId,pluginId='people-memory',now=Date.now,allowedSource=()=>true}){Object.assign(this,{root,accountScope,accountId,pluginId,now,allowedSource});}
  file(){const base=directory(this.root,`state/plugins/${this.accountScope}/${this.pluginId}`),file=path.join(base,'people-memory.json');if(fs.existsSync(file)&&(fs.lstatSync(file).isSymbolicLink()||!fs.statSync(file).isFile()||fs.statSync(file).size>4*1024*1024))throw Error('PEOPLE_MEMORY_FILE_INVALID');return file;}
  read(){const file=this.file();if(!fs.existsSync(file))return {version:1,accountId:this.accountId,people:{},usage:{}};const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||data.accountId!==this.accountId||!data.people||Array.isArray(data.people)||typeof data.people!=='object'||Object.keys(data.people).length>1000)throw Error('PEOPLE_MEMORY_FILE_INVALID');data.usage??={};if(!data.usage||Array.isArray(data.usage)||typeof data.usage!=='object'||Object.keys(data.usage).length>1000)throw Error('PEOPLE_MEMORY_FILE_INVALID');for(const key of Object.keys(data.usage))if(!KEY.test(key)||!data.usage[key]||!Number.isSafeInteger(data.usage[key].lastContextNotes)||data.usage[key].lastContextNotes<0)throw Error('PEOPLE_MEMORY_FILE_INVALID');for(const [id,person]of Object.entries(data.people)){if(!HEX.test(id)||person.id!==id||!Array.isArray(person.names)||person.names.length>5||person.names.some(name=>typeof name!=='string'||name.length>80)||!Array.isArray(person.notes)||person.notes.length>64)throw Error('PEOPLE_MEMORY_FILE_INVALID');for(const note of person.notes)if(!HEX.test(note.id)||!HEX.test(note.evidenceId)||!KEY.test(note.chat)||!['chat','person'].includes(note.visibility)||typeof note.text!=='string'||note.text.length>500||!Number.isSafeInteger(note.at)||!Number.isSafeInteger(note.expiresAt))throw Error('PEOPLE_MEMORY_FILE_INVALID');}return data;}
  write(data){if(Buffer.byteLength(JSON.stringify(data))>4*1024*1024)throw Error('PEOPLE_MEMORY_FULL');atomicJson(this.file(),data);}
  observations(turn){if(!KEY.test(turn?.conversationKey??''))return [];return (Array.isArray(turn.peopleObservations)?turn.peopleObservations:[]).slice(-20).filter(row=>row&&/^[A-Za-z0-9_-]{1,128}$/.test(row.senderId??'')&&HEX.test(row.evidenceId??'')&&typeof row.name==='string'&&row.name.length<=80&&typeof row.text==='string'&&row.text.length<=1000&&Number.isSafeInteger(row.at)&&row.at>this.now()-86400000&&row.at<this.now()+60000).map(row=>({...row,personId:hash(this.accountId+'\0'+row.senderId)}));}
  current(turn){const rows=this.observations(turn);return [...new Set(rows.map(row=>row.personId))].map(id=>({id,name:rows.findLast(row=>row.personId===id).name,evidence:rows.filter(row=>row.personId===id).map(row=>({id:row.evidenceId,text:row.text,at:row.at}))}));}
  capture(turn){
    const rows=this.observations(turn);if(!rows.length)return {saved:0};const data=this.read();let saved=0;
    for(const evidence of rows){
      for(const fact of selfFacts(evidence.text)){
        const id=evidence.personId,visibility=sharingConfirmed(evidence.text)?'person':'chat';
        const person=data.people[id]??{id,names:[],notes:[],firstSeenAt:evidence.at};
        const noteId=hash(id+'\0'+turn.conversationKey+'\0'+fact.text+'\0'+visibility);
        // Keep deletion tombstones: replaying the same source message cannot restore a forgotten note.
        if(person.notes.some(note=>note.id===noteId)){data.people[id]=person;continue;}
        if(person.notes.length>=64)continue;
        for(const old of person.notes){if(old.visibility!==visibility||old.chat!==turn.conversationKey||old.deletedAt)continue;if(selfFacts(old.text).some(previous=>previous.key===fact.key&&previous.polarity!==fact.polarity))old.deletedAt=this.now();}
        person.names=[evidence.name,...person.names].filter((value,index,array)=>value&&array.indexOf(value)===index).slice(0,5);person.lastSeenAt=evidence.at;
        person.notes.push({id:noteId,text:fact.text,visibility,chat:turn.conversationKey,evidenceId:evidence.evidenceId,evidence:evidence.text.slice(0,300),at:this.now(),expiresAt:this.now()+180*86400000});data.people[id]=person;saved++;
      }
    }
    if(saved)this.write(data);return {saved};
  }
  recall(turn,args={}){
    if(Object.keys(args).some(key=>!['personId','query','limit'].includes(key))||args.personId!==undefined&&!HEX.test(args.personId)||args.query!==undefined&&(typeof args.query!=='string'||args.query.length>120)||args.limit!==undefined&&(!Number.isInteger(args.limit)||args.limit<1||args.limit>8))throw Error('PEOPLE_MEMORY_QUERY_INVALID');
    const current=this.current(turn);if(args.personId&&!current.some(person=>person.id===args.personId))throw Error('PEOPLE_MEMORY_PERSON_NOT_PRESENT');const data=this.read(),query=clean(args.query).toLocaleLowerCase(),tokens=query.match(/[a-z0-9]{2,}|[\u4e00-\u9fff]{2}/gi)??[];
    const result=current.filter(person=>!args.personId||person.id===args.personId).slice(0,5).map(person=>({id:person.id,name:person.name,notes:(data.people[person.id]?.notes??[]).filter(note=>!note.deletedAt&&note.expiresAt>this.now()&&this.allowedSource(note.chat)&&(note.chat===turn.conversationKey||note.visibility==='person')).map(note=>({...note,score:tokens.reduce((score,token)=>score+(note.text.toLocaleLowerCase().includes(token)?1:0),0)})).sort((a,b)=>b.score-a.score||b.at-a.at).slice(0,args.limit??4).map(note=>({id:note.id,text:note.text,visibility:note.visibility,at:note.at,source:note.chat===turn.conversationKey?'本聊天的本人陈述':'本人明确允许跨聊天使用'}))}));
    data.usage[turn.conversationKey]={lastContextNotes:result.reduce((sum,person)=>sum+person.notes.length,0)};this.write(data);return result;
  }
  remember(turn,args){
    if(!args||Object.keys(args).some(key=>!['personId','text','evidenceId','visibility'].includes(key))||typeof args.text!=='string'||!clean(args.text)||args.text.length>500||!HEX.test(args.evidenceId??'')||!['chat','person'].includes(args.visibility??'chat'))throw Error('PEOPLE_MEMORY_NOTE_INVALID');
    const evidence=this.observations(turn).find(row=>row.evidenceId===args.evidenceId&&(!args.personId||row.personId===args.personId));if(!evidence)throw Error('PEOPLE_MEMORY_EVIDENCE_MISMATCH');if(!clean(evidence.text).includes(clean(args.text)))throw Error('PEOPLE_MEMORY_EVIDENCE_MISMATCH');if(!rememberRequest.test(evidence.text))throw Error('PEOPLE_MEMORY_EXPLICIT_REQUEST_REQUIRED');
    const visibility=args.visibility??'chat';if(visibility==='person'&&!publicRequest.test(evidence.text))throw Error('PEOPLE_MEMORY_SHARING_NOT_CONFIRMED');
    const data=this.read(),id=evidence.personId;if(!data.people[id]&&Object.keys(data.people).length>=1000)throw Error('PEOPLE_MEMORY_FULL');
    const person=data.people[id]??{id,names:[],notes:[],firstSeenAt:evidence.at};person.names=[evidence.name,...person.names].filter((value,index,array)=>value&&array.indexOf(value)===index).slice(0,5);person.lastSeenAt=evidence.at;
    const noteId=hash(id+'\0'+turn.conversationKey+'\0'+clean(args.text)+'\0'+visibility);
    const existing=person.notes.find(note=>note.id===noteId);if(existing)return existing.deletedAt?{saved:false,forgotten:true}:{saved:true,duplicate:true,id:existing.id};
    if(person.notes.length>=64)throw Error('PEOPLE_MEMORY_PERSON_FULL');
    person.notes.push({id:noteId,text:clean(args.text),visibility,chat:turn.conversationKey,evidenceId:evidence.evidenceId,evidence:evidence.text.slice(0,300),at:this.now(),expiresAt:this.now()+180*86400000});data.people[id]=person;this.write(data);return {saved:true,id:noteId,visibility};
  }
  forget(id){if(!HEX.test(id??''))throw Error('PEOPLE_MEMORY_NOTE_INVALID');const data=this.read();for(const person of Object.values(data.people)){const note=person.notes.find(note=>note.id===id);if(note){note.deletedAt=this.now();this.write(data);return {forgotten:true};}}return {forgotten:false};}
  forgetForTurn(turn,args){const data=this.read(),evidence=this.observations(turn).find(row=>row.evidenceId===args?.evidenceId);if(!evidence||!/忘记|删除.*记忆|forget/i.test(evidence.text)||!data.people[evidence.personId]?.notes.some(note=>note.id===args.id))throw Error('PEOPLE_MEMORY_FORGET_NOT_CONFIRMED');return this.forget(args.id);}
  catalog(){const data=this.read();return {people:Object.values(data.people).map(person=>({...person,notes:person.notes.filter(note=>!note.deletedAt&&note.expiresAt>this.now()).map(({evidence,...note})=>note)})).filter(person=>person.notes.length).sort((a,b)=>b.lastSeenAt-a.lastSeenAt)};}
  usage(){return structuredClone(this.read().usage);}
}
