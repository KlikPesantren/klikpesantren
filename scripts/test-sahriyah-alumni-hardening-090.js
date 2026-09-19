const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");
const { stripOuterTransaction } = require("../utils/migrationLedger");

const ROOT = path.join(__dirname, "..");

function envFile(name) {
  return dotenv.parse(fs.readFileSync(path.join(ROOT, "..", name)));
}

function endpointMatches(host, endpointId) {
  return host.startsWith(`${endpointId}.`) || host.startsWith(`${endpointId}-pooler.`);
}

function guardedTestUrl() {
  if (process.argv.includes("--local-isolated")) {
    const local = envFile(".env");
    const hostHash = crypto.createHash("sha256").update(local.DB_HOST || "").digest("hex");
    const auditedRailwayProductionHostHash = "64265e92aed7d2994faf83307588dbb495f2e73e911be1e3784a9066bc8f9d71";
    if (!local.DB_HOST || hostHash === auditedRailwayProductionHostHash) {
      throw new Error("PRODUCTION_COLLISION");
    }
    const url = new URL("postgresql://placeholder/placeholder");
    url.username = local.DB_USER;
    url.password = local.DB_PASSWORD;
    url.hostname = local.DB_HOST;
    url.port = local.DB_PORT || "5432";
    url.pathname = `/${local.DB_NAME}`;
    return url.toString();
  }
  const rehearsal = envFile(".env.rehearsal");
  const production = envFile(".env.production.local");
  const rehearsalUrl = new URL(rehearsal.DATABASE_URL);
  const productionUrl = new URL(production.DATABASE_URL);
  const rehearsalId = String(rehearsal.EXPECTED_REHEARSAL_ENDPOINT_ID || "").toLowerCase();
  const productionId = String(production.EXPECTED_PRODUCTION_ENDPOINT_ID || "").toLowerCase();
  if (!rehearsalId || !productionId
      || !endpointMatches(rehearsalUrl.hostname.toLowerCase(), rehearsalId)
      || !endpointMatches(productionUrl.hostname.toLowerCase(), productionId)) {
    throw new Error("ENDPOINT_GUARD_FAILED");
  }
  if (rehearsalUrl.hostname === productionUrl.hostname
      || endpointMatches(rehearsalUrl.hostname.toLowerCase(), productionId)) {
    throw new Error("PRODUCTION_COLLISION");
  }
  return rehearsal.DATABASE_URL;
}

function configureUnusedPool(url) {
  const parsed = new URL(url);
  process.env.DB_USER = decodeURIComponent(parsed.username);
  process.env.DB_PASSWORD = decodeURIComponent(parsed.password);
  process.env.DB_HOST = parsed.hostname;
  process.env.DB_NAME = parsed.pathname.slice(1);
  process.env.DB_PORT = parsed.port || "5432";
  process.env.NODE_ENV = "production";
}

async function setSearchPath(client, schema) {
  await client.query(`SET search_path TO "${schema}"`);
}

function clientConfig(url) {
  return {
    connectionString: url,
    ssl: process.argv.includes("--local-isolated") ? false : { rejectUnauthorized: false },
  };
}

async function fixtureSchema(client, schema) {
  await client.query(`CREATE SCHEMA "${schema}"`);
  await setSearchPath(client, schema);
  await client.query(`
    CREATE TABLE santri (
      id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, nama TEXT NOT NULL, nis TEXT,
      status TEXT, kelas_id INTEGER, jenis_kelamin TEXT, alamat TEXT,
      CONSTRAINT uq_santri_tenant_id_id UNIQUE (tenant_id,id)
    );
    CREATE TABLE kelas (id INTEGER PRIMARY KEY, tenant_id INTEGER NOT NULL, nama_kelas TEXT);
    CREATE TABLE santri_units (
      id BIGINT PRIMARY KEY, tenant_id INTEGER NOT NULL, santri_id INTEGER NOT NULL,
      unit_id INTEGER NOT NULL, status TEXT NOT NULL, joined_at DATE, left_at DATE,
      is_primary BOOLEAN NOT NULL DEFAULT false, updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT uq_santri_units_tenant_id_id UNIQUE (tenant_id,id)
    );
    CREATE TABLE santri_kelas_enrollments (
      id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, santri_unit_id BIGINT NOT NULL,
      kelas_id INTEGER, status TEXT NOT NULL, start_date DATE, end_date DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE sahriyah_setting (
      id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER,
      santri_id INTEGER, santri_unit_id BIGINT, nominal_uang BIGINT,
      nominal_beras NUMERIC, keterangan TEXT, legacy_resolution_status TEXT NOT NULL DEFAULT 'resolved'
    );
    CREATE UNIQUE INDEX uq_setting_fixture ON sahriyah_setting(tenant_id,unit_id,santri_id) WHERE unit_id IS NOT NULL;
    CREATE TABLE tagihan_sahriyah (
      id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER,
      santri_id INTEGER NOT NULL, santri_unit_id BIGINT, bulan INTEGER NOT NULL,
      tahun INTEGER NOT NULL, nominal BIGINT NOT NULL DEFAULT 0, nominal_beras NUMERIC DEFAULT 0,
      keterangan TEXT, total_bayar BIGINT DEFAULT 0, sisa_tagihan BIGINT DEFAULT 0,
      sisa_beras NUMERIC DEFAULT 0,
      actor_user_id INTEGER, source TEXT,
      CONSTRAINT tagihan_sahriyah_tenant_santri_bulan_tahun_key UNIQUE (tenant_id,santri_id,bulan,tahun)
    );
    CREATE TABLE pembayaran_sahriyah (
      id BIGSERIAL PRIMARY KEY, tenant_id INTEGER, tagihan_id BIGINT,
      nominal BIGINT, nominal_beras NUMERIC
    );
    CREATE TABLE buku_kas (id BIGSERIAL PRIMARY KEY, nominal BIGINT);
    CREATE TABLE alumni (
      id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, santri_id INTEGER,
      nama TEXT NOT NULL, nis TEXT, jenis_kelamin TEXT, alamat TEXT, kelas_terakhir TEXT,
      status_kelulusan TEXT NOT NULL, tahun_masuk INTEGER, tahun_lulus INTEGER,
      updated_at TIMESTAMPTZ DEFAULT NOW(), CONSTRAINT uq_alumni_identity UNIQUE(tenant_id,santri_id),
      CONSTRAINT uq_alumni_tenant_id_id UNIQUE(tenant_id,id)
    );
    CREATE TABLE alumni_units (
      id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, alumni_id BIGINT NOT NULL,
      unit_id INTEGER NOT NULL, identity_key TEXT NOT NULL, tahun_masuk INTEGER,
      tahun_lulus INTEGER, status_kelulusan TEXT NOT NULL, kelas_terakhir TEXT,
      source TEXT, updated_at TIMESTAMPTZ DEFAULT NOW(),
      CONSTRAINT alumni_units_alumni_fkey FOREIGN KEY(tenant_id,alumni_id) REFERENCES alumni(tenant_id,id)
    );
    CREATE UNIQUE INDEX uq_alumni_units_history ON alumni_units(tenant_id,alumni_id,unit_id,COALESCE(tahun_lulus,0));
    CREATE UNIQUE INDEX uq_alumni_units_business_identity ON alumni_units(tenant_id,unit_id,identity_key,COALESCE(tahun_lulus,0));
  `);
  await client.query(`
    INSERT INTO santri(id,tenant_id,nama,nis,status,kelas_id) VALUES
      (1,900001,'Multi Unit','MU-1','aktif',10),
      (2,900001,'Active Only B','MU-2','aktif',10),
      (99,900001,'Historical','H-99','keluar',10);
    INSERT INTO kelas(id,tenant_id,nama_kelas) VALUES(10,900001,'Kelas Fixture');
    INSERT INTO santri_units(id,tenant_id,santri_id,unit_id,status,joined_at,is_primary) VALUES
      (101,900001,1,7001,'active','2026-01-01',true),
      (102,900001,1,7002,'active','2026-01-01',false),
      (201,900001,2,7001,'left','2026-01-01',false),
      (202,900001,2,7002,'active','2026-01-01',true),
      (999,900001,99,7001,'left','2020-01-01',false);
    UPDATE santri_units SET left_at='2026-08-31' WHERE id=201;
    INSERT INTO sahriyah_setting(tenant_id,unit_id,santri_id,santri_unit_id,nominal_uang) VALUES
      (900001,7001,1,101,100000),
      (900001,7002,1,102,100000),
      (900001,7001,2,201,100000),
      (900001,7002,2,202,100000);
    INSERT INTO tagihan_sahriyah(tenant_id,unit_id,santri_id,santri_unit_id,bulan,tahun,nominal)
      VALUES(900001,7001,99,999,8,2026,123456);
    INSERT INTO pembayaran_sahriyah(nominal,nominal_beras) VALUES(123456,0);
    INSERT INTO buku_kas(nominal) VALUES(123456);
  `);
}

async function financeHash(client) {
  const result = {};
  for (const table of ["tagihan_sahriyah", "pembayaran_sahriyah", "buku_kas"]) {
    result[table] = (await client.query(
      `SELECT COUNT(*)::integer count, MD5(COALESCE(STRING_AGG(TO_JSONB(t)::text,'|' ORDER BY id),'')) hash FROM ${table} t`,
    )).rows[0];
  }
  return result;
}

async function main() {
  const url = guardedTestUrl();
  configureUnusedPool(url);
  const { generateSahriyah } = require("../services/sahriyahGenerationService");
  const { sahriyahLedgerJoin, sahriyahCanonicalSelect, projectCanonicalSahriyah } = require("../services/sahriyahCanonicalSql");
  const { ensureAlumni } = require("../services/alumniService");
  const schema = `rehearsal_090_${Date.now()}`;
  if (!/^rehearsal_090_\d+$/.test(schema)) throw new Error("UNSAFE_SCHEMA_NAME");
  const owner = new Client(clientConfig(url));
  await owner.connect();
  try {
    await fixtureSchema(owner, schema);
    const moneyBefore = await financeHash(owner);
    const rawMigration = fs.readFileSync(path.join(ROOT, "migrations", "090_sahriyah_membership_idempotency_and_alumni_transition.sql"), "utf8");
    const scopedMigration = stripOuterTransaction(rawMigration)
      .replaceAll("table_schema = 'public'", `table_schema = '${schema}'`)
      .replaceAll("'public.", `'${schema}.`);
    await owner.query("BEGIN");
    await owner.query(scopedMigration);
    const moneyAfter = await financeHash(owner);
    assert.deepStrictEqual(moneyAfter, moneyBefore, "migration mengubah snapshot finansial");
    await owner.query("COMMIT");

    const sequentialFirst = await generateSahriyah({ tenantId: 900001, unitId: 7001, bulan: 9, tahun: 2026, client: owner });
    const sequentialRerun = await generateSahriyah({ tenantId: 900001, unitId: 7001, bulan: 9, tahun: 2026, client: owner });
    assert.strictEqual(sequentialFirst.createdCount, 1);
    assert.strictEqual(sequentialRerun.createdCount, 0);
    const initialRemaining = (await owner.query(
      `SELECT nominal,nominal_beras,total_bayar,sisa_tagihan,sisa_beras
       FROM tagihan_sahriyah WHERE tenant_id=900001 AND unit_id=7001
         AND bulan=9 AND tahun=2026`,
    )).rows[0];
    assert.strictEqual(Number(initialRemaining.sisa_tagihan), Number(initialRemaining.nominal));
    assert.strictEqual(Number(initialRemaining.sisa_beras), Number(initialRemaining.nominal_beras));
    assert.strictEqual(Number(initialRemaining.total_bayar), 0);
    const generatedId = (await owner.query(
      `SELECT id FROM tagihan_sahriyah WHERE tenant_id=900001 AND unit_id=7001
         AND bulan=9 AND tahun=2026`,
    )).rows[0].id;
    await owner.query(`UPDATE tagihan_sahriyah SET sisa_tagihan=0 WHERE id=$1`, [generatedId]);
    const canonicalRow = (await owner.query(
      `SELECT t.*, ${sahriyahCanonicalSelect("t")}
       FROM tagihan_sahriyah t ${sahriyahLedgerJoin("t")}
       WHERE t.id=$1`, [generatedId],
    )).rows[0];
    const projected = projectCanonicalSahriyah(canonicalRow);
    assert.strictEqual(Number(projected.sisa_tagihan), Number(initialRemaining.nominal),
      "stale zero cache must not mask unpaid ledger balance");
    assert.strictEqual(projected.status, "Belum Lunas");
    await owner.query(`UPDATE tagihan_sahriyah SET sisa_tagihan=nominal WHERE id=$1`, [generatedId]);

    const leftAActiveB = await generateSahriyah({ tenantId: 900001, unitId: 7002, bulan: 9, tahun: 2026, client: owner });
    assert.strictEqual(leftAActiveB.createdCount, 2, "Unit B harus menerima dua membership aktif termasuk identity multi-unit");
    const multiUnitBills = Number((await owner.query(
      `SELECT COUNT(*) count FROM tagihan_sahriyah WHERE tenant_id=900001 AND santri_id=1 AND bulan=9 AND tahun=2026`,
    )).rows[0].count);
    assert.strictEqual(multiUnitBills, 2, "identity sama harus dapat bill valid di dua unit");

    const c1 = new Client(clientConfig(url));
    const c2 = new Client(clientConfig(url));
    await Promise.all([c1.connect(), c2.connect()]);
    await Promise.all([setSearchPath(c1, schema), setSearchPath(c2, schema)]);
    const concurrent = await Promise.all([
      generateSahriyah({ tenantId: 900001, unitId: 7001, bulan: 10, tahun: 2026, client: c1 }),
      generateSahriyah({ tenantId: 900001, unitId: 7001, bulan: 10, tahun: 2026, client: c2 }),
    ]);
    await Promise.all([c1.end(), c2.end()]);
    assert.strictEqual(concurrent.reduce((sum, item) => sum + item.createdCount, 0), 1);

    await owner.query(`INSERT INTO tagihan_sahriyah(tenant_id,santri_id,bulan,tahun,nominal) VALUES(900001,1,11,2026,777)`);
    const legacyGuard = await generateSahriyah({ tenantId: 900001, unitId: 7001, bulan: 11, tahun: 2026, client: owner });
    assert.strictEqual(legacyGuard.createdCount, 0, "legacy ambiguous row harus memblokir bill modern baru");

    await owner.query(`
      INSERT INTO santri(id,tenant_id,nama,nis,status,kelas_id) VALUES(3,900001,'Exit Fixture','EXIT-3','aktif',10);
      INSERT INTO santri_units(id,tenant_id,santri_id,unit_id,status,joined_at,is_primary) VALUES(301,900001,3,7001,'active','2025-01-01',true);
      INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id,status,start_date) VALUES(900001,301,10,'active','2025-01-01');
    `);
    const santri = (await owner.query(`SELECT * FROM santri WHERE id=3`)).rows[0];
    const membership = (await owner.query(`SELECT * FROM santri_units WHERE id=301`)).rows[0];
    await owner.query("BEGIN");
    await owner.query(`UPDATE santri_units SET status='graduated',left_at='2026-09-11',is_primary=false WHERE id=301`);
    await owner.query(`UPDATE santri_kelas_enrollments SET status='completed',end_date='2026-09-11' WHERE santri_unit_id=301`);
    await ensureAlumni(owner, { tenantId: 900001, santri, status: "lulus", membership, unitId: 7001, effectiveExitDate: "2026-09-11" });
    await ensureAlumni(owner, { tenantId: 900001, santri, status: "lulus", membership, unitId: 7001, effectiveExitDate: "2026-09-11" });
    await owner.query("COMMIT");
    assert.strictEqual(Number((await owner.query(`SELECT COUNT(*) count FROM alumni WHERE tenant_id=900001 AND santri_id=3`)).rows[0].count), 1);
    const exitState = (await owner.query(`SELECT su.status membership_status,su.left_at::text,
      e.status enrollment_status,e.end_date::text,au.tahun_masuk,au.tahun_lulus,
      au.effective_exit_at::text
      FROM santri_units su
      JOIN santri_kelas_enrollments e ON e.tenant_id=su.tenant_id AND e.santri_unit_id=su.id
      JOIN alumni_units au ON au.tenant_id=su.tenant_id AND au.source_santri_unit_id=su.id
      WHERE su.id=301`)).rows[0];
    assert.deepStrictEqual(exitState, {
      membership_status: "graduated",
      left_at: "2026-09-11",
      enrollment_status: "completed",
      end_date: "2026-09-11",
      tahun_masuk: 2025,
      tahun_lulus: 2026,
      effective_exit_at: "2026-09-11",
    });

    await owner.query(`
      INSERT INTO santri(id,tenant_id,nama,nis,status,kelas_id) VALUES(4,900001,'Rollback Fixture','EXIT-4','aktif',10);
      INSERT INTO santri_units(id,tenant_id,santri_id,unit_id,status,joined_at,is_primary) VALUES(401,900001,4,7001,'active','2025-01-01',true);
      INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id,status,start_date) VALUES(900001,401,10,'active','2025-01-01');
      INSERT INTO alumni(tenant_id,nama,nis,status_kelulusan) VALUES(900001,'Conflicting Snapshot','CONFLICT-4','lulus');
      INSERT INTO alumni_units(tenant_id,alumni_id,unit_id,identity_key,tahun_lulus,status_kelulusan,source)
        SELECT 900001,id,7001,'SANTRI:4',2026,'lulus','fixture_conflict' FROM alumni WHERE nis='CONFLICT-4';
    `);
    const rollbackSantri = (await owner.query(`SELECT * FROM santri WHERE id=4`)).rows[0];
    const rollbackMembership = (await owner.query(`SELECT * FROM santri_units WHERE id=401`)).rows[0];
    await owner.query("BEGIN");
    let forcedFailure = false;
    try {
      await owner.query(`UPDATE santri_units SET status='graduated',left_at='2026-09-11',is_primary=false WHERE id=401`);
      await owner.query(`UPDATE santri_kelas_enrollments SET status='completed',end_date='2026-09-11' WHERE santri_unit_id=401`);
      await ensureAlumni(owner, {
        tenantId: 900001,
        santri: rollbackSantri,
        status: "lulus",
        membership: rollbackMembership,
        unitId: 7001,
        effectiveExitDate: "2026-09-11",
      });
    } catch (error) {
      forcedFailure = error.code === "ALUMNI_UNIT_TRANSITION_CONFLICT";
      await owner.query("ROLLBACK");
    }
    assert.strictEqual(forcedFailure, true, "fixture harus memaksa kegagalan sinkronisasi Alumni");
    const rolledBack = (await owner.query(`SELECT status,left_at FROM santri_units WHERE id=401`)).rows[0];
    const enrollmentRolledBack = (await owner.query(`SELECT status,end_date FROM santri_kelas_enrollments WHERE santri_unit_id=401`)).rows[0];
    assert.deepStrictEqual(rolledBack, { status: "active", left_at: null });
    assert.deepStrictEqual(enrollmentRolledBack, { status: "active", end_date: null });
    assert.strictEqual(Number((await owner.query(`SELECT COUNT(*) count FROM alumni WHERE tenant_id=900001 AND santri_id=4`)).rows[0].count), 0);

    const duplicateGroups = Number((await owner.query(`SELECT COUNT(*) count FROM (
      SELECT tenant_id,unit_id,santri_unit_id,bulan,tahun FROM tagihan_sahriyah
      WHERE unit_id IS NOT NULL AND santri_unit_id IS NOT NULL GROUP BY 1,2,3,4,5 HAVING COUNT(*)>1
    ) d`)).rows[0].count);
    assert.strictEqual(duplicateGroups, 0);
    console.log(JSON.stringify({
      status: "PASS",
      target: process.argv.includes("--local-isolated") ? "NON_PRODUCTION_ISOLATED" : "REHEARSAL_ENDPOINT",
      migration_money_unchanged: true,
      sequential: { first: 1, rerun: 0 },
      concurrent_created_total: 1,
      multi_unit_identity_bills: multiUnitBills,
      inactive_a_active_b: "PASS",
      legacy_ambiguous_guard: "PASS",
      alumni_transition_idempotent: "PASS",
      transaction_rollback: "PASS",
      duplicate_groups: duplicateGroups,
    }, null, 2));
  } finally {
    try { await owner.query("ROLLBACK"); } catch {}
    await owner.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await owner.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.stack || error.message }));
  process.exit(1);
});
