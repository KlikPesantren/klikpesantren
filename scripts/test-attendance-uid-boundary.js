const assert = require("node:assert/strict");
const dbPath = require.resolve("../db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { end: async () => {} } };
const { canonicalAttendanceUid, attendanceUidSql } = require("../utils/attendanceRfidUid");
const { normalizeCredential, resolveAttendanceCredential } = require("../services/attendanceCredentialService");

(async () => {
  const admin = await import("../frontend/src/utils/attendanceRfidUid.js");
  for (const fixture of [" 0AB102FF ", "0ab102ff", "0001", "TEST-Only", ""])
    assert.equal(admin.canonicalAttendanceUid(fixture), canonicalAttendanceUid(fixture));
  assert.equal(canonicalAttendanceUid(" 0AB102FF "), "0ab102ff");
  assert.equal(canonicalAttendanceUid("0ab102ff"), "0ab102ff");
  assert.equal(canonicalAttendanceUid("TEST-Only"), "TEST-Only");
  assert.equal(normalizeCredential("rfid", "0AB102FF").credential, "0ab102ff");
  assert.throws(() => attendanceUidSql("request-input;DROP"));
  let queryCount = 0;
  const db = { async query(sql, params) {
    queryCount++;
    assert(sql.includes("tenant_id=$1") && sql.includes("LOWER(BTRIM(s.uid_rfid))"));
    assert.deepEqual(params, [123, "0ab102ff"]);
    return { rows: [{ id: 456, nama: "Synthetic" }] };
  }};
  for (const credential of ["0AB102FF", "0ab102ff"]) {
    assert.equal((await resolveAttendanceCredential({ tenantId: 123, credentialType: "rfid", credential }, db)).id, 456);
  }
  assert.equal(queryCount, 2);
  await assert.rejects(() => resolveAttendanceCredential({tenantId:123, credentialType:"rfid", credential:"0AB102FF"},
    {query: async () => ({rows:[{id:1},{id:2}]})}), e => e.code === "AMBIGUOUS_CREDENTIAL");
  console.log("PASS Attendance UID boundary: equivalent hex case, leading zeros/order, legacy nonhex exact, collision fail-closed, parameterized tenant scope");
  await require("../db").end();
})().catch(e => { console.error(e.message); process.exitCode = 1; });
