import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'../..');
const browser=process.env.ATTENDANCE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const output=path.join(root,'build/attendance-session-editor');fs.mkdirSync(output,{recursive:true});
const before=execFileSync('git',['show','HEAD:frontend/src/pages/AbsensiPage.jsx'],{cwd:root,encoding:'utf8'});
const current=fs.readFileSync(path.join(root,'frontend/src/pages/AbsensiPage.jsx'),'utf8');
const handler=text=>text.match(/const saveSession = async \(session\) => \{[\s\S]*?\n  \};/)?.[0]?.replace(/\r\n/g,'\n');
assert(handler(before));assert.equal(handler(current),handler(before),'session save handler/business contract changed');
const baseline=execFileSync('git',['show','HEAD:frontend/src/components/AttendanceScheduleControls.jsx'],{cwd:root,encoding:'utf8'});
const controls=fs.readFileSync(path.join(root,'frontend/src/components/AttendanceScheduleControls.jsx'),'utf8');
const request=text=>text.match(/await api.patch\([\s\S]*?\);/)?.[0];
assert.equal(request(controls),request(baseline),'schedule endpoint/payload changed');
for(const [width,theme] of [[1648,'light'],[820,'light'],[390,'light'],[1648,'dark']]) {
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'attendance-editor-browser-'));
  const child=spawn(browser,['--headless','--no-first-run','--disable-background-networking',`--user-data-dir=${profile}`,'--remote-debugging-port=0','about:blank'],{stdio:'ignore'});
  let socket;
  try {
    const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
    const activePort=path.join(profile,'DevToolsActivePort');
    for(let i=0;i<100&&!fs.existsSync(activePort);i++)await pause();
    assert(fs.existsSync(activePort),'Browser debugging endpoint unavailable');
    const port=fs.readFileSync(activePort,'utf8').split('\n')[0];
    const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    let id=0;const pending=new Map();const errors=[];
    socket.addEventListener('message',event=>{const reply=JSON.parse(event.data);if(reply.method==='Runtime.exceptionThrown')errors.push(reply.params.exceptionDetails.text);if(reply.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(reply.params.type))errors.push(reply.params.type);if(reply.id){const callbacks=pending.get(reply.id);pending.delete(reply.id);if(reply.error)callbacks.reject(Error(reply.error.message));else callbacks.resolve(reply.result);}});
    const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
    await send('Runtime.enable');await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:width<640});
    await send('Page.navigate',{url:`http://127.0.0.1:4176/scripts/fixtures/attendance-session-editor.html?theme=${theme}`});
    let result;
    for(let i=0;i<150;i++){await pause();result=(await send('Runtime.evaluate',{expression:"document.getElementById('test-result')?.textContent",returnByValue:true})).result.value;if(result&&result!=='WAITING')break;}
    assert(result?.startsWith('PASS'),result || 'fixture failed to hydrate');assert.deepEqual(errors,[],'Browser runtime exception');
    assert.equal((await send('Runtime.evaluate',{expression:'document.documentElement.scrollWidth <= innerWidth',returnByValue:true})).result.value,true,'post-save horizontal overflow');
    const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
    fs.writeFileSync(path.join(output,`${width}-${theme}.png`),Buffer.from(screenshot.data,'base64'));
    console.log(theme+' '+result);
    await send('Browser.close');
  } finally {socket?.close();child.kill();await new Promise(resolve=>setTimeout(resolve,500));fs.rmSync(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}
}
console.log('PASS unchanged production save contracts; one effective selector; existing values; TODAY/NEXT across both actions; desktop/tablet/mobile no-overflow. Synthetic API adapter only.');
