const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const requireTenantFeature = require("../middleware/requireTenantFeature");
const deviceAuthMiddleware = require("../middleware/deviceAuthMiddleware");

// Device ping — requires valid device credentials
router.post("/ping", deviceAuthMiddleware, requireTenantFeature("rfid"), async (req, res) => {
  try {
    const deviceId = req.device.device_id;
    const ip = req.ip;

    await pool.query(
      `UPDATE devices
       SET last_ping = NOW(), ip_address = $1, status = 'online', connection_state = 'online'
       WHERE tenant_id = $2 AND device_id = $3`,
      [ip, req.tenantId, deviceId]
    );

    res.json({ success: true, message: "Ping diterima" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get(
  "/",
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("rfid"),
  requirePermission.requireAnyPermission(["device.view", "rfid.view"]),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT d.*, m.nama_merchant
         FROM devices d
         LEFT JOIN merchant_rfid m ON m.id = d.merchant_id AND m.tenant_id = d.tenant_id
         WHERE d.tenant_id = $1
         ORDER BY d.id DESC`,
        [req.tenantId]
      );

      const safeRows = result.rows.map((row) => {
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
  }
);

console.log("DEVICE ROUTES READY");

module.exports = router;
