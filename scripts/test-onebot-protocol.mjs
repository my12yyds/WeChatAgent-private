import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {ReverseOneBotServer} from '../components/qq-bridge/src/onebot/reverse-ws-server.js';

async function connect(server, headers = {}) {
  const socket = net.createConnection({host:'127.0.0.1',port:server.server.address().port});
  await once(socket,'connect');
  const rows={Host:'127.0.0.1',Upgrade:'websocket',Connection:'keep-alive, Upgrade','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':Buffer.alloc(16,7).toString('base64'),...headers};
  socket.write(`GET /ws HTTP/1.1\r\n${Object.entries(rows).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
  let data=Buffer.alloc(0);
  while(!data.includes(Buffer.from('\r\n\r\n'))){const [chunk]=await once(socket,'data');data=Buffer.concat([data,chunk]);}
  return {socket,head:data.toString('latin1').split('\r\n\r\n',1)[0],tail:data.subarray(data.indexOf(Buffer.from('\r\n\r\n'))+4)};
}

function clientFrame(text){
  const body=Buffer.from(text),mask=Buffer.from([3,9,7,5]);
  if(body.length>=126)throw new Error('test frame too large');
  const payload=Buffer.from(body);for(let i=0;i<payload.length;i++)payload[i]^=mask[i&3];
  return Buffer.concat([Buffer.from([0x81,0x80|body.length]),mask,payload]);
}

async function withServer(options,fn){
  const server=new ReverseOneBotServer({port:0,...options});
  await server.start();
  try{await fn(server);}finally{await server.stop();}
}

test('reverse WebSocket handshake requires a valid HTTP upgrade and bearer token',async()=>{
  await withServer({token:'local-secret'},async server=>{
    const wrong=await connect(server,{Authorization:'local-secret'});
    assert.match(wrong.head,/401 Unauthorized/);wrong.socket.destroy();
    const accepted=await connect(server,{Authorization:'Bearer local-secret'});
    assert.match(accepted.head,/101 Switching Protocols/);accepted.socket.destroy();
  });
});

test('reverse WebSocket rejects a missing Connection upgrade token',async()=>{
  await withServer({},async server=>{
    const socket=net.createConnection({host:'127.0.0.1',port:server.server.address().port});
    await once(socket,'connect');
    socket.write('GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: BwcHBwcHBwcHBwcHBwcHBw==\r\n\r\n');
    const [chunk]=await once(socket,'data');
    assert.match(chunk.toString('latin1'),/400 Bad Request|404 Not Found/);socket.destroy();
  });
});

test('reverse WebSocket rejects browser-origin connections to the loopback endpoint',async()=>{
  await withServer({},async server=>{
    const browser=await connect(server,{Origin:'https://example.invalid'});
    assert.match(browser.head,/403 Forbidden/);browser.socket.destroy();
  });
});

test('non-loopback OneBot listener requires an access token',async()=>{
  const server=new ReverseOneBotServer({host:'0.0.0.0',port:0});
  await assert.rejects(server.start(),/requires a token/);
});

test('OneBot action round-trips through a masked client text frame and correlated echo',async()=>{
  await withServer({},async server=>{
    const {socket,head,tail}=await connect(server);
    assert.match(head,/101 Switching Protocols/);
    const response=once(socket,'data');
    await assert.rejects(server.action('',{}),/invalid OneBot action/);
    assert.equal(server.pending.size,0);
    const pending=server.action('get_status',{});
    const [chunk]=await response;
    const frameStart=tail.length?tail:chunk;
    assert.equal(frameStart[0]&15,1);
    let length=frameStart[1]&127,offset=2;
    if(length===126){length=frameStart.readUInt16BE(2);offset=4;}
    else if(length===127){length=Number(frameStart.readBigUInt64BE(2));offset=10;}
    assert.equal(frameStart.length,offset+length);
    const request=JSON.parse(frameStart.subarray(offset).toString('utf8'));
    socket.write(clientFrame(JSON.stringify({status:'ok',retcode:0,data:{online:true},echo:request.echo})));
    assert.deepEqual(await pending,{status:'ok',retcode:0,data:{online:true},echo:request.echo});
    socket.destroy();
  });
});
