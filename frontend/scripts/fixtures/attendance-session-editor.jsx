import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import AttendanceSessionEditor from '../../src/components/AttendanceSessionEditor';
import api from '../../src/services/api';
import '../../src/index.css';
import '../../src/styles/theme.css';

const original={id:987654,unit_id:2,display_name:'Sesi Uji Sintetis',start_time:'13:00',end_time:'14:30',sort_order:3,active:true,today_exists:true,weekdays:[1,3],additional_unit_ids:[3]};
const units=[{id:2,nama:'Unit Pemilik'},{id:3,nama:'Unit Uji A'},{id:4,nama:'Unit Uji B'},{id:5,nama:'Unit Uji C'},{id:6,nama:'Unit Uji D'}];
const requests=[];
if(new URLSearchParams(location.search).get('theme')==='dark') document.documentElement.dataset.theme='dark';
// No HTTP or production mutation: all requests terminate at this synthetic adapter.
api.defaults.adapter=async config=>{requests.push({url:config.url,data:JSON.parse(config.data)});return {data:{success:true},status:200,statusText:'OK',headers:{},config};};
export default function Fixture() {
  const [session,setSession]=useState(original);
  return <main style={{maxWidth:1240,margin:'24px auto',padding:16}}>
    <AttendanceSessionEditor session={session} unitId={2} units={units} saving={false}
      onChange={(field,value)=>setSession(s=>({...s,[field]:value}))}
      onScheduleSaved={async()=>{}}
      onSave={()=>api.patch(`/attendance-sessions/${session.id}`,{display_name:session.display_name,start_time:session.start_time||null,end_time:session.end_time||null,sort_order:Number(session.sort_order),active:Boolean(session.active),unit_id:2,effective_scope:session.effective_scope||undefined})}/>
    <pre id="test-result" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>WAITING</pre>
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
async function verify() {
  await pause();
  const check=(ok,message)=>{if(!ok)throw Error(message);};
  const editor=document.querySelector('.attendance-session-editor');
  check(editor,'editor missing');
  check(editor.querySelectorAll('.attendance-effective-choice select').length===1,'effective control duplicated');
  check([...editor.querySelectorAll('button')].every(button=>button.disabled),'save enabled without mandatory choice');
  check(editor.querySelector('input[type=time]').value==='13:00','existing time not loaded');
  check(editor.querySelector('input[type=number]').value==='3','sort order not loaded');
  check(editor.querySelectorAll('.attendance-schedule-days input:checked').length===2,'weekday state not loaded');
  check(editor.querySelectorAll('.attendance-schedule-units input:checked').length===1,'unit state not loaded');
  check(document.documentElement.scrollWidth<=window.innerWidth,'horizontal overflow');
  const fields=[...editor.querySelector('.attendance-session-editor__fields').children];
  if(window.innerWidth>1023) check(fields.every(el=>Math.abs(el.getBoundingClientRect().top-fields[0].getBoundingClientRect().top)<35),'desktop fields not one row');
  for(const scope of ['TODAY','NEXT']) {
    const select=editor.querySelector('select'); select.value=scope;select.dispatchEvent(new Event('change',{bubbles:true}));await pause();
    const buttons=[...editor.querySelectorAll('button')];
    check(buttons.every(button=>!button.disabled),'explicit choice did not enable save');
    buttons.find(b=>b.textContent==='Simpan').click();await pause();
    buttons.find(b=>b.textContent==='Simpan Hari & Unit').click();await pause();
    const pair=requests.slice(-2);
    check(pair.length===2 && pair.every(r=>r.data.effective_scope===scope && r.data.unit_id===2),'effective scope/payload wrong');
    check(JSON.stringify(pair[1].data.weekdays)==='[1,3]' && JSON.stringify(pair[1].data.additional_unit_ids)==='[3]','schedule payload changed');
    check(editor.querySelector('select').value==='','successful schedule save did not reset explicit choice');
  }
  document.getElementById('test-result').textContent='PASS '+JSON.stringify({width:window.innerWidth,effectiveControls:1,requests:requests.length,overflow:false});
}
verify().catch(error=>{document.getElementById('test-result').textContent='FAIL '+error.message;});
