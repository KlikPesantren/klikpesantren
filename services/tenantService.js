const pool = require("../db");
const {
  enforceTenantBillingExpiry,
} = require("./tenantBillingEnforcementService");

const DEFAULT_TENANT_SLUG = "default";

const TENANT_INACTIVE_MESSAGE =
  "Layanan KlikPesantren untuk pesantren ini sedang tidak aktif.";

function buildInactiveTenantPayload() {
  return {
    success: false,
    error: TENANT_INACTIVE_MESSAGE,
    message: TENANT_INACTIVE_MESSAGE,
  };
}

async function getTenantBySlug(slug) {
  await enforceTenantBillingExpiry({ slug });
  const { rows } = await pool.query(
    `SELECT id, slug, nama, tenant_display_name, status, logo_url, tagline, alamat, telepon,
            suspended_at, suspended_reason, onboarded_at, created_at,
            plan_code, billing_status, subscription_started_at,
            subscription_expires_at, last_payment_at, next_invoice_at,
            subscription_amount, billing_notes
     FROM tenants
     WHERE slug = $1`,
    [slug]
  );
  return rows[0] ?? null;
}

async function getDefaultTenant() {
  return getTenantBySlug(DEFAULT_TENANT_SLUG);
}

async function getTenantById(id) {
  await enforceTenantBillingExpiry({ tenantId: Number(id) || null });
  const { rows } = await pool.query(
    `SELECT id, slug, nama, tenant_display_name, status, logo_url, tagline, alamat, telepon,
            suspended_at, suspended_reason, onboarded_at, created_at, created_by,
            plan_code, billing_status, subscription_started_at,
            subscription_expires_at, last_payment_at, next_invoice_at,
            subscription_amount, billing_notes
     FROM tenants
     WHERE id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

async function resolveTenantForLogin(tenantSlug) {
  const slug = (tenantSlug || DEFAULT_TENANT_SLUG).trim().toLowerCase();
  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return { error: "Pesantren tidak ditemukan", status: 404 };
  }
  if (tenant.status !== "active") {
    return {
      error: TENANT_INACTIVE_MESSAGE,
      status: 403,
    };
  }
  return { tenant };
}

module.exports = {
  DEFAULT_TENANT_SLUG,
  TENANT_INACTIVE_MESSAGE,
  buildInactiveTenantPayload,
  getTenantBySlug,
  getDefaultTenant,
  getTenantById,
  resolveTenantForLogin,
};
