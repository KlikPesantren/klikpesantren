/* eslint-disable no-console */
// Replays one existing scoped row with identical values; aborts without a safe fixture.
require("dotenv").config();
if (process.env.NODE_ENV !== "production") throw new Error("NODE_ENV=production required");

const jwt = require("jsonwebtoken");
const pool = require("../db");
const { JWT_SECRET } = require("../config/authSecrets");
const API_BASE = String(process.env.SMOKE_API_BASE || "https://api.klikpesantren.com").replace(/\/$/, "");

function tokenFor(row) {
  return jwt.sign({
    id: row.actor_id,
    username: row.username,
    nama: row.actor_name,
    role: row.role,
    tenant_id: row.tenant_id,
    tenant_slug: row.tenant_slug,
    token_version: Number(row.token_version || 0),
  }, JWT_SECRET, { expiresIn: "10m" });
}

async function api(path, token, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function main() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT ag.id, ag.tenant_id, ag.unit_id, ag.guru_id, ag.guru_unit_id,
             ag.bulan, ag.tahun, ag.total_hadir, ag.total_izin, ag.total_sakit, ag.total_alfa,
             u.id AS actor_id, u.username, u.nama AS actor_name, u.role, u.token_version,
             t.slug AS tenant_slug
      FROM absensi_guru ag
      JOIN guru_units gu ON gu.id = ag.guru_unit_id AND gu.tenant_id = ag.tenant_id
        AND gu.unit_id = ag.unit_id AND gu.guru_id = ag.guru_id
        AND gu.status = 'active' AND gu.left_at IS NULL
      JOIN users u ON u.id = ag.actor_user_id AND u.tenant_id = ag.tenant_id
        AND LOWER(BTRIM(u.status)) IN ('aktif', 'active')
      JOIN tenants t ON t.id = ag.tenant_id
      WHERE ag.unit_id IS NOT NULL AND ag.source = 'admin'
      ORDER BY ag.id DESC LIMIT 1
    `);
    if (!rows[0]) throw new Error("NO_SAFE_EXISTING_GURU_ATTENDANCE_FIXTURE");
    const row = rows[0];
    const token = tokenFor(row);
    const { rows: superadmins } = await client.query(`
      SELECT u.id AS actor_id, u.username, u.nama AS actor_name, u.role,
             u.token_version, u.tenant_id, t.slug AS tenant_slug
      FROM users u JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id = $1 AND u.role = 'superadmin'
        AND LOWER(BTRIM(u.status)) IN ('aktif', 'active')
      ORDER BY u.id LIMIT 1
    `, [row.tenant_id]);
    if (!superadmins[0]) throw new Error("NO_ACTIVE_SUPERADMIN_FOR_SCOPE_READ");
    const adminToken = tokenFor(superadmins[0]);
    const before = await client.query(
      "SELECT MD5(ROW_TO_JSON(ag)::text) hash FROM absensi_guru ag WHERE id=$1 AND tenant_id=$2",
      [row.id, row.tenant_id],
    );
    const countBefore = await client.query(
      "SELECT COUNT(*)::int count FROM absensi_guru WHERE tenant_id=$1 AND unit_id=$2 AND guru_id=$3 AND bulan=$4 AND tahun=$5",
      [row.tenant_id, row.unit_id, row.guru_id, row.bulan, row.tahun],
    );
    if (countBefore.rows[0].count !== 1) throw new Error("EXISTING_GURU_ATTENDANCE_NOT_UNIQUE");
    const listed = await api(`/absensi-guru?unit_id=${row.unit_id}`, token);
    if (listed.status !== 200 || !listed.body.data?.some((item) => Number(item.id) === Number(row.id))) {
      throw new Error(`SCOPED_GURU_READ_FAILED_${listed.status}`);
    }
    const saved = await api("/absensi-guru", token, {
      unit_id: row.unit_id, guru_id: row.guru_id, bulan: row.bulan, tahun: row.tahun,
      total_hadir: row.total_hadir, total_izin: row.total_izin,
      total_sakit: row.total_sakit, total_alfa: row.total_alfa,
    });
    const noUnit = await api("/absensi-guru", adminToken, {
      guru_id: row.guru_id, bulan: row.bulan, tahun: row.tahun,
      total_hadir: row.total_hadir, total_izin: row.total_izin,
      total_sakit: row.total_sakit, total_alfa: row.total_alfa,
    });
    if (noUnit.status !== 400 || noUnit.body?.code !== "UNIT_REQUIRED") {
      throw new Error(`GURU_NO_UNIT_GATE_FAILED_${noUnit.status}`);
    }
    const after = await client.query(
      "SELECT MD5(ROW_TO_JSON(ag)::text) hash FROM absensi_guru ag WHERE id=$1 AND tenant_id=$2",
      [row.id, row.tenant_id],
    );
    const countAfter = await client.query(
      "SELECT COUNT(*)::int count FROM absensi_guru WHERE tenant_id=$1 AND unit_id=$2 AND guru_id=$3 AND bulan=$4 AND tahun=$5",
      [row.tenant_id, row.unit_id, row.guru_id, row.bulan, row.tahun],
    );
    const unchanged = before.rows[0].hash === after.rows[0]?.hash &&
      countBefore.rows[0].count === countAfter.rows[0].count;
    if (saved.status !== 200 || !unchanged) throw new Error(`GURU_REPLAY_FAILED_${saved.status}_UNCHANGED_${unchanged}`);
    const unitReads = {};
    for (const unitId of [2, 3, 179]) {
      const result = await api(`/absensi-guru?unit_id=${unitId}`, adminToken);
      unitReads[unitId] = {
        status: result.status,
        contains_target: result.body.data?.some((item) => Number(item.id) === Number(row.id)) || false,
        cross_unit_rows: result.body.data?.filter((item) => Number(item.unit_id) !== unitId).length || 0,
      };
      if (result.status !== 200 || unitReads[unitId].cross_unit_rows !== 0 ||
        unitReads[unitId].contains_target !== (unitId === Number(row.unit_id))) {
        throw new Error(`GURU_UNIT_SCOPE_FAILED_${unitId}`);
      }
    }
    const legacy = await client.query("SELECT COUNT(*)::int count FROM absensi_guru WHERE unit_id IS NULL");
    const { rows: operatorRows } = await client.query(`
      SELECT u.id AS actor_id, u.username, u.nama AS actor_name, u.role,
             u.token_version, u.tenant_id, t.slug AS tenant_slug, s.unit_id AS own_unit_id
      FROM users u JOIN tenants t ON t.id = u.tenant_id
      JOIN user_unit_scope s ON s.user_id = u.id AND s.tenant_id = u.tenant_id
        AND s.status = 'active' AND s.unit_id IN (2, 3)
      WHERE u.tenant_id = $1 AND u.role <> 'superadmin'
        AND LOWER(BTRIM(u.status)) IN ('aktif', 'active')
        AND NOT EXISTS (
          SELECT 1 FROM user_unit_scope foreign_scope
          WHERE foreign_scope.user_id = u.id AND foreign_scope.tenant_id = u.tenant_id
            AND foreign_scope.unit_id = $2 AND foreign_scope.status = 'active'
        )
      ORDER BY s.unit_id, u.id LIMIT 2
    `, [row.tenant_id, row.unit_id]);
    const operatorChecks = [];
    for (const operator of operatorRows) {
      const operatorToken = tokenFor(operator);
      const ownRead = await api(`/absensi-guru?unit_id=${operator.own_unit_id}`, operatorToken);
      const spoof = await api("/absensi-guru", operatorToken, {
        unit_id: row.unit_id, guru_id: row.guru_id, bulan: row.bulan, tahun: row.tahun,
        total_hadir: row.total_hadir, total_izin: row.total_izin,
        total_sakit: row.total_sakit, total_alfa: row.total_alfa,
      });
      if (ownRead.status !== 200 || spoof.status !== 403) {
        throw new Error(`GURU_OPERATOR_SCOPE_FAILED_${operator.own_unit_id}_${ownRead.status}_${spoof.status}`);
      }
      operatorChecks.push({ own_unit_id: operator.own_unit_id, own_read_http: ownRead.status, foreign_write_http: spoof.status });
    }
    console.log(JSON.stringify({
      mode: "IDENTICAL_EXISTING_ROW_REPLAY",
      target_unit_id: row.unit_id,
      save_http: saved.status,
      persisted_hash_unchanged: unchanged,
      duplicate_count: countAfter.rows[0].count - 1,
      no_unit_write_http: noUnit.status,
      operators: operatorChecks,
      unit_reads: unitReads,
      legacy_null_unit_rows: legacy.rows[0].count,
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
