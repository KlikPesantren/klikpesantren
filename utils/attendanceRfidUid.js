// Attendance-only credential boundary. Non-hex legacy credentials remain exact.
// Hex UIDs retain byte order/leading zeros; only surrounding whitespace/case change.
function canonicalAttendanceUid(value) {
  const uid = String(value ?? "").trim();
  return /^[0-9a-f]+$/i.test(uid) ? uid.toLowerCase() : uid;
}

function attendanceUidSql(column) {
  // column is a source-code identifier, NEVER request input.
  if (!/^[a-z_]+\.[a-z_]+$/.test(column)) throw new Error("Invalid UID SQL identifier");
  return `CASE WHEN BTRIM(${column}) ~ '^[0-9A-Fa-f]+$' THEN LOWER(BTRIM(${column})) ELSE BTRIM(${column}) END`;
}

module.exports = { canonicalAttendanceUid, attendanceUidSql };
