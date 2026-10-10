// Isolated branch ONLY. Every fixture and schema change is rolled back. No secret output.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Client}=require('pg'),dotenv=require('dotenv'),bcrypt=require('bcryptjs');
const {readMigration}=require('../utils/migrationLedger');
function stub(name,exports){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports};}
async function main(){
  const env=dotenv.parse(fs.readFileSync(process.env.ATTENDANCE_REHEARSAL_ENV));
  const endpoint=host=>String(host).match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./)?.[1];
  const target=endpoint(new URL(env.DATABASE_URL).hostname),production=endpoint(process.env.DB_HOST);
  assert(target && production && target===env.EXPECTED_REHEARSAL_ENDPOINT_ID && target!==production);
  const db=new Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await db.connect();
  let savepoint=0,activeSavepoint;
  const bridge={release(){},async query(sql,params){
    if(sql==='BEGIN'){activeSavepoint=`pairing_${++savepoint}`;return db.query(`SAVEPOINT ${activeSavepoint}`);}
    if(sql==='COMMIT')return db.query(`RELEASE SAVEPOINT ${activeSavepoint}`);
    if(sql==='ROLLBACK')return db.query(`ROLLBACK TO SAVEPOINT ${activeSavepoint}`);
    return db.query(sql,params);
  }};
  stub('../db',{query:(...args)=>db.query(...args),connect:async()=>bridge});
  // Feature/RBAC unit tests are separate. This harness exercises real SQL,
  // real unit authority, bcrypt, canonical services and transactional rollback.
  stub('../services/tenantFeatureService',{isFeatureEnabled:async()=>true});
  const pairing=require('../services/attendancePairingService');
  const core=require('../services/attendanceCoreService');
  const {saveManualAttendanceBatch}=require('../services/attendanceManualService');
  const {deleteTenantSafely}=require('../services/tenantHealthService');
  const {attendanceReadSql}=require('../services/attendanceReadSql');
  const id=async(sql,p)=>(await db.query(sql,p)).rows[0].id;
  try{
    await db.query('BEGIN');await db.query('SET LOCAL statement_timeout=20000');
    assert.equal((await db.query("SELECT to_regclass('attendance_device_pairings') IS NULL AS fresh")).rows[0].fresh,true);
    await db.query(readMigration('093_attendance_device_pairing.sql').executionSql);
    const runtimeRole=process.env.DB_USER;
    assert(/^[a-z_][a-z0-9_]*$/.test(runtimeRole));
    assert.equal((await db.query('SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls AS privileged FROM pg_roles WHERE rolname=$1',[runtimeRole])).rows[0].privileged,false);
    // Non-production transactional rehearsal of the exact additive grant plan.
    await db.query(`GRANT SELECT,INSERT,UPDATE ON attendance_device_pairings TO "${runtimeRole}"`);
    await db.query(`GRANT USAGE ON attendance_device_pairings_id_seq TO "${runtimeRole}"`);
    for(const operation of ['SELECT','INSERT','UPDATE'])assert.equal((await db.query('SELECT has_table_privilege($1,$2,$3) allowed',[runtimeRole,'attendance_device_pairings',operation])).rows[0].allowed,true);
    assert.equal((await db.query("SELECT has_table_privilege($1,'attendance_device_pairings','DELETE') allowed",[runtimeRole])).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_sequence_privilege($1,'attendance_device_pairings_id_seq','USAGE') allowed",[runtimeRole])).rows[0].allowed,true);
    console.log('PASS non-production runtime metadata: least-privilege role flags, pairing SELECT/INSERT/UPDATE + sequence USAGE only; no DELETE; all rehearsal grants rolled back');
    const suffix=crypto.randomBytes(8).toString('hex');
    const tenant=await id("INSERT INTO tenants(slug,nama,status) VALUES($1,'SYNTHETIC ATTENDANCE TEST','active') RETURNING id",[`att-test-${suffix}`]);
    const other=await id("INSERT INTO tenants(slug,nama,status) VALUES($1,'SYNTHETIC CONTROL','inactive') RETURNING id",[`att-control-${suffix}`]);
    const unit=await id("INSERT INTO unit_pendidikan(tenant_id,kode,nama,unit_type,preset_key) VALUES($1,'TEST','SYNTHETIC','CUSTOM','custom') RETURNING id",[tenant]);
    const unitB=await id("INSERT INTO unit_pendidikan(tenant_id,kode,nama,unit_type,preset_key) VALUES($1,'TESTB','SYNTHETIC B','CUSTOM','custom') RETURNING id",[tenant]);
    const actor=await id("INSERT INTO users(tenant_id,username,role,status) VALUES($1,$2,'superadmin','Aktif') RETURNING id",[tenant,`att-user-${suffix}`]);
    const req={tenantId:tenant,user:{id:actor},body:{unit_id:unit,nama_device:'SYNTHETIC DEVICE'}};
    // Actual production router + JWT/session/tenant/RBAC middleware on localhost.
    process.env.JWT_SECRET='synthetic-rehearsal-only-no-production';
    process.env.WALI_JWT_SECRET='synthetic-wali-rehearsal-only';
    const express=require('express'),jwt=require('jsonwebtoken');
    const app=express();app.use(express.json());app.use('/rfid/device',require('../routes/rfidDeviceRoutes'));
    const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
    try{
      const base=`http://127.0.0.1:${server.address().port}/rfid/device/attendance`;
      const token=jwt.sign({id:actor,role:'superadmin',tenant_id:tenant,token_version:0},process.env.JWT_SECRET,{expiresIn:'1m'});
      assert.equal((await fetch(base)).status,401);
      assert.equal((await fetch(base,{headers:{authorization:'Bearer invalid-synthetic'}})).status,401);
      assert.equal((await fetch(base,{headers:{authorization:`Bearer ${token}`}})).status,400);
      const response=await fetch(`${base}?unit_id=${unit}`,{headers:{authorization:`Bearer ${token}`}});
      assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
      const payload=await response.json();assert.equal(payload.data.length,0);
      const body=JSON.stringify(payload);assert(!body.includes('device_secret'));
      console.log('PASS authenticated localhost: actual RFID router + JWT/session/tenant/RBAC; 401 missing/wrong auth, 400 no scope, 200 scoped device read/no secret');
    }finally{await new Promise(r=>server.close(r));}
    const issued=await pairing.create(req);
    const redeem=await pairing.redeem(issued.pairing_code);
    const stored=(await db.query('SELECT device_secret,device_secret_hash FROM devices WHERE tenant_id=$1 AND id=$2',[tenant,issued.device.id])).rows[0];
    assert.equal(stored.device_secret,'__HASHED_V1__');assert(await bcrypt.compare(redeem.device_secret,stored.device_secret_hash));
    await assert.rejects(()=>pairing.redeem(issued.pairing_code),e=>e.code==='PAIRING_INVALID');
    const targetReq={...req,params:{deviceId:issued.device.device_id}};
    const reissued=await pairing.reissue(targetReq);
    const replacement=await pairing.redeem(reissued.pairing_code);
    const newHash=(await db.query('SELECT device_secret_hash FROM devices WHERE tenant_id=$1 AND id=$2',[tenant,issued.device.id])).rows[0].device_secret_hash;
    assert(await bcrypt.compare(replacement.device_secret,newHash));assert(!(await bcrypt.compare(redeem.device_secret,newHash)));
    await assert.rejects(()=>pairing.reissue({...targetReq,tenantId:other}),e=>e.status===403);
    await assert.rejects(()=>pairing.list({...req,body:{}}),e=>e.code==='UNIT_REQUIRED');
    await pairing.edit({...targetReq,body:{unit_id:unit,assignment_unit_id:unitB,enabled:false}});
    assert.equal((await pairing.list(req)).length,0);assert.equal((await pairing.list({...req,body:{unit_id:unitB}})).length,1);
    await assert.rejects(()=>pairing.reissue(targetReq),e=>e.status===403);
    const kelas=await id("INSERT INTO kelas(tenant_id,unit_id,nama_kelas) VALUES($1,$2,'SYNTHETIC') RETURNING id",[tenant,unit]);
    const person=await id("INSERT INTO santri(tenant_id,nama,status) VALUES($1,'SYNTHETIC PERSON','aktif') RETURNING id",[tenant]);
    const membership=await id('INSERT INTO santri_units(tenant_id,santri_id,unit_id) VALUES($1,$2,$3) RETURNING id',[tenant,person,unit]);
    await db.query('INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id) VALUES($1,$2,$3)',[tenant,membership,kelas]);
    const kelasB=await id("INSERT INTO kelas(tenant_id,unit_id,nama_kelas) VALUES($1,$2,'SYNTHETIC B') RETURNING id",[tenant,unitB]);
    const membershipB=await id('INSERT INTO santri_units(tenant_id,santri_id,unit_id) VALUES($1,$2,$3) RETURNING id',[tenant,person,unitB]);
    await db.query('INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id) VALUES($1,$2,$3)',[tenant,membershipB,kelasB]);
    const childB=await id("INSERT INTO santri(tenant_id,nama,status) VALUES($1,'SYNTHETIC CHILD B','aktif') RETURNING id",[tenant]);
    const childBMembership=await id('INSERT INTO santri_units(tenant_id,santri_id,unit_id) VALUES($1,$2,$3) RETURNING id',[tenant,childB,unitB]);
    await db.query('INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id) VALUES($1,$2,$3)',[tenant,childBMembership,kelasB]);
    const teacher=await id("INSERT INTO guru(tenant_id,unit_id,nama) VALUES($1,$2,'SYNTHETIC TEACHER') RETURNING id",[tenant,unit]);
    await db.query('INSERT INTO guru_units(tenant_id,guru_id,unit_id) VALUES($1,$2,$3)',[tenant,teacher,unit]);
    const session=await id("INSERT INTO attendance_sessions(tenant_id,unit_id,code,display_name,start_time,end_time) VALUES($1,$2,'TEST','SYNTHETIC','00:00','00:01') RETURNING id",[tenant,unit]);
    await core.setSessionAdditionalUnits({tenantId:tenant,sessionId:session,unitIds:[unitB]},db);
    const date=(await db.query("SELECT TO_CHAR(NOW() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') d")).rows[0].d;
    const occurrence=await core.resolveOccurrence({tenantId:tenant,sessionId:session,occurrenceDate:date},db);
    assert.equal((await core.resolveOccurrence({tenantId:tenant,sessionId:session,occurrenceDate:date},db)).id,occurrence.id);
    const closed=await core.closeOccurrence({tenantId:tenant,occurrenceId:occurrence.id,now:new Date(occurrence.window_end)},db);assert.equal(closed.inserted,3);
    assert.equal((await core.closeOccurrence({tenantId:tenant,occurrenceId:occurrence.id},db)).changed,false);
    const input={tenantId:tenant,occurrenceId:occurrence.id,personType:'santri',personId:person,nextStatus:'H',source:'device',effectiveAt:occurrence.window_start};
    assert.equal((await core.applyAttendanceResult(input,db)).result.status,'H');
    assert.equal((await core.applyAttendanceResult(input,db)).changed,false);
    await saveManualAttendanceBatch(db,{tenantId:tenant,unitId:unit,actorUserId:actor,sessions:new Map([[Number(session),{start_time:'00:00',end_time:'00:01'}]]),entries:[{santri_id:person,session_id:session,tanggal:date,status:'I'}]});
    assert.equal((await core.applyAttendanceResult(input,db)).changed,false);
    const projected=(await db.query(`SELECT * FROM (${attendanceReadSql()}) a WHERE santri_id=$2 AND unit_id=$3`,[tenant,person,unit])).rows;
    assert.equal(projected.length,1);assert.equal(projected[0].status,'I');
    const protectedTeacher=await core.applyAttendanceResult({...input,personType:'guru',personId:teacher,source:'admin',nextStatus:'S',adminExplicit:true,actorUserId:actor},db);
    assert.equal(protectedTeacher.result.status,'S');
    assert.equal((await core.applyAttendanceResult({...input,personType:'guru',personId:teacher},db)).changed,false);
    const phone=`test-${suffix.slice(0,12)}`;
    const waliId=await id("INSERT INTO wali_akun(tenant_id,nomor_hp,pin_hash,nama,must_change_pin) VALUES($1,$2,$3,'SYNTHETIC GUARDIAN',false) RETURNING id",[tenant,phone,await bcrypt.hash('synthetic-fixture-only',4)]);
    for(const child of [person,childB])await db.query("INSERT INTO wali_santri(tenant_id,santri_id,nomor_hp,nama) VALUES($1,$2,$3,'SYNTHETIC')",[tenant,child,phone]);
    for(const u of [unit,unitB])await db.query("INSERT INTO unit_features(tenant_id,unit_id,feature_key,enabled,source) VALUES($1,$2,'absensi',true,'custom')",[tenant,u]);
    const waliService=require('../services/waliAppService');
    const waliApp=express();waliApp.use('/wali-app',require('../routes/waliAppRoutes'));
    const waliServer=waliApp.listen(0,'127.0.0.1');await new Promise(r=>waliServer.once('listening',r));
    try{
      const endpoint=`http://127.0.0.1:${waliServer.address().port}/wali-app`;
      const token=waliService.signWaliToken({id:waliId,nomor_hp:phone,token_version:0},[person,childB],{id:tenant,slug:`att-test-${suffix}`});
      const headers={authorization:`Bearer ${token}`};
      assert.equal((await fetch(`${endpoint}/me`)).status,401);
      const children=await fetch(`${endpoint}/anak`,{headers});assert.equal(children.status,200);
      assert.equal((await children.json()).data.length,3);
      for(const [child,u,expected] of [[person,unit,'I'],[childB,unitB,'A'],[person,unit,'I'],[person,unitB,'I']]){
        const response=await fetch(`${endpoint}/absensi?bulan=${Number(date.slice(5,7))}&tahun=${date.slice(0,4)}`,
          {headers:{...headers,'x-santri-id':String(child),'x-unit-id':String(u)}});
        assert.equal(response.status,200);const body=await response.json();
        assert.equal(body.riwayat.length,1);assert.equal(body.riwayat[0].status,expected);
      }
      assert.equal((await fetch(`${endpoint}/absensi`,{headers:{...headers,'x-santri-id':String(childB),'x-unit-id':String(unit)}})).status,403);
      assert.equal((await fetch(`${endpoint}/absensi`,{headers:{...headers,'x-santri-id':String(person)}})).status,400);
      assert.equal((await fetch(`${endpoint}/absensi`,{headers:{...headers,'x-santri-id':String(person+1000000),'x-unit-id':String(unit)}})).status,403);
      console.log('PASS authenticated Wali localhost: actual JWT/ownership/unit guards, two children/three contexts, A→B→A, canonical I/A history, wrong-child/foreign-unit denied, no-unit fail closed');
    }finally{await new Promise(r=>waliServer.close(r));}
    // Lifecycle uses the SAME service. Force a late failure, prove full rollback.
    await db.query("UPDATE tenants SET status='inactive' WHERE id=$1",[tenant]);
    const tenantRow=(await db.query('SELECT id,slug,nama,status FROM tenants WHERE id=$1',[tenant])).rows[0];
    await db.query('SAVEPOINT forced_failure');
    const failing={query:async(sql,p)=>{if(sql.includes('DELETE FROM tenants'))throw {code:'SYNTHETIC_FORCED_FAILURE'};return db.query(sql,p);}};
    await assert.rejects(()=>deleteTenantSafely(tenantRow,{id:actor},failing),e=>e.code==='SYNTHETIC_FORCED_FAILURE');
    await db.query('ROLLBACK TO SAVEPOINT forced_failure');
    assert.equal((await db.query('SELECT count(*)::int n FROM attendance_results WHERE tenant_id=$1',[tenant])).rows[0].n,3);
    await deleteTenantSafely(tenantRow,{id:actor},db);
    for(const table of ['tenants','devices','attendance_device_pairings','attendance_results','attendance_events','attendance_occurrences']){
      const column=table==='tenants'?'id':'tenant_id';
      assert.equal((await db.query(`SELECT count(*)::int n FROM ${table} WHERE ${column}=$1`,[tenant])).rows[0].n,0);
    }
    assert.equal((await db.query('SELECT count(*)::int n FROM tenants WHERE id=$1',[other])).rows[0].n,1);
    await db.query('ROLLBACK');
    assert.equal((await db.query("SELECT to_regclass('attendance_device_pairings') IS NULL gone")).rows[0].gone,true);
    console.log('PASS real PostgreSQL: pairing bcrypt/replay/replacement, unit assignment/isolation, occurrence uniqueness, auto-A santri+guru/idempotency, late A→H, manual I/S protection, canonical read, hard-delete/cascade, forced rollback, unrelated tenant intact; all writes rolled back; production writes=0');
  }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
main().catch(e=>{console.error(JSON.stringify({status:'FAIL',error_class:e.code||e.name,assertion:e.name==='AssertionError'?e.message:undefined}));process.exitCode=1;});
