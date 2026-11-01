/* eslint-disable no-console */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dotenv = require("dotenv");
const { Client } = require("pg");
const { upsertAttendanceBatch } = require("../services/attendanceBatchService");

const ROOT = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function localTestConfig() {
  if (["127.0.0.1", "localhost"].includes(process.env.AK_TEST_DB_HOST) && process.env.AK_TEST_DB_NAME === "klikpesantren_ak_test") {
    return { user: process.env.AK_TEST_DB_USER, password: process.env.AK_TEST_DB_PASSWORD || "", host: process.env.AK_TEST_DB_HOST,
      database: process.env.AK_TEST_DB_NAME, port: Number(process.env.AK_TEST_DB_PORT || 55433), ssl: false };
  }
  const localEnvPath = [path.join(ROOT, ".env"), path.join(ROOT, "..", ".env")]
    .find((candidate) => fs.existsSync(candidate));
  if (!localEnvPath) throw new Error("LOCAL_TEST_ENV_NOT_FOUND");
  const env = dotenv.parse(fs.readFileSync(localEnvPath));
  const hostHash = crypto.createHash("sha256").update(env.DB_HOST || "").digest("hex");
  const productionHash = "64265e92aed7d2994faf83307588dbb495f2e73e911be1e3784a9066bc8f9d71";
  if (!env.DB_HOST || hostHash === productionHash) throw new Error("PRODUCTION_COLLISION");
  return {
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    host: env.DB_HOST,
    database: env.DB_NAME,
    port: Number(env.DB_PORT || 5432),
    ssl: false,
  };
}

function entry(santriId, unitId, date = "2026-09-12", sessionId = 11) {
  return {
    santri_id: santriId,
    tanggal: date,
    session_id: sessionId,
    status: "H",
    session_name: "Sesi Fixture",
    santri_unit_id: unitId * 1000 + santriId,
    enrollment_id: unitId * 10000 + santriId,
    kelas_id: unitId,
  };
}

async function transactionalSave(client, args) {
  await client.query("BEGIN");
  try {
    const count = await upsertAttendanceBatch(client, args);
    await client.query("COMMIT");
    return count;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const route = source("routes/absensiRoutes.js");
  const page = source("frontend/src/pages/AbsensiPage.jsx");
  assert.match(route, /router\.post\("\/batch"/, "batch endpoint required");
  assert.match(route, /su\.status = 'active' AND su\.left_at IS NULL/, "active unit membership required");
  assert.match(route, /ske\.status = 'active' AND ske\.end_date IS NULL/, "active enrollment required");
  assert.match(route, /isKelasAllowed\(access, context\.kelas_id\)/, "class scope required");
  assert.match(route, /code: "UNIT_REQUIRED"/, "all-unit write must fail closed");
  assert.match(route, /CROSS_UNIT_ATTENDANCE_SESSION/, "foreign session must fail closed");
  assert.match(route, /CROSS_UNIT_STUDENT/, "foreign student must fail closed");
  assert.match(page, /api\.post\("\/absensi\/batch"/, "frontend must issue one batch request");
  assert.match(page, /dirtyAbsensiKeys/, "frontend must submit only edited cells");
  assert.match(page, /loading=\{attendanceSaving\}/, "save loading indicator required");
  assert.match(page, /finally[\s\S]*setAttendanceSaving\(false\)/, "loading must reset in finally");
  assert.match(page, /Absensi berhasil disimpan/, "success feedback required");
  assert.match(page, /Gagal menyimpan absensi/, "error feedback required");
  assert.doesNotMatch(page, /for \(const \[key, status\] of entries\)[\s\S]*api\.post/, "serial per-cell POST must not return");

  const config = localTestConfig();
  const owner = new Client(config);
  const concurrentA = new Client(config);
  const concurrentB = new Client(config);
  const schema = `absensi_batch_${Date.now()}`;
  assert.match(schema, /^absensi_batch_\d+$/);
  await Promise.all([owner.connect(), concurrentA.connect(), concurrentB.connect()]);
  try {
    await owner.query(`CREATE SCHEMA "${schema}"`);
    for (const client of [owner, concurrentA, concurrentB]) {
      await client.query(`SET search_path TO "${schema}"`);
    }
    await owner.query(`
      CREATE TABLE absensi (
        id BIGSERIAL PRIMARY KEY, santri_id INTEGER, tanggal DATE, sesi VARCHAR,
        session_id BIGINT, session_name_snapshot VARCHAR, status VARCHAR,
        tenant_id INTEGER NOT NULL, unit_id INTEGER, santri_unit_id BIGINT,
        enrollment_id BIGINT, kelas_id INTEGER, actor_user_id INTEGER, source VARCHAR NOT NULL,
        academic_year_id BIGINT, academic_semester_id BIGINT
      );
      CREATE TABLE academic_semesters(id BIGINT,tenant_id INTEGER,unit_id INTEGER,academic_year_id BIGINT,
        start_date DATE,end_date DATE,status VARCHAR);
      CREATE UNIQUE INDEX uq_absensi_tenant_unit_student_date_session
        ON absensi(tenant_id, unit_id, santri_id, tanggal, session_id)
        WHERE unit_id IS NOT NULL AND session_id IS NOT NULL;
    `);

    const ten = Array.from({ length: 10 }, (_, index) => entry(index + 1, 7001));
    assert.equal(await transactionalSave(owner, { entries: ten, tenantId: 900001, unitId: 7001, actorUserId: 1 }), 10);
    assert.equal((await owner.query("SELECT COUNT(*)::int count FROM absensi")).rows[0].count, 10);

    assert.equal(await transactionalSave(owner, { entries: ten, tenantId: 900001, unitId: 7001, actorUserId: 1 }), 10);
    assert.equal((await owner.query("SELECT COUNT(*)::int count FROM absensi")).rows[0].count, 10, "rerun must not duplicate");

    const sameIdentityUnitB = [entry(1, 7002)];
    await transactionalSave(owner, { entries: sameIdentityUnitB, tenantId: 900001, unitId: 7002, actorUserId: 1 });
    assert.equal((await owner.query("SELECT COUNT(*)::int count FROM absensi WHERE santri_id=1")).rows[0].count, 2, "same identity may attend two units");

    const concurrentEntry = [entry(99, 7001, "2026-09-13", 12)];
    await Promise.all([
      transactionalSave(concurrentA, { entries: concurrentEntry, tenantId: 900001, unitId: 7001, actorUserId: 1 }),
      transactionalSave(concurrentB, { entries: concurrentEntry, tenantId: 900001, unitId: 7001, actorUserId: 1 }),
    ]);
    assert.equal((await owner.query("SELECT COUNT(*)::int count FROM absensi WHERE santri_id=99")).rows[0].count, 1, "concurrent writes must remain one row");

    const beforeFailure = (await owner.query("SELECT COUNT(*)::int count FROM absensi")).rows[0].count;
    await owner.query("BEGIN");
    await assert.rejects(() => upsertAttendanceBatch(owner, {
      entries: [entry(100, 7001), { ...entry(101, 7001), tanggal: "invalid-date" }],
      tenantId: 900001,
      unitId: 7001,
      actorUserId: 1,
    }));
    await owner.query("ROLLBACK");
    assert.equal((await owner.query("SELECT COUNT(*)::int count FROM absensi")).rows[0].count, beforeFailure, "failed batch must roll back fully");

    console.log("PASS absensi batch: single/batch, rerun, concurrent idempotency, multi-unit identity, rollback, security and UI feedback contracts");
  } finally {
    await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all([owner.end(), concurrentA.end(), concurrentB.end()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
