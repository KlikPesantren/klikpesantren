import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const browser='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const output=path.join(root,'build/device-management-ui');fs.mkdirSync(output,{recursive:true});
for(const [width,theme] of [[1648,'light'],[820,'light'],[390,'light'],[1648,'dark']]){
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'device-ui-browser-'));
  const child=spawn(browser,['--headless','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
  let socket;
  try{
    const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
    const activePort=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(activePort);i++)await pause();assert(fs.existsSync(activePort));
    const port=fs.readFileSync(activePort,'utf8').split('\n')[0];const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let id=0;const pending=new Map(),errors=[];
    socket.addEventListener('message',event=>{const reply=JSON.parse(event.data);if(reply.method==='Runtime.exceptionThrown')errors.push('exception');if(reply.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(reply.params.type))errors.push(reply.params.type);if(reply.id){const p=pending.get(reply.id);pending.delete(reply.id);reply.error?p.reject(Error(reply.error.message)):p.resolve(reply.result);}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<640});
    await send('Page.navigate',{url:`http://127.0.0.1:4176/scripts/fixtures/device-management.html?theme=${theme}`});
    let result;for(let i=0;i<150;i++){await pause();result=(await send('Runtime.evaluate',{expression:"document.getElementById('test-result')?.textContent",returnByValue:true})).result.value;if(result&&result!=='WAITING')break;}
    assert(result?.startsWith('PASS'),result||'fixture failed to hydrate');assert.deepEqual(errors,[]);
    assert.equal((await send('Runtime.evaluate',{expression:'document.documentElement.scrollWidth<=innerWidth',returnByValue:true})).result.value,true);
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(output,`${width}-${theme}.png`),Buffer.from(screenshot.data,'base64'));console.log(theme+' '+result);
    await send('Browser.close');
  }finally{socket?.close();child.kill();await new Promise(resolve=>setTimeout(resolve,500));fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
