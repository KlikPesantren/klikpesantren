const crypto = require("node:crypto");
const {resolveOccurrence,applyAttendanceResult,recordAttendanceEvent,getSessionUnits,attendanceError} = require("./attendanceCoreService");
const {upsertAttendanceBatch} = require("./attendanceBatchService");

// Caller owns a single transaction and has already verified class/person authority.
// Scheduled sessions use canonical results ONLY; unscheduled legacy sessions retain
// their existing batch contract. No historical rows are backfilled or removed.
async function saveManualAttendanceBatch(db,{entries,sessions,tenantId,unitId,actorUserId}) {
  let processed=0;
  const legacy=[], occurrences=new Map();
  for (const entry of entries) {
    const session=sessions.get(Number(entry.session_id));
    if (!session || !session.start_time || !session.end_time) {legacy.push(entry);continue;}
    const key=`${entry.session_id}:${entry.tanggal}`;
    if (!occurrences.has(key)) {
      const occurrence=await resolveOccurrence({tenantId,sessionId:entry.session_id,occurrenceDate:entry.tanggal},db);
      const units=await getSessionUnits(db,tenantId,entry.session_id);
      if (!units.includes(Number(unitId))) throw attendanceError("CROSS_UNIT_ATTENDANCE_SESSION","Sesi bukan unit aktif",403);
      occurrences.set(key,occurrence);
    }
    const occurrence=occurrences.get(key);
    const result=await applyAttendanceResult({tenantId,occurrenceId:occurrence.id,
      personType:"santri",personId:entry.santri_id,nextStatus:entry.status,source:"admin",
      adminExplicit:true,actorUserId,effectiveAt:occurrence.window_start,
      provenance:{manual_unit_id:unitId}},db);
    if (result.changed) await recordAttendanceEvent({tenantId,eventKey:`manual:${crypto.randomUUID()}`,
      provider:"admin",personType:"santri",personId:entry.santri_id,occurrenceId:occurrence.id,
      capturedAt:new Date(),outcome:"admin_correction",provenance:{actor_user_id:actorUserId,status:entry.status}},db);
    processed++;
  }
  if (legacy.length) processed+=await upsertAttendanceBatch(db,{entries:legacy,tenantId,unitId,actorUserId});
  return processed;
}
module.exports={saveManualAttendanceBatch};
