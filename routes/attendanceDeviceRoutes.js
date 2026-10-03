const express = require("express");
const deviceAuthMiddleware = require("../middleware/deviceAuthMiddleware");
const requireTenantFeature = require("../middleware/requireTenantFeature");
const attendanceDeviceController = require("../controllers/attendanceDeviceController");
const pairing = require("../controllers/attendancePairingController");

const router = express.Router();
router.use("/admin",require("../middleware/authMiddleware"),require("../middleware/tenantMiddleware"),
  requireTenantFeature("pendidikan"),require("./attendanceAdminRoutes"));

// Device knows no tenant authority before this one-time exchange.
router.post("/device/pair", pairing.pairingRateLimit, pairing.redeem);

router.get(
  "/device/snapshot",
  deviceAuthMiddleware,
  requireTenantFeature("pendidikan"),
  requireTenantFeature("rfid"),
  attendanceDeviceController.getSnapshot,
);

router.post(
  "/events",
  deviceAuthMiddleware,
  requireTenantFeature("pendidikan"),
  requireTenantFeature("rfid"),
  attendanceDeviceController.ingestEvent,
);

module.exports = router;
