import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AttendanceDeviceControls from '../../src/components/AttendanceDeviceControls';
import api from '../../src/services/api';
import '../../src/index.css';
import '../../src/styles/theme.css';
const units=[{id:2,nama:'Unit Sintetis A'},{id:3,nama:'Unit Sintetis B'}];
let rows=[{id:1,device_id:'SYNTHETIC-1',nama_device:'Legacy Sintetis',unit_id:2,enabled:false,status:'offline',attendance_mode:null},{id:2,device_id:'SYNTHETIC-2',nama_device:'Baru Sintetis',unit_id:2,enabled:false,status:'offline',attendance_mode:'ATTENDANCE'},{id:3,device_id:'SYNTHETIC-3',nama_device:'Histori Sintetis',unit_id:2,enabled:true,status:'online',attendance_mode:'ATTENDANCE',last_ping:'2026-01-01T00:00:00Z'}];
const requests=[];let next=4;
const pause=(ms=60)=>new Promise(resolve=>setTimeout(resolve,ms));
localStorage.setItem('user',JSON.stringify({role:'superadmin',tenant_id:901,permissions:['rfid.manage']}));
if(new URLSearchParams(location.search).get('theme')==='dark')document.documentElement.dataset.theme='dark';
let copied='';Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{copied=text;}}});
api.defaults.adapter=async config=>{
  requests.push({url:config.url,method:config.method,data:config.data?JSON.parse(config.data):{}});await pause(120);
  const body=config.data?JSON.parse(config.data):{};
  if(config.method==='post'){
    const device={id:next++,device_id:'SYNTHETIC-CREATED',nama_device:body.nama_device,unit_id:2,enabled:false,status:'offline',attendance_mode:'ATTENDANCE'};
    if(config.url.endsWith('/attendance'))rows.push(device);
    return {data:{success:true,data:{device,pairing_code:'s'.repeat(43),expires_at:new Date(Date.now()+900000).toISOString()}},status:201,headers:{},config};
  }
  const id=config.url.includes('SYNTHETIC-1')?1:2;
  if(body.nama_device==='Reject')throw {response:{data:{error:'Synthetic validation error'}}};
  if(config.method==='patch')rows=rows.map(d=>d.id===id?{...d,nama_device:body.nama_device}:d);
  if(config.method==='delete')rows=rows.filter(d=>d.id!==id);
  return {data:{success:true,data:{}},status:200,headers:{},config};
};
export default function Fixture(){const [devices,setDevices]=useState(rows);return <main style={{maxWidth:1240,margin:'20px auto',padding:16,minWidth:0}}><AttendanceDeviceControls unitId={2} units={units} devices={devices} onSaved={async()=>setDevices([...rows])}/><pre id="test-result" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>WAITING</pre></main>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
function input(el,value){Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));}
async function rename(value){document.querySelector('details summary').click();document.querySelector('details button').click();await pause();const dialog=document.querySelector('[role=dialog]');input(dialog.querySelector('input'),value);await pause();button('Simpan').click();await pause(220);}
(async()=>{
  await pause(200);check(button('+ Tambah Perangkat').disabled,'empty create enabled');
  input(document.querySelector('.device-provision input'),'  Created  ');await pause();
  document.querySelector('.device-provision form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  document.querySelector('.device-provision form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));await pause(220);
  check(requests.length===1&&requests[0].data.nama_device==='Created','duplicate create or untrimmed name');
  check(document.querySelector('[role=dialog] code').textContent==='s'.repeat(43),'pairing code not displayed');
  button('Salin').click();await pause();check(copied==='s'.repeat(43),'pairing copy failed');button('Tutup').click();await pause();check(!document.querySelector('code'),'pairing retained after close');
  check(!Object.values(localStorage).some(v=>v.includes('s'.repeat(43))),'pairing persisted');
  await rename('New Name');check(requests.at(-1).url.endsWith('/SYNTHETIC-1/name'),'rename identity changed');check(Object.keys(requests.at(-1).data).sort().join(',')==='nama_device,unit_id','rename leaked mutation fields');
  await rename('Reject');check(document.querySelector('[role=alert]').textContent.includes('Synthetic validation error'),'error silent');button('Batal').click();await pause();
  const unused=[...document.querySelectorAll('tbody tr')].find(tr=>tr.textContent.includes('SYNTHETIC-2'));unused.querySelector('summary').click();[...unused.querySelectorAll('button')].find(b=>b.textContent==='Hapus Perangkat').click();await pause();
  document.querySelector('[role=dialog] button[type=submit]').click();await pause(220);check(requests.at(-1).method==='delete'&&requests.at(-1).data.confirmation_device_id==='SYNTHETIC-2','delete confirmation wrong');
  check(![...document.querySelectorAll('tbody tr')].some(tr=>tr.textContent.includes('SYNTHETIC-2')),'deleted fixture remains');
  const historical=[...document.querySelectorAll('tbody tr')].find(tr=>tr.textContent.includes('SYNTHETIC-3'));historical.querySelector('summary').click();check([...historical.querySelectorAll('button')].find(b=>b.textContent==='Hapus Perangkat').disabled,'known historical delete enabled');
  check(document.documentElement.scrollWidth<=innerWidth,'horizontal overflow');
  document.getElementById('test-result').textContent='PASS '+JSON.stringify({width:innerWidth,requests:requests.length,doubleSubmitGuard:true,copy:true,rename:true,error:true,delete:true,history:true,overflow:false});
})().catch(e=>{document.getElementById('test-result').textContent='FAIL '+e.message;});
