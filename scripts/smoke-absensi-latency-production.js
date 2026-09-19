/* eslint-disable no-console */
require("dotenv").config();

if (process.env.NODE_ENV !== "production") {
  throw new Error("NODE_ENV=production is required for production smoke");
}

const { performance } = require("node:perf_hooks");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { JWT_SECRET } = require("../config/authSecrets");

const API_BASE = String(process.env.SMOKE_API_BASE || "https://api.klikpesantren.com").replace(/\/$/, "");
const SAVE_MODE = process.env.SMOKE_SAVE_MODE === "batch" ? "batch" : "sequential";
const MAX_REPLAY_ROWS = process.env.SMOKE_MAX_ROWS
  ? Number(process.env.SMOKE_MAX_ROWS)
  : null;
if (MAX_REPLAY_ROWS !== null && (!Number.isInteger(MAX_REPLAY_ROWS) || MAX_REPLAY_ROWS < 1)) {
  throw new Error("SMOKE_MAX_ROWS must be a positive integer");
}

function hashMap(rows) {
  return Object.fromEntries(rows.map((row) => [String(row.id), row.row_hash]));
}

async function snapshot(client, ids) {
  const { rows } = await client.query(
    `SELECT id, MD5(ROW_TO_JSON(a)::text) AS row_hash
     FROM absensi a WHERE id = ANY($1::int[]) ORDER BY id`,
    [ids],
  );
  return hashMap(rows);
}

async function apiCall(path, token, { method = "GET", body, unitId } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (unitId) headers["x-unit-id"] = String(unitId);
  if (body !== undefined) headers["content-type"] = "application/json";
  const started = performance.now();
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
  return {
    status: response.status,
    durationMs: Number((performance.now() - started).toFixed(2)),
    body: parsed,
  };
}

async function main() {
  const client = await pool.connect();
  try {
    const groups = await client.query(`
      SELECT a.tenant_id, a.unit_id, a.kelas_id, a.tanggal, a.session_id,
             a.actor_user_id, COUNT(*)::int AS row_count
      FROM absensi a
      JOIN users u ON u.id = a.actor_user_id AND u.tenant_id = a.tenant_id
        AND LOWER(BTRIM(u.status)) IN ('aktif', 'active')
      JOIN attendance_sessions ats
        ON ats.tenant_id = a.tenant_id AND ats.unit_id = a.unit_id
       AND ats.id = a.session_id AND ats.active = true
      JOIN santri_units su
        ON su.tenant_id = a.tenant_id AND su.unit_id = a.unit_id
       AND su.santri_id = a.santri_id AND su.id = a.santri_unit_id
       AND su.status = 'active' AND su.left_at IS NULL
      JOIN santri_kelas_enrollments e
        ON e.tenant_id = a.tenant_id AND e.santri_unit_id = su.id
       AND e.id = a.enrollment_id AND e.kelas_id = a.kelas_id
       AND e.status = 'active' AND e.end_date IS NULL
      WHERE a.unit_id IS NOT NULL AND a.source = 'admin'
      GROUP BY a.tenant_id, a.unit_id, a.kelas_id, a.tanggal, a.session_id, a.actor_user_id
      ORDER BY row_count DESC, a.tanggal DESC
      LIMIT 30
    `);

    let selected = null;
    let token = null;
    let authProbe = null;
    for (const group of groups.rows) {
      const { rows: users } = await client.query(`
        SELECT u.id, u.username, u.nama, u.role, u.tenant_id, u.token_version, t.slug AS tenant_slug
        FROM users u JOIN tenants t ON t.id = u.tenant_id
        WHERE u.id = $1 AND u.tenant_id = $2 LIMIT 1
      `, [group.actor_user_id, group.tenant_id]);
      if (!users[0]) continue;
      const candidateToken = jwt.sign({
        id: users[0].id,
        username: users[0].username,
        nama: users[0].nama,
        role: users[0].role,
        tenant_id: users[0].tenant_id,
        tenant_slug: users[0].tenant_slug,
        token_version: Number(users[0].token_version || 0),
      }, JWT_SECRET, { expiresIn: "10m" });
      const probe = await apiCall(`/absensi?unit_id=${group.unit_id}&bulan=${new Date(group.tanggal).getUTCMonth() + 1}&tahun=${new Date(group.tanggal).getUTCFullYear()}`, candidateToken, { unitId: group.unit_id });
      if (probe.status === 200) {
        selected = group;
        token = candidateToken;
        authProbe = probe;
        break;
      }
    }

    if (!selected) {
      console.log(JSON.stringify({ mode: "ABORTED_NO_SAFE_AUTHORIZED_REPLAY", probes: groups.rowCount }, null, 2));
      return;
    }

    const { rows } = await client.query(`
      SELECT a.id, a.santri_id, TO_CHAR(a.tanggal, 'YYYY-MM-DD') AS tanggal,
             a.session_id, a.status, a.unit_id
      FROM absensi a
      WHERE a.tenant_id = $1 AND a.unit_id = $2 AND a.kelas_id = $3
        AND a.tanggal = $4 AND a.session_id = $5 AND a.actor_user_id = $6
        AND a.source = 'admin'
      ORDER BY a.id
    `, [selected.tenant_id, selected.unit_id, selected.kelas_id, selected.tanggal,
      selected.session_id, selected.actor_user_id]);

    const maxRows = MAX_REPLAY_ROWS === null ? rows.length : Math.min(MAX_REPLAY_ROWS, rows.length);
    const sizes = [...new Set([1, Math.min(10, maxRows), maxRows])].filter((size) => size > 0);
    const samples = [];
    for (const size of sizes) {
      const batch = rows.slice(0, size);
      const ids = batch.map((row) => row.id);
      const before = await snapshot(client, ids);
      const durations = [];
      let finalBody = null;
      let finalStatus = null;
      const bodies = batch.map((row) => ({
        santri_id: row.santri_id,
        tanggal: row.tanggal,
        session_id: row.session_id,
        status: row.status,
      }));
      const requests = SAVE_MODE === "batch" ? [bodies] : bodies.map((body) => [body]);
      for (const requestEntries of requests) {
        const requestBody = SAVE_MODE === "batch"
          ? { unit_id: selected.unit_id, entries: requestEntries }
          : { unit_id: selected.unit_id, ...requestEntries[0] };
        const result = await apiCall(SAVE_MODE === "batch" ? "/absensi/batch" : "/absensi", token, {
          method: "POST",
          unitId: selected.unit_id,
          body: requestBody,
        });
        durations.push(result.durationMs);
        finalStatus = result.status;
        finalBody = result.body;
        if (result.status !== 200) break;
      }
      const after = await snapshot(client, ids);
      const unchanged = JSON.stringify(before) === JSON.stringify(after);
      if (!unchanged) throw new Error(`DATA_SAFETY_MISMATCH_AFTER_${size}_REPLAY`);
      samples.push({
        rows: size,
        payloadBytes: Buffer.byteLength(JSON.stringify(SAVE_MODE === "batch"
          ? { unit_id: selected.unit_id, entries: bodies }
          : { unit_id: selected.unit_id, ...bodies[0] })),
        requests: durations.length,
        totalMs: Number(durations.reduce((sum, value) => sum + value, 0).toFixed(2)),
        minMs: Math.min(...durations),
        maxMs: Math.max(...durations),
        http: finalStatus,
        responseShape: finalBody && {
          success: finalBody.success,
          hasData: Boolean(finalBody.data),
          processed: finalBody.data?.processed,
          meta: finalBody.meta,
        },
        rowsUnchanged: unchanged,
      });
    }

    console.log(JSON.stringify({
      mode: `IDENTICAL_EXISTING_ROW_REPLAY_${SAVE_MODE.toUpperCase()}`,
      target: {
        tenant_id: selected.tenant_id,
        unit_id: selected.unit_id,
        kelas_id: selected.kelas_id,
        session_id: selected.session_id,
        date: new Date(selected.tanggal).toISOString().slice(0, 10),
        availableRows: rows.length,
      },
      get: {
        http: authProbe.status,
        durationMs: authProbe.durationMs,
        rows: Array.isArray(authProbe.body?.data) ? authProbe.body.data.length : null,
      },
      saveSamples: samples,
      safety: "all replayed rows hash-identical before/after",
    }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
