// Attendance UID input contract; no automatic rewrite of loaded/historical data.
export function canonicalAttendanceUid(value) {
  const uid = String(value ?? "").trim();
  return /^[0-9a-f]+$/i.test(uid) ? uid.toLowerCase() : uid;
}
