import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {DshPluginClient} from '../components/qq-bridge/src/dsh/plugin-client.js';

async function fixture(t,status,body){
  let calls=0;
  const server=http.createServer((req,res)=>{calls++;req.resume();res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return {client:new DshPluginClient({url:'http://127.0.0.1:'+server.address().port,token:'synthetic-test-token'}),calls:()=>calls};
}
test('a wrapped upstream 42908 reports rate limiting and preserves admission without retrying images',async t=>{
  const f=await fixture(t,502,{error:'turn_error',admitted:true,detail:'429: {"message":"all upstreams temporarily rate-limited, please retry later","code":"42908","private":"must-not-leak"}'});
  await assert.rejects(f.client.followup('wechat:private:123','synthetic input',{images:[{id:'a'.repeat(64)}]}),error=>{
    assert.equal(error.code,'MODEL_RATE_LIMITED');assert.equal(error.status,429);assert.equal(error.admitted,true);
    assert.match(error.message,/限流/);assert.doesNotMatch(error.message,/must-not-leak/);return true;
  });
  assert.equal(f.calls(),1);
});
test('a direct 429 retains the before-admission boundary',async t=>{
  const f=await fixture(t,429,{error:'rate_limited'});
  await assert.rejects(f.client.followup('wechat:private:123','synthetic input'),error=>error.code==='MODEL_RATE_LIMITED'&&error.admitted===false);
  assert.equal(f.calls(),1);
});
test('an unrelated native error remains generic and does not disclose its raw detail',async t=>{
  const f=await fixture(t,502,{error:'turn_error',admitted:true,detail:'an unrelated failure containing private data'});
  await assert.rejects(f.client.followup('wechat:private:123','synthetic input'),error=>error.admitted===true&&error.code===undefined&&error.message==='DSH plugin: turn_error');
});
