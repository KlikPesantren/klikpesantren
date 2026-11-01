// Rollback-only service checks under the existing restricted local fixture role.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),{Pool}=require('pg');
const config=require('./local-academic-test-config').localAcademicTestConfig();
if(config.host!=='127.0.0.1'||config.port!==55439||!/^klikpesantren_ak_nov20261101rc[a-z0-9]+_test$/.test(config.database))throw Error('LOCAL_RC_FIXTURE_REQUIRED');
const {createAcademicPeriodService}=require('../services/academicPeriodService');
const reports=require('../services/academicReportService');
const pool=new Pool(config),role='ak_report_runtime_'+crypto.createHash('sha256').update(config.database).digest('hex').slice(0,10);
(async()=>{
 const c=await pool.connect();let nested=0,checks=0;
 try{
  const identity=(await c.query('SELECT current_database() db,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
  assert.deepEqual(identity,{db:config.database,host:'127.0.0.1',port:55439});
  const ws=(await c.query('SELECT s.id semester_id,k.id kelas_id FROM academic_semesters s JOIN kelas k ON k.tenant_id=s.tenant_id AND k.unit_id=s.unit_id WHERE s.tenant_id=1 AND s.unit_id=1 ORDER BY s.id,k.id LIMIT 1')).rows[0];
  const subject=(await c.query('SELECT id FROM mata_pelajaran WHERE tenant_id=1 AND unit_id=1 ORDER BY id LIMIT 1')).rows[0];
  const before=(await c.query('SELECT (SELECT count(*) FROM academic_years) years,(SELECT count(*) FROM academic_semesters) semesters,(SELECT count(*) FROM academic_report_config_versions) configs')).rows[0];
  await c.query('BEGIN');await c.query('SET LOCAL ROLE "'+role+'"');
  const bridge={connect:async()=>bridge,query(sql,params){
   if(sql==='BEGIN')return c.query('SAVEPOINT service_'+(++nested));
   if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT service_'+nested--);
   if(sql==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT service_'+nested--);
   return c.query(sql,params);
  }};
  const period=createAcademicPeriodService(bridge),ctx={tenantId:1,unitId:1,userId:1};
  const year=await period.createYear(ctx,{name:'Runtime RC 2098',start_date:'2098-07-01',end_date:'2099-06-30'});assert(year.id);checks++;
  const semester=await period.createSemester(ctx,{academic_year_id:year.id,term:'GANJIL',start_date:'2098-07-01',end_date:'2098-12-31'});assert(semester.id);checks++;
  const cfg=await reports.createConfig(bridge,{tenantId:1,unitId:1,actorId:1,name:'Rollback runtime RC',subjects:[{mata_pelajaran_id:subject.id}]});assert(cfg.id);checks++;
  assert(await reports.listWorkspace(bridge,{tenantId:1,unitId:1,actorId:1,isManager:true,semesterId:ws.semester_id,kelasId:ws.kelas_id,configId:cfg.id}));checks++;
  await assert.rejects(()=>reports.listWorkspace(bridge,{tenantId:999,unitId:1,actorId:1,semesterId:ws.semester_id,kelasId:ws.kelas_id,configId:cfg.id}),e=>e.code==='REPORT_WORKSPACE_NOT_FOUND');checks++;
  await c.query('SAVEPOINT denied_delete');await assert.rejects(()=>c.query('DELETE FROM academic_report_publications WHERE false'),e=>e.code==='42501');await c.query('ROLLBACK TO SAVEPOINT denied_delete');checks++;
  await c.query('ROLLBACK');
  assert.deepEqual((await c.query('SELECT (SELECT count(*) FROM academic_years) years,(SELECT count(*) FROM academic_semesters) semesters,(SELECT count(*) FROM academic_report_config_versions) configs')).rows[0],before);checks++;
  console.log(JSON.stringify({status:'PASS',checks,restrictedRole:true,rollback:true,productionQueries:0}));
 }finally{await c.query('ROLLBACK').catch(()=>{});c.release();}
})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1;}).finally(()=>pool.end());
