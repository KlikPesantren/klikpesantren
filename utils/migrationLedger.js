const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");
const MIGRATION_POLICY_PATH = path.join(__dirname, "..", "docs", "migration-baseline-manifest.json");

function migrationSortKey(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql") && !name.endsWith("_rollback.sql"))
    .sort((a, b) => migrationSortKey(a) - migrationSortKey(b) || a.localeCompare(b));
}

function checksum(sql) {
  return crypto.createHash("sha256").update(sql, "utf8").digest("hex");
}

function checksumMatches(sql, expectedChecksum) {
  const variants = [
    sql,
    sql.replace(/\r\n/g, "\n"),
    sql.replace(/\r?\n/g, "\r\n"),
  ];
  return variants.some((variant) => checksum(variant) === expectedChecksum);
}

function stripOuterTransaction(sql) {
  const withoutBom = sql.replace(/^\uFEFF/, "");
  if (!/^\s*BEGIN\s*;/i.test(withoutBom) || !/COMMIT\s*;\s*$/i.test(withoutBom)) {
    return withoutBom;
  }
  return withoutBom
    .replace(/^\s*BEGIN\s*;/i, "")
    .replace(/COMMIT\s*;\s*$/i, "");
}

function readMigration(filename) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
  return {
    filename,
    sql,
    executionSql: stripOuterTransaction(sql),
    checksum: checksum(sql),
  };
}

function loadMigrationPolicy() {
  if (!fs.existsSync(MIGRATION_POLICY_PATH)) return new Map();
  const manifest = JSON.parse(fs.readFileSync(MIGRATION_POLICY_PATH, "utf8"));
  return new Map((manifest.migrations || []).map((item) => [item.filename, item]));
}

function applyMigrationPolicy(status, policy = loadMigrationPolicy()) {
  return status.map((item) => {
    const rule = policy.get(item.filename) || {};
    const recommendation = rule.recommendation || rule.recommended_action || null;
    let state = item.state;
    if (item.state === "pending") {
      if (recommendation === "SUPERSEDED") state = "superseded";
      else if (recommendation === "APPLY_RECONCILIATION") state = "replaced";
      else if (recommendation === "BASELINE_AS_APPLIED") state = "baseline-missing";
      else if (recommendation === "MANUAL_REVIEW" || !recommendation) state = "blocked";
    }
    return {
      ...item,
      state,
      recommendation,
      execution_order: Number(rule.execution_order) || migrationSortKey(item.filename),
    };
  });
}

async function ledgerExists(client) {
  const { rows } = await client.query(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
  );
  return rows[0]?.exists === true;
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getMigrationStatus(client) {
  const files = listMigrationFiles().map(readMigration);
  if (!(await ledgerExists(client))) {
    return files.map((file) => ({ ...file, state: "unverified" }));
  }

  const { rows } = await client.query(
    `SELECT filename, checksum, applied_at FROM schema_migrations ORDER BY filename`,
  );
  const applied = new Map(rows.map((row) => [row.filename, row]));
  const result = files.map((file) => {
    const ledger = applied.get(file.filename);
    if (!ledger) return { ...file, state: "pending" };
    return {
      ...file,
      state: checksumMatches(file.sql, ledger.checksum) ? "applied" : "drift",
      applied_at: ledger.applied_at,
    };
  });

  for (const row of rows) {
    if (!files.some((file) => file.filename === row.filename)) {
      result.push({ ...row, state: "missing-file" });
    }
  }
  return result;
}

async function recordMigration(client, migration) {
  await client.query(
    `INSERT INTO schema_migrations (filename, checksum)
     VALUES ($1, $2)
     ON CONFLICT (filename) DO NOTHING`,
    [migration.filename, migration.checksum],
  );
}

function printMigrationStatus(status, { dryRun = false } = {}) {
  if (dryRun) console.log("DRY RUN: tidak ada migration yang dieksekusi.");
  for (const item of status) {
    console.log(`${String(item.state).toUpperCase().padEnd(12)} ${item.filename}`);
  }
  if (status.some((item) => item.state === "unverified")) {
    console.log(
      "Ledger belum tersedia. Migration existing berstatus UNVERIFIED dan tidak ditandai applied otomatis.",
    );
  }
}

module.exports = {
  MIGRATIONS_DIR,
  MIGRATION_POLICY_PATH,
  applyMigrationPolicy,
  checksum,
  checksumMatches,
  ensureLedger,
  getMigrationStatus,
  ledgerExists,
  loadMigrationPolicy,
  listMigrationFiles,
  printMigrationStatus,
  readMigration,
  recordMigration,
  stripOuterTransaction,
};
