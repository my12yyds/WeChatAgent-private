import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createNeteaseClient,protectCredential,sessionCookies} from '../packages/netease/client.mjs';
import {createPublicMedia} from '../packages/public-media/index.mjs';
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'netease-account-'));
const response=(data,cookies=[])=>new Response(JSON.stringify(data),{headers:cookies.length?{'set-cookie':cookies}:{}});
test('direct platform search uses signed fixed endpoint and does not substitute web results',async()=>{
  const urls=[],c=createNeteaseClient(null,{fetcher:async(url,options)=>{urls.push(url);assert.equal(options.redirect,'error');assert.equal(options.method,'POST');assert.match(options.body,/encSecKey=/);assert.equal(options.headers.Cookie,undefined);return response({code:200,result:{songs:[{id:123,name:'歌',ar:[{name:'歌手'}]}]}});}});
  const media=createPublicMedia({neteaseClient:c,fetchImpl:()=>{throw Error('Unexpected public fallback');}}),result=await media('search',{platform:'netease',query:'歌',limit:5});assert.equal(result.items[0].artist,'歌手');assert.equal(urls.length,1);assert.match(urls[0],/^https:\/\/music\.163\.com\/weapi\/cloudsearch\/pc/);
  await assert.rejects(c.request('https://evil.invalid'),/NETEASE_ENDPOINT_BLOCKED/);
});
test('restricted direct search remains honest without unrelated search engine',async()=>{
  const media=createPublicMedia({neteaseClient:{search:async()=>{throw Error('restricted');}},fetchImpl:()=>{throw Error('Unexpected fallback');}});const result=await media('search',{platform:'netease',query:'歌'});assert.equal(result.status,'restricted');assert.deepEqual(result.items,[]);
});
test('QR credentials stay server side, encrypted and reusable; logout clears them',async()=>{
  const folder=root();let step=0,seenCookie='';const c=createNeteaseClient(folder,{protect:async(value,mode)=>mode==='protect'?'encrypted': 'MUSIC_U=private-token; __csrf=csrf',fetcher:async(url,options)=>{
    step++;if(url.includes('/unikey'))return response({code:200,unikey:'test-key-12345678'});
    if(url.includes('/client/login'))return response({code:803},['MUSIC_U=private-token; Path=/; HttpOnly']);
    seenCookie=options.headers.Cookie;return response({code:200,result:{songs:[]}});
  }});
  const qr=await c.startLogin();assert.match(qr.url,/music\.163\.com\/login/);assert.equal((await c.checkLogin()).state,'logged-in');
  const file=path.join(folder,'state/netease/session.json'),bytes=fs.readFileSync(file,'utf8');assert.ok(!bytes.includes('private-token'));assert.equal(c.status().loggedIn,true);await c.search('歌');assert.match(seenCookie,/MUSIC_U=/);assert.ok(!JSON.stringify(c.status()).includes('private-token'));c.logout();assert.equal(c.status().loggedIn,false);assert.equal(fs.existsSync(file),false);
});
test('cancelled scan cannot commit late successful authorization',async()=>{
  const folder=root();let unblock;const pending=new Promise(resolve=>{unblock=resolve;});const c=createNeteaseClient(folder,{protect:async()=> 'encrypted',fetcher:async url=>url.includes('/unikey')?response({code:200,unikey:'test-key-12345678'}):pending});await c.startLogin();const poll=c.checkLogin();await new Promise(resolve=>setTimeout(resolve,5));c.cancelLogin();unblock(response({code:803},['MUSIC_U=private-token; Path=/']));assert.equal((await poll).state,'expired');assert.equal(c.status().loggedIn,false);
});
test('Windows credential protection round trip does not store plaintext', {skip:process.platform!=='win32'},async()=>{const value='MUSIC_U=local-round-trip-test',protectedValue=await protectCredential(value);assert.ok(!protectedValue.includes(value));assert.equal(await protectCredential(protectedValue,'unprotect'),value);});
test('combined desktop Set-Cookie headers retain auth through Expires commas and leading spaces',()=>{
  assert.equal(sessionCookies(' NMTID=one; Path=/, MUSIC_U=auth; Expires=Thu, 01 Jan 2099 00:00:00 GMT; HttpOnly, __csrf=two; Path=/'),'NMTID=one; MUSIC_U=auth; __csrf=two');
  assert.equal(sessionCookies('MUSIC_U=first; __csrf=one','MUSIC_U=second'),'MUSIC_U=second; __csrf=one');
});
test('authorization persists when desktop fetch exposes only a combined cookie header',async()=>{
  const folder=root();let n=0;const c=createNeteaseClient(folder,{protect:async()=> 'encrypted',fetcher:async()=>{
    if(n++===0)return response({code:200,unikey:'test-key-12345678'});
    const r=response({code:803});r.headers.getSetCookie=undefined;r.headers.set('set-cookie','NMTID=one; Path=/, MUSIC_U=auth; Expires=Thu, 01 Jan 2099 00:00:00 GMT, __csrf=two; Path=/');return r;
  }});await c.startLogin();assert.equal((await c.checkLogin()).state,'logged-in');assert.equal((await c.checkLogin()).state,'logged-in');assert.equal(c.status().login.state,'logged-in');
});
test('temporary QR check failure retains server-side attempt and retries successfully',async()=>{
  const folder=root();let now=100000,n=0;const c=createNeteaseClient(folder,{now:()=>now,protect:async()=> 'encrypted',fetcher:async()=>{
    if(n++===0)return response({code:200,unikey:'test-key-12345678'});if(n===2)throw Error('temporary transport failure');return response({code:803},['MUSIC_U=auth; Path=/']);
  }});await c.startLogin();await assert.rejects(c.checkLogin(),/NETEASE_CONNECTION_FAILED/);assert.equal(c.status().login.state,'retrying');now+=3000;assert.equal((await c.checkLogin()).state,'logged-in');
});
test('checking account status never cancels an uncommitted authorization attempt',async()=>{
 let now=100000;const c=createNeteaseClient(root(),{now:()=>now,fetcher:async url=>response(url.includes('/unikey')?{code:200,unikey:'test-key-12345678'}:{code:802})});await c.startLogin();assert.equal((await c.verify()).pending,true);assert.equal(c.status().login.state,'confirm');now+=3000;assert.equal((await c.checkLogin()).state,'confirm');
});
test('official-site session is encrypted and can be verified with the stored credential',async()=>{
 const folder=root();let received='';const c=createNeteaseClient(folder,{protect:async(value,mode)=>mode==='protect'?'encrypted': 'MUSIC_U=official-test',fetcher:async(_url,options)=>{received=options.headers.Cookie;return response({code:200,account:{id:1},profile:{nickname:'test-user'}});}});await c.saveOfficialCookies('MUSIC_U=official-test; __csrf=test');assert.equal((await c.verify()).valid,true);assert.equal(received,'MUSIC_U=official-test');assert.equal(c.status().nickname,'test-user');assert.ok(!fs.readFileSync(path.join(folder,'state/netease/session.json'),'utf8').includes('official-test'));
});
