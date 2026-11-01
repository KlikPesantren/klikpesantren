const assert=require('node:assert/strict'),{Pool}=require('pg');
const config=require('./local-academic-test-config').localAcademicTestConfig();
if(config.host!=='127.0.0.1'||config.port!==55439||!/^klikpesantren_ak_nov[a-z0-9]+_test$/.test(config.database))throw Error('LOCAL_FIXTURE_REQUIRED');
const pool=new Pool(config);const {createAcademicPeriodService}=require('../services/academicPeriodService');
(async()=>{const c=await pool.connect();let nested=0;try{
 assert.equal((await c.query('SELECT current_database() db')).rows[0].db,config.database);
 await c.query('BEGIN');
 const bridge={release(){},connect:async()=>bridge,query(sql,p){if(sql==='BEGIN')return c.query('SAVEPOINT p'+(++nested));if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT p'+nested--);if(sql==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT p'+nested--);return c.query(sql,p);}};
 const svc=createAcademicPeriodService(bridge),ctx={tenantId:1,unitId:1,userId:1};
 await c.query("UPDATE academic_semesters SET status='CLOSED' WHERE tenant_id=1 AND unit_id=1 AND status='ACTIVE'; UPDATE academic_years SET status='CLOSED' WHERE tenant_id=1 AND unit_id=1 AND status='ACTIVE'");
 const year=await svc.createYear(ctx,{name:'Boundary 2090',start_date:'2090-07-01',end_date:'2091-06-30'});
 const semester=await svc.createSemester(ctx,{academic_year_id:year.id,term:'GANJIL',start_date:'2090-07-01',end_date:'2090-12-31'});
 await c.query("UPDATE academic_years SET status='CLOSED' WHERE id=$1",[year.id]);
 await assert.rejects(()=>svc.transitionSemester(ctx,semester.id,'activate'),e=>e.code==='ACADEMIC_YEAR_CLOSED');
 assert.equal((await c.query('SELECT status FROM academic_years WHERE id=$1',[year.id])).rows[0].status,'CLOSED');
 assert.equal((await c.query('SELECT status FROM academic_semesters WHERE id=$1',[semester.id])).rows[0].status,'DRAFT');
 await assert.rejects(()=>svc.transitionSemester({...ctx,tenantId:999},semester.id,'activate'),e=>e.code==='NOT_FOUND');
 console.log('PASS closed-year semester activation rejected atomically; tenant isolation; rollback-only fixture');
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}})().catch(e=>{console.error(e.code||e.name,e.message);process.exitCode=1;});
