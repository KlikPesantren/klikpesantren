const express = require("express");
const deviceAuthMiddleware = require("../middleware/deviceAuthMiddleware");
const requireTenantFeature = require("../middleware/requireTenantFeature");
const attendanceDeviceController = require("../controllers/attendanceDeviceController");

const router = express.Router();

router.post(
  "/events",
  deviceAuthMiddleware,
  requireTenantFeature("absensi"),
  attendanceDeviceController.ingestEvent,
);

module.exports = router;
