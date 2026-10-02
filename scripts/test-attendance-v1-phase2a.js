const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.DB_USER ||= "attendance-v1-test";
process.env.DB_HOST ||= "127.0.0.1";
process.env.DB_NAME ||= "attendance-v1-test";
process.env.DB_PASSWORD ||= "attendance-v1-test";

const secureDeviceAuth = require("../middleware/secureDeviceAuthMiddleware");
const {
  ingestOnlineRfidAttendance,
  parseCapturedAt,
  validatePayload,
} = require("../services/attendanceDeviceAdapterService");
const { resolveAttendanceCredential } = require("../services/attendanceCredentialService");
const { decideAttendanceTransition, MAX_OFFLINE_AGE_MS } = require("../services/attendanceStatusPolicy");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const adapterSource = read("services/attendanceDeviceAdapterService.js");
const credentialSource = read("services/attendanceCredentialService.js");
const authSource = read("middleware/secureDeviceAuthMiddleware.js");
const routeSource = read("routes/attendanceDeviceRoutes.js");
const serverSource = read("server.js");
const migration = read("migrations/092_attendance_v1_foundation.sql");
const walletController = read("controllers/rfidController.js");
const attendanceCore = read("services/attendanceCoreService.js");
const approvedEdc01Firmware = read("KasirRFID_V3 EDC01/KasirRFID_V3/KasirRFID_V3.ino");
const edc01Firmware = read("AttendanceRFID_EDC01/AttendanceRFID_EDC01.ino");

const approvedEdc01Keypad = Object.freeze({
  rowPins: [13, 14, 27, 26],
  colPins: [25, 33, 32, 15],
  keymap: [
    "1", "2", "3", "A",
    "4", "5", "6", "B",
    "7", "8", "9", "C",
    "*", "0", "#", "D",
  ],
});

function parseEdc01KeypadContract(source) {
  const rowPins = source.match(/byte\s+rowPins\s*\[\s*ROWS\s*\]\s*=\s*\{([^}]+)\}/s);
  const colPins = source.match(/byte\s+colPins\s*\[\s*COLS\s*\]\s*=\s*\{([^}]+)\}/s);
  const keymap = source.match(/char\s+keys\s*\[\s*ROWS\s*\]\s*\[\s*COLS\s*\]\s*=\s*\{([\s\S]*?)\n\s*\};/);
  assert(rowPins, "EDC01 rowPins definition missing");
  assert(colPins, "EDC01 colPins definition missing");
  assert(keymap, "EDC01 keymap definition missing");
  return {
    rowPins: [...rowPins[1].matchAll(/\d+/g)].map(([value]) => Number(value)),
    colPins: [...colPins[1].matchAll(/\d+/g)].map(([value]) => Number(value)),
    keymap: [...keymap[1].matchAll(/'([^'])'/g)].map(([, value]) => value),
  };
}

const capturedAt = new Date("2026-09-30T00:30:00.000Z");
const receivedAt = new Date("2026-09-30T00:31:00.000Z");
const defaultOccurrence = {
  id: 11,
  session_id: 7,
  display_name: "Ngaji Pagi",
  state: "active",
  window_start: "2026-09-30T00:00:00.000Z",
  window_end: "2026-09-30T01:00:00.000Z",
};

function attendanceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createHarness(options = {}) {
  const state = options.state || {
    events: new Map(),
    current: options.current || null,
    applyCount: 0,
    eventCount: 0,
    lastEventInput: null,
  };
  const occurrences = options.occurrences || [defaultOccurrence];
  const client = {
    async query(sql, params) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();
      if (normalized.includes("pg_advisory_xact_lock")) return { rows: [] };
      if (normalized.startsWith("SELECT * FROM attendance_events")) {
        const prior = state.events.get(params[1]);
        return { rows: prior ? [prior] : [] };
      }
      if (normalized.startsWith("SELECT ao.*,s.display_name")) {
        const occurrence = occurrences.find((item) => Number(item.id) === Number(params[1]));
        return { rows: occurrence ? [occurrence] : [] };
      }
      if (normalized.startsWith("SELECT * FROM attendance_results")) {
        return { rows: state.current ? [state.current] : [] };
      }
      throw new Error("Unexpected adapter query: " + normalized);
    },
  };
  const dependencies = {
    async resolveAttendanceCredential() {
      if (options.ambiguousCredential) throw attendanceError("AMBIGUOUS_CREDENTIAL");
      return options.unknownCredential ? null : { type: "santri", id: 41, name: "Santri Uji" };
    },
    async findCandidateSessions() {
      return options.sessions === undefined
        ? occurrences.map((item) => ({ id: item.session_id, occurrence_date: "2026-09-30" }))
        : options.sessions;
    },
    async resolveOccurrence({ sessionId }) {
      return occurrences.find((item) => Number(item.session_id) === Number(sessionId));
    },
    async assertParticipantEligible({ occurrenceId }) {
      if (options.eligible === false ||
          (options.eligibleIds && !options.eligibleIds.includes(Number(occurrenceId)))) {
        throw attendanceError("PARTICIPANT_NOT_ELIGIBLE");
      }
      return { membership_id: 1, unit_id: options.participantUnit || 179 };
    },
    async recordAttendanceEvent(input) {
      state.lastEventInput = input;
      const prior = state.events.get(input.eventKey);
      if (prior) return { duplicate: true, event: prior };
      const event = {
        id: ++state.eventCount,
        tenant_id: input.tenantId,
        event_key: input.eventKey,
        credential_reference: input.credentialReference,
        captured_at: input.capturedAt,
        received_at: input.receivedAt,
        outcome: input.outcome,
        provenance: input.provenance,
      };
      state.events.set(input.eventKey, event);
      return { duplicate: false, event };
    },
    async applyAttendanceResult(input) {
      const occurrence = occurrences.find((item) => Number(item.id) === Number(input.occurrenceId));
      const decision = decideAttendanceTransition({
        current: state.current,
        nextStatus: input.nextStatus,
        source: input.source,
        capturedAt: input.effectiveAt,
        receivedAt: input.receivedAt,
        windowStart: occurrence.window_start,
        windowEnd: occurrence.window_end,
        occurrenceState: occurrence.state,
      });
      if (decision.changed) {
        state.current = {
          status: input.nextStatus,
          source: input.source,
          protected_manual: false,
          auto_generated: false,
        };
        state.applyCount += 1;
      }
      return { changed: decision.changed, code: decision.code, result: state.current };
    },
  };
  const ingest = (overrides = {}) => ingestOnlineRfidAttendance({
    tenantId: 1,
    device: {
      id: 8,
      tenant_id: 1,
      unit_id: options.deviceUnit || 2,
      device_id: "EDC-01",
      enabled: true,
      status: "online",
    },
    payload: {
      event_id: overrides.event_id || "event-1",
      credential_type: "rfid",
      credential: "RFID-001",
      captured_at: (overrides.captured_at || capturedAt).toISOString?.() || overrides.captured_at,
      ...(overrides.extra || {}),
    },
    receivedAt: overrides.received_at || receivedAt,
  }, client, dependencies);
  return { client, dependencies, ingest, state };
}

async function main() {
  const checks = [];
  const pass = (name, fn) => checks.push(Promise.resolve().then(fn).then(() => name));

  pass("unauthenticated device rejected", () => {
    const parsed = secureDeviceAuth.credentialsFromRequest({ query: {}, headers: {}, body: {} });
    assert.equal(parsed.deviceId, "");
    assert(authSource.includes("DEVICE_CREDENTIALS_REQUIRED"));
  });
  pass("invalid secret rejected", () => {
    assert(authSource.includes("bcrypt.compare"));
    assert(authSource.includes("DEVICE_AUTH_INVALID"));
  });
  pass("disabled device rejected", async () => {
    const h = createHarness();
    await assert.rejects(() => ingestOnlineRfidAttendance({
      tenantId: 1,
      device: { id: 8, tenant_id: 1, device_id: "EDC-01", enabled: false },
      payload: { event_id: "x", credential_type: "rfid", credential: "x", captured_at: capturedAt.toISOString() },
      receivedAt,
    }, h.client, h.dependencies), (error) => error.code === "DEVICE_DISABLED");
  });
  pass("enabled authenticated device accepted", async () => {
    assert.equal((await createHarness().ingest()).body.code, "ATTENDANCE_RECORDED");
  });
  pass("tenant spoof rejected", () => {
    assert.throws(() => validatePayload({
      event_id: "x", credential_type: "rfid", credential: "x",
      captured_at: capturedAt.toISOString(), tenant_id: 999,
    }), (error) => error.code === "ATTENDANCE_AUTHORITY_FIELDS_FORBIDDEN");
  });
  pass("known tenant RFID resolves santri", async () => {
    const fake = { query: async (_sql, params) => {
      assert.deepEqual(params, [1, "RFID-001"]);
      return { rows: [{ id: 41, nama: "Santri Uji" }] };
    } };
    assert.deepEqual(await resolveAttendanceCredential({ tenantId: 1, credentialType: "rfid", credential: "RFID-001" }, fake),
      { type: "santri", id: 41, name: "Santri Uji" });
  });
  pass("unknown RFID recorded", async () => {
    const h = createHarness({ unknownCredential: true });
    assert.equal((await h.ingest()).body.code, "UNKNOWN_CREDENTIAL");
    assert.equal(h.state.lastEventInput.outcome, "rejected_unknown_credential");
  });
  pass("ambiguous RFID recorded", async () => {
    const h = createHarness({ ambiguousCredential: true });
    assert.equal((await h.ingest()).body.code, "AMBIGUOUS_CREDENTIAL");
    assert.equal(h.state.lastEventInput.outcome, "rejected_ambiguous_credential");
  });
  pass("cross-tenant credential impossible", () => {
    assert(credentialSource.includes("WHERE tenant_id=$1 AND uid_rfid=$2"));
  });
  pass("inactive membership not eligible", async () => {
    assert.equal((await createHarness({ eligible: false }).ingest()).body.code, "NOT_ELIGIBLE");
  });
  pass("inside window resolves occurrence", async () => {
    assert.equal((await createHarness().ingest()).body.session.id, 7);
  });
  pass("before window no session", async () => {
    assert.equal((await createHarness({ sessions: [] }).ingest()).body.code, "NO_ACTIVE_SESSION");
  });
  pass("after window no session", async () => {
    assert.equal((await createHarness({ sessions: [] }).ingest({ event_id: "after" })).body.code, "NO_ACTIVE_SESSION");
  });
  pass("cancelled occurrence ignored", async () => {
    const cancelled = { ...defaultOccurrence, state: "cancelled" };
    assert.equal((await createHarness({ occurrences: [cancelled] }).ingest()).body.code, "NO_ACTIVE_SESSION");
  });
  pass("ambiguous occurrence rejected", async () => {
    const second = { ...defaultOccurrence, id: 12, session_id: 8, display_name: "Sesi Kedua" };
    assert.equal((await createHarness({ occurrences: [defaultOccurrence, second] }).ingest()).body.code, "AMBIGUOUS_SESSION");
  });
  pass("combined multi-unit participant accepted", async () => {
    const h = createHarness({ deviceUnit: 2, participantUnit: 3 });
    assert.equal((await h.ingest()).body.code, "ATTENDANCE_RECORDED");
    assert(attendanceCore.includes("attendance_occurrence_units"));
  });
  pass("unrelated unit participant rejected", async () => {
    assert.equal((await createHarness({ eligible: false }).ingest({ event_id: "unit-no" })).body.code, "NOT_ELIGIBLE");
  });
  pass("first tap records H", async () => {
    const h = createHarness(); const result = await h.ingest();
    assert.equal(result.body.code, "ATTENDANCE_RECORDED"); assert.equal(result.body.status, "H");
    assert.equal(h.state.applyCount, 1);
  });
  pass("second event already attended", async () => {
    const h = createHarness(); await h.ingest();
    assert.equal((await h.ingest({ event_id: "event-2" })).body.code, "ALREADY_ATTENDED");
    assert.equal(h.state.applyCount, 1);
  });
  pass("same event id idempotent", async () => {
    const h = createHarness(); await h.ingest(); const replay = await h.ingest();
    assert.equal(replay.body.idempotent_replay, true); assert.equal(h.state.events.size, 1);
  });
  pass("concurrent authority is DB guarded", () => {
    assert(adapterSource.includes("attendance-device-event:"));
    assert(adapterSource.includes("attendance-result:"));
    assert(migration.includes("uq_attendance_events_idempotency"));
    assert(migration.includes("uq_attendance_results_person_occurrence"));
  });
  pass("concurrent different events converge to one result", async () => {
    const h = createHarness();
    let transactionQueue = Promise.resolve();
    const serialized = (eventId) => {
      const run = transactionQueue.then(() => h.ingest({ event_id: eventId }));
      transactionQueue = run.then(() => undefined, () => undefined);
      return run;
    };
    const responses = await Promise.all([serialized("concurrent-1"), serialized("concurrent-2")]);
    assert.deepEqual(responses.map((item) => item.body.code), ["ATTENDANCE_RECORDED", "ALREADY_ATTENDED"]);
    assert.equal(h.state.applyCount, 1);
  });
  for (const status of ["I", "S"]) pass(`${status} remains protected`, async () => {
    const h = createHarness({ current: { status, source: "admin", protected_manual: true, auto_generated: false } });
    assert.equal((await h.ingest({ event_id: `protected-${status}` })).body.code, "STATUS_PROTECTED");
    assert.equal(h.state.applyCount, 0);
  });
  pass("manual correction remains protected", async () => {
    const h = createHarness({ current: { status: "A", source: "manual", protected_manual: true, auto_generated: false } });
    assert.equal((await h.ingest()).body.code, "STATUS_PROTECTED");
  });
  pass("auto A reconciles to H", async () => {
    const h = createHarness({ current: { status: "A", source: "system", protected_manual: false, auto_generated: true } });
    assert.equal((await h.ingest()).body.code, "ATTENDANCE_RECORDED"); assert.equal(h.state.current.status, "H");
  });
  pass("captured and received timestamps remain separate", async () => {
    const h = createHarness(); await h.ingest();
    assert.notEqual(h.state.lastEventInput.capturedAt.getTime(), h.state.lastEventInput.receivedAt.getTime());
  });
  pass("older than seven days rejected", async () => {
    const old = new Date(receivedAt.getTime() - MAX_OFFLINE_AGE_MS - 1);
    const h = createHarness(); assert.equal((await h.ingest({ captured_at: old })).body.code, "EVENT_TOO_OLD");
    assert.equal(h.state.applyCount, 0);
  });
  pass("future timestamp rejected", async () => {
    const future = new Date(receivedAt.getTime() + 5 * 60 * 1000 + 1);
    assert.equal((await createHarness().ingest({ captured_at: future })).body.code, "INVALID_EVENT_TIME");
  });
  pass("small future clock skew accepted", async () => {
    const slightFuture = new Date(receivedAt.getTime() + 60 * 1000);
    const occurrence = {
      ...defaultOccurrence,
      window_end: "2026-09-30T01:30:00.000Z",
    };
    assert.equal((await createHarness({ occurrences: [occurrence] }).ingest({ captured_at: slightFuture })).body.code,
      "ATTENDANCE_RECORDED");
  });
  pass("invalid timestamp rejected", () => {
    assert.throws(() => parseCapturedAt("2026-09-30 07:00:00"), (error) => error.code === "INVALID_EVENT_TIME");
  });
  pass("event provenance contains device", async () => {
    const h = createHarness(); await h.ingest();
    assert.equal(h.state.lastEventInput.provenance.attendance_adapter.device_id, "EDC-01");
  });
  pass("rejected event outcome stored", async () => {
    const h = createHarness({ unknownCredential: true }); await h.ingest();
    assert.match(h.state.lastEventInput.outcome, /^rejected_/);
  });
  pass("duplicate event does not duplicate result", async () => {
    const h = createHarness(); await h.ingest(); await h.ingest();
    assert.equal(h.state.events.size, 1); assert.equal(h.state.applyCount, 1);
  });
  pass("route uses secure auth and canonical education plus RFID features", () => {
    assert(routeSource.includes("deviceAuthMiddleware"));
    assert(routeSource.includes('requireTenantFeature("pendidikan")'));
    assert(routeSource.includes('requireTenantFeature("rfid")'));
    assert(!routeSource.includes('requireTenantFeature("absensi")'));
    assert(serverSource.includes('"/attendance"'));
  });
  pass("EDC01 unknown RFID uses local UID paging without server logging", () => {
    assert(edc01Firmware.includes('showUnknownCredentialFeedback(scannedUid)'));
    assert(
      /handleAttendanceResponse\(\s*result,\s*pendingCapturedAt,\s*pendingUid\s*\)/s
        .test(edc01Firmware),
    );
    assert(edc01Firmware.includes('"BELUM TERDAFTAR"'));
    assert(edc01Firmware.includes('UNKNOWN_UID_PAGE_CHARS'));
    assert(edc01Firmware.includes('attendanceUnknownUid.substring('));
    assert(!edc01Firmware.includes('Serial.println(uid)'));
    assert(!edc01Firmware.includes('Serial.print(uid)'));
  });
  pass("EDC01 maps business and authorization responses explicitly", () => {
    for (const code of [
      "ATTENDANCE_RECORDED", "ALREADY_ATTENDED", "NO_ACTIVE_SESSION",
      "NOT_ELIGIBLE", "STATUS_PROTECTED", "AMBIGUOUS_CREDENTIAL",
      "AMBIGUOUS_SESSION", "EVENT_TOO_OLD", "INVALID_EVENT_TIME",
      "EVENT_ID_CONFLICT", "FEATURE_DISABLED", "DEVICE_AUTH_INVALID",
      "DEVICE_DISABLED",
    ]) {
      assert(edc01Firmware.includes(`code == "${code}"`), code);
    }
  });
  pass("EDC01 keypad pin order and logical layout remain hardware-compatible", () => {
    assert.deepEqual(
      parseEdc01KeypadContract(edc01Firmware),
      parseEdc01KeypadContract(approvedEdc01Firmware),
    );
    assert.deepEqual(parseEdc01KeypadContract(edc01Firmware), approvedEdc01Keypad);
    assert(edc01Firmware.includes("makeKeymap(keys)"));
  });
  pass("EDC01 dedicated runtime contains Attendance only", () => {
    for (const state of [
      "BOOT", "LOAD_CONFIG", "WIFI_CONNECTING", "TIME_SYNC",
      "READY", "CARD_READ", "SENDING", "RESULT",
    ]) {
      assert(edc01Firmware.includes(state), state);
    }
    for (const forbidden of [
      "CHECK_SALDO", "SHOW_PAYMENT", "SHOW_TOPUP", "payment_queue",
      "INPUT_PAYMENT", "INPUT_TOPUP", "nominalInput", "rfidPayment",
      "wallet_accounts", "wallet_transactions",
    ]) {
      assert(!edc01Firmware.includes(forbidden), forbidden);
    }
    assert(!edc01Firmware.includes("setInsecure"));
    assert(!edc01Firmware.includes("WiFi.config"));
    assert.equal((edc01Firmware.match(/WiFi\.begin\s*\(/g) || []).length, 1);
    assert(edc01Firmware.includes('prefs.begin(NVS_NAMESPACE, false)'));
    assert(edc01Firmware.includes('prefs.getULong64("att_counter", 0)'));
    assert(edc01Firmware.includes('prefs.putULong64("att_counter", next)'));
  });
  pass("connectivity is not authorization", () => {
    assert(!/connection_state\s*[!=]==?\s*["']online/.test(adapterSource));
  });
  pass("no device-selected authority", () => {
    for (const field of ["tenant_id", "person_id", "session_id", "status"]) {
      assert(FORBIDDEN_FIELD_PRESENT(field));
    }
  });
  pass("body limit enforced", () => {
    assert.throws(() => validatePayload({
      event_id: "x", credential_type: "rfid", credential: "x".repeat(2100),
      captured_at: capturedAt.toISOString(),
    }), (error) => error.code === "ATTENDANCE_PAYLOAD_TOO_LARGE");
  });
  pass("wallet RFID flow remains separate", () => {
    assert(walletController.includes("exports.lookupCard"));
    assert(walletController.includes("exports.rfidPayment"));
    assert(!adapterSource.includes("wallet_accounts"));
    assert(!adapterSource.includes("wallet_transactions"));
  });
  pass("guru RFID safely deferred", () => {
    assert(!credentialSource.includes("FROM guru"));
    assert(adapterSource.includes('personType: context.person.type'));
  });

  function FORBIDDEN_FIELD_PRESENT(field) {
    return adapterSource.includes(`"${field}"`);
  }

  const passed = await Promise.all(checks);
  assert(passed.length >= 36);
  console.log(`PASS Attendance V1 Phase 2A: ${passed.length} adapter/auth/credential/session/core/time/event/regression-contract checks`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
