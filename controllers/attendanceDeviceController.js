const {
  ingestOnlineRfidAttendance,
} = require("../services/attendanceDeviceAdapterService");
const {
  buildSnapshotPayload,
} = require("../services/attendanceDeviceSnapshotService");

async function ingestEvent(req, res) {
  try {
    const response = await ingestOnlineRfidAttendance({
      tenantId: req.tenantId,
      device: req.device,
      payload: req.body,
      receivedAt: new Date(),
    });
    return res.status(response.httpStatus).json(response.body);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error("[ATTENDANCE_DEVICE] ingestion failed:", error.code || "INTERNAL_ERROR");
    }
    return res.status(status).json({
      ok: false,
      code: error.code || "ATTENDANCE_INGESTION_FAILED",
      message: status >= 500 ? "Absensi gagal diproses" : error.message,
    });
  }
}

async function getSnapshot(req, res) {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  try {
    if (Object.keys(req.query || {}).length) {
      return res.status(400).json({ok: false, code: "SNAPSHOT_AUTHORITY_FIELDS_FORBIDDEN",
        message: "Scope snapshot ditentukan identitas device"});
    }
    const response = await buildSnapshotPayload({
      tenantId: req.tenantId,
      device: req.device,
      now: new Date(),
    });
    return res.status(200).json(response);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) {
      console.error("[ATTENDANCE_DEVICE] snapshot failed:", error.code || "INTERNAL_ERROR");
    }
    return res.status(status).json({
      ok: false,
      code: error.code || "ATTENDANCE_SNAPSHOT_FAILED",
      message: status >= 500 ? "Sinkronisasi data absensi gagal" : error.message,
    });
  }
}

module.exports = { getSnapshot, ingestEvent };
