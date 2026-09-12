/* eslint-disable no-console */
require("dotenv").config();
if (process.env.NODE_ENV !== "production") throw new Error("NODE_ENV=production required");

const assert = require("assert");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { JWT_SECRET } = require("../config/authSecrets");

const API_BASE = String(process.env.SMOKE_API_BASE || "https://api.klikpesantren.com").replace(/\/$/, "");
const UNIT_ID = 179;
const BULAN = 9;
const TAHUN = 2026;

function tokenFor(user) {
  return jwt.sign({
    id: user.id, username: user.username, nama: user.nama, role: user.role,
    tenant_id: user.tenant_id, tenant_slug: user.tenant_slug,
    token_version: Number(user.token_version || 0),
  }, JWT_SECRET, { expiresIn: "10m" });
}

async function get(token, params) {
  const url = new URL(`${API_BASE}/sahriyah`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { status: response.status, body: await response.json() };
}

async function financialSnapshot(tenantId) {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM tagihan_sahriyah WHERE tenant_id=$1)::int tagihan_count,
      (SELECT COALESCE(SUM(nominal),0) FROM tagihan_sahriyah WHERE tenant_id=$1)::bigint tagihan_nominal,
      (SELECT COUNT(*) FROM pembayaran_sahriyah WHERE tenant_id=$1)::int payment_count,
      (SELECT COALESCE(SUM(nominal),0) FROM pembayaran_sahriyah WHERE tenant_id=$1)::bigint payment_nominal,
      (SELECT COUNT(*) FROM buku_kas WHERE tenant_id=$1)::int buku_kas_count,
      (SELECT COALESCE(SUM(nominal),0) FROM buku_kas WHERE tenant_id=$1)::bigint buku_kas_nominal
  `, [tenantId]);
  return rows[0];
}

function assertSummary(summary, expected) {
  for (const [key, value] of Object.entries(expected)) {
    assert.equal(Number(summary?.[key]), value, `${key}: expected ${value}, got ${summary?.[key]}`);
  }
  assert.equal(Number(summary.total), Number(summary.lunas) + Number(summary.belum_lunas));
  assert.equal(Number(summary.total_nominal), Number(summary.lunas_nominal) + Number(summary.belum_lunas_nominal));
}

async function main() {
  const { rows: units } = await pool.query(
    `SELECT id, tenant_id FROM unit_pendidikan WHERE id=$1 AND is_active=true`, [UNIT_ID],
  );
  assert(units[0], "UNIT_179_NOT_FOUND");
  const tenantId = units[0].tenant_id;

  const { rows: admins } = await pool.query(`
    SELECT u.*, t.slug tenant_slug FROM users u JOIN tenants t ON t.id=u.tenant_id
    WHERE u.tenant_id=$1 AND u.role='superadmin'
      AND LOWER(BTRIM(u.status)) IN ('aktif','active') ORDER BY u.id LIMIT 1
  `, [tenantId]);
  assert(admins[0], "NO_ACTIVE_SUPERADMIN");
  const adminToken = tokenFor(admins[0]);
  const before = await financialSnapshot(tenantId);

  const main = await get(adminToken, { unit_id: UNIT_ID, bulan: BULAN, tahun: TAHUN, limit: 20, offset: 0 });
  assert.equal(main.status, 200);
  assertSummary(main.body.summary, {
    total: 80, total_nominal: 21250000,
    lunas: 22, lunas_nominal: 7500000,
    belum_lunas: 58, belum_lunas_nominal: 13750000,
    partial_count: 1, partial_nominal_tagihan: 400000,
    partial_sudah_dibayar: 250000, partial_sisa: 150000,
  });

  const cicilan = await get(adminToken, { unit_id: UNIT_ID, bulan: BULAN, tahun: TAHUN, status: "Cicilan" });
  assert.equal(cicilan.status, 200);
  assertSummary(cicilan.body.summary, {
    total: 1, total_nominal: 400000, lunas: 0, lunas_nominal: 0,
    belum_lunas: 1, belum_lunas_nominal: 400000,
    partial_count: 1, partial_nominal_tagihan: 400000,
    partial_sudah_dibayar: 250000, partial_sisa: 150000,
  });

  const { rows: classFixtures } = await pool.query(`
    SELECT enrollment.kelas_id
    FROM tagihan_sahriyah t
    JOIN LATERAL (
      SELECT ske.kelas_id FROM santri_kelas_enrollments ske
      WHERE ske.tenant_id=t.tenant_id AND ske.santri_unit_id=t.santri_unit_id
        AND ske.status='active' AND ske.end_date IS NULL
      ORDER BY ske.id DESC LIMIT 1
    ) enrollment ON true
    WHERE t.unit_id=$1 AND t.bulan=$2 AND t.tahun=$3
    ORDER BY enrollment.kelas_id LIMIT 1
  `, [UNIT_ID, BULAN, TAHUN]);
  assert(classFixtures[0], "NO_CLASS_FILTER_FIXTURE");
  const kelasId = classFixtures[0].kelas_id;
  const { rows: classExpectedRows } = await pool.query(`
    SELECT COUNT(*)::int total, COALESCE(SUM(t.nominal),0)::bigint total_nominal,
      COUNT(*) FILTER (WHERE LOWER(TRIM(t.status))='lunas')::int lunas,
      COALESCE(SUM(t.nominal) FILTER (WHERE LOWER(TRIM(t.status))='lunas'),0)::bigint lunas_nominal,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(t.status,'')))<>'lunas')::int belum_lunas,
      COALESCE(SUM(t.nominal) FILTER (WHERE LOWER(TRIM(COALESCE(t.status,'')))<>'lunas'),0)::bigint belum_lunas_nominal
    FROM tagihan_sahriyah t
    JOIN LATERAL (
      SELECT ske.kelas_id FROM santri_kelas_enrollments ske
      WHERE ske.tenant_id=t.tenant_id AND ske.santri_unit_id=t.santri_unit_id
        AND ske.status='active' AND ske.end_date IS NULL
      ORDER BY ske.id DESC LIMIT 1
    ) enrollment ON true
    WHERE t.unit_id=$1 AND t.bulan=$2 AND t.tahun=$3 AND enrollment.kelas_id=$4
  `, [UNIT_ID, BULAN, TAHUN, kelasId]);
  const kelas = await get(adminToken, { unit_id: UNIT_ID, bulan: BULAN, tahun: TAHUN, kelas_id: kelasId });
  assert.equal(kelas.status, 200);
  assertSummary(kelas.body.summary, Object.fromEntries(
    Object.entries(classExpectedRows[0]).map(([key, value]) => [key, Number(value)]),
  ));

  const noAuth = await get(null, { unit_id: UNIT_ID, bulan: BULAN, tahun: TAHUN });
  assert.equal(noAuth.status, 401);

  const { rows: operators } = await pool.query(`
    SELECT DISTINCT u.*, t.slug tenant_slug
    FROM users u JOIN tenants t ON t.id=u.tenant_id
    JOIN user_unit_scope scope ON scope.tenant_id=u.tenant_id AND scope.user_id=u.id
      AND scope.unit_id=$2 AND scope.status='active'
    JOIN roles r ON r.name=u.role
    JOIN role_permissions rp ON rp.role_id=r.id
    JOIN permissions p ON p.id=rp.permission_id AND p.key='sahriyah.view'
    WHERE u.tenant_id=$1 AND u.role<>'superadmin'
      AND LOWER(BTRIM(u.status)) IN ('aktif','active')
    ORDER BY u.id LIMIT 20
  `, [tenantId, UNIT_ID]);
  assert(operators[0], "NO_OPERATOR_WITH_SAHRIYAH_SCOPE");
  let operator = null;
  let operatorToken = null;
  let operatorOwnUnit = null;
  let operatorForeignUnit = null;
  for (const candidate of operators) {
    const candidateToken = tokenFor(candidate);
    const response = await get(candidateToken, { unit_id: UNIT_ID, bulan: BULAN, tahun: TAHUN });
    if (response.status === 200) {
      operator = candidate;
      operatorToken = candidateToken;
      operatorOwnUnit = response;
      break;
    }
  }
  assert(operator && operatorOwnUnit, "NO_EFFECTIVE_OPERATOR_ACCESS");
  const { rows: foreignUnits } = await pool.query(`
      SELECT up.id FROM unit_pendidikan up
      WHERE up.tenant_id=$1 AND up.id<>$2 AND up.is_active=true
        AND NOT EXISTS (SELECT 1 FROM user_unit_scope s WHERE s.tenant_id=$1
          AND s.user_id=$3 AND s.unit_id=up.id AND s.status='active')
      ORDER BY up.id LIMIT 1
  `, [tenantId, UNIT_ID, operator.id]);
  assert(foreignUnits[0], "NO_FOREIGN_UNIT_FIXTURE");
  operatorForeignUnit = await get(operatorToken, { unit_id: foreignUnits[0].id, bulan: BULAN, tahun: TAHUN });
  assert.equal(operatorForeignUnit.status, 403);

  const { rows: crossTenantUnits } = await pool.query(`
    SELECT id FROM unit_pendidikan WHERE tenant_id<>$1 AND is_active=true ORDER BY id LIMIT 1
  `, [tenantId]);
  const crossTenant = crossTenantUnits[0]
    ? await get(adminToken, { unit_id: crossTenantUnits[0].id, bulan: BULAN, tahun: TAHUN })
    : null;
  assert(crossTenant, "NO_CROSS_TENANT_FIXTURE");
  assert([403, 404].includes(crossTenant.status));

  const after = await financialSnapshot(tenantId);
  assert.deepStrictEqual(after, before, "FINANCIAL_SNAPSHOT_CHANGED");

  console.log(JSON.stringify({
    main: { status: main.status, summary: main.body.summary },
    cicilan: { status: cicilan.status, summary: cicilan.body.summary },
    kelas: { status: kelas.status, kelas_id: kelasId, summary: kelas.body.summary },
    unauthorized: noAuth.status,
    operatorOwnUnit: operatorOwnUnit?.status || null,
    operatorForeignUnit: operatorForeignUnit?.status || null,
    crossTenant: crossTenant?.status || null,
    financialSnapshotUnchanged: true,
  }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
