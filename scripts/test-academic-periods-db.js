const assert=require('assert');
const {Client,Pool}=require('pg');
const {readMigration}=require('../utils/migrationLedger');
const {createAcademicPeriodService}=require('../services/academicPeriodService');
const {resolveAcademicPeriodForDate}=require('../services/academicUnitService');
const {upsertAttendanceBatch}=require('../services/attendanceBatchService');
const {resolveOccurrence}=require('../services/attendanceCoreService');
const grants=require('../config/academicRuntimePrivileges');

const config=require('./local-academic-test-config').localAcademicTestConfig();
const {host,port,user,database}=config;
const runtimeRole='ak_runtime_test_'+require('crypto').createHash('sha256').update(database).digest('hex').slice(0,10);
const q=id=>`"${String(id).replace(/"/g,'""')}"`;

async function bootstrap(){
 const admin=new Client({...config,database:'postgres'});await admin.connect();
 try{
  if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[database])).rowCount)throw Error('ACADEMIC_TEST_DB_ALREADY_EXISTS_PRESERVE');
  await admin.query(`CREATE DATABASE ${q(database)}`);
 }finally{await admin.end();}
 const db=new Client(config);await db.connect();
 try{await db.query(`
 CREATE TABLE tenants(id SERIAL PRIMARY KEY,slug text,nama text,status text,attendance_timezone varchar(80) NOT NULL DEFAULT 'Asia/Jakarta');
 CREATE TABLE unit_pendidikan(id SERIAL PRIMARY KEY,tenant_id int NOT NULL REFERENCES tenants(id),kode text,nama text,is_active boolean default true,UNIQUE(tenant_id,id));
 CREATE TABLE users(id SERIAL PRIMARY KEY,tenant_id int NOT NULL REFERENCES tenants(id),nama text,UNIQUE(tenant_id,id));
 CREATE TABLE santri(id SERIAL PRIMARY KEY,tenant_id int NOT NULL REFERENCES tenants(id),nama text,nis text,status text default 'aktif',UNIQUE(tenant_id,id));
 CREATE TABLE kelas(id SERIAL PRIMARY KEY,tenant_id int NOT NULL REFERENCES tenants(id),unit_id int NOT NULL,nama_kelas text,UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id));
 CREATE TABLE santri_units(id BIGSERIAL PRIMARY KEY,tenant_id int NOT NULL,santri_id int NOT NULL,unit_id int NOT NULL,status text default 'active',joined_at date,left_at date,is_primary boolean default false,metadata jsonb default '{}',UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,santri_id) REFERENCES santri(tenant_id,id),FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id));
 -- Match the oldest supported canonical shape: id is globally unique, but the
 -- tenant-scoped pair was not declared unique before migration 110.
 CREATE TABLE santri_kelas_enrollments(id BIGSERIAL PRIMARY KEY,tenant_id int NOT NULL,santri_unit_id bigint NOT NULL,kelas_id int NOT NULL,tahun_ajaran text,semester smallint,start_date date,end_date date,status text default 'active',created_at timestamptz default now(),updated_at timestamptz default now(),FOREIGN KEY(tenant_id,santri_unit_id) REFERENCES santri_units(tenant_id,id),FOREIGN KEY(tenant_id,kelas_id) REFERENCES kelas(tenant_id,id));
 CREATE UNIQUE INDEX uq_fixture_active_enrollment ON santri_kelas_enrollments(tenant_id,santri_unit_id) WHERE status='active' AND end_date IS NULL;
 CREATE TABLE nilai_mingguan(id SERIAL PRIMARY KEY,tenant_id int NOT NULL,santri_id int,tanggal date,mapel text,nilai numeric,bulan int,tahun int,unit_id int,santri_unit_id bigint,enrollment_id bigint,kelas_id int,mata_pelajaran_id int,actor_user_id int,source text default 'admin');
 CREATE TABLE absensi(id SERIAL PRIMARY KEY,tenant_id int NOT NULL,santri_id int,tanggal date,sesi text,session_id bigint,session_name_snapshot text,status text,unit_id int,santri_unit_id bigint,enrollment_id bigint,kelas_id int,actor_user_id int,source text default 'admin');
 CREATE UNIQUE INDEX uq_fixture_absensi ON absensi(tenant_id,unit_id,santri_id,tanggal,session_id) WHERE unit_id IS NOT NULL AND session_id IS NOT NULL;
 CREATE TABLE attendance_sessions(id BIGSERIAL PRIMARY KEY,tenant_id int NOT NULL,unit_id int NOT NULL,start_time time,end_time time,active boolean default true,UNIQUE(tenant_id,id));
 CREATE TABLE attendance_session_units(tenant_id int,session_id bigint,unit_id int,PRIMARY KEY(tenant_id,session_id,unit_id));
 CREATE TABLE attendance_session_weekdays(tenant_id int,session_id bigint,day_of_week smallint,PRIMARY KEY(tenant_id,session_id,day_of_week));
 CREATE TABLE attendance_occurrences(id BIGSERIAL PRIMARY KEY,tenant_id int NOT NULL,session_id bigint NOT NULL,occurrence_date date NOT NULL,timezone text NOT NULL,window_start timestamptz NOT NULL,window_end timestamptz NOT NULL,state text default 'active',cancellation_reason text,created_at timestamptz default now(),closed_at timestamptz,UNIQUE(tenant_id,id),UNIQUE(tenant_id,session_id,occurrence_date));
 CREATE TABLE attendance_occurrence_units(tenant_id int NOT NULL,occurrence_id bigint NOT NULL,unit_id int NOT NULL,created_at timestamptz default now(),PRIMARY KEY(tenant_id,occurrence_id,unit_id));
 CREATE TABLE schema_migrations(filename text PRIMARY KEY,checksum char(64),applied_at timestamptz default now());
 `);
 const migration=readMigration('110_academic_periods_and_promotions.sql');await db.query('BEGIN');await db.query(migration.executionSql);await db.query(`INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)`,[migration.filename,migration.checksum]);await db.query('COMMIT');
 }finally{await db.end();}
}

async function applyRuntimeGrants(db,role){
 await db.query(`CREATE ROLE ${q(role)} NOLOGIN`);await db.query(`GRANT USAGE ON SCHEMA public TO ${q(role)}`);
 for(const [table,rule] of Object.entries({...grants.tables,...grants.externalTables})){
  if(!(await db.query('SELECT to_regclass($1) object',[`public.${table}`])).rows[0].object)continue;
  const ops=[rule.select&&'SELECT',rule.insert&&'INSERT'].filter(Boolean);if(ops.length)await db.query(`GRANT ${ops.join(',')} ON ${q(table)} TO ${q(role)}`);
  if(rule.update?.length)await db.query(`GRANT UPDATE(${rule.update.map(q).join(',')}) ON ${q(table)} TO ${q(role)}`);
 }
 for(const seq of grants.sequences)if((await db.query('SELECT to_regclass($1) object',[`public.${seq}`])).rows[0].object)await db.query(`GRANT USAGE ON SEQUENCE ${q(seq)} TO ${q(role)}`);
}

async function main(){await bootstrap();const pool=new Pool(config),svc=createAcademicPeriodService(pool);let assertions=0;const ok=(v,m)=>{assert.ok(v,m);assertions++};
 try{
  await pool.query(`INSERT INTO tenants(id,slug,nama) VALUES(1,'fixture','Fixture');INSERT INTO unit_pendidikan(id,tenant_id,kode,nama) VALUES(1,1,'SMP','SMP'),(2,1,'MAD','Madinah');INSERT INTO users(id,tenant_id,nama) VALUES(1,1,'Admin'),(2,1,'Operator');`);
  const ctx1={tenantId:1,unitId:1,userId:1},ctx2={tenantId:1,unitId:2,userId:1};
  const y24u1=await svc.createYear(ctx1,{name:'2024/2025',start_date:'2024-07-01',end_date:'2025-06-30'});await pool.query(`UPDATE academic_years SET status='CLOSED' WHERE id=$1`,[y24u1.id]);
  const y25u1=await svc.createYear(ctx1,{name:'2025/2026',start_date:'2025-07-01',end_date:'2026-06-30'});await pool.query(`UPDATE academic_years SET status='CLOSED' WHERE id=$1`,[y25u1.id]);
  const y26u1=await svc.createYear(ctx1,{name:'2026/2027',start_date:'2026-07-01',end_date:'2027-06-30'});
  const y24u2=await svc.createYear(ctx2,{name:'2024/2025',start_date:'2024-07-01',end_date:'2025-06-30'});await pool.query(`UPDATE academic_years SET status='CLOSED' WHERE id=$1`,[y24u2.id]);
  const y25u2=await svc.createYear(ctx2,{name:'2025/2026',start_date:'2025-07-01',end_date:'2026-06-30'});await pool.query(`UPDATE academic_years SET status='CLOSED' WHERE id=$1`,[y25u2.id]);
  const y26u2=await svc.createYear(ctx2,{name:'2026/2027',start_date:'2026-07-01',end_date:'2027-06-30'});
  const vii=await svc.createLevel(ctx1,{code:'VII',name:'VII',sort_order:1,duration_years:1}),viii=await svc.createLevel(ctx1,{code:'VIII',name:'VIII',sort_order:2,duration_years:1}),ix=await svc.createLevel(ctx1,{code:'IX',name:'IX',sort_order:3,duration_years:1,is_terminal:true});
  const m1=await svc.createLevel(ctx2,{code:'1',name:'Kelas 1',sort_order:1,duration_years:2}),m2=await svc.createLevel(ctx2,{code:'2',name:'Kelas 2',sort_order:2,duration_years:2});
  const classes=(await pool.query(`INSERT INTO kelas(tenant_id,unit_id,nama_kelas,academic_grade_level_id) VALUES(1,1,'VII A',$1),(1,1,'VIII A',$2),(1,1,'IX A',$3),(1,2,'M1 A',$4),(1,2,'M2 A',$5) RETURNING *`,[vii.id,viii.id,ix.id,m1.id,m2.id])).rows;
  const byName=n=>classes.find(x=>x.nama_kelas===n);
  await pool.query(`INSERT INTO santri(id,tenant_id,nama,nis) VALUES(1,1,'Satu','1'),(2,1,'Dua','2'),(3,1,'Tiga','3'),(4,1,'Empat','4'),(5,1,'Lima','5'),(6,1,'Enam','6');
    INSERT INTO santri_units(id,tenant_id,santri_id,unit_id) VALUES(1,1,1,1),(2,1,1,2),(3,1,2,1),(4,1,3,2),(5,1,4,2),(6,1,5,1),(7,1,6,1);`);
  const ins=async(su,k,year,level,startYear,status='active',end=null)=>(await pool.query(`INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id,academic_year_id,academic_grade_level_id,level_started_academic_year_id,start_date,end_date,status) VALUES(1,$1,$2,$3,$4,$5,(SELECT start_date FROM academic_years WHERE id=$3),$6,$7) RETURNING *`,[su,k.id,year.id,level.id,startYear.id,end,status])).rows[0];
  const eSmp=await ins(1,byName('VII A'),y25u1,vii,y25u1);await ins(2,byName('M1 A'),y25u2,m1,y25u2);
  const eTerminal=await ins(3,byName('IX A'),y25u1,ix,y25u1);
  await ins(4,byName('M1 A'),y24u2,m1,y24u2,'completed','2025-06-30');const eM2=await ins(4,byName('M1 A'),y25u2,m1,y24u2);
  const eMStay=await ins(5,byName('M1 A'),y25u2,m1,y25u2);
  const eRollback=await ins(6,byName('VII A'),y25u1,vii,y25u1);const eConcurrent=await ins(7,byName('VII A'),y25u1,vii,y25u1);
  const pSmp=await svc.preview(ctx1,{mappings:[{source_kelas_id:byName('VII A').id,target_kelas_id:byName('VIII A').id,target_grade_level_id:viii.id}]});
  ok(pSmp.find(x=>x.santri_unit_id==='1'||Number(x.santri_unit_id)===1).recommendation==='NAIK','SMP VII recommends NAIK');ok(pSmp.find(x=>Number(x.santri_unit_id)===3).recommendation==='LULUS','terminal recommends LULUS');
  const pMad=await svc.preview(ctx2,{mappings:[{source_kelas_id:byName('M1 A').id,target_kelas_id:byName('M2 A').id,target_grade_level_id:m2.id}]});ok(pMad.find(x=>Number(x.santri_unit_id)===2).recommendation==='TETAP','Madinah year one stays');ok(pMad.find(x=>Number(x.santri_unit_id)===4).recommendation==='NAIK','Madinah year two advances');
  const batch=await svc.execute(ctx1,{source_academic_year_id:y25u1.id,target_academic_year_id:y26u1.id,effective_date:'2026-07-01',idempotency_key:'smp-main',decisions:[{source_enrollment_id:eSmp.id,target_kelas_id:byName('VIII A').id,target_grade_level_id:viii.id,decision:'NAIK'},{source_enrollment_id:eTerminal.id,decision:'LULUS'}]});ok(batch.summary.NAIK===1&&batch.summary.LULUS===1,'batch summary');
  const replay=await svc.execute(ctx1,{source_academic_year_id:y25u1.id,target_academic_year_id:y26u1.id,effective_date:'2026-07-01',idempotency_key:'smp-main',decisions:[{source_enrollment_id:eSmp.id,target_kelas_id:byName('VIII A').id,target_grade_level_id:viii.id,decision:'NAIK'},{source_enrollment_id:eTerminal.id,decision:'LULUS'}]});ok(replay.id===batch.id,'idempotent replay');
  ok(Number((await pool.query(`SELECT count(*) c FROM santri_kelas_enrollments WHERE santri_unit_id=1 AND status='active'`)).rows[0].c)===1,'one active enrollment');ok(Number((await pool.query(`SELECT count(*) c FROM santri_kelas_enrollments WHERE santri_unit_id=2 AND status='active'`)).rows[0].c)===1,'other unit untouched');
  await assert.rejects(()=>svc.execute(ctx1,{source_academic_year_id:y25u1.id,target_academic_year_id:y26u1.id,effective_date:'2026-07-01',idempotency_key:'rollback',decisions:[{source_enrollment_id:eRollback.id,target_kelas_id:byName('VIII A').id,decision:'NAIK'},{source_enrollment_id:999999,target_kelas_id:byName('VIII A').id,decision:'NAIK'}]}),e=>e.code==='STALE_PREVIEW');assertions++;ok((await pool.query(`SELECT status FROM santri_kelas_enrollments WHERE id=$1`,[eRollback.id])).rows[0].status==='active','rollback restored first row');
  const concurrencyPayload=k=>svc.execute(ctx1,{source_academic_year_id:y25u1.id,target_academic_year_id:y26u1.id,effective_date:'2026-07-01',idempotency_key:k,decisions:[{source_enrollment_id:eConcurrent.id,target_kelas_id:byName('VIII A').id,decision:'NAIK'}]});const concurrent=await Promise.allSettled([concurrencyPayload('con-a'),concurrencyPayload('con-b')]);ok(concurrent.filter(x=>x.status==='fulfilled').length===1&&concurrent.filter(x=>x.status==='rejected').length===1,'concurrent promotion bounded');
  const madBatch=await svc.execute(ctx2,{source_academic_year_id:y25u2.id,target_academic_year_id:y26u2.id,effective_date:'2026-07-01',idempotency_key:'mad-main',decisions:[{source_enrollment_id:eM2.id,target_kelas_id:byName('M2 A').id,decision:'NAIK'},{source_enrollment_id:eMStay.id,target_kelas_id:byName('M1 A').id,decision:'TETAP',reason:'Keputusan admin: belum lulus'}]});ok(madBatch.summary.NAIK===1&&madBatch.summary.TETAP===1,'Madinah exception');
  await pool.query(`UPDATE academic_years SET status='ACTIVE' WHERE id=$1`,[y26u1.id]);const semester=await svc.createSemester(ctx1,{academic_year_id:y26u1.id,term:'GANJIL',start_date:'2026-07-01',end_date:'2026-12-31'});await svc.transitionSemester(ctx1,semester.id,'activate');
  const activeEnrollment=(await pool.query(`SELECT * FROM santri_kelas_enrollments WHERE santri_unit_id=1 AND status='active'`)).rows[0];await pool.query(`INSERT INTO nilai_mingguan(tenant_id,santri_id,tanggal,mapel,nilai,bulan,tahun,unit_id,santri_unit_id,enrollment_id,kelas_id,academic_year_id,academic_semester_id) VALUES(1,1,'2026-08-01','Matematika',80,8,2026,1,1,$1,$2,$3,$4)`,[activeEnrollment.id,activeEnrollment.kelas_id,y26u1.id,semester.id]);await pool.query(`INSERT INTO nilai_mingguan(tenant_id,santri_id,tanggal,mapel,nilai,bulan,tahun,unit_id) VALUES(1,2,'2020-01-01','Legacy',70,1,2020,1)`);
  await upsertAttendanceBatch(pool,{entries:[{santri_id:1,tanggal:'2026-08-01',session_id:1,status:'H',session_name:'Pagi',santri_unit_id:1,enrollment_id:activeEnrollment.id,kelas_id:activeEnrollment.kelas_id}],tenantId:1,unitId:1,actorUserId:1});const attendance=(await pool.query(`SELECT academic_semester_id FROM absensi WHERE santri_id=1`)).rows[0];ok(Number(attendance.academic_semester_id)===Number(semester.id),'attendance period snapshot');
  await pool.query(`INSERT INTO attendance_sessions(id,tenant_id,unit_id,start_time,end_time,active) VALUES(1,1,1,'07:00','08:00',true)`);const occurrence=await resolveOccurrence({tenantId:1,sessionId:1,occurrenceDate:'2026-08-01'},pool);const occurrenceUnit=(await pool.query(`SELECT academic_semester_id FROM attendance_occurrence_units WHERE occurrence_id=$1`,[occurrence.id])).rows[0];ok(Number(occurrenceUnit.academic_semester_id)===Number(semester.id),'occurrence unit period snapshot');
  await svc.transitionSemester(ctx1,semester.id,'close');await assert.rejects(()=>resolveAcademicPeriodForDate(1,1,'2026-08-01',{requireActive:true},pool),e=>e.code==='ACADEMIC_SEMESTER_NOT_ACTIVE');assertions++;
  const gradeId=(await pool.query(`SELECT id FROM nilai_mingguan WHERE mapel='Matematika'`)).rows[0].id;await svc.correctClosedGrade(ctx1,gradeId,{confirmation:'CORRECT_CLOSED_SEMESTER',reason:'Koreksi administratif fixture',nilai:85});ok(Number((await pool.query(`SELECT nilai FROM nilai_mingguan WHERE id=$1`,[gradeId])).rows[0].nilai)===85,'audited correction applied');ok(Number((await pool.query(`SELECT count(*) c FROM academic_grade_corrections WHERE nilai_id=$1`,[gradeId])).rows[0].c)===1,'correction audit');
  ok((await pool.query(`SELECT academic_semester_id FROM nilai_mingguan WHERE mapel='Legacy'`)).rows[0].academic_semester_id===null,'legacy grade remains unmapped');
  await pool.query(`INSERT INTO academic_semesters(tenant_id,unit_id,academic_year_id,term,start_date,end_date,status) VALUES(1,1,$1,'GENAP','2027-01-01','2027-06-30','ACTIVE')`,[y26u1.id]);
  await assert.rejects(()=>pool.query(`INSERT INTO academic_semesters(tenant_id,unit_id,academic_year_id,term,start_date,end_date,status) VALUES(1,1,$1,'GANJIL','2025-07-01','2025-12-31','ACTIVE')`,[y25u1.id]),e=>e.code==='23505');assertions++;
  await applyRuntimeGrants(pool,runtimeRole);const acl=(await pool.query(`SELECT has_table_privilege($1,'academic_years','SELECT') sel,has_table_privilege($1,'academic_years','DELETE') del,has_schema_privilege($1,'public','CREATE') create_schema`,[runtimeRole])).rows[0];ok(acl.sel&&!acl.del&&!acl.create_schema,'least privilege');
  const runtime=await pool.connect();try{await runtime.query('SET ROLE '+q(runtimeRole));ok((await runtime.query('SELECT count(*)::int c FROM academic_years')).rows[0].c>0,'runtime read works');await assert.rejects(()=>runtime.query('DELETE FROM academic_years WHERE false'),e=>e.code==='42501');assertions++;}finally{await runtime.query('RESET ROLE');runtime.release();}
  const ledger=(await pool.query(`SELECT count(*) c FROM schema_migrations WHERE filename='110_academic_periods_and_promotions.sql'`)).rows[0];ok(Number(ledger.c)===1,'migration ledger once');
  console.log(JSON.stringify({status:'PASS',assertions,migration:'110_academic_periods_and_promotions.sql',database,host,port},null,2));
 }finally{await pool.end();}
}
main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
