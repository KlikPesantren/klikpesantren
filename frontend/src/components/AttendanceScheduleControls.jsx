import {useState} from "react";
import api from "../services/api";
import AttendanceEffectiveScopeChoice from './AttendanceEffectiveScopeChoice';
const days=["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
export default function AttendanceScheduleControls({session,unitId,units,onSaved}){
  const [weekdays,setWeekdays]=useState(session.weekdays||[]),[additional,setAdditional]=useState(session.additional_unit_ids||[]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [effectiveScope,setEffectiveScope]=useState('');
  if(session.can_configure===false)return <p>Konfigurasi sesi dikelola unit pemilik.</p>;
  async function save(){if(busy)return;setBusy(true);setMessage("");
    try{await api.patch(`/attendance-sessions/${session.id}/schedule`,{unit_id:unitId,weekdays,additional_unit_ids:additional,effective_scope:effectiveScope||undefined});
      setMessage("Jadwal berhasil disimpan.");setEffectiveScope('');await onSaved();}
    catch(e){setMessage(e.response?.data?.error||"Jadwal gagal disimpan");}finally{setBusy(false);}}
  return <div style={{flexBasis:"100%"}}><p>Hari berulang (kosong = setiap hari):</p>
    {days.map((name,i)=><label key={name} style={{marginRight:12}}><input type="checkbox" checked={weekdays.includes(i)}
      onChange={e=>setWeekdays(e.target.checked?[...weekdays,i]:weekdays.filter(d=>d!==i))}/>{name}</label>)}
    <p><label>Unit peserta tambahan <select multiple aria-label="Unit peserta tambahan" value={additional.map(String)}
      onChange={e=>setAdditional(Array.from(e.target.selectedOptions,o=>Number(o.value)))}>
      {units.filter(u=>Number(u.id)!==Number(session.unit_id)&&u.is_active!==false).map(u=><option key={u.id} value={u.id}>{u.nama}</option>)}
    </select></label></p>
    {session.today_exists&&<AttendanceEffectiveScopeChoice value={effectiveScope} onChange={setEffectiveScope} disabled={busy}/>}
    <button disabled={busy||(session.today_exists&&!effectiveScope)} type="button" onClick={save}>Simpan Hari &amp; Unit</button>
    {message&&<p role="status">{message}</p>}
  </div>;
}
