const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const requireTenantFeature = require("../middleware/requireTenantFeature");
const deviceAuthMiddleware = require("../middleware/deviceAuthMiddleware");
const deviceController = require("../controllers/rfidDeviceController");
const pairing = require("../controllers/attendancePairingController");

const adminDevice = [
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("rfid"),
  requirePermission.requireAnyPermission(["device.view", "rfid.view", "device.manage", "rfid.manage"]),
];

const attendanceAdmin = [authMiddleware,tenantMiddleware,
  requireTenantFeature("pendidikan"),requireTenantFeature("rfid"),requirePermission("rfid.manage")];
router.get("/attendance", ...adminDevice, requireTenantFeature("pendidikan"), pairing.list);
router.post("/attendance", ...attendanceAdmin, pairing.create);
router.patch("/attendance/:deviceId", ...attendanceAdmin, pairing.edit);
router.post("/attendance/:deviceId/adopt", ...attendanceAdmin, pairing.adopt);
router.post("/attendance/:deviceId/pairing", ...attendanceAdmin, pairing.reissue);

// Admin provision + list
router.post(
  "/provision",
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("rfid"),
  requirePermission("rfid.manage"),
  deviceController.provision
);
router.post(
  "/:deviceId/rotate-secret",
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("rfid"),
  requirePermission("rfid.manage"),
  deviceController.rotateSecret
);

router.get("/", ...adminDevice, deviceController.list);

// Device-authenticated routes (tenant from device credentials)
router.post("/register", deviceController.registerDisabled);
router.put(
  "/assign",
  authMiddleware,
  tenantMiddleware,
  requireTenantFeature("rfid"),
  requirePermission("rfid.manage"),
  deviceController.assignMerchant
);
router.post("/heartbeat", deviceAuthMiddleware, requireTenantFeature("rfid"), deviceController.heartbeat);

module.exports = router;
