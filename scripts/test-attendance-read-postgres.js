// Real PostgreSQL parser/behavior; SQL-only synthetic CTEs, NO persisted fixtures.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const dotenv = require("dotenv");
const { Client } = require("pg");
const { attendanceReadSql } = require("../services/attendanceReadSql");
const fixture = `WITH
  attendance_results(id,tenant_id,person_id,occurrence_id,person_type,status) AS (VALUES
    (1,901,1,1,'santri','H'),(2,901,2,1,'santri','S'),(3,902,1,2,'santri','H')),
  attendance_occurrences(id,tenant_id,session_id,occurrence_date,state) AS (VALUES
    (1,901,1,DATE '2026-10-03','active'),(2,902,2,DATE '2026-10-03','active')),
  attendance_sessions(id,tenant_id,display_name) AS (VALUES(1,901,'SESI UJI'),(2,902,'SESI TENANT LAIN')),
  attendance_occurrence_units(tenant_id,occurrence_id,unit_id) AS (VALUES(901,1,2),(901,1,3),(902,2,2)),
  santri_units(id,tenant_id,santri_id,unit_id,joined_at,left_at) AS (VALUES
    (11,901,1,2,NULL::date,NULL::date),(12,901,1,3,NULL::date,NULL::date),
    (21,901,2,2,NULL::date,NULL::date),(31,902,1,2,NULL::date,NULL::date)),
  santri_kelas_enrollments(id,tenant_id,santri_unit_id,kelas_id,start_date,end_date) AS (VALUES
    (11,901,11,201,NULL::date,NULL::date),(12,901,12,301,NULL::date,NULL::date),
    (21,901,21,201,NULL::date,NULL::date),(31,902,31,201,NULL::date,NULL::date)),
  absensi(id,tenant_id,santri_id,session_id,sesi,session_name_snapshot,tanggal,status,unit_id,santri_unit_id,enrollment_id,kelas_id) AS (VALUES
    (1,901,1,1,'SESI UJI','SESI UJI',DATE '2026-10-03','A',2,11,11,201),
    (2,901,1,1,'SESI UJI','SESI UJI',DATE '2026-10-02','I',2,11,11,201),
    (3,901,1,1,'SESI UJI','SESI UJI',DATE '2026-10-03','A',179,11,11,201),
    (4,901,3,1,'SESI UJI','SESI UJI',DATE '2026-10-03','H',2,11,11,201),
    (5,902,1,2,'SESI TENANT LAIN','SESI TENANT LAIN',DATE '2026-10-03','A',2,31,31,201))
`;

(async () => {
  let db;
  try {
    if (!process.env.ATTENDANCE_REHEARSAL_ENV) throw { code: "REHEARSAL_ENV_REQUIRED" };
    const env = dotenv.parse(fs.readFileSync(process.env.ATTENDANCE_REHEARSAL_ENV));
    const endpoint = new URL(env.DATABASE_URL).hostname.match(/^(ep-[a-z0-9-]+?)(?:-pooler)?\./)?.[1];
    if (!endpoint || endpoint !== env.EXPECTED_REHEARSAL_ENDPOINT_ID) throw { code: "REHEARSAL_IDENTITY_UNPROVEN" };
    db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await db.connect(); await db.query("BEGIN READ ONLY"); await db.query("SET LOCAL statement_timeout=15000");
    const query = fixture + `SELECT * FROM (${attendanceReadSql()}) a WHERE santri_id=$2 AND unit_id=$3 ORDER BY tanggal`;
    const own = (await db.query(query,[901,1,2])).rows;
    assert.equal(own.length,2); assert.deepEqual(own.map(r=>r.status),["I","H"]);
    assert(own.every(r=>r.tenant_id===901 && r.unit_id===2 && Number(r.santri_id)===1));
    const second = (await db.query(query,[901,2,2])).rows;
    assert.equal(second.length,1); assert.equal(second[0].status,"S");
    const multiUnit = (await db.query(query,[901,1,3])).rows;
    assert.equal(multiUnit.length,1); assert.equal(multiUnit[0].status,"H");
    const foreign = (await db.query(query,[902,1,2])).rows;
    assert.equal(foreign.length,1); assert.equal(foreign[0].tenant_id,902);
    const absent = (await db.query(query,[903,1,2])).rows; assert.equal(absent.length,0);
    await db.query("ROLLBACK");
    console.log("PASS real PostgreSQL synthetic READ-only CTE: canonical H visible, no duplicate legacy same session/date/unit, historical I retained, sibling isolated, multi-unit scoped, cross-tenant isolated; persisted rows=0");
  } catch (e) {
    if (db) await db.query("ROLLBACK").catch(()=>{});
    console.error(JSON.stringify({status:"FAIL",error_class:e.code||e.name||"UNKNOWN"})); process.exitCode=1;
  } finally { if(db) await db.end(); }
})();
