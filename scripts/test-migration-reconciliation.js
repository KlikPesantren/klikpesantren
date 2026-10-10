const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { applyMigrationPolicy, checksumMatches, loadMigrationPolicy, readMigration } = require("../utils/migrationLedger");

const ROOT = path.join(__dirname, "..");
const policy = loadMigrationPolicy();

function recommendation(filename) {
  const rule = policy.get(filename) || {};
  return rule.recommendation || rule.recommended_action;
}

assert.strictEqual(recommendation("003_demo_data_fix.sql"), "SUPERSEDED");
assert.strictEqual(recommendation("008_absensi_unique.sql"), "SUPERSEDED");
assert.strictEqual(recommendation("050_user_kelas_scope.sql"), "APPLY_RECONCILIATION");
assert.strictEqual(recommendation("063_rbac_module_permissions.sql"), "BASELINE_AS_APPLIED");

const plannedFiles = [
  "001_wali_app.sql", "006_normalize_phone_08.sql", "050_user_kelas_scope.sql",
  "064_multi_unit_foundation.sql", "065_reconcile_core_constraints.sql",
  "066_reconcile_missing_operational_schema.sql", "067_reconcile_academic_schema.sql",
  "068_reconcile_active_permissions.sql", "069_reconcile_wali_phone_canonical.sql",
  "070_admin_token_version.sql", "071_backfill_canonical_santri_unit_membership.sql",
];
const planned = applyMigrationPolicy(plannedFiles.map((filename) => ({ filename, state: "pending" })), policy);
assert.strictEqual(planned.find((item) => item.filename.startsWith("001_")).state, "superseded");
assert.strictEqual(planned.find((item) => item.filename.startsWith("006_")).state, "replaced");
assert.strictEqual(planned.find((item) => item.filename.startsWith("050_")).state, "replaced");

const executable = planned.filter((item) => item.state === "pending")
  .sort((a, b) => a.execution_order - b.execution_order)
  .map((item) => item.filename);
assert.deepStrictEqual(executable, [
  "065_reconcile_core_constraints.sql",
  "066_reconcile_missing_operational_schema.sql",
  "067_reconcile_academic_schema.sql",
  "068_reconcile_active_permissions.sql",
  "069_reconcile_wali_phone_canonical.sql",
  "064_multi_unit_foundation.sql",
  "070_admin_token_version.sql",
  "071_backfill_canonical_santri_unit_membership.sql",
]);

for (const filename of executable.filter((name) => /^0(?:6[5-9]|7[01])_/.test(name))) {
  const sql = fs.readFileSync(path.join(ROOT, "migrations", filename), "utf8");
  const withoutComments = sql.replace(/--[^\r\n]*/g, "");
  assert.match(sql, /^--[\s\S]*\bBEGIN\s*;/i, `${filename} must be transactional`);
  assert.match(sql, /COMMIT\s*;\s*$/i, `${filename} must commit explicitly`);
  assert.doesNotMatch(withoutComments, /\bDELETE\s+FROM\b/i, `${filename} must not delete rows`);
  assert.doesNotMatch(withoutComments, /\bDROP\s+(?:TABLE|COLUMN)\b/i, `${filename} must not drop data structures`);
}

const posFiles = Array.from({ length: 11 }, (_, index) => {
  const number = String(94 + index).padStart(3, "0");
  return fs.readdirSync(path.join(ROOT, "migrations"))
    .find((filename) => filename.startsWith(`${number}_`) && !filename.endsWith("_rollback.sql"));
});
assert.ok(posFiles.every(Boolean), "migrations 094-104 must all exist");
assert.deepStrictEqual(posFiles.map(recommendation), Array(11).fill("APPLY_ORIGINAL"));
assert.deepStrictEqual(posFiles.map((filename) => policy.get(filename).execution_order),
  Array.from({ length: 11 }, (_, index) => 240 + index * 10));
for (const filename of posFiles) {
  assert.ok(checksumMatches(readMigration(filename).sql, policy.get(filename).checksum),
    `${filename} policy checksum must match source across supported line endings`);
}
const executionOrders = [...policy.values()].map((rule) => rule.execution_order).filter(Boolean);
assert.strictEqual(new Set(executionOrders).size, executionOrders.length,
  "manifest execution_order values must be unique");
const posPlan = applyMigrationPolicy(posFiles.map((filename) => ({ filename, state: "pending" })), policy)
  .sort((a, b) => a.execution_order - b.execution_order);
assert.deepStrictEqual(posPlan.map((item) => item.filename), posFiles);
assert.ok(posPlan.every((item) => item.state === "pending"), "094-104 must remain executable pending migrations");
assert.strictEqual(applyMigrationPolicy([{ filename: "999_unreviewed.sql", state: "pending" }], policy)[0].state, "blocked",
  "unreviewed migration must fail closed");
assert.strictEqual(applyMigrationPolicy([{ filename: posFiles[0], state: "drift" }], policy)[0].state, "drift",
  "applied checksum drift must remain drift");

console.log("PASS migration reconciliation policy and POS 094-104 execution guard");
