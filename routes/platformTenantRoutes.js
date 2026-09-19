const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const requirePermission = require("../middleware/requirePermission");
const { createTenantWithDefaults } = require("../services/tenantOnboardingService");
const { getPackageOptions } = require("../config/tenantPackageConfig");
const { getTenantById } = require("../services/tenantService");
const {
  getTenantBilling,
  updateTenantBilling,
} = require("../services/tenantBillingService");
const { getTenantPlatformDashboard } = require("../services/tenantPlatformStatsService");
const {
  attachTenantListHealth,
  getTenantHealth,
} = require("../services/tenantHealthService");
const {
  applyTenantPackage,
  getTenantFeatureManagementState,
  updateTenantFeatures,
} = require("../services/tenantFeatureService");
const { updateTenantFromPlatform } = require("../services/tenantPlatformUpdateService");
const {
  createDraftDomainForTenant,
  provisionFullTenantDomain,
  syncTenantDomainDisabledStatus,
} = require("../services/tenantDomainService");
const { createTenantWithDomainAutomation } = require("../services/tenantCreationDomainService");

const router = express.Router();

router.use(platformAuthMiddleware);

function generateTenantAdminPassword() {
  return crypto.randomBytes(18).toString("base64url");
}

router.get(
  "/",
  requirePermission("platform.tenant.view"),
  async (req, res) => {
    try {
      const status = req.query.status
        ? String(req.query.status).trim()
        : null;
      const q = req.query.q ? String(req.query.q).trim() : null;

      const conditions = [];
      const params = [];
      let i = 1;

      if (status) {
        conditions.push(`t.status = $${i}`);
        params.push(status);
        i += 1;
      }

      if (q) {
        conditions.push(`(t.nama ILIKE ${i} OR t.slug ILIKE ${i})`);
        params.push(`%${q}%`);
        i += 1;
      }

      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

      const result = await pool.query(
        `SELECT
           t.id, t.slug, t.nama, t.tenant_display_name, t.status, t.alamat, t.telepon, t.logo_url,
           t.tagline, t.onboarded_at, t.suspended_at, t.suspended_reason,
           t.created_at, t.plan_code, t.billing_status,
           t.subscription_started_at, t.subscription_expires_at,
           t.last_payment_at, t.next_invoice_at, t.billing_notes,
           (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS user_count,
           (SELECT COUNT(*)::int FROM unit_pendidikan up WHERE up.tenant_id = t.id) AS unit_count,
           (SELECT COUNT(*)::int FROM santri s WHERE s.tenant_id = t.id AND LOWER(s.status) = 'aktif') AS santri_count
         FROM tenants t
         ${where}
         ORDER BY t.onboarded_at DESC NULLS LAST, t.id DESC`,
        params
      );

      const data = await attachTenantListHealth(result.rows);

      res.json({ success: true, data });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.get(
  "/packages",
  requirePermission("platform.tenant.view"),
  async (_req, res) => {
    res.json({ success: true, packages: getPackageOptions() });
  }
);

router.post(
  "/",
  requirePermission("platform.tenant.create"),
  async (req, res) => {
    try {
      const body = req.body || {};

      const nama = body.nama_pesantren?.trim() || body.nama?.trim();
      if (!nama) {
        return res.status(400).json({
          success: false,
          error: "Nama pesantren wajib diisi",
        });
      }

      if (!body.slug?.trim()) {
        return res.status(400).json({
          success: false,
          error: "Slug wajib diisi",
        });
      }

      if (!body.admin_username?.trim()) {
        return res.status(400).json({
          success: false,
          error: "admin_username wajib diisi",
        });
      }

      if (body.package && !["basic", "standard", "premium", "custom"].includes(String(body.package).toLowerCase())) {
        return res.status(400).json({
          success: false,
          error: "Package harus basic, standard, premium, atau custom",
        });
      }

      const {
        tenantResult: result,
        tenantDomain,
        tenantDomainError,
      } = await createTenantWithDomainAutomation(body, req.platformUser, {
        createTenant: createTenantWithDefaults,
        createDraftDomain: createDraftDomainForTenant,
        provisionDomain: provisionFullTenantDomain,
      });

      res.status(201).json({
        success: true,
        tenant_id: result.tenant.id,
        tenant: {
          id: result.tenant.id,
          slug: result.tenant.slug,
          nama: result.tenant.nama,
          status: result.tenant.status,
        },
        admin: {
          nama: result.admin_user?.nama,
          username: result.admin_user?.username,
          password: result.admin_initial_password,
        },
        package: result.package,
        features_enabled: result.features_enabled,
        tenant_domain: tenantDomain,
        tenant_domain_error: tenantDomainError,
        data: result,
      });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

router.post(
  "/:id/reset-admin-password",
  requirePermission("platform.tenant.update"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      if (req.platformUser?.role !== "platform_superadmin") {
        return res.status(403).json({
          success: false,
          error: "Hanya platform_superadmin yang boleh reset password admin tenant",
        });
      }

      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const adminResult = await client.query(
        `SELECT id, nama, username, role
         FROM users
         WHERE tenant_id = $1
           AND role = 'superadmin'
         ORDER BY id ASC
         LIMIT 1`,
        [tenant.id]
      );

      const admin = adminResult.rows[0];
      if (!admin) {
        return res.status(404).json({
          success: false,
          error: "Admin tenant tidak ditemukan",
        });
      }

      const password = generateTenantAdminPassword();
      const hash = await bcrypt.hash(password, 10);

      await client.query("BEGIN");
      await client.query(
        `UPDATE users
         SET password = $1
         WHERE id = $2
           AND tenant_id = $3`,
        [hash, admin.id, tenant.id]
      );
      await client.query(
        `INSERT INTO audit_logs (device_id, event_type, detail, tenant_id)
         VALUES ($1, $2, $3, $4)`,
        [
          `platform:${req.platformUser?.id ?? "system"}`,
          "platform.tenant.admin_password_reset",
          JSON.stringify({
            tenant_id: tenant.id,
            tenant_slug: tenant.slug,
            admin_user_id: admin.id,
            admin_username: admin.username,
            reset_by: req.platformUser?.id ?? null,
            reset_by_username: req.platformUser?.username ?? null,
          }),
          tenant.id,
        ]
      );
      await client.query("COMMIT");

      res.json({
        success: true,
        tenant_id: tenant.id,
        admin: {
          id: admin.id,
          nama: admin.nama,
          username: admin.username,
          password,
        },
      });
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {
        /* ignore rollback error */
      }
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    } finally {
      client.release();
    }
  }
);

router.get(
  "/:id/features",
  requirePermission("platform.tenant.view"),
  async (req, res) => {
    try {
      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const featureState = await getTenantFeatureManagementState(tenant.id);

      res.json({
        success: true,
        tenant_id: tenant.id,
        ...featureState,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.patch(
  "/:id/features",
  requirePermission("platform.tenant.update"),
  async (req, res) => {
    try {
      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const featureState = await updateTenantFeatures(
        tenant.id,
        req.body?.features
      );

      res.json({
        success: true,
        tenant_id: tenant.id,
        ...featureState,
      });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

router.patch(
  "/:id/package",
  requirePermission("platform.tenant.update"),
  async (req, res) => {
    try {
      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const featureState = await applyTenantPackage(
        tenant.id,
        req.body?.package,
        req.body?.custom_features
      );

      res.json({
        success: true,
        tenant_id: tenant.id,
        ...featureState,
      });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

router.get(
  "/:id/billing",
  requirePermission("platform.tenant.view"),
  async (req, res) => {
    try {
      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const billing = await getTenantBilling(tenant.id);

      res.json({
        success: true,
        tenant_id: tenant.id,
        data: billing,
      });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

router.patch(
  "/:id/billing",
  requirePermission("platform.tenant.update"),
  async (req, res) => {
    try {
      if (req.platformUser?.role !== "platform_superadmin") {
        return res.status(403).json({
          success: false,
          error: "Hanya platform_superadmin yang boleh mengubah billing",
        });
      }

      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const billing = await updateTenantBilling(
        tenant,
        req.body || {},
        req.platformUser
      );

      res.json({
        success: true,
        tenant_id: tenant.id,
        data: billing,
      });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
      });
    }
  }
);

router.delete(
  "/:id",
  (_req, res) => {
    // Tenant-wide physical deletion requires a separate, controlled maintenance
    // credential. The normal Railway runtime must never execute this workflow.
    return res.status(409).json({
      success: false,
      code: "MAINTENANCE_REQUIRED",
      error: "Hapus tenant hanya tersedia melalui prosedur maintenance terkontrol",
    });
  }
);

router.get(
  "/:id/dashboard",
  requirePermission("platform.tenant.view"),
  async (req, res) => {
    try {
      const dashboard = await getTenantPlatformDashboard(req.params.id);
      if (!dashboard) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      res.json(dashboard);
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.get(
  "/:id",
  requirePermission("platform.tenant.view"),
  async (req, res) => {
    try {
      const tenant = await getTenantById(req.params.id);
      if (!tenant) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      const [counts, health] = await Promise.all([
        pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM users WHERE tenant_id = $1) AS user_count,
           (SELECT COUNT(*)::int FROM unit_pendidikan WHERE tenant_id = $1) AS unit_count`,
        [tenant.id]
        ),
        getTenantHealth(tenant.id),
      ]);

      const profil = await pool.query(
        `SELECT id, nama_pesantren, alamat, telepon, logo_url
         FROM profil_pesantren
         WHERE tenant_id = $1
         LIMIT 1`,
        [tenant.id]
      );

      res.json({
        success: true,
        data: {
          ...tenant,
          user_count: counts.rows[0].user_count,
          unit_count: counts.rows[0].unit_count,
          health,
          profil: profil.rows[0] || null,
        },
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.patch(
  "/:id/status",
  requirePermission("platform.tenant.suspend"),
  async (req, res) => {
    try {
      const { status, reason } = req.body;
      const allowed = new Set(["active", "suspended", "inactive"]);

      if (!allowed.has(status)) {
        return res.status(400).json({
          success: false,
          error: "Status harus active, suspended, atau inactive",
        });
      }

      const suspendedAt =
        status === "active" ? null : new Date();
      const suspendedReason =
        status === "active" ? null : reason?.trim() || null;

      const result = await pool.query(
        `UPDATE tenants
         SET status = $1,
             suspended_at = $2,
             suspended_reason = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [status, suspendedAt, suspendedReason, req.params.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }

      await syncTenantDomainDisabledStatus(result.rows[0].id, status, req.platformUser.id);

      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

router.patch(
  "/:id",
  requirePermission("platform.tenant.update"),
  async (req, res) => {
    try {
      const tenant = await updateTenantFromPlatform(req.params.id, req.body || {});
      if (req.body?.status) {
        await syncTenantDomainDisabledStatus(tenant.id, tenant.status, req.platformUser.id);
      }
      res.json({ success: true, data: tenant });
    } catch (err) {
      console.error(err);
      res.status(err.status || 500).json({
        success: false,
        error: err.message,
        code: err.code || undefined,
      });
    }
  }
);

module.exports = router;
