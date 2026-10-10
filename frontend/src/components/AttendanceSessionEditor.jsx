import AttendanceScheduleControls from './AttendanceScheduleControls';
import AttendanceEffectiveScopeChoice from './AttendanceEffectiveScopeChoice';
import Button from './ui/Button';
import './AttendanceSessionEditor.css';

// Presentation only: parent retains the existing session save/API authority.
export default function AttendanceSessionEditor({session, unitId, units, saving, onChange, onSave, onScheduleSaved}) {
  const effectiveScope = session.effective_scope || '';
  return <section className="attendance-session-editor" aria-label={`Pengaturan sesi ${session.display_name}`}>
    <h3>Pengaturan Sesi</h3>
    <div className="attendance-session-editor__fields">
      <label className="absensi-session-field attendance-session-editor__name"><small>Nama sesi</small>
        <input className="form-control-v3" value={session.display_name} onChange={e=>onChange('display_name',e.target.value)}/></label>
      <label className="absensi-session-field"><small>Mulai</small>
        <input className="form-control-v3" type="time" value={session.start_time || ''} onChange={e=>onChange('start_time',e.target.value)}/></label>
      <label className="absensi-session-field"><small>Selesai</small>
        <input className="form-control-v3" type="time" value={session.end_time || ''} onChange={e=>onChange('end_time',e.target.value)}/></label>
      <label className="absensi-session-field"><small>Urutan</small>
        <input className="form-control-v3" type="number" value={session.sort_order} onChange={e=>onChange('sort_order',e.target.value)}/></label>
      <label className="absensi-session-active"><input type="checkbox" checked={Boolean(session.active)} onChange={e=>onChange('active',e.target.checked)}/>Aktif</label>
    </div>
    <AttendanceScheduleControls session={session} unitId={unitId} units={units} onSaved={onScheduleSaved}
      effectiveScope={effectiveScope} onEffectiveScopeChange={value=>onChange('effective_scope',value)}
      effectiveChoice={session.today_exists && <AttendanceEffectiveScopeChoice value={effectiveScope}
        onChange={value=>onChange('effective_scope',value)} disabled={saving}/>}
      primaryAction={<Button type="button" onClick={onSave} disabled={saving || session.can_configure===false || (session.today_exists&&!effectiveScope)}>Simpan</Button>}/>
  </section>;
}
