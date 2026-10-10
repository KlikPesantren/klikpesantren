import {useState} from "react";
import api from "../services/api";
import Button from './ui/Button';
const days=["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"];
export default function AttendanceScheduleControls({session,unitId,units,onSaved,effectiveScope,onEffectiveScopeChange,effectiveChoice,primaryAction}){
  const [weekdays,setWeekdays]=useState(session.weekdays||[]),[additional,setAdditional]=useState(session.additional_unit_ids||[]);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function save(){if(busy)return;setBusy(true);setMessage("");
    try{await api.patch(`/attendance-sessions/${session.id}/schedule`,{unit_id:unitId,weekdays,additional_unit_ids:additional,effective_scope:effectiveScope||undefined});
      setMessage("Jadwal berhasil disimpan.");onEffectiveScopeChange('');await onSaved();}
    catch(e){setMessage(e.response?.data?.error||"Jadwal gagal disimpan");}finally{setBusy(false);}}
  return <div>
    {session.can_configure===false && <p>Konfigurasi sesi dikelola unit pemilik.</p>}
    <fieldset className="attendance-schedule-section" disabled={session.can_configure===false}><legend>Hari Berulang</legend>
      <p className="attendance-schedule-helper">Pilih hari pelaksanaan. Kosong = setiap hari.</p>
      <div className="attendance-schedule-days">{days.map((name,i)=><label key={name} className="attendance-schedule-option"><input type="checkbox" checked={weekdays.includes(i)}
        onChange={e=>setWeekdays(e.target.checked?[...weekdays,i]:weekdays.filter(d=>d!==i))}/><span>{name}</span></label>)}</div>
    </fieldset>
    <fieldset className="attendance-schedule-section" disabled={session.can_configure===false}><legend>Unit Peserta Tambahan</legend>
      <p className="attendance-schedule-helper">Pilih unit lain yang ikut sesi ini.</p>
      <div className="attendance-schedule-units">{units.filter(u=>Number(u.id)!==Number(session.unit_id)&&u.is_active!==false).map(u=><label key={u.id} className="attendance-schedule-option">
        <input type="checkbox" checked={additional.map(Number).includes(Number(u.id))}
          onChange={e=>setAdditional(e.target.checked?[...additional,Number(u.id)]:additional.filter(id=>Number(id)!==Number(u.id)))}/><span>{u.nama}</span>
      </label>)}</div>
    </fieldset>
    {effectiveChoice}<div className="attendance-session-editor__footer">
      <Button variant="outline" disabled={session.can_configure===false||busy||(session.today_exists&&!effectiveScope)} type="button" onClick={save}>Simpan Hari &amp; Unit</Button>
      {primaryAction}
    </div>
    {message&&<p role="status">{message}</p>}
  </div>;
}
