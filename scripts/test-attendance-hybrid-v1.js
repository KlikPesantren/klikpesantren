const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const dbPath = require.resolve("../db");
const queries = [];
let deviceDisabled = false, featuresEnabled = true, unitActive = true;
const testSecret = "synthetic-hybrid-test-only";
const fixture = {
  timezone: "Asia/Jakarta", sessions: [{id: 9, display_name: "Test session", weekdays: [1,2]}],
  windows: [{session_id: 9, occurrence_date: "2026-10-02", window_start: "2026-10-02T00:00:00Z",
    window_end: "2026-10-02T01:00:00Z", state: "cancelled"}],
  credentials: [{value: "TEST-CARD", identity_count: 1, eligible: true}],
};
const connection = {
  release() {},
  async query(sql, params) {
    queries.push({sql, params});
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return {rows: []};
    assert.equal(params[0], 1); assert.equal(params[1], 2);
    if (sql.startsWith("SELECT t.attendance_timezone")) return {rows: unitActive ? [{attendance_timezone: fixture.timezone}] : []};
    if (sql.startsWith("SELECT s.id,s.code")) return {rows: fixture.sessions};
    if (sql.startsWith("WITH clock")) return {rows: fixture.windows};
    if (sql.startsWith("WITH identities")) return {rows: fixture.credentials};
    throw new Error("Unexpected snapshot query");
  },
};
require.cache[dbPath] = {id: dbPath, filename: dbPath, loaded: true, exports: {
  connect: async () => connection,
  async query(sql, params) {
    if (sql.includes("FROM devices d")) {
      if (params[0] !== 1 || params[1] !== "TEST-DEVICE") return {rows: []};
      return {rows: [{id: 1, tenant_id: 1, unit_id: 2, device_id: "TEST-DEVICE",
        device_secret_hash: require("bcryptjs").hashSync(testSecret, 4), enabled: !deviceDisabled}]};
    }
    assert(sql.startsWith("UPDATE devices SET last_authenticated_at"));
    return {rows:[]}; // Synthetic auth telemetry only; no live DB.
  },
}};
function stub(file, exports) {
  const id = require.resolve(file); require.cache[id] = {id,filename:id,loaded:true,exports};
}
stub("../services/tenantService", {resolveTenantForLogin: async slug => ({tenant:{id:slug === "test" ? 1 : 2,slug}})});
stub("../services/tenantFeatureService", {isFeatureEnabled: async (_tenant,key) => {
  assert(["pendidikan","rfid"].includes(key)); return featuresEnabled;
}});
const service = require("../services/attendanceDeviceSnapshotService");
const device = {tenant_id: 1, unit_id: 2, enabled: true};
async function main() {
  for (const invalid of [{tenant_id: 2, unit_id: 2}, {tenant_id: 1}, {...device, enabled:false}])
    assert.throws(() => service.requireDeviceContext(1, invalid));
  const now = new Date("2026-10-02T00:30:00Z");
  const payload = await service.buildSnapshotPayload({tenantId:1, device, now});
  assert.equal(payload.checksum, crypto.createHash("sha256").update(payload.snapshot_json).digest("hex"));
  const result = JSON.parse(payload.snapshot_json);
  assert.equal(result.authorized_unit_id, 2);
  assert.equal(result.valid_until_epoch - result.generated_epoch, 604800);
  assert.equal(result.refresh_after_epoch - result.generated_epoch, 900);
  assert.equal(result.windows[0].state, "cancelled");
  assert.equal(result.credentials[0].eligible, true);
  assert.deepEqual(Object.keys(result.credentials[0]).sort(), ["display_name","eligible","person_type","status","type","value"]);
  assert(queries[0].sql.includes("REPEATABLE READ READ ONLY"));
  assert.equal(queries.at(-1).sql, "COMMIT");
  assert(queries.some(q => q.sql.includes("attendance_occurrence_units") && q.sql.includes("ou.unit_id=$2")));
  assert(queries.some(q => q.sql.includes("other.tenant_id=s.tenant_id") && q.sql.includes("other.value=s.value") && q.sql.includes("LOWER(BTRIM(s.uid_rfid))")));
  assert(queries.every(q => !/INSERT|UPDATE|DELETE|wallet|pembayaran/i.test(q.sql)));
  fixture.credentials[0].identity_count = 2;
  const ambiguous = JSON.parse((await service.buildSnapshotPayload({tenantId:1, device, now})).snapshot_json);
  assert.equal(ambiguous.credentials[0].status, "ambiguous"); assert.equal(ambiguous.credentials[0].eligible, false);
  fixture.credentials = Array.from({length:201}, () => ({value:"TEST",identity_count:1,eligible:true}));
  await assert.rejects(() => service.buildSnapshotPayload({tenantId:1, device, now}), e => e.code === "SNAPSHOT_CREDENTIAL_LIMIT");
  assert.equal(queries.at(-1).sql, "ROLLBACK");
  fixture.credentials = [{value:"TEST-CARD",identity_count:1,eligible:true}];
  const express = require("express");
  const app = express(); app.use(express.json());
  app.use("/attendance", require("../routes/attendanceDeviceRoutes"));
  const server = app.listen(0,"127.0.0.1");
  await new Promise(resolve => server.once("listening",resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/attendance/device/snapshot`;
  const headers = {"X-Device-Id":"TEST-DEVICE","X-Device-Secret":testSecret,"X-Tenant-Slug":"test"};
  try {
    assert.equal((await fetch(endpoint)).status,401);
    assert.equal((await fetch(endpoint,{headers:{...headers,"X-Device-Secret":"wrong"}})).status,401);
    assert.equal((await fetch(endpoint,{headers:{...headers,"X-Device-Id":"foreign-device"}})).status,401);
    assert.equal((await fetch(endpoint,{headers:{...headers,"X-Tenant-Slug":"foreign"}})).status,401);
    deviceDisabled = true; assert.equal((await fetch(endpoint,{headers})).status,403); deviceDisabled = false;
    featuresEnabled = false; assert.equal((await fetch(endpoint,{headers})).status,403); featuresEnabled = true;
    unitActive = false; assert.equal((await fetch(endpoint,{headers})).status,403); unitActive = true;
    assert.equal((await fetch(endpoint+"?tenant_id=999&unit_id=999",{headers})).status,400);
    const response = await fetch(endpoint,{headers}); assert.equal(response.status,200);
    assert.equal(response.headers.get("cache-control"),"no-store");
    const body = await response.text(); assert(!body.includes(testSecret) && !body.includes("device_secret"));
    assert.equal(JSON.parse(JSON.parse(body).snapshot_json).authorized_unit_id,2);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const root = path.join(__dirname, "..");
  const firmware = fs.readFileSync(path.join(root,"firmware/Absensi_RFID/Absensi_RFID.ino"),"utf8");
  const runtime = fs.readFileSync(path.join(root,"firmware/Absensi_RFID/AttendanceHybridRuntime.h"),"utf8");
  const route = fs.readFileSync(path.join(root,"routes/attendanceDeviceRoutes.js"),"utf8");
  assert.equal((firmware.match(/rfid\.uid\.uidByte\[index\]/g) || []).length, 1);
  assert(firmware.includes('snprintf(byteText, sizeof(byteText), "%02x", rfid.uid.uidByte[index])'));
  assert(!firmware.includes('"%02X"'));
  assert(/String uid = readRfidUid\(\);[\s\S]*?pendingUid = uid;/.test(firmware));
  assert(firmware.includes('request["credential"] = pendingUid;'));
  assert.equal((firmware.match(/hybrid\.validate\(pendingUid,/g) || []).length, 1);
  assert(firmware.includes('showUnknownCredentialFeedback(scannedUid);'));
  assert(firmware.includes('attendanceUnknownUid = scannedUid;'));
  assert(firmware.includes('attendanceUnknownUid.substring('));
  assert(firmware.includes('start + UNKNOWN_UID_PAGE_CHARS'));
  assert(route.includes('"/device/snapshot"'));
  assert.equal((route.match(/requireTenantFeature\("pendidikan"\)/g)||[]).length, 2);
  assert.equal((route.match(/requireTenantFeature\("rfid"\)/g)||[]).length, 2);
  assert(firmware.includes("sntp_set_time_sync_notification_cb(onTimeSync)"));
  assert(/case RuntimeState::WIFI_CONNECTING:[\s\S]*?updateWifiConnecting\(\);\s*if \(WiFi.status\(\) != WL_CONNECTED\) showReady\(\);/.test(firmware));
  assert(firmware.includes("xTaskCreate(networkWorker"));
  assert(firmware.includes("networkRevision != configRevision"));
  assert(firmware.includes("hybrid.append(pendingRequestBody"));
  assert(!firmware.includes("NetworkJob::TAP"));
  const tap = firmware.match(/void prepareAttendanceRequest\(\) \{[\s\S]*?\n\}/)[0];
  assert(tap.includes("queuePendingTap()") && !tap.includes("startNetworkJob"));
  assert(!firmware.includes('showScreen("SINKRONISASI"'));
  assert(/if \(hybrid.append[\s\S]*?showAttendanceFeedback\(name, "BERHASIL"/.test(firmware));
  assert(firmware.includes('if (feedbackActive) return;'));
  assert(runtime.includes('queueStore.load(raw, false)'));
  assert(!firmware.includes("setInsecure"));
  assert(!/Serial\.(print|println)\([^;]*(pendingUid|deviceSecret|wifiPassword)/.test(firmware));
  assert(!/wallet|payment_queue|pembayaran/.test(runtime));
  console.log("PASS hybrid backend: scoped read-only snapshot, bounds, cancellation, ambiguity, checksum, auth context, rollback and firmware security contracts");
}
main().catch(e => {console.error(e); process.exitCode=1;});
