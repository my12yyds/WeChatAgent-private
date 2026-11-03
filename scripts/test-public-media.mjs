import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createPublicMedia,mediaLink} from '../packages/public-media/index.mjs';
import {PluginRuntime} from '../packages/plugin-api/index.mjs';import {PluginInstaller} from '../packages/plugin-api/installer.mjs';import {configuration,updatePlugin,packageFiles} from '../packages/plugin-api/catalog.mjs';import {packZip} from '../packages/plugin-api/zip.mjs';
const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}),bvid='BV1xx411c7mu';
test('share links normalize to platform identities; credentials/private/arbitrary URLs never enter fetch',async()=>{
 assert.equal(mediaLink('netease','https://music.163.com/#/song?id=186016&x=1').url,'https://music.163.com/song?id=186016');assert.equal(mediaLink('bilibili',bvid).bvid,bvid);assert.equal(mediaLink('bilibili','https://www.bilibili.com/video/'+bvid+'/?p=2').page,2);
 let calls=0;const request=createPublicMedia({fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 for(const url of ['http://127.0.0.1/','https://music.163.com.evil.test/song?id=1','https://name:secret@music.163.com/song?id=1','https://music.163.com:123/song?id=1','file:///etc/passwd'])await assert.rejects(request('read',{platform:'netease',url}),/MEDIA_LINK_INVALID/);
 assert.equal(calls,0);
});
test('platform search results are bounded and labels stripped, independent of web search',async()=>{
 const request=createPublicMedia({fetchImpl:async(url,opts)=>{assert.equal(opts.redirect,'manual');assert.equal(opts.headers.Cookie,undefined);return json({code:200,result:{songs:[{id:123,name:'<em>晴天</em>',artists:[{name:'周杰伦'}]}]}});}});
 const result=await request('search',{platform:'netease',query:'晴天',limit:1});assert.equal(result.items[0].title,'晴天');assert.equal(result.items[0].url,'https://music.163.com/song?id=123');assert.equal(result.source,'platform_search');assert.equal(result.untrustedExternalContent,true);
});
test('restricted search uses a normal public index and filters unrelated/malicious links',async()=>{
 const calls=[],request=createPublicMedia({fetchImpl:async url=>{calls.push(url);if(url.includes('api.bilibili.com'))return new Response('',{status:412});return new Response('<div class="result"><a class="result__a" href="https://www.bilibili.com/video/'+bvid+'/">视频</a><a class="result__snippet">公开摘要</a></div><div class="result"><a class="result__a" href="http://127.0.0.1/">恶意结果</a></div>');}});
 const result=await request('search',{platform:'bilibili',query:'测试',limit:3});assert.equal(result.source,'public_web_search');assert.equal(result.items.length,1);assert.equal(result.scope,'search_snippets');assert.equal(new URL(calls[1]).hostname,'html.duckduckgo.com');
});
test('failure returns honest official search entry instead of invented results',async()=>{
 const result=await createPublicMedia({fetchImpl:async()=>new Response('',{status:429})})('search',{platform:'netease',query:'无结果'});assert.equal(result.status,'restricted');assert.deepEqual(result.items,[]);assert(result.searchUrl.startsWith('https://music.163.com/'));
});
test('song ID binding and cache survive only valid, uncancelled requests',async()=>{
 let calls=0;const request=createPublicMedia({fetchImpl:async()=>{calls++;return json({code:200,songs:[{id:123,name:'晴天',artists:[{name:'歌手'}],album:{name:'专辑'},duration:60000}]});}});
 const a={platform:'netease',url:'https://music.163.com/song?id=123'};assert.equal((await request('read',a)).durationSeconds,60);assert.equal((await request('read',a)).cached,true);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(request('read',a,{signal:controller.signal}));assert.equal(calls,1);await assert.rejects(request('read',{...a,url:'https://music.163.com/song?id=999'}),/MEDIA_CONTENT_UNAVAILABLE/);
});
test('video page and public subtitle scopes are explicit; external subtitle hosts are never fetched',async()=>{
 for(const allowed of [true,false]){let subtitleRequests=0;const request=createPublicMedia({fetchImpl:async url=>{
  if(url.includes('/view?'))return json({code:0,data:{bvid,aid:1,title:'测试视频',owner:{name:'作者'},desc:'视频简介',pages:[{page:1,cid:2,part:'第一集',duration:60}]}});
  if(url.includes('/v2?'))return json({code:0,data:{subtitle:{subtitles:[{subtitle_url:allowed?'https://aisubtitle.hdslb.com/bfs/subtitle/demo.json':'http://127.0.0.1/secret.json'}]}}});
  subtitleRequests++;assert(new URL(url).hostname==='aisubtitle.hdslb.com');return json({body:[{content:'第一句公开字幕'}]});
 }});const result=await request('read',{platform:'bilibili',url:bvid});assert.equal(result.scope,allowed?'video_metadata_and_public_subtitles':'video_metadata_only');assert.equal(subtitleRequests,allowed?1:0);if(!allowed)assert.equal(result.transcript,undefined);}
});
test('b23 redirects are checked at every hop, never followed to private or unrelated domains',async()=>{
 let calls=0;const request=createPublicMedia({fetchImpl:async()=>{calls++;return new Response('',{status:302,headers:{Location:'http://127.0.0.1/secret'}});}});await assert.rejects(request('read',{platform:'bilibili',url:'https://b23.tv/abcdef'}),/MEDIA_LINK_INVALID/);assert.equal(calls,1);
});
test('large responses and invalid parameters fail before exposing content',async()=>{
 const request=createPublicMedia({fetchImpl:async()=>new Response('a'.repeat(1024*1024+1))});await assert.rejects(request('read',{platform:'netease',url:'https://music.163.com/song?id=1'}),/MEDIA_RESPONSE_TOO_LARGE/);await assert.rejects(request('search',{platform:'bilibili',query:'test',limit:6}),/MEDIA_REQUEST_INVALID/);
});
test('host enforces scope, per-turn network opt-out, read-only hooks and live revocation',async()=>{
 const runtime=Object.create(PluginRuntime.prototype);let allowed=true,calls=0;Object.assign(runtime,{active:()=>allowed,requestMedia:async()=>{calls++;allowed=false;return {status:'ready'};}});
 const signal=new AbortController().signal,turn={conversationKey:'wechat:group:1',networkOptOut:true};await assert.rejects(runtime.service({},turn,signal)('media.search',[{}]),/NETWORK_DISABLED/);assert.equal(calls,0);
 turn.networkOptOut=false;await assert.rejects(runtime.service({},turn,signal,true)('media.search',[{}]),/HOOK_READ_ONLY/);assert.equal(calls,0);
 await assert.rejects(runtime.service({},turn,signal)('media.search',[{}]),/PERMISSION_DENIED/);assert.equal(calls,1);
});
test('installed isolated plugin tools call the host and remain unavailable in ungranted chats',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'public-media-')),key='wechat:group:123';fs.mkdirSync(path.join(root,'config'));fs.writeFileSync(path.join(root,'config/wechatagent.json'),JSON.stringify({wechat:{whitelist:{groups:['123','456'],private:[]}}}));const installer=new PluginInstaller(root);
 const source=fileURLToPath(new URL('../optional-extensions/netease-music',import.meta.url)),preview=installer.inspect({name:'music.zip',zip:packZip(packageFiles(source)).toString('base64')}),installed=installer.install({ticket:preview.ticket,revision:preview.revision});
 updatePlugin(root,'netease-music',{revision:installed.revision,enabled:true,permissions:['web_fetch'],chats:[key],settings:{}});let calls=0;const runtime=new PluginRuntime({root,accountScope:'a'.repeat(64),requestMedia:async(action,args)=>{calls++;assert.equal(args.platform,'netease');return {status:'ready',items:[{title:'公开测试歌'}]};}});t.after(async()=>{await runtime.dispose();installer.dispose();fs.rmSync(root,{recursive:true,force:true});});await runtime.sync();
 const turn={conversationKey:key,toolCalls:0,replies:[]};const result=await runtime.execute('netease-music__search',{query:'测试'},turn);assert(result.content.includes('公开测试歌'));assert.equal(calls,1);assert.equal(runtime.toolDefinitions('wechat:group:456').length,0);
});
