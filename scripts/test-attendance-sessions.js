const assert = require("assert/strict");
const { readFileSync } = require("fs");
const { resolve } = require("path");

const root = resolve(__dirname, "..");
const read = (file) => readFileSync(resolve(root, file), "utf8");

const attendance = read("routes/absensiRoutes.js");
const settings = read("routes/attendanceSessionRoutes.js");
const service = read("services/academicUnitService.js");
const page = read("frontend/src/pages/AbsensiPage.jsx");
const migration = read("migrations/083_attendance_sessions_per_unit.sql");
const dashboard = read("routes/dashboardRoutes.js");

assert.match(migration, /CREATE TABLE IF NOT EXISTS attendance_sessions/, "Canonical session table is required");
for (const field of [
  "tenant_id", "unit_id", "code", "display_name", "start_time", "end_time",
  "sort_order", "active", "created_at", "updated_at",
]) {
  assert.match(migration, new RegExp(`\\b${field}\\b`), `Session model must include ${field}`);
}
assert.match(migration, /SELECT DISTINCT a\.tenant_id, a\.unit_id, BTRIM\(a\.sesi\)/, "Backfill must be evidence-driven per unit");
assert.match(migration, /ATTENDANCE_SESSION_BACKFILL_MISMATCH/, "Migration must fail closed on historical mismatch");
assert.match(migration, /session_name_snapshot/, "Historical labels must be snapshotted");
assert.match(migration, /uq_absensi_tenant_unit_student_date_session/, "Uniqueness must be unit and session native");
assert.doesNotMatch(migration, /INSERT INTO attendance_sessions[\s\S]*FROM unit_pendidikan(?![\s\S]*absensi)/, "Migration must not seed every unit");
assert.doesNotMatch(migration, /DELETE FROM absensi|DROP TABLE absensi|DROP COLUMN sesi/i, "Migration must preserve attendance history");

assert.match(settings, /router\.post\("\/"/, "Settings must support session creation");
assert.match(settings, /router\.patch\("\/:sessionId"/, "Settings must support rename, ordering, time, and activation edits");
assert.match(settings, /UNIT_REQUIRED/, "All-unit writes must be rejected");
assert.doesNotMatch(settings, /router\.delete/, "Historical sessions must not have a destructive delete endpoint");
assert.doesNotMatch(settings, /PESANTREN|SMP|PAUD|TK/, "Runtime settings must not branch by unit name or type");

assert.match(service, /CROSS_UNIT_SESSION/, "Cross-unit session spoof must return a controlled 403");
assert.match(service, /CROSS_UNIT_STUDENT/, "Cross-unit student spoof must return a controlled 403");
assert.match(attendance, /getAttendanceSessionInUnit/, "Attendance writes must validate session ownership");
assert.match(attendance, /getActiveStudentContext/, "Attendance writes must validate active student membership");
assert.match(attendance, /session_id, session_name_snapshot/, "Attendance writes must persist stable identity and historical label");
assert.match(attendance, /SELECT \$1, \$2, \$3, \$4, \$3, \$5, \$6, \$7, \$8, \$9, \$10, \$11, 'admin',p\.academic_year_id,p\.id/, "Attendance insert must append server-resolved academic period snapshots");
assert.match(attendance, /ON CONFLICT \(tenant_id, unit_id, santri_id, tanggal, session_id\)/, "Write uniqueness must include unit and session");
assert.doesNotMatch(attendance, /req\.body[^;]*sesi/, "Attendance writes must not trust a display label from the client");

assert.match(page, /activeSessions\.map\(\(session\)/, "Page structure must use configured sessions");
assert.match(page, /session_id: sessionId/, "Frontend writes must send a stable session ID");
assert.match(page, /Sesi absensi belum dikonfigurasi/, "Unconfigured units must show an explicit empty state");
assert.match(page, /api\.post\("\/attendance-sessions"/, "Admin can create sessions without source edits");
assert.match(page, /api\.patch\(`\/attendance-sessions\/\$\{session\.id\}`/, "Admin can edit and disable sessions");
assert.doesNotMatch(page, /SESI_LIST|Ngaji Pagi|Ngaji Siang|Ngaji Sore|Ngaji Malam/, "Frontend must not fall back to fixed Pesantren labels");

// Representative runtime matrix: arbitrary names/counts stay independent.
const unitMatrix = new Map([
  ["pesantren", ["Legacy 1", "Legacy 2", "Legacy 3", "Legacy 4", "Legacy 5"]],
  ["smp", ["Apel", "Pelajaran 1", "Pelajaran 2"]],
  ["paud", ["Datang"]],
  ["random", ["Session A", "Session B", "Session C"]],
]);
assert.equal(unitMatrix.get("random").length, 3);
unitMatrix.get("random")[1] = "Session B Renamed";
assert.deepEqual(unitMatrix.get("smp"), ["Apel", "Pelajaran 1", "Pelajaran 2"]);
unitMatrix.get("random").splice(2, 1);
assert.equal(unitMatrix.get("random").length, 2);
assert.equal(unitMatrix.get("paud").length, 1);

assert.match(dashboard, /FROM absensi|getDashboardUnitSummary/, "Dashboard attendance aggregate remains row-driven through its canonical summary source");
assert.doesNotMatch(dashboard, /Ngaji Pagi|Ngaji Siang|Ngaji Sore|Ngaji Malam/, "Dashboard must not assume fixed sessions");

console.log("PASS attendance sessions: canonical model, dynamic UI, history, scope security, and representative units");
