const crypto=require('node:crypto');
const {attendanceError,recordAttendanceEvent,getSessionUnits,closeOccurrence}=require('./attendanceCoreService');

// Called inside the session-edit transaction. Today's identity/history never
// moves to a new occurrence; earlier calendar dates are never edited here.
async function loadTodayForEdit(db,tenantId,sessionId,effectiveScope){
  await db.query(`SELECT pg_advisory_xact_lock(hashtext('attendance-occurrence:'||$1::text||':'||
    TO_CHAR(NOW() AT TIME ZONE attendance_timezone,'YYYY-MM-DD'))) FROM tenants WHERE id=$1::int`,[tenantId]);
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`attendance-session-edit:${tenantId}:${sessionId}`]);
  await db.query('SELECT id FROM attendance_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,sessionId]);
  const row=(await db.query(`SELECT o.*,TO_CHAR(o.occurrence_date,'YYYY-MM-DD') local_date
    FROM attendance_occurrences o JOIN tenants t ON t.id=o.tenant_id
    WHERE o.tenant_id=$1 AND o.session_id=$2
      AND o.occurrence_date=(NOW() AT TIME ZONE t.attendance_timezone)::date FOR UPDATE OF o`,[tenantId,sessionId])).rows[0];
  if(row&&!['TODAY','NEXT'].includes(effectiveScope))throw attendanceError('SCHEDULE_EFFECTIVE_SCOPE_REQUIRED',
    'Jadwal hari ini sudah terbentuk. Pilih Berlaku Hari Ini atau Mulai Jadwal Berikutnya.',409);
  if(effectiveScope!==undefined&&!['TODAY','NEXT'].includes(effectiveScope))throw attendanceError('INVALID_EFFECTIVE_SCOPE','Pilihan berlaku jadwal tidak valid',400);
  return row;
}

async function reconcileToday(db,{tenantId,sessionId,actorUserId,effectiveScope,before,now=new Date()}){
  if(!before||effectiveScope==='NEXT')return {today_changed:false};
  if(before.state==='cancelled')throw attendanceError('OCCURRENCE_CANCELLED','Sesi hari ini dibatalkan; tidak boleh dibuka diam-diam',409);
  const next=(await db.query(`SELECT s.active,s.start_time,s.end_time,
    ($3::date+s.start_time) AT TIME ZONE o.timezone window_start,
    ($3::date+s.end_time) AT TIME ZONE o.timezone window_end,$5::timestamptz clock,
    NOT EXISTS(SELECT 1 FROM attendance_session_weekdays w WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id)
      OR EXISTS(SELECT 1 FROM attendance_session_weekdays w WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id
        AND w.day_of_week=EXTRACT(DOW FROM $3::date)) scheduled
    FROM attendance_sessions s JOIN attendance_occurrences o ON o.tenant_id=s.tenant_id AND o.id=$4
    WHERE s.tenant_id=$1 AND s.id=$2`,[tenantId,sessionId,before.local_date,before.id,now])).rows[0];
  if(!next.active||!next.scheduled||!next.start_time||!next.end_time||next.start_time>=next.end_time)
    throw attendanceError('INVALID_TODAY_SCHEDULE','Hari ini memerlukan sesi aktif, hari terjadwal dan jam mulai sebelum selesai',422);
  const units=await getSessionUnits(db,tenantId,sessionId);
  const existingUnits=(await db.query('SELECT unit_id FROM attendance_occurrence_units WHERE tenant_id=$1 AND occurrence_id=$2 ORDER BY unit_id',[tenantId,before.id])).rows.map(r=>Number(r.unit_id));
  // Scope removal must not hide valid history. Adding scope remains safe.
  if(existingUnits.some(id=>!units.includes(id)))throw attendanceError('TODAY_UNIT_REMOVAL_REQUIRES_REVIEW',
    'Unit sesi hari ini tidak boleh dihapus dari histori. Gunakan Mulai Jadwal Berikutnya.',409);
  const conflict=(await db.query(`SELECT o.id FROM attendance_occurrences o
    WHERE o.tenant_id=$1 AND o.occurrence_date=$2 AND o.id<>$3 AND o.state<>'cancelled'
      AND o.window_start<$5 AND o.window_end>$4 AND EXISTS(SELECT 1 FROM attendance_occurrence_units u
        WHERE u.tenant_id=o.tenant_id AND u.occurrence_id=o.id AND u.unit_id=ANY($6::int[])) LIMIT 1`,
    [tenantId,before.local_date,before.id,next.window_start,next.window_end,units])).rows[0];
  if(conflict)throw attendanceError('AMBIGUOUS_SESSION_WINDOW','Jadwal bertumpuk pada unit peserta yang sama',409);
  const state=next.clock<next.window_end?'active':'closed';
  const reopen=before.state==='closed'&&state==='active';
  const audit=await recordAttendanceEvent({tenantId,eventKey:`schedule:${crypto.randomUUID()}`,provider:'admin',
    occurrenceId:before.id,capturedAt:next.clock,receivedAt:next.clock,outcome:'schedule_edited',
    provenance:{actor_user_id:actorUserId,effective_scope:'TODAY',before:{window_start:before.window_start,
      window_end:before.window_end,state:before.state,closed_at:before.closed_at,unit_ids:existingUnits},after:{window_start:next.window_start,
      window_end:next.window_end,state,unit_ids:units}}},db);
  await db.query(`UPDATE attendance_occurrences SET window_start=$3,window_end=$4,state=$5::varchar,
    closed_at=CASE WHEN $5::varchar='active' THEN NULL ELSE closed_at END WHERE tenant_id=$1 AND id=$2`,
    [tenantId,before.id,next.window_start,next.window_end,'active']);
  await db.query(`INSERT INTO attendance_occurrence_units(tenant_id,occurrence_id,unit_id)
    SELECT $1,$2,u FROM UNNEST($3::int[]) u ON CONFLICT DO NOTHING`,[tenantId,before.id,units]);
  if(state==='active')await db.query(`UPDATE attendance_results SET provenance=provenance||jsonb_build_object(
    'pending_schedule_edit_event_id',$3::bigint),updated_at=NOW()
    WHERE tenant_id=$1 AND occurrence_id=$2 AND status='A' AND source='system'
      AND auto_generated=true AND protected_manual=false`,[tenantId,before.id,audit.event.id]);
  if(state==='closed')await closeOccurrence({tenantId,occurrenceId:before.id,now:next.clock},db);
  return {today_changed:true,reopened:reopen,occurrence_id:before.id};
}
module.exports={loadTodayForEdit,reconcileToday};
