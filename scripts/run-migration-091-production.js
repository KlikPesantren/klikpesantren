const pool = require("../db");
const { readMigration, recordMigration } = require("../utils/migrationLedger");

const FILENAME = "091_platform_subscription_billing_controls.sql";

async function snapshot(client) {
  const column = (await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='tenants'
         AND column_name='subscription_amount'
     ) AS value`
  )).rows[0].value === true;
  const settings = (await client.query(
    "SELECT settings FROM platform_settings WHERE id=1"
  )).rows[0]?.settings || {};
  return {
    column_exists: column,
    tenant_count: Number((await client.query("SELECT COUNT(*) value FROM tenants")).rows[0].value),
    configured_amount_count: column
      ? Number((await client.query("SELECT COUNT(*) value FROM tenants WHERE subscription_amount IS NOT NULL")).rows[0].value)
      : 0,
    warning_configured: Object.hasOwn(settings, "warning_days_before_due"),
    template_configured: Object.hasOwn(settings, "billing_confirmation_message_template"),
    ledger_count: Number((await client.query(
      "SELECT COUNT(*) value FROM schema_migrations WHERE filename=$1",
      [FILENAME]
    )).rows[0].value),
  };
}

async function main() {
  const rehearsal = process.argv.includes("--rollback-rehearsal");
  const confirm = process.argv.includes("--confirm-production");
  if (!rehearsal && !confirm) {
    throw new Error("Gunakan --rollback-rehearsal atau --confirm-production");
  }

  const client = await pool.connect();
  try {
    const before = await snapshot(client);
    if (before.ledger_count) throw new Error("ALREADY_APPLIED:" + JSON.stringify(before));
    await client.query("BEGIN");
    const migration = readMigration(FILENAME);
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const after = await snapshot(client);
    const checks = {
      column_exists: after.column_exists,
      warning_initialized: after.warning_configured,
      template_initialized: after.template_configured,
      ledger_recorded: after.ledger_count === 1,
      tenant_rows_unchanged: after.tenant_count === before.tenant_count,
      no_amount_backfill: after.configured_amount_count === before.configured_amount_count,
    };
    if (Object.values(checks).some((value) => !value)) {
      throw new Error("MIGRATION_CHECK_FAILED:" + JSON.stringify(checks));
    }
    if (rehearsal) {
      await client.query("ROLLBACK");
      const rollback = await snapshot(client);
      const rollbackPass = JSON.stringify(rollback) === JSON.stringify(before);
      console.log(JSON.stringify({ mode: "ROLLBACK_REHEARSAL", before, after, checks, rollback: rollbackPass ? "PASS" : "FAIL" }, null, 2));
      if (!rollbackPass) process.exitCode = 1;
      return;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "PRODUCTION_APPLY", migration: FILENAME, before, after, checks, status: "PASS" }, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message }));
  process.exit(1);
});
