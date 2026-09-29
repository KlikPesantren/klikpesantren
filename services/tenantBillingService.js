const pool = require("../db");

const PLAN_CODES = new Set(["basic", "standard", "premium", "custom"]);
const BILLING_STATUSES = new Set([
  "trial",
  "active",
  "overdue",
  "suspended",
  "cancelled",
]);

const BILLING_FIELDS = `
  plan_code,
  billing_status,
  subscription_started_at,
  subscription_expires_at,
  last_payment_at,
  next_invoice_at,
  subscription_amount,
  billing_notes
`;

function normalizeOptionalString(value) {
  if (value == null) return null;
  const str = String(value).trim();
  return str || null;
}

function normalizeDate(value, fieldName) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const err = new Error(`${fieldName} tidak valid`);
    err.status = 400;
    throw err;
  }
  return date;
}

function assertPlatformSuperadmin(platformUser) {
  if (platformUser?.role !== "platform_superadmin") {
    const err = new Error("Hanya platform_superadmin yang boleh mengubah billing");
    err.status = 403;
    throw err;
  }
}

function validateBillingPatch(tenant, patch = {}) {
  const updates = {};

  if (patch.plan_code !== undefined) {
    const plan = normalizeOptionalString(patch.plan_code);
    if (!PLAN_CODES.has(plan)) {
      const err = new Error("plan_code harus basic, standard, premium, atau custom");
      err.status = 400;
      throw err;
    }
    updates.plan_code = plan;
  }

  if (patch.billing_status !== undefined) {
    const status = normalizeOptionalString(patch.billing_status);
    if (!BILLING_STATUSES.has(status)) {
      const err = new Error(
        "billing_status harus trial, active, overdue, suspended, atau cancelled"
      );
      err.status = 400;
      throw err;
    }
    if (tenant.slug === "default" && status === "cancelled") {
      const err = new Error("Tenant default tidak boleh diubah menjadi cancelled");
      err.status = 400;
      throw err;
    }
    updates.billing_status = status;
  }

  if (patch.subscription_expires_at !== undefined) {
    updates.subscription_expires_at = normalizeDate(
      patch.subscription_expires_at,
      "subscription_expires_at"
    );
  }

  if (patch.subscription_started_at !== undefined) {
    updates.subscription_started_at = normalizeDate(
      patch.subscription_started_at,
      "subscription_started_at"
    );
  }

  if (patch.last_payment_at !== undefined) {
    updates.last_payment_at = normalizeDate(patch.last_payment_at, "last_payment_at");
  }

  if (patch.next_invoice_at !== undefined) {
    updates.next_invoice_at = normalizeDate(patch.next_invoice_at, "next_invoice_at");
  }

  if (patch.subscription_amount !== undefined) {
    if (patch.subscription_amount === null || patch.subscription_amount === "") {
      updates.subscription_amount = null;
    } else {
      const amount = Number(patch.subscription_amount);
      if (!Number.isFinite(amount) || amount < 0) {
        const err = new Error("subscription_amount harus berupa nominal non-negatif");
        err.status = 400;
        throw err;
      }
      updates.subscription_amount = amount;
    }
  }

  if (patch.billing_notes !== undefined) {
    updates.billing_notes = patch.billing_notes == null
      ? null
      : String(patch.billing_notes);
  }

  return updates;
}

async function getTenantBilling(tenantId, client = pool) {
  const { rows } = await client.query(
    `SELECT ${BILLING_FIELDS}
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );
  return rows[0] || null;
}

async function updateTenantBilling(tenant, patch, platformUser, client = pool) {
  assertPlatformSuperadmin(platformUser);

  const updates = validateBillingPatch(tenant, patch);
  if (Object.keys(updates).length === 0) {
    return getTenantBilling(tenant.id, client);
  }

  const setClauses = [];
  const params = [];
  let index = 1;

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = $${index}`);
    params.push(value);
    index += 1;
  }

  const status = updates.billing_status;
  if (status === "suspended") {
    setClauses.push(`status = 'suspended'`);
    setClauses.push(`suspended_at = COALESCE(suspended_at, NOW())`);
    setClauses.push(`suspended_reason = COALESCE(suspended_reason, 'Billing suspended')`);
  } else if (status === "active" || status === "trial") {
    setClauses.push(`status = 'active'`);
    setClauses.push(`suspended_at = NULL`);
    setClauses.push(`suspended_reason = NULL`);
  }

  params.push(tenant.id);

  const { rows } = await client.query(
    `UPDATE tenants
     SET ${setClauses.join(", ")}
     WHERE id = $${index}
     RETURNING ${BILLING_FIELDS}, status`,
    params
  );

  await client.query(
    `INSERT INTO audit_logs (device_id, event_type, detail, tenant_id)
     VALUES ($1, $2, $3, $4)`,
    [
      `platform:${platformUser?.id ?? "system"}`,
      "platform.tenant.billing.updated",
      JSON.stringify({
        tenant_id: tenant.id,
        slug: tenant.slug,
        updated_by: platformUser?.id ?? null,
        updated_by_username: platformUser?.username ?? null,
        updates,
      }),
      tenant.id,
    ]
  );

  return rows[0];
}

module.exports = {
  PLAN_CODES,
  BILLING_STATUSES,
  getTenantBilling,
  updateTenantBilling,
};
