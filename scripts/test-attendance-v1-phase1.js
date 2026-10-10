const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { decideAttendanceTransition, MAX_OFFLINE_AGE_MS } = require("../services/attendanceStatusPolicy");

process.env.DB_USER ||= "attendance-v1-test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "attendance-v1-test";
process.env.DB_PASSWORD ||= "attendance-v1-test";
const secureDeviceAuth = require("../middleware/secureDeviceAuthMiddleware");
const deviceControllerRuntime = require("../controllers/rfidDeviceController");
const { deleteTenantSafely } = require("../services/tenantHealthService");


const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("migrations/092_attendance_v1_foundation.sql");
const rollback = read("migrations/092_attendance_v1_foundation_rollback.sql");
const core = read("services/attendanceCoreService.js");
const secureAuth = read("middleware/secureDeviceAuthMiddleware.js");
const authEntry = read("middleware/deviceAuthMiddleware.js");
const deviceRoutes = read("routes/rfidDeviceRoutes.js");
const deviceController = read("controllers/rfidDeviceController.js");
const waliRoutes = read("routes/waliAppRoutes.js");
const walletController = read("controllers/walletController.js");
const tenantHealthService = read("services/tenantHealthService.js");

const window = {
  capturedAt: "2026-09-29T00:15:00.000Z",
  receivedAt: "2026-09-29T03:00:00.000Z",
  windowStart: "2026-09-29T00:00:00.000Z",
  windowEnd: "2026-09-29T01:00:00.000Z",
  occurrenceState: "closed",
};

assert.strictEqual(decideAttendanceTransition({ nextStatus:"H", source:"device", ...window }).code, "DEVICE_HADIR");
assert.strictEqual(decideAttendanceTransition({
  current:{ status:"A", source:"system", auto_generated:true, protected_manual:false },
  nextStatus:"H", source:"device", ...window,
}).code, "LATE_HADIR_RECONCILED");
for (const status of ["I", "S"]) {
  assert.strictEqual(decideAttendanceTransition({
    current:{ status, source:"admin", auto_generated:false, protected_manual:true },
    nextStatus:"H", source:"device", ...window,
  }).allowed, false);
}
assert.strictEqual(decideAttendanceTransition({
  current:{ status:"A", source:"manual", auto_generated:false, protected_manual:true },
  nextStatus:"H", source:"device", ...window,
}).code, "MANUAL_RESULT_PROTECTED");
assert.strictEqual(decideAttendanceTransition({
  current:{ status:"I", source:"admin", protected_manual:true },
  nextStatus:"H", source:"admin", adminExplicit:true,
}).code, "ADMIN_CORRECTION");
assert.strictEqual(decideAttendanceTransition({ nextStatus:"A", source:"system" }).code, "AUTO_ALFA");
assert.strictEqual(decideAttendanceTransition({
  current:{ status:"H" }, nextStatus:"A", source:"system",
}).changed, false);
assert.strictEqual(decideAttendanceTransition({
  nextStatus:"H", source:"device", ...window, capturedAt:window.capturedAt,
  receivedAt:new Date(Date.parse(window.capturedAt)+MAX_OFFLINE_AGE_MS+1),
}).code, "EVENT_OUTSIDE_OFFLINE_POLICY");
assert.strictEqual(decideAttendanceTransition({
  nextStatus:"H", source:"device", ...window, capturedAt:window.windowEnd,
}).code, "OUTSIDE_ATTENDANCE_WINDOW");

for (const expected of [
  "attendance_timezone", "attendance_session_units", "attendance_session_weekdays", "attendance_occurrence_units",
  "attendance_occurrences", "attendance_results", "attendance_events",
  "uq_attendance_occurrences_session_date", "uq_attendance_results_person_occurrence",
  "uq_attendance_events_idempotency", "uq_attendance_results_source_event",
  "device_secret_hash", "connection_state", "enabled",
]) assert(migration.includes(expected), expected);
assert(migration.includes("start_time<end_time"));
assert(!migration.includes("attendance_events_immutable"));
assert(!migration.includes("prevent_attendance_event_mutation"));
assert(!migration.includes("DROP TABLE absensi"));
assert(!migration.includes("DROP TABLE absensi_guru"));
assert(rollback.includes("DROP TABLE IF EXISTS attendance_results"));
assert(rollback.includes("DROP COLUMN IF EXISTS attendance_timezone"));
assert(!rollback.includes("attendance_events_immutable"));
assert(!rollback.includes("prevent_attendance_event_mutation"));

const phaseOneTables = [
  "attendance_events",
  "attendance_occurrence_units",
  "attendance_occurrences",
  "attendance_results",
  "attendance_session_units",
  "attendance_session_weekdays",
];
for (const table of phaseOneTables) {
  assert(tenantHealthService.includes(`"${table}"`), `hard-delete registry: ${table}`);
}
for (const constraint of [
  "attendance_session_units_tenant_fkey",
  "attendance_session_weekdays_tenant_fkey",
  "attendance_occurrence_units_tenant_fkey",
]) {
  assert(migration.includes(constraint), `direct tenant ownership: ${constraint}`);
}
assert.strictEqual((migration.match(/REFERENCES tenants\(id\) ON DELETE CASCADE/g) || []).length, 6);
assert(migration.includes("DEFERRABLE INITIALLY DEFERRED"));

assert(core.includes("ON CONFLICT(tenant_id,session_id,occurrence_date)"));
assert(core.includes("AMBIGUOUS_SESSION_WINDOW"));
assert(core.includes("INSERT INTO attendance_occurrence_units"));
assert(core.includes("DUPLICATE_SESSION_UNIT"));
assert(core.includes("CROSS_TENANT_UNIT"));
assert(core.includes("su.status='active' AND su.left_at IS NULL"));
assert(core.includes("gu.status='active' AND gu.left_at IS NULL"));
assert(core.includes("ON CONFLICT(tenant_id,event_key) DO NOTHING"));
assert(core.includes("ON CONFLICT(tenant_id,occurrence_id,person_type,person_id) DO NOTHING"));
assert(core.includes("state='closed',closed_at=$3"));
assert(core.includes("pg_advisory_xact_lock"));
assert(core.includes("santri_kelas_enrollments"));
assert(core.includes("INSERT INTO attendance_events"));
assert(!/UPDATE\s+attendance_events/i.test(core));
assert(!/DELETE\s+FROM\s+attendance_events/i.test(core));

assert(secureAuth.includes("DEVICE_CREDENTIALS_IN_QUERY_FORBIDDEN"));
assert(secureAuth.includes("stored.enabled === false"));
assert(secureAuth.includes("bcrypt.compare"));
assert(secureAuth.includes("timingSafeEqual"));
assert(!secureAuth.includes("console.log(req"));
assert(authEntry.includes("secureDeviceAuthMiddleware"));
assert(deviceRoutes.includes("registerDisabled"));
assert(deviceController.includes("DEVICE_ADMIN_PROVISIONING_REQUIRED"));
assert(deviceController.includes("deviceSecretHash"));
assert(deviceController.includes('"__HASHED_V1__"'));

for (const field of ["hadir", "izin", "sakit", "alpa", "riwayat"]) assert(waliRoutes.includes(field));
assert(walletController.includes("wallet_accounts"));


assert.strictEqual(secureDeviceAuth.credentialsFromRequest({
  query:{ device_secret:"must-not-be-read" }, headers:{}, body:{},
}).error, "DEVICE_CREDENTIALS_IN_QUERY_FORBIDDEN");
assert.strictEqual(secureDeviceAuth.credentialsFromRequest({
  query:{}, headers:{ "x-device-id":"A" }, body:{ device_id:"B" },
}).error, "AMBIGUOUS_DEVICE_CREDENTIALS");
assert.strictEqual(secureDeviceAuth.credentialsFromRequest({
  query:{}, headers:{}, body:{ device_id:"A",device_secret:"secret",tenant_slug:"demo" },
}).deviceId, "A");
let disabledStatus = null;
let disabledBody = null;
deviceControllerRuntime.registerDisabled({}, {
  status(code) { disabledStatus = code; return this; },
  json(body) { disabledBody = body; return this; },
});
assert.strictEqual(disabledStatus, 410);
assert.strictEqual(disabledBody.code, "DEVICE_ADMIN_PROVISIONING_REQUIRED");
assert(!JSON.stringify(disabledBody).includes("must-not-be-read"));

function quotedArray(source, name) {
  const match = source.match(new RegExp("const " + name + " = \\[([\\s\\S]*?)\\];"));
  assert(match, name);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((item) => item[1]);
}

async function verifyTenantHardDeleteLifecycle() {
  const explicitTables = quotedArray(tenantHealthService, "DELETE_TABLE_ORDER");
  const cascadeTables = quotedArray(tenantHealthService, "CASCADE_TABLES");
  const columns = [...new Set([...explicitTables, ...cascadeTables])]
    .map((table_name) => ({ table_name, column_name: "tenant_id" }));
  const queries = [];
  const client = {
    async query(sql) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      queries.push(normalized);
      if (normalized.includes("FROM pg_catalog.pg_class c")) {
        return { rows: columns };
      }
      if (normalized.includes("SELECT child.relname AS child_table")) {
        return { rows: [] };
      }
      if (normalized.includes("SELECT child.relname AS table_name")) {
        return { rows: cascadeTables.map((table_name) => ({ table_name })) };
      }
      if (normalized.startsWith("DELETE FROM tenants ")) {
        return { rows: [{ id: 991, slug: "attendance-v1-disposable" }], rowCount: 1 };
      }
      if (normalized.startsWith("DELETE FROM ")) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith("INSERT INTO audit_logs ")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error("Unexpected hard-delete query: " + normalized);
    },
  };

  await deleteTenantSafely(
    { id: 991, slug: "attendance-v1-disposable", nama: "Attendance V1", status: "suspended" },
    { id: 1, username: "platform-test" },
    client,
  );

  for (const table of phaseOneTables) {
    assert(cascadeTables.includes(table), "cascade registry missing " + table);
    assert(!queries.some((sql) => sql.startsWith("DELETE FROM " + table + " ")),
      "Phase 1 table must be FK-cascaded: " + table);
  }
  const tenantDeleteIndex = queries.findIndex((sql) => sql.startsWith("DELETE FROM tenants "));
  const lastExplicitDeleteIndex = Math.max(...queries.map((sql, index) =>
    explicitTables.some((table) => sql.startsWith("DELETE FROM " + table + " ")) ? index : -1));
  assert(tenantDeleteIndex > lastExplicitDeleteIndex, "tenant row must be deleted last");
}

verifyTenantHardDeleteLifecycle()
  .then(() => console.log("PASS Attendance V1 Phase 1: security, occurrence, multi-unit, person eligibility, precedence, event, closure, and tenant lifecycle contracts"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
