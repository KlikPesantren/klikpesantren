const pool = require("../db");
const {isFeatureEnabled} = require("./tenantFeatureService");
const {resolveOccurrence,closeOccurrence} = require("./attendanceCoreService");

async function enforceAutoAlfa() {
  const db=await pool.connect();
  try {
    const locked=(await db.query("SELECT pg_try_advisory_lock(hashtext('attendance-auto-alfa')) AS locked")).rows[0].locked;
    if(!locked) return {skipped:true,closed:0};
    try {
      // Only the current tenant-local calendar day is materialized. This is not
      // a guessed historical backfill. Existing closed occurrences are idempotent.
      const sessions=(await db.query(`SELECT s.tenant_id,s.id,
        TO_CHAR(NOW() AT TIME ZONE t.attendance_timezone,'YYYY-MM-DD') AS occurrence_date
        FROM attendance_sessions s JOIN tenants t ON t.id=s.tenant_id
        WHERE s.active=true AND t.status='active' AND s.start_time IS NOT NULL
          AND s.end_time IS NOT NULL AND s.start_time<s.end_time
          AND (NOW() AT TIME ZONE t.attendance_timezone)::time>=s.end_time
          AND (NOT EXISTS(SELECT 1 FROM attendance_session_weekdays w WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id)
            OR EXISTS(SELECT 1 FROM attendance_session_weekdays w WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id
              AND w.day_of_week=EXTRACT(DOW FROM NOW() AT TIME ZONE t.attendance_timezone)))
        ORDER BY s.tenant_id,s.id`)).rows;
      // Recover only occurrences already materialized before a restart. Never
      // manufacture missed historical days/ownership from today's membership.
      const overdue=(await db.query(`SELECT o.tenant_id,o.id AS occurrence_id
        FROM attendance_occurrences o JOIN tenants t ON t.id=o.tenant_id
        WHERE o.state='active' AND o.window_end<=NOW() AND t.status='active'
        ORDER BY o.tenant_id,o.id`)).rows;
      let closed=0; const failed=[];
      for(const session of [...overdue,...sessions]) {
        if(!(await isFeatureEnabled(session.tenant_id,"pendidikan"))) continue;
        await db.query("BEGIN");
        try {
          await db.query("SET LOCAL statement_timeout=30000");
          const occurrence=session.occurrence_id ? {id:session.occurrence_id} :
            await resolveOccurrence({tenantId:session.tenant_id,sessionId:session.id,
              occurrenceDate:session.occurrence_date},db);
          const result=await closeOccurrence({tenantId:session.tenant_id,occurrenceId:occurrence.id},db);
          await db.query("COMMIT"); if(result.changed) closed++;
        } catch(error) {await db.query("ROLLBACK");failed.push({tenant_id:session.tenant_id,
          session_id:session.id,occurrence_id:session.occurrence_id,code:error.code||'INTERNAL_ERROR'});}
      }
      return {skipped:false,closed,failed};
    } finally {await db.query("SELECT pg_advisory_unlock(hashtext('attendance-auto-alfa'))");}
  } finally {db.release();}
}

function startAutoAlfa() {
  let busy=false;
  const run=async()=>{
    if(busy)return; busy=true;
    try {const result=await enforceAutoAlfa();for(const failure of result.failed||[])
      console.error('[ATTENDANCE AUTO ALFA]',failure);}
    catch(error) {console.error("[ATTENDANCE AUTO ALFA]",error.code || "INTERNAL_ERROR");}
    finally{busy=false;}
  };
  run(); const timer=setInterval(run,60_000); timer.unref(); return timer;
}
module.exports={enforceAutoAlfa,startAutoAlfa};
