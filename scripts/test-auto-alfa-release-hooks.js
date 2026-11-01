// Route handlers run against mocks: no DB/network, checks post-commit scheduling.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const filename=path.join(root,'routes/attendanceSessionRoutes.js');
const source=globalThis.__releaseFiles?.['routes/attendanceSessionRoutes.js']||fs.readFileSync(filename,'utf8');
let events=[],fail=null,denied=false,foreign=false,checks=0;
const routes=new Map(),router={get(){},post(p,fn){routes.set('POST '+p,fn);},patch(p,fn){routes.set('PATCH '+p,fn);}};
const row={id:7,display_name:'Test',start_time:'08:00',end_time:'09:00',sort_order:0,active:true};
const query=async sql=>{const op=sql.trim().split(/\s+/)[0];events.push(op);if(fail===op)throw Object.assign(Error('synthetic'),{status:409});return {rows:[row]};};
const db={query,release(){events.push('release');}};
const mocks={crypto:require('node:crypto'),express:{Router:()=>router},'../db':{query,connect:async()=>db},
 '../middleware/kelasScope':{resolveKelasScopeAccess:async()=>({denied,canManage:!denied})},
 '../services/academicUnitService':{getAttendanceSessionInUnit:async()=>{if(foreign)throw Object.assign(Error('scope'),{status:403});return row;},resolveAcademicUnit:async()=>({mode:'UNIT',unitId:1}),sendAcademicError(res,e){res.status(e.status||500).json({success:false});}},
 '../services/unitAccessService':{assertUnitAccess:async()=>{}},
 '../services/attendanceCoreService':{setSessionWeekdays:async()=>[],setSessionAdditionalUnits:async()=>[]},
 '../services/attendanceScheduleEditService':{loadTodayForEdit:async()=>null,reconcileToday:async()=>{events.push('reconcile');return {}; }},
 '../services/attendanceAutoAlfaService':{requestAutoAlfaReschedule(){events.push('reschedule');}},
};
vm.runInThisContext(require('node:module').wrap(source),{filename})({},name=>{assert(name in mocks,'unexpected dependency '+name);return mocks[name];},{exports:{}},filename,path.dirname(filename));
async function invoke(key){events=[];const res={code:200,status(n){this.code=n;return this;},json(){events.push('response');return this;}};await routes.get(key)({tenantId:1,user:{id:1},params:{sessionId:7},body:{display_name:'Test',start_time:'08:00',end_time:'09:00',additional_unit_ids:[],weekdays:[1]}},res);return res;}
(async()=>{
 for(const key of ['POST /','PATCH /:sessionId/schedule','PATCH /:sessionId']){
  fail=null;denied=false;foreign=false;const res=await invoke(key);
  assert(res.code<300);assert.equal(events.filter(e=>e==='reschedule').length,1);assert(events.indexOf('reschedule')>events.indexOf(key==='POST /'?'INSERT':'COMMIT'));assert(events.indexOf('response')>events.indexOf('reschedule'));checks++;
  fail=key==='POST /'?'INSERT':'COMMIT';assert((await invoke(key)).code>=400);assert(!events.includes('reschedule'));if(key!=='POST /')assert(events.includes('ROLLBACK'));checks++;
  fail=null;denied=true;assert.equal((await invoke(key)).code,403);assert(!events.includes('reschedule')&&!events.includes('INSERT')&&!events.includes('BEGIN'));checks++;
  if(key!=='POST /'){denied=false;foreign=true;assert.equal((await invoke(key)).code,403);assert(!events.includes('reschedule'));assert(events.includes('ROLLBACK'));checks++;}
 }
 console.log(JSON.stringify({status:'PASS',checks,coverage:'3 hooks; after write/commit; failed write/commit; permission denial; cross-unit rejection',realDatabaseQueries:0}));
})().catch(e=>{console.error(e);process.exitCode=1;});
