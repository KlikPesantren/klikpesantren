const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const pool = require("../db");
const { resolveTenantForLogin } = require("../services/tenantService");

function equalPlaintext(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function credentialsFromRequest(req) {
  if (req.query?.device_id || req.query?.device_secret || req.query?.tenant_slug) {
    return { error: "DEVICE_CREDENTIALS_IN_QUERY_FORBIDDEN" };
  }
  const header = {
    deviceId: req.headers["x-device-id"],
    secret: req.headers["x-device-secret"],
    tenantSlug: req.headers["x-tenant-slug"],
  };
  const body = {
    deviceId: req.body?.device_id,
    secret: req.body?.device_secret,
    tenantSlug: req.body?.tenant_slug,
  };
  for (const key of ["deviceId", "secret", "tenantSlug"]) {
    if (header[key] && body[key] && String(header[key]) !== String(body[key])) {
      return { error: "AMBIGUOUS_DEVICE_CREDENTIALS" };
    }
  }
  return {
    deviceId: String(header.deviceId || body.deviceId || "").trim(),
    secret: String(header.secret || body.secret || ""),
    tenantSlug: String(header.tenantSlug || body.tenantSlug || "").trim() || null,
  };
}

async function secureDeviceAuthMiddleware(req, res, next) {
  try {
    const credentials = credentialsFromRequest(req);
    if (credentials.error) {
      return res.status(400).json({ success: false, code: credentials.error, error: "Kredensial device tidak valid" });
    }
    if (!credentials.deviceId || !credentials.secret) {
      return res.status(401).json({ success: false, code: "DEVICE_CREDENTIALS_REQUIRED", error: "Kredensial device wajib" });
    }

    const tenantResult = await resolveTenantForLogin(credentials.tenantSlug);
    if (tenantResult.error) {
      return res.status(tenantResult.status || 400).json({
        success: false,
        code: "DEVICE_TENANT_INVALID",
        error: tenantResult.error,
      });
    }
    const tenantId = Number(tenantResult.tenant.id);
    const { rows } = await pool.query(
      `SELECT d.id,d.tenant_id,d.unit_id,d.device_id,d.device_secret,d.device_secret_hash,
              d.nama_device,d.merchant_id,d.enabled,d.connection_state,d.status,
              d.firmware_version,d.last_ping,d.last_sync,d.location_resolution_status,
              m.tenant_id AS merchant_tenant_id,m.nama_merchant
       FROM devices d
       LEFT JOIN merchant_rfid m ON m.id=d.merchant_id
       WHERE d.tenant_id=$1 AND d.device_id=$2
       LIMIT 1`,
      [tenantId, credentials.deviceId],
    );
    const stored = rows[0];
    if (!stored) {
      return res.status(401).json({ success: false, code: "DEVICE_AUTH_INVALID", error: "Device tidak valid" });
    }

    const authenticated = stored.device_secret_hash
      ? await bcrypt.compare(credentials.secret, stored.device_secret_hash)
      : equalPlaintext(credentials.secret, stored.device_secret);
    if (!authenticated) {
      return res.status(401).json({ success: false, code: "DEVICE_AUTH_INVALID", error: "Device tidak valid" });
    }
    if (stored.enabled === false || stored.status === false ||
        stored.status === "false" || stored.status === "disabled") {
      return res.status(403).json({ success: false, code: "DEVICE_DISABLED", error: "Device nonaktif" });
    }
    if (stored.merchant_id && stored.merchant_tenant_id &&
        Number(stored.merchant_tenant_id) !== tenantId) {
      return res.status(403).json({ success: false, code: "DEVICE_MERCHANT_INVALID", error: "Merchant device tidak valid" });
    }

    const { device_secret: ignoredPlaintext, device_secret_hash: ignoredHash, ...safeDevice } = stored;
    void ignoredPlaintext;
    void ignoredHash;
    req.tenantId = tenantId;
    req.tenantSlug = tenantResult.tenant.slug;
    req.device = safeDevice;
    await pool.query(
      "UPDATE devices SET last_authenticated_at=NOW() WHERE tenant_id=$1 AND id=$2",
      [tenantId, stored.id],
    );
    return next();
  } catch (error) {
    console.error("[DEVICE_AUTH] authentication failed:", error.message);
    return res.status(500).json({ success: false, code: "DEVICE_AUTH_FAILED", error: "Device auth gagal" });
  }
}

secureDeviceAuthMiddleware.credentialsFromRequest = credentialsFromRequest;
module.exports = secureDeviceAuthMiddleware;
