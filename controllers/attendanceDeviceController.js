const {
  ingestOnlineRfidAttendance,
} = require("../services/attendanceDeviceAdapterService");

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
      console.error("[ATTENDANCE_DEVICE] ingestion failed:", error.code || error.message);
    }
    return res.status(status).json({
      ok: false,
      code: error.code || "ATTENDANCE_INGESTION_FAILED",
      message: status >= 500 ? "Absensi gagal diproses" : error.message,
    });
  }
}

module.exports = { ingestEvent };
