const pool = require("../db");
const {isFeatureEnabled} = require("./tenantFeatureService");
const {resolveOccurrence,closeOccurrence} = require("./attendanceCoreService");

const DEADLINE_GRACE_MS = 1500;
const ERROR_RETRY_MS = 5 * 60 * 1000;
const MAX_ERROR_RETRY_MS = 60 * 60 * 1000;
const MAX_TIMER_MS = 2_147_000_000;

async function enforceAutoAlfa({dbPool=pool,featureEnabled=isFeatureEnabled}={}) {
  let connection;
  try {connection=await dbPool.connect();}
  catch(error){if(error&&typeof error==='object')error.runner_sql_attempts=0;throw error;}
  let sqlAttempts=0;
  const db={query(...args){sqlAttempts++;return connection.query(...args);}};
  try {
    // No session-level lock: PgBouncer transaction pooling does not preserve it.
    // resolveOccurrence/closeOccurrence retain transaction locks and uniqueness.
      // Only the current tenant-local calendar day is materialized. This is not
      // a guessed historical backfill. Existing closed occurrences are idempotent.
      const candidates=(await db.query(`SELECT s.tenant_id,s.id AS session_id,
        TO_CHAR(NOW() AT TIME ZONE t.attendance_timezone,'YYYY-MM-DD') AS occurrence_date,
        NULL::bigint AS occurrence_id
        FROM attendance_sessions s JOIN tenants t ON t.id=s.tenant_id
        WHERE s.active=true AND t.status='active' AND s.start_time IS NOT NULL
          AND s.end_time IS NOT NULL AND s.start_time<s.end_time
          AND (NOW() AT TIME ZONE t.attendance_timezone)::time>=s.end_time
          AND (NOT EXISTS(SELECT 1 FROM attendance_session_weekdays w WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id)
            OR EXISTS(SELECT 1 FROM attendance_session_weekdays w WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id
              AND w.day_of_week=EXTRACT(DOW FROM NOW() AT TIME ZONE t.attendance_timezone)))
          AND NOT EXISTS(SELECT 1 FROM attendance_occurrences existing
            WHERE existing.tenant_id=s.tenant_id AND existing.session_id=s.id
              AND existing.occurrence_date=(NOW() AT TIME ZONE t.attendance_timezone)::date)
        UNION ALL
        -- Recover materialized overdue windows; do not invent historical ownership.
        SELECT o.tenant_id,o.session_id,TO_CHAR(o.occurrence_date,'YYYY-MM-DD'),o.id
        FROM attendance_occurrences o JOIN tenants t ON t.id=o.tenant_id
        WHERE o.state='active' AND o.window_end<=NOW() AND t.status='active'
        ORDER BY tenant_id,session_id,occurrence_id`)).rows;
      let closed=0; const failed=[];
      for(const session of candidates) {
        if(!(await featureEnabled(session.tenant_id,"pendidikan"))) continue;
        await db.query("BEGIN");
        try {
          await db.query("SET LOCAL statement_timeout=30000");
          const occurrence=session.occurrence_id ? {id:session.occurrence_id} :
            await resolveOccurrence({tenantId:session.tenant_id,sessionId:session.session_id,
              occurrenceDate:session.occurrence_date},db);
          const result=await closeOccurrence({tenantId:session.tenant_id,occurrenceId:occurrence.id},db);
          await db.query("COMMIT"); if(result.changed) closed++;
        } catch(error) {await db.query("ROLLBACK");failed.push({tenant_id:session.tenant_id,
          session_id:session.session_id,occurrence_id:session.occurrence_id,code:error.code||'INTERNAL_ERROR'});}
      }
      return {skipped:false,closed,failed,candidates:candidates.length,runner_sql_attempts:sqlAttempts};
  } catch(error) {
    if(error&&typeof error==='object')error.runner_sql_attempts=sqlAttempts;
    throw error;
  } finally {connection.release();}
}

async function getNextAutoAlfaDeadline(client = pool) {
  const {rows}=await client.query(`WITH candidates AS (
    SELECT ((local_day.day + s.end_time) AT TIME ZONE t.attendance_timezone) AS run_at
    FROM attendance_sessions s
    JOIN tenants t ON t.id=s.tenant_id
    CROSS JOIN LATERAL (
      SELECT ((NOW() AT TIME ZONE t.attendance_timezone)::date + day_offset.day)::date AS day
      FROM generate_series(0,7) AS day_offset(day)
    ) local_day
    WHERE s.active=true AND t.status='active' AND s.start_time IS NOT NULL
      AND s.end_time IS NOT NULL AND s.start_time<s.end_time
      AND (NOT EXISTS(SELECT 1 FROM attendance_session_weekdays w
            WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id)
        OR EXISTS(SELECT 1 FROM attendance_session_weekdays w
            WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id
              AND w.day_of_week=EXTRACT(DOW FROM local_day.day)::int))
  ) SELECT MIN(run_at) AS next_run_at FROM candidates WHERE run_at>NOW()`);
  return rows[0]?.next_run_at ? new Date(rows[0].next_run_at) : null;
}

function createAutoAlfaScheduler({
  enforce=enforceAutoAlfa,
  nextDeadline=getNextAutoAlfaDeadline,
  now=()=>Date.now(),
  setTimer=setTimeout,
  clearTimer=clearTimeout,
  logger=console,
}={}) {
  let timer=null,busy=false,rerun=false,started=false,failuresInARow=0,retryNotBefore=0;
  const emit=(level,event)=>logger[level]?.('[ATTENDANCE AUTO ALFA]',JSON.stringify(event));
  const backoff=()=>Math.min(MAX_ERROR_RETRY_MS,ERROR_RETRY_MS*2**Math.min(10,failuresInARow++));
  const clear=()=>{if(timer){clearTimer(timer);timer=null;}};
  const arm=(deadline,reason,grace=true)=>{
    clear();
    if(!started||!deadline){emit('info',{event:'idle',reason});return;}
    const at=new Date(deadline).getTime()+(grace?DEADLINE_GRACE_MS:0);
    if(!Number.isFinite(at))throw Object.assign(Error('Invalid scheduler deadline'),{code:'AUTO_ALFA_INVALID_DEADLINE'});
    const delay=Math.max(0,Math.min(MAX_TIMER_MS,at-now()));
    timer=setTimer(()=>{timer=null;void run('deadline');},delay);
    timer?.unref?.();
    emit('info',{event:'scheduled',reason,run_at:new Date(at).toISOString()});
  };
  const schedule=async(reason,retryAt=null)=>{
    const deadline=await nextDeadline();
    if(retryAt&&(!deadline||retryAt.getTime()<=new Date(deadline).getTime()))arm(retryAt,reason,false);
    else arm(deadline,reason);
  };
  const run=async(reason)=>{
    if(!started)return;
    if(busy){rerun=true;return;}
    if(now()<retryNotBefore){if(!timer)arm(new Date(retryNotBefore),'failure-cooldown',false);return;}
    busy=true;clear();
    const began=now();
    let retryDelay=0;
    const delay=()=>retryDelay||(retryDelay=backoff());
    try {
      const result=await enforce();
      const failures=result.failed||[];
      emit('info',{event:failures.length?'partial':'completed',reason,candidates:result.candidates,closed:result.closed,
        failures:failures.length,runner_sql_attempts:result.runner_sql_attempts,duration_ms:Math.max(0,now()-began)});
      for(const failure of failures)emit('error',{event:'candidate_failed',code:failure.code});
      // One invalid candidate must not delay another tenant's legitimate deadline.
      if(failures.length){await schedule('candidate-retry',new Date(now()+delay()));retryNotBefore=0;}
      else {await schedule(reason);failuresInARow=0;retryNotBefore=0;}
    } catch(error) {
      retryNotBefore=now()+delay();
      emit('error',{event:'failed',reason,code:error.code||'INTERNAL_ERROR',
        category:error.code==='53000'?'insufficient_resources':'database_or_job_error',
        runner_sql_attempts:error.runner_sql_attempts,retry_at:new Date(retryNotBefore).toISOString(),duration_ms:Math.max(0,now()-began)});
      arm(new Date(retryNotBefore),'error-retry',false);
    } finally {
      busy=false;
      if(rerun){rerun=false;queueMicrotask(()=>void run('schedule-change'));}
    }
  };
  return {
    start(){if(started)return this;started=true;void run('startup-catch-up');return this;},
    reschedule(){if(started)void run('schedule-change');},
    stop(){started=false;rerun=false;clear();},
  };
}

let activeScheduler=null;
function startAutoAlfa() {
  if(!activeScheduler)activeScheduler=createAutoAlfaScheduler();
  return activeScheduler.start();
}
function requestAutoAlfaReschedule(){activeScheduler?.reschedule();}

module.exports={enforceAutoAlfa,getNextAutoAlfaDeadline,createAutoAlfaScheduler,startAutoAlfa,requestAutoAlfaReschedule};
