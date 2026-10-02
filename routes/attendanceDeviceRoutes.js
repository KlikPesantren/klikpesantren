const express = require("express");
const deviceAuthMiddleware = require("../middleware/deviceAuthMiddleware");
const requireTenantFeature = require("../middleware/requireTenantFeature");
const attendanceDeviceController = require("../controllers/attendanceDeviceController");

const router = express.Router();

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
