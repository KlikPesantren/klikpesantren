const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

let closed=new Set(),transactions=[],failed=true;
const db={release(){},async query(sql){
  transactions.push(sql);
  if(sql.includes('FROM attendance_sessions'))return {rows:[{tenant_id:1,session_id:7,occurrence_date:'2026-10-03'},{tenant_id:1,session_id:8,occurrence_date:'2026-10-03'},{tenant_id:1,session_id:9,occurrence_id:6}]};
  return {rows:[]};
}};
function stub(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../db',{connect:async()=>db});
stub('../services/tenantFeatureService',{isFeatureEnabled:async()=>true});
stub('../services/attendanceCoreService',{
  resolveOccurrence:async({sessionId})=>{if(sessionId===7&&failed)throw {code:'AMBIGUOUS_SESSION_WINDOW'};return {id:sessionId};},
  closeOccurrence:async({occurrenceId})=>{const changed=!closed.has(occurrenceId);closed.add(occurrenceId);return {changed};},
});
const auto=require('../services/attendanceAutoAlfaService');

async function settle(){await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));}

(async()=>{
  const first=await auto.enforceAutoAlfa();
  assert.equal(first.closed,2);assert.equal(first.failed.length,1);assert(transactions.includes('ROLLBACK'));
  failed=false;assert.equal((await auto.enforceAutoAlfa()).closed,1);assert.equal((await auto.enforceAutoAlfa()).closed,0);
  assert(!transactions.some(sql=>sql.includes('pg_try_advisory_lock')),'no session lock on transaction pooling');
  assert(transactions.some(sql=>sql.includes("o.state='active' AND o.window_end<=NOW()")),'restart catch-up must inspect overdue occurrences');

  const deadline=new Date('2026-10-22T05:30:00.000Z');
  const next=await auto.getNextAutoAlfaDeadline({query:async sql=>{
    assert(sql.includes('generate_series(0,7)'),'deadline query must calculate actual recurring session dates');
    assert(sql.includes('attendance_timezone')&&sql.includes('attendance_session_weekdays'));
    return {rows:[{next_run_at:deadline}]};
  }});
  assert.equal(next.toISOString(),deadline.toISOString());

  let enforceCalls=0,nextCalls=0;const timers=[];
  const scheduler=auto.createAutoAlfaScheduler({
    enforce:async()=>{enforceCalls++;return {skipped:false,closed:0,failed:[]};},
    nextDeadline:async()=>{nextCalls++;return new Date(11_000);},now:()=>0,
    setTimer:(fn,delay)=>{const timer={fn,delay,unref(){}};timers.push(timer);return timer;},
    clearTimer:()=>{},logger:{info(){},error(){}},
  }).start();
  await settle();
  assert.equal(enforceCalls,1,'startup performs one catch-up');assert.equal(nextCalls,1);
  assert.equal(timers.at(-1).delay,12_500,'timer is armed at the exact session end plus grace');
  scheduler.reschedule();await settle();assert.equal(enforceCalls,2,'schedule mutation re-arms without browser activity');
  scheduler.stop();
  assert(!read('services/attendanceAutoAlfaService.js').includes('setInterval('),'idle scheduler must not poll PostgreSQL every minute');

  const hook=read('frontend/src/hooks/useVisibilityPolling.js');
  assert(hook.includes("document.visibilityState==='visible'")&&hook.includes("visibilitychange"));
  for(const file of ['DevicePage.jsx','AuditPage.jsx','RFIDDevicePage.jsx','RFIDMonitorPage.jsx']){
    const source=read(`frontend/src/pages/${file}`);
    assert(source.includes('useVisibilityPolling'),`${file} must use visibility-aware polling`);
    assert(!source.includes('setInterval('),`${file} must not retain unconditional polling`);
  }
  assert(read('frontend/src/pages/DevicePage.jsx').includes('useVisibilityPolling(getDevices,60000)'));
  assert(read('frontend/src/pages/AuditPage.jsx').includes('useVisibilityPolling(getLogs,60000)'));
  assert(read('frontend/src/pages/RFIDDevicePage.jsx').includes('useVisibilityPolling(loadData,30000)'));
  assert(read('frontend/src/pages/RFIDMonitorPage.jsx').includes('useVisibilityPolling(getData,30000)'));

  const monitor=read('controllers/rfidMonitorController.js');
  assert(!monitor.includes('UPDATE devices'),'monitor GET must be read-only');
  assert(monitor.includes("tr.created_at >= CURRENT_DATE")&&monitor.includes("tr.created_at < CURRENT_DATE + INTERVAL '1 day'"));
  assert(monitor.includes("CASE WHEN d.last_ping IS NOT NULL"),'online status remains a timestamp-derived projection');
  console.log('PASS deadline-driven Auto-Alfa, restart catch-up, singleton/idempotency, visibility polling, read-only RFID monitor and indexable date range');
})().catch(error=>{console.error(error);process.exitCode=1;});
