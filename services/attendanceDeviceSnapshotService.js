const crypto = require("crypto");
const pool = require("../db");
const { canonicalAttendanceUid, attendanceUidSql } = require("../utils/attendanceRfidUid");

const SNAPSHOT_SCHEMA_VERSION = 1;
const SNAPSHOT_REFRESH_SECONDS = 15 * 60;
const SNAPSHOT_VALIDITY_DAYS = 7;
const MAX_CREDENTIALS = 200;
const MAX_SESSIONS = 16;
const MAX_WINDOWS = 128;
const MAX_SNAPSHOT_BYTES = 24 * 1024;

function snapshotError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function requireDeviceContext(tenantId, device) {
  const parsedTenantId = Number(tenantId);
  const unitId = Number(device && device.unit_id);
  if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0 ||
      !device || Number(device.tenant_id) !== parsedTenantId) {
    throw snapshotError("DEVICE_CONTEXT_INVALID", "Konteks device tidak valid", 403);
  }
  if (!Number.isInteger(unitId) || unitId <= 0) {
    throw snapshotError("DEVICE_UNIT_REQUIRED", "Device belum memiliki unit Attendance", 409);
  }
  if (device.enabled === false || [false, "false", "disabled"].includes(device.status)) {
    throw snapshotError("DEVICE_DISABLED", "Device nonaktif", 403);
  }
  return { tenantId: parsedTenantId, unitId };
}

function bounded(rows, limit, code) {
  if (rows.length > limit) {
    throw snapshotError(code, "Snapshot Attendance melebihi batas aman", 409);
  }
  return rows;
}

async function querySnapshotSource(db, tenantId, unitId, generatedAt) {
  const tenant = await db.query(
    "SELECT t.attendance_timezone,u.id AS unit_id " +
    "FROM tenants t JOIN unit_pendidikan u ON u.tenant_id=t.id " +
    "WHERE t.id=$1 AND u.id=$2 AND u.is_active=true",
    [tenantId, unitId],
  );
  if (!tenant.rows[0]) {
    throw snapshotError("DEVICE_UNIT_INVALID", "Unit device tidak aktif atau tidak sesuai tenant", 403);
  }
  const sessions = await db.query(
    "SELECT s.id,s.code,s.display_name,s.start_time::text,s.end_time::text,s.active," +
    "COALESCE(array_agg(DISTINCT w.day_of_week ORDER BY w.day_of_week) " +
    "FILTER (WHERE w.day_of_week IS NOT NULL),'{}') AS weekdays " +
    "FROM attendance_sessions s " +
    "LEFT JOIN attendance_session_weekdays w ON w.tenant_id=s.tenant_id AND w.session_id=s.id " +
    "WHERE s.tenant_id=$1 AND s.active=true AND s.start_time IS NOT NULL " +
    "AND s.end_time IS NOT NULL AND s.start_time<s.end_time " +
    "AND (s.unit_id=$2 OR EXISTS(SELECT 1 FROM attendance_session_units su " +
    "WHERE su.tenant_id=s.tenant_id AND su.session_id=s.id AND su.unit_id=$2)) " +
    "GROUP BY s.id,s.code,s.display_name,s.start_time,s.end_time,s.active ORDER BY s.id LIMIT 17",
    [tenantId, unitId],
  );
  const windows = await db.query(
    "WITH clock AS ( SELECT attendance_timezone,($3::timestamptz AT TIME ZONE attendance_timezone)::date AS today " +
    "FROM tenants WHERE id=$1), days AS (SELECT (clock.today+n)::date AS local_date,clock.attendance_timezone " +
    "FROM clock CROSS JOIN generate_series(0,$4::int) n), scoped AS (SELECT s.* FROM attendance_sessions s " +
    "WHERE s.tenant_id=$1 AND s.active=true AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL " +
    "AND s.start_time<s.end_time AND (s.unit_id=$2 OR EXISTS(SELECT 1 FROM attendance_session_units su " +
    "WHERE su.tenant_id=s.tenant_id AND su.session_id=s.id AND su.unit_id=$2))) " +
    "SELECT s.id AS session_id,d.local_date::text AS occurrence_date," +
    "COALESCE(o.timezone,d.attendance_timezone) AS timezone," +
    "COALESCE(o.window_start,(d.local_date+s.start_time) AT TIME ZONE d.attendance_timezone) AS window_start," +
    "COALESCE(o.window_end,(d.local_date+s.end_time) AT TIME ZONE d.attendance_timezone) AS window_end," +
    "COALESCE(o.state,'active') AS state FROM scoped s CROSS JOIN days d " +
    "LEFT JOIN attendance_occurrences o ON o.tenant_id=s.tenant_id AND o.session_id=s.id " +
    "AND o.occurrence_date=d.local_date WHERE (o.id IS NULL OR EXISTS(" +
    "SELECT 1 FROM attendance_occurrence_units ou WHERE ou.tenant_id=o.tenant_id " +
    "AND ou.occurrence_id=o.id AND ou.unit_id=$2)) AND (NOT EXISTS(SELECT 1 FROM attendance_session_weekdays w " +
    "WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id) OR EXISTS(SELECT 1 FROM attendance_session_weekdays w " +
    "WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id " +
    "AND w.day_of_week=EXTRACT(DOW FROM d.local_date)::int)) ORDER BY window_start,s.id LIMIT 129",
    [tenantId, unitId, generatedAt, SNAPSHOT_VALIDITY_DAYS],
  );
  const credentials = await db.query(
    "WITH identities AS (SELECT s.id,s.tenant_id,s.nama,s.status," + attendanceUidSql("s.uid_rfid") +
    " AS value FROM santri s WHERE s.tenant_id=$1 AND s.uid_rfid IS NOT NULL AND BTRIM(s.uid_rfid)<>'') " +
    "SELECT s.value,MIN(s.nama) AS display_name,(SELECT COUNT(*)::int FROM identities other " +
    "WHERE other.tenant_id=s.tenant_id AND other.value=s.value) AS identity_count," +
    "BOOL_OR(su.status='active' AND su.left_at IS NULL " +
    "AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN('aktif','active','') AND EXISTS(" +
    "SELECT 1 FROM santri_kelas_enrollments e WHERE e.tenant_id=su.tenant_id " +
    "AND e.santri_unit_id=su.id AND e.status='active' AND e.end_date IS NULL)) AS eligible " +
    "FROM identities s JOIN santri_units su ON su.tenant_id=s.tenant_id AND su.santri_id=s.id " +
    "WHERE s.tenant_id=$1 AND su.unit_id=$2 " +
    "GROUP BY s.tenant_id,s.value ORDER BY value LIMIT 201",
    [tenantId, unitId],
  );
  return {
    timezone: tenant.rows[0].attendance_timezone,
    sessions: bounded(sessions.rows, MAX_SESSIONS, "SNAPSHOT_SESSION_LIMIT"),
    windows: bounded(windows.rows, MAX_WINDOWS, "SNAPSHOT_WINDOW_LIMIT"),
    credentials: bounded(credentials.rows, MAX_CREDENTIALS, "SNAPSHOT_CREDENTIAL_LIMIT"),
  };
}

function buildAttendanceSnapshot(source, context, generatedAt = new Date()) {
  const generatedEpoch = Math.floor(generatedAt.getTime() / 1000);
  return {
    schema_version: SNAPSHOT_SCHEMA_VERSION,
    authorized_unit_id: context.unitId,
    timezone: source.timezone,
    generated_at: generatedAt.toISOString(),
    generated_epoch: generatedEpoch,
    refresh_after_epoch: generatedEpoch + SNAPSHOT_REFRESH_SECONDS,
    valid_until_epoch: generatedEpoch + SNAPSHOT_VALIDITY_DAYS * 86400,
    max_replay_age_seconds: SNAPSHOT_VALIDITY_DAYS * 86400,
    sessions: source.sessions.map((row) => ({
      id: Number(row.id), code: row.code || null, name: row.display_name,
      start_time: row.start_time, end_time: row.end_time,
      weekdays: (row.weekdays || []).map(Number),
    })),
    windows: source.windows.map((row) => ({
      key: String(row.session_id) + ":" + row.occurrence_date,
      session_id: Number(row.session_id), occurrence_date: row.occurrence_date,
      window_start: new Date(row.window_start).toISOString(),
      window_end: new Date(row.window_end).toISOString(), state: row.state,
      start_epoch: Math.floor(new Date(row.window_start).getTime() / 1000),
      end_epoch: Math.floor(new Date(row.window_end).getTime() / 1000),
    })),
    credentials: source.credentials.map((row) => ({
      type: "rfid", person_type: "santri", value: canonicalAttendanceUid(row.value),
      display_name: Number(row.identity_count) === 1 ? String(row.display_name || "").slice(0, 80) : "",
      status: Number(row.identity_count) === 1 ? "valid" : "ambiguous",
      eligible: Number(row.identity_count) === 1 && row.eligible === true,
    })),
  };
}

async function buildSnapshotPayload({ tenantId, device, now = new Date() }, client = null) {
  const context = requireDeviceContext(tenantId, device);
  const connection = client || await pool.connect();
  try {
    if (!client) await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const source = await querySnapshotSource(connection, context.tenantId, context.unitId, now);
    const snapshot = buildAttendanceSnapshot(source, context, now);
    const snapshotJson = JSON.stringify(snapshot);
    if (Buffer.byteLength(snapshotJson, "utf8") > MAX_SNAPSHOT_BYTES) {
      throw snapshotError("SNAPSHOT_SIZE_LIMIT", "Snapshot Attendance melebihi batas aman", 409);
    }
    const checksum = crypto.createHash("sha256").update(snapshotJson, "utf8").digest("hex");
    if (!client) await connection.query("COMMIT");
    return {
      ok: true, code: "ATTENDANCE_SNAPSHOT_READY",
      cache_version: checksum, checksum, snapshot_json: snapshotJson,
    };
  } catch (error) {
    if (!client) await connection.query("ROLLBACK");
    throw error;
  } finally {
    if (!client) connection.release();
  }
}

module.exports = {
  MAX_CREDENTIALS, MAX_SESSIONS, MAX_SNAPSHOT_BYTES, MAX_WINDOWS,
  SNAPSHOT_REFRESH_SECONDS, SNAPSHOT_SCHEMA_VERSION, SNAPSHOT_VALIDITY_DAYS,
  buildAttendanceSnapshot, buildSnapshotPayload, querySnapshotSource,
  requireDeviceContext, snapshotError,
};
