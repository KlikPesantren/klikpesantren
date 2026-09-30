const pool = require("../db");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DEVICE_SECRET_BYTES = 32;
const DEVICE_SECRET_HASH_ROUNDS = 12;
const HASHED_SECRET_SENTINEL = "__HASHED_V1__";

async function createOneTimeDeviceSecret() {
  const plaintext = crypto.randomBytes(DEVICE_SECRET_BYTES).toString("hex");
  const hash = await bcrypt.hash(plaintext, DEVICE_SECRET_HASH_ROUNDS);
  return { plaintext, hash };
}

exports.registerDisabled = (req, res) => res.status(410).json({
  success: false,
  code: "DEVICE_ADMIN_PROVISIONING_REQUIRED",
  error: "Self-registration device dinonaktifkan; gunakan provisioning Admin",
});


/**
 * POST /rfid/device/provision — admin creates device for own tenant
 */
exports.provision = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const {
      device_id: deviceId,
      nama_device: namaDevice,
      merchant_id: merchantId,
      firmware_version: firmwareVersion,
    } = req.body;

    if (!deviceId || !String(deviceId).trim()) {
      return res.status(400).json({
        success: false,
        error: "device_id wajib",
      });
    }

    if (merchantId) {
      const { rows: merchantRows } = await pool.query(
        `SELECT id FROM merchant_rfid
         WHERE id = $1 AND tenant_id = $2`,
        [merchantId, tenantId]
      );
      if (merchantRows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Merchant tidak valid untuk tenant ini",
        });
      }
    }

    const existing = await pool.query(
      `SELECT id FROM devices WHERE tenant_id = $1 AND device_id = $2`,
      [tenantId, String(deviceId).trim()]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "Device ID sudah ada di tenant ini",
      });
    }

    const {
      plaintext: deviceSecret,
      hash: deviceSecretHash,
    } = await createOneTimeDeviceSecret();

    const { rows } = await pool.query(
      `INSERT INTO devices (
         device_id, device_secret, device_secret_hash, nama_device, merchant_id,
         status, enabled, connection_state, firmware_version, tenant_id, created_at
       )
       VALUES ($1, $2, $3, $4, $5, 'offline', true, 'offline', $6, $7, NOW())
       RETURNING id, device_id, nama_device, merchant_id, tenant_id,
                 status, enabled, connection_state, created_at`,
      [
        String(deviceId).trim(),
        HASHED_SECRET_SENTINEL,
        deviceSecretHash,
        namaDevice || String(deviceId).trim(),
        merchantId || null,
        firmwareVersion || null,
        tenantId,
      ]
    );

    res.status(201).json({
      success: true,
      registered: true,
      device_secret: deviceSecret,
      device: rows[0],
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.rotateSecret = async (req, res) => {
  try {
    const tenantId = Number(req.tenantId);
    const deviceId = String(req.params.deviceId || "").trim();
    if (!Number.isInteger(tenantId) || tenantId <= 0 || !deviceId) {
      return res.status(400).json({
        success: false,
        code: "INVALID_DEVICE_TARGET",
        error: "Target device tidak valid",
      });
    }

    const {
      plaintext: deviceSecret,
      hash: deviceSecretHash,
    } = await createOneTimeDeviceSecret();
    const { rows } = await pool.query(
      `UPDATE devices
       SET device_secret = $1,
           device_secret_hash = $2,
           secret_rotated_at = NOW()
       WHERE tenant_id = $3
         AND device_id = $4
       RETURNING id, device_id, nama_device, merchant_id, status, enabled,
                 connection_state, firmware_version, tenant_id, secret_rotated_at`,
      [HASHED_SECRET_SENTINEL, deviceSecretHash, tenantId, deviceId]
    );

    if (!rows[0]) {
      return res.status(404).json({
        success: false,
        code: "DEVICE_NOT_FOUND",
        error: "Device tidak ditemukan pada tenant aktif",
      });
    }

    res.set("Cache-Control", "no-store");
    res.set("Pragma", "no-cache");
    return res.json({
      success: true,
      rotated: true,
      device_secret: deviceSecret,
      device: rows[0],
    });
  } catch (err) {
    console.error("[RFID DEVICE SECRET ROTATION]", err.message);
    return res.status(500).json({
      success: false,
      code: "DEVICE_SECRET_ROTATION_FAILED",
      error: "Gagal merotasi credential device",
    });
  }
};

/**
 * POST /rfid/device/register — legacy self-register (tenant_slug wajib)
 */

exports.register = exports.registerDisabled;

exports.assignMerchant = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const { device_id: deviceId, merchant_id: merchantId } = req.body;

    const { rows: merchantRows } = await pool.query(
      `SELECT id FROM merchant_rfid WHERE id = $1 AND tenant_id = $2`,
      [merchantId, tenantId]
    );

    if (merchantRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Merchant tidak valid untuk tenant ini",
      });
    }

    const result = await pool.query(
      `UPDATE devices
       SET merchant_id = $1
       WHERE tenant_id = $2 AND device_id = $3
       RETURNING *`,
      [merchantId, tenantId, deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Device tidak ditemukan",
      });
    }

    const { device_secret: ignoredSecret, device_secret_hash: ignoredHash, ...safeDevice } = result.rows[0];
    void ignoredSecret; void ignoredHash;
    res.json({ success: true, data: safeDevice });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

exports.heartbeat = async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const deviceId = req.device.device_id;
    const ipAddress = req.ip;

    const result = await pool.query(
      `UPDATE devices
       SET status = 'online', connection_state = 'online', last_ping = NOW(), ip_address = $1
       WHERE tenant_id = $2 AND device_id = $3
       RETURNING *`,
      [ipAddress, tenantId, deviceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Device tidak ditemukan",
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * List devices for admin tenant
 */
exports.list = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, m.nama_merchant
       FROM devices d
       LEFT JOIN merchant_rfid m ON m.id = d.merchant_id AND m.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1
       ORDER BY d.id DESC`,
      [req.tenantId]
    );

    const safeRows = rows.map((row) => {
      const device = { ...row };
      delete device.device_secret;
      delete device.device_secret_hash;
      return device;
    });
    res.json({ success: true, data: safeRows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
};
