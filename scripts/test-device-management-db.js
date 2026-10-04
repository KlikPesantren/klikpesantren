// Non-production only: isolated session-local TEMP tables, never real tenant rows.
const assert=require('node:assert/strict'),fs=require('node:fs');
const {Client}=require('pg'),dotenv=require('dotenv');
function endpoint(host){return String(host).match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./)?.[1];}
async function main(){
  if(!process.env.DEVICE_TEST_REHEARSAL_ENV || !process.env.DB_HOST)throw {code:'NON_PRODUCTION_CONTEXT_REQUIRED'};
  const env=dotenv.parse(fs.readFileSync(process.env.DEVICE_TEST_REHEARSAL_ENV));
  const target=endpoint(new URL(env.DATABASE_URL).hostname),production=endpoint(process.env.DB_HOST);
  if(!target || target!==env.EXPECTED_REHEARSAL_ENDPOINT_ID || target===production)throw {code:'NON_PRODUCTION_IDENTITY_UNPROVEN'};
  const client=new Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});await client.connect();
  const suffix=require('node:crypto').randomBytes(6).toString('hex');
  const tables=['devices','attendance_events','attendance_device_pairings','wallet_transactions','transaksi_rfid','rfid_sync_queue','audit_logs'];
  const baseQuery=client.query.bind(client);
  // Neon pooled sessions may retain TEMP objects until backend reset. Unique
  // names + explicit TEMP cleanup prevent collision with prior test sessions.
  const raw=(sql,params)=>baseQuery(sql.replace(new RegExp('(?<!public\\.)\\b('+tables.join('|')+')\\b','g'),name=>name+'_'+suffix),params);
  let failure=false;
  const db={release(){},query:async(sql,params)=>{if(failure===true&&sql.startsWith('INSERT INTO audit_logs'))throw Error('synthetic rollback');const result=await raw(sql,params);if(failure==='after-delete'&&sql.startsWith('DELETE FROM devices'))throw Error('synthetic post-delete rollback');return result;}};
  function stub(name,value){const id=require.resolve(name);require.cache[id]={id,filename:id,loaded:true,exports:value};}
  stub('../db',{connect:async()=>db});
  stub('../services/unitAccessService',{
    accessError:(message,status=403,code='UNIT_ACCESS_DENIED')=>Object.assign(Error(message),{status,code}),
    resolveActiveUnit:async req=>{if(req.user.role==='operator'&&req.body.unit_id!==2)throw Object.assign(Error('denied'),{status:403});return {mode:req.body.unit_id&&!req.body.scope?'UNIT':'ALL',unitId:req.body.unit_id,tenantId:req.tenantId};},
  });
  const service=require('../services/deviceManagementService');
  try{
    await raw(`CREATE TEMP TABLE devices(id integer PRIMARY KEY,tenant_id integer,device_id text,nama_device text,unit_id integer,enabled boolean,status text,last_ping timestamp,firmware_version text,last_sync timestamp,attendance_mode text,merchant_id integer,device_secret text,device_secret_hash text,secret_rotated_at timestamptz,last_authenticated_at timestamptz,UNIQUE(tenant_id,id))`);
    await raw(`CREATE TEMP TABLE attendance_events(device_id integer REFERENCES devices(id) DEFERRABLE INITIALLY DEFERRED)`);
    await raw(`CREATE TEMP TABLE attendance_device_pairings(device_id integer REFERENCES devices(id) ON DELETE CASCADE,used_at timestamptz)`);
    for(const table of ['wallet_transactions','transaksi_rfid','rfid_sync_queue'])await raw(`CREATE TEMP TABLE ${table}(device_id integer)`);
    await raw(`CREATE TEMP TABLE audit_logs(tenant_id integer,device_id text,event_type text,detail text)`);
    const req={tenantId:901,user:{id:11,role:'superadmin'},params:{deviceId:'SYNTHETIC-DEVICE'},body:{unit_id:2,nama_device:'  Baru  ',confirmation:'DELETE',confirmation_device_id:'SYNTHETIC-DEVICE'}};
    await raw(`INSERT INTO devices(id,tenant_id,device_id,nama_device,unit_id,enabled,status,attendance_mode,device_secret) VALUES(1,901,'SYNTHETIC-DEVICE','Original',2,false,'offline','ATTENDANCE','__UNPAIRED__'),(2,902,'OTHER-TENANT','Other',3,false,'offline','ATTENDANCE','__UNPAIRED__')`);
    await raw('INSERT INTO attendance_device_pairings(device_id) VALUES(1)');
    const before=(await raw('SELECT * FROM devices WHERE id=1')).rows[0];
    await service.rename(req);const after=(await raw('SELECT * FROM devices WHERE id=1')).rows[0];
    assert.equal(after.nama_device,'Baru');delete before.nama_device;delete after.nama_device;assert.deepEqual(after,before);
    failure=true;await assert.rejects(()=>service.rename({...req,body:{...req.body,nama_device:'Failed'}}));failure=false;
    assert.equal((await raw('SELECT nama_device FROM devices WHERE id=1')).rows[0].nama_device,'Baru');
    await assert.rejects(()=>service.rename({...req,tenantId:902}),e=>e.status===404);
    await assert.rejects(()=>service.rename({...req,body:{...req.body,unit_id:3},user:{id:12,role:'operator'}}),e=>e.status===403);
    await assert.rejects(()=>service.rename({...req,body:{nama_device:'A'}}),e=>e.code==='UNIT_REQUIRED');
    for(const table of ['attendance_events','wallet_transactions','transaksi_rfid','rfid_sync_queue']){
      await raw(`INSERT INTO ${table}(device_id) VALUES(1)`);await assert.rejects(()=>service.remove(req),e=>e.code==='DEVICE_HISTORY_PROTECTED');assert.equal((await raw('SELECT count(*)::int n FROM devices WHERE id=1')).rows[0].n,1);await raw(`DELETE FROM ${table} WHERE device_id=1`);
    }
    await raw("UPDATE devices SET last_authenticated_at=NOW() WHERE id=1");await assert.rejects(()=>service.remove(req),e=>e.code==='DEVICE_HISTORY_PROTECTED');await raw('UPDATE devices SET last_authenticated_at=NULL WHERE id=1');
    failure=true;await assert.rejects(()=>service.remove(req));failure=false;assert.equal((await raw('SELECT count(*)::int n FROM devices WHERE id=1')).rows[0].n,1);
    failure='after-delete';await assert.rejects(()=>service.remove(req));failure=false;
    assert.equal((await raw('SELECT count(*)::int n FROM devices WHERE id=1')).rows[0].n,1);
    assert.equal((await raw('SELECT count(*)::int n FROM attendance_device_pairings')).rows[0].n,1);
    await service.remove(req);assert.equal((await raw('SELECT count(*)::int n FROM devices WHERE id=1')).rows[0].n,0);assert.equal((await raw('SELECT count(*)::int n FROM attendance_device_pairings')).rows[0].n,0);
    assert.equal((await raw('SELECT count(*)::int n FROM devices WHERE id=2')).rows[0].n,1);
    assert.equal((await raw("SELECT count(*)::int n FROM audit_logs WHERE event_type='attendance.device.deleted'")).rows[0].n,1);
    console.log('PASS real PostgreSQL non-production TEMP fixtures: name-only, tenant/unit/no-scope, history protection across four ledgers, authentication history, atomic forced rollback, unused delete + pairing cascade, other tenant untouched, audit retained. Real tenant/finance rows untouched.');
  }finally{for(const table of [...tables].reverse())await baseQuery(`DROP TABLE IF EXISTS pg_temp.${table}_${suffix} CASCADE`).catch(()=>{});await client.end();}
}
main().catch(e=>{console.error({status:'FAIL',error_class:e.code||e.name});process.exitCode=1;});
