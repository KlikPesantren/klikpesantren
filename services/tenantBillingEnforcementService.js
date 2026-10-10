const pool = require("../db");

const BILLING_TIME_ZONE = "Asia/Jakarta";

async function runExpiryEnforcement({ tenantId = null, slug = null } = {}, client = pool) {
  const { rows } = await client.query(
    `WITH suspended AS (
       UPDATE tenants
       SET billing_status = 'suspended',
           status = 'suspended',
           suspended_at = COALESCE(suspended_at, NOW()),
           suspended_reason = COALESCE(suspended_reason, 'Masa langganan berakhir'),
           updated_at = NOW()
       WHERE ($1::int IS NULL OR id = $1)
         AND ($2::text IS NULL OR slug = $2)
         AND slug <> 'default'
         AND status = 'active'
         AND billing_status IN ('active', 'trial', 'overdue')
         AND subscription_expires_at IS NOT NULL
         AND subscription_expires_at::date
             < (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
       RETURNING id, slug, nama, subscription_expires_at
     ), audited AS (
       INSERT INTO audit_logs (device_id, event_type, detail, tenant_id)
       SELECT
         'system:subscription-expiry',
         'platform.tenant.billing.auto_suspended',
         json_build_object(
           'tenant_id', id,
           'slug', slug,
           'subscription_expires_at', subscription_expires_at,
           'time_zone', $3
         )::text,
         id
       FROM suspended
       RETURNING tenant_id
     )
     SELECT s.id, s.slug, s.nama, s.subscription_expires_at
     FROM suspended s
     JOIN audited a ON a.tenant_id = s.id`,
    [tenantId, slug, BILLING_TIME_ZONE]
  );

  return rows;
}

async function enforceTenantBillingExpiry({ tenantId = null, slug = null } = {}, client = pool) {
  if (!tenantId && !slug) return null;
  const rows = await runExpiryEnforcement({ tenantId, slug }, client);
  return rows[0] || null;
}

async function enforceAllTenantBillingExpiries(client = pool) {
  return runExpiryEnforcement({}, client);
}

module.exports = {
  BILLING_TIME_ZONE,
  enforceAllTenantBillingExpiries,
  enforceTenantBillingExpiry,
};
