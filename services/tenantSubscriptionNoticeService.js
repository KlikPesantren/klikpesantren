const pool = require("../db");
const { getPlatformSettings } = require("./platformSettingsService");
const { BILLING_TIME_ZONE } = require("./tenantBillingEnforcementService");
const {
  buildTenantSubscriptionNotice,
} = require("../utils/tenantSubscriptionBilling");

async function getTenantSubscriptionNotice(tenantId, client = pool) {
  const [{ rows }, platform] = await Promise.all([
    client.query(
      `SELECT
         id,
         nama,
         status,
         billing_status,
         subscription_started_at,
         subscription_expires_at,
         subscription_amount,
         (
           subscription_expires_at::date
           - (CURRENT_TIMESTAMP AT TIME ZONE $2)::date
         )::int AS days_until_due
       FROM tenants
       WHERE id = $1`,
      [tenantId, BILLING_TIME_ZONE]
    ),
    getPlatformSettings(),
  ]);

  const tenant = rows[0];
  if (!tenant) return null;

  return buildTenantSubscriptionNotice(tenant, platform.settings || {});
}

module.exports = {
  getTenantSubscriptionNotice,
};
