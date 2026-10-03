const assert=require('node:assert/strict');
let locked=true,closed=new Set(),transactions=[],failed=true;
const db={release(){},async query(sql){
  transactions.push(sql);
  if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked}]};
  if(sql.includes('FROM attendance_sessions'))return {rows:[{tenant_id:1,id:7,occurrence_date:'2026-10-03'},{tenant_id:1,id:8,occurrence_date:'2026-10-03'}]};
  if(sql.includes('FROM attendance_occurrences'))return {rows:[{tenant_id:1,occurrence_id:6}]};
  return {rows:[]};
}};
function stub(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};}
stub('../db',{connect:async()=>db});
stub('../services/tenantFeatureService',{isFeatureEnabled:async()=>true});
stub('../services/attendanceCoreService',{
  resolveOccurrence:async({sessionId})=>{if(sessionId===7 && failed)throw {code:'AMBIGUOUS_SESSION_WINDOW'};return {id:sessionId};},
  closeOccurrence:async({occurrenceId})=>{const changed=!closed.has(occurrenceId);closed.add(occurrenceId);return {changed};},
});
const {enforceAutoAlfa}=require('../services/attendanceAutoAlfaService');
(async()=>{
  const first=await enforceAutoAlfa();assert.equal(first.closed,2);assert.equal(first.failed.length,1);
  assert(closed.has(6)&&closed.has(8));assert(transactions.includes('ROLLBACK'));
  failed=false;const second=await enforceAutoAlfa();assert.equal(second.closed,1);
  assert.equal((await enforceAutoAlfa()).closed,0);
  locked=false;assert.equal((await enforceAutoAlfa()).skipped,true);
  const query=transactions.find(s=>s.includes('FROM attendance_sessions'));
  assert(query.includes('attendance_timezone')&&query.includes('attendance_session_weekdays'));
  assert(transactions.some(s=>s.includes("o.state='active' AND o.window_end<=NOW()")));
  console.log('PASS auto-Alfa job: singleton lock, recurring tenant-local day, prior materialized occurrence recovery, failure rollback/isolated continuation, repeated enforcement no duplicate');
})().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
