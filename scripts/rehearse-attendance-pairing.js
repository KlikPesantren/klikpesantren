// Non-production ONLY. All rehearsal DDL/DML is rolled back by the outer
// transaction. The production connection supplies identity comparison, never DDL.
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const dotenv=require("dotenv"),{Client}=require("pg");
const {readMigration,stripOuterTransaction}=require("../utils/migrationLedger");
function endpoint(host){return String(host).match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./)?.[1];}
async function main(){
  if(!process.env.ATTENDANCE_REHEARSAL_ENV || !process.env.DB_HOST)throw {code:"IDENTITY_CONTEXT_REQUIRED"};
  const env=dotenv.parse(fs.readFileSync(process.env.ATTENDANCE_REHEARSAL_ENV));
  const target=endpoint(new URL(env.DATABASE_URL).hostname),production=endpoint(process.env.DB_HOST);
  if(!target || !production || target!==env.EXPECTED_REHEARSAL_ENDPOINT_ID || target===production)
    throw {code:"REHEARSAL_IDENTITY_UNPROVEN"};
  const db=new Client({connectionString:env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
  await db.connect();
  try{
    await db.query("BEGIN");await db.query("SET LOCAL statement_timeout=15000");
    const present=(await db.query(`SELECT to_regclass('public.attendance_results') IS NOT NULL AS attendance,
      to_regclass('public.santri_units') IS NOT NULL AS santri,to_regclass('public.guru_units') IS NOT NULL AS guru,
      to_regclass('public.attendance_device_pairings') IS NULL AS fresh`)).rows[0];
    assert(Object.values(present).every(Boolean));
    const baseline=(await db.query(`SELECT md5(COALESCE(string_agg(row_to_json(d)::text,'' ORDER BY id),'')) hash FROM devices d`)).rows[0].hash;
    const beforeColumns=(await db.query(`SELECT column_name,data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='devices' ORDER BY ordinal_position`)).rows;
    const up=readMigration("093_attendance_device_pairing.sql").executionSql;
    const down=stripOuterTransaction(fs.readFileSync(path.join(__dirname,"../migrations/093_attendance_device_pairing_rollback.sql"),"utf8"));
    assert(!/\b(?:BEGIN|COMMIT)\s*;/i.test(up));assert(!/\b(?:BEGIN|COMMIT)\s*;/i.test(down));
    await db.query(up);
    const constraints=(await db.query(`SELECT conname,confdeltype FROM pg_constraint
      WHERE conrelid='attendance_device_pairings'::regclass`)).rows;
    assert(constraints.some(c=>c.conname==='attendance_pairing_device_tenant_fkey'&&c.confdeltype==='c'));
    assert(constraints.some(c=>c.conname==='attendance_pairing_actor_tenant_fkey'));
    assert.equal((await db.query("SELECT count(*)::int n FROM attendance_device_pairings")).rows[0].n,0);
    await db.query("SAVEPOINT behavior");
    // Constraint tests do not need a real tenant or its business data.
    await assert.rejects(()=>db.query(`INSERT INTO attendance_device_pairings
      (tenant_id,device_id,verifier,issued_by,expires_at)
      VALUES(-900001,-900001,repeat('0',64),-900001,NOW()+INTERVAL '15 minutes')`),e=>e.code==='23503');
    await db.query("ROLLBACK TO SAVEPOINT behavior");
    await db.query(down);
    assert.equal((await db.query("SELECT to_regclass('attendance_device_pairings') IS NULL gone")).rows[0].gone,true);
    assert.deepEqual((await db.query(`SELECT column_name,data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name='devices' ORDER BY ordinal_position`)).rows,beforeColumns);
    assert.equal((await db.query(`SELECT md5(COALESCE(string_agg(row_to_json(d)::text,'' ORDER BY id),'')) hash FROM devices d`)).rows[0].hash,baseline);
    await db.query(up);
    assert.equal((await db.query("SELECT count(*)::int n FROM attendance_device_pairings")).rows[0].n,0);
    await db.query("ROLLBACK");
    console.log("PASS non-production 093: guarded endpoint differs from production; representative 092 schema; first UP; FK rejection; DOWN restores device columns/data; second UP; final outer rollback; production writes=0");
  } finally {await db.query("ROLLBACK").catch(()=>{});await db.end();}
}
main().catch(e=>{console.error(JSON.stringify({status:"FAIL",error_class:e.code||e.name}));process.exitCode=1;});
