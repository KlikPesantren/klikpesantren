const pool = require("../db");
const { canonicalAttendanceUid, attendanceUidSql } = require("../utils/attendanceRfidUid");

function credentialError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizeCredential(type, value) {
  const credentialType = String(type || "").trim().toLowerCase();
  if (credentialType !== "rfid") {
    throw credentialError(
      "UNSUPPORTED_CREDENTIAL_TYPE",
      "Credential type belum didukung untuk absensi",
      422,
    );
  }
  const credential = canonicalAttendanceUid(value);
  if (!credential || credential.length > 200) {
    throw credentialError("INVALID_CREDENTIAL", "Credential RFID tidak valid");
  }
  return { credentialType, credential };
}

async function resolveAttendanceCredential(
  { tenantId, credentialType, credential },
  client = pool,
) {
  const normalized = normalizeCredential(credentialType, credential);
  const { rows } = await client.query(
    `SELECT id,nama
     FROM santri s
     WHERE tenant_id=$1 AND (${attendanceUidSql("s.uid_rfid")})=$2
     ORDER BY id
     LIMIT 2`,
    [tenantId, normalized.credential],
  );
  if (rows.length > 1) {
    throw credentialError(
      "AMBIGUOUS_CREDENTIAL",
      "Credential RFID terhubung ke lebih dari satu identitas",
      409,
    );
  }
  if (!rows[0]) return null;
  return {
    type: "santri",
    id: Number(rows[0].id),
    name: rows[0].nama,
  };
}

module.exports = {
  credentialError,
  normalizeCredential,
  resolveAttendanceCredential,
};
