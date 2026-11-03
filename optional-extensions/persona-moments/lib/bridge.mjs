import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
export function workspaceRoot(config){
  return config&&config.workspaceRoot?path.resolve(config.workspaceRoot):fileURLToPath(new URL('../../../',import.meta.url));
}
export async function accountGate(root,scope){
  const account=read(path.join(root,'state/weflow/active-account.json'));
  if((account.id||account.legacyId)!==scope)throw Error('朋友圈账号作用域与宿主不一致');
  const {verifyWeChatAccount}=await import(pathToFileURL(path.join(root,'scripts/wechat-account-check.mjs')).href);
  const config=read(path.join(root,'config/wechatagent.json'));
  const settings=read(path.join(root,'state/weflow/WeFlow-config.json'));
  const verified=await verifyWeChatAccount({root,config,settings,wait:false,requestTimeoutMs:1000});
  if(!Number.isSafeInteger(verified.pid)||verified.pid<1)throw Error('微信进程核验失败');
  return verified.pid;
}
export async function deliver(ctx,request){
  const cfg=ctx.config(),root=workspaceRoot(cfg);
  const python=cfg.pythonExe||path.join(os.homedir(),'AppData/Local/WeChatAgentMoments/runtime/Scripts/python.exe');
  const timeoutMs=Number.isFinite(request.timeoutMs)?Math.min(Math.max(request.timeoutMs,3000),30000):18000;
  const maxPosts=Number.isInteger(request.maxPosts)?Math.min(Math.max(request.maxPosts,1),3):1;
  if(!path.isAbsolute(python)||!fs.existsSync(python))throw Error('请先运行安装运行环境.cmd，或配置Python绝对路径');
  await request.check();
  const pid=await accountGate(root,ctx.account.id);
  const script=fileURLToPath(new URL('../bridge/publisher.py',import.meta.url));
  const receiptDir=path.join(root,'state/persona-moments',ctx.account.id);
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-X','utf8','-u',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let buffer='',output=null,settled=false,ready=false,commitAttempted=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);ctx.signal?.removeEventListener('abort',cancel);child.kill();if(error)error.commitAttempted=commitAttempted;error?reject(error):resolve(result);};
    const cancel=()=>finish(Error('朋友圈操作取消；如已进入发表阶段，请核对朋友圈，禁止盲目重试'));
    const timer=setTimeout(()=>finish(Error('朋友圈组件超时；请检查微信弹窗和操作记录')),timeoutMs);
    ctx.signal?.addEventListener('abort',cancel,{once:true});
    if(ctx.signal?.aborted)return cancel();
    child.on('error',()=>finish(Error('Python启动失败，请检查运行环境')));
    child.stderr.on('data',()=>{});
    child.stdin.on('error',()=>{});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk=>{
      buffer+=chunk;if(buffer.length>16000)return finish(Error('发布组件输出超限'));
      let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;
        let value;try{value=JSON.parse(line);}catch{return finish(Error('发布组件协议错误'));}
        if(value.event==='ready'&&!ready){ready=true;(async()=>{try{
          await request.check();if(await accountGate(root,ctx.account.id)!==pid)throw Error('微信进程发生变化');
          if(!settled){commitAttempted=true;child.stdin.write(JSON.stringify({commit:true})+'\n');}
        }catch(e){finish(e);}})();}
        else if(value.event==='result'){output=value;}
      }
    });
    child.on('close',()=>{if(settled)return;if(!output)return finish(Error('发布组件退出，未取得结果；请核对微信'));finish(null,output);});
    child.stdin.write(JSON.stringify({pid,text:request.text,date:request.date,mode:request.mode,receiptDir,maxPosts})+'\n');
  });
}
