/**
 * Check or enforce canonical tenant subscription expiry.
 *
 * Default: read-only report.
 * Apply: BILLING_APPLY=1 node scripts/check-tenant-billing-expiry.js
 */
require("dotenv").config();
const pool = require("../db");
const {
  BILLING_TIME_ZONE,
  enforceAllTenantBillingExpiries,
} = require("../services/tenantBillingEnforcementService");

async function run() {
  const apply = process.env.BILLING_APPLY === "1";
  const { rows } = await pool.query(
    `SELECT id, slug, nama, plan_code, billing_status, subscription_expires_at
     FROM tenants
     WHERE subscription_expires_at IS NOT NULL
       AND subscription_expires_at::date
           < (CURRENT_TIMESTAMP AT TIME ZONE $1)::date
       AND billing_status IN ('active', 'trial', 'overdue')
       AND status = 'active'
       AND slug <> 'default'
     ORDER BY subscription_expires_at ASC`,
    [BILLING_TIME_ZONE]
  );

  console.log(`Billing expiry check (timezone=${BILLING_TIME_ZONE}). Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Expired tenants eligible for suspension: ${rows.length}`);
  for (const row of rows) {
    console.log(
      `- ${row.slug} (${row.nama}) plan=${row.plan_code} status=${row.billing_status} expires=${row.subscription_expires_at?.toISOString?.() || row.subscription_expires_at}`
    );
  }

  if (apply) {
    const updated = await enforceAllTenantBillingExpiries();
    console.log(`Suspended exactly once: ${updated.length}`);
  } else if (rows.length) {
    console.log("Dry run. Set BILLING_APPLY=1 to apply canonical suspension.");
  }
}

run()
  .catch((error) => {
    console.error("ERR", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
