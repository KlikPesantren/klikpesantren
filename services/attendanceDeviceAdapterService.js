const crypto = require("crypto");
const pool = require("../db");
const {
  applyAttendanceResult,
  getProtectedLegacyResult,
  assertParticipantEligible,
  recordAttendanceEvent,
  resolveOccurrence,
} = require("./attendanceCoreService");
const {
  DEFAULT_MAX_FUTURE_SKEW_MS,
  decideAttendanceTransition,
  maxFutureSkewMs,
  MAX_OFFLINE_AGE_MS,
} = require("./attendanceStatusPolicy");
const {
  resolveAttendanceCredential,
} = require("./attendanceCredentialService");

const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  "tenant_id", "person_id", "person_type", "session_id", "occurrence_id", "status",
]);

function adapterError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function parseCapturedAt(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(raw)) {
    throw adapterError("INVALID_EVENT_TIME", "captured_at wajib berupa timestamp RFC3339 dengan zona waktu");
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw adapterError("INVALID_EVENT_TIME", "captured_at tidak valid");
  }
  return parsed;
}

function validatePayload(payload = {}) {
  const forbidden = Object.keys(payload).filter((key) => FORBIDDEN_AUTHORITY_FIELDS.has(key));
  if (forbidden.length) {
    throw adapterError(
      "ATTENDANCE_AUTHORITY_FIELDS_FORBIDDEN",
      "Tenant, participant, sesi, occurrence, dan status ditentukan server",
    );
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > 2048) {
    throw adapterError("ATTENDANCE_PAYLOAD_TOO_LARGE", "Payload absensi terlalu besar", 413);
  }
  const eventId = String(payload.event_id || "").trim();
  if (!eventId || eventId.length > 160) {
    throw adapterError("INVALID_EVENT_ID", "event_id wajib dan maksimal 160 karakter");
  }
  const credentialType = String(payload.credential_type || "").trim().toLowerCase();
  if (credentialType !== "rfid") {
    throw adapterError("UNSUPPORTED_CREDENTIAL_TYPE", "Phase 2A hanya mendukung RFID", 422);
  }
  const credential = String(payload.credential || "").trim();
  if (!credential || credential.length > 200) {
    throw adapterError("INVALID_CREDENTIAL", "Credential RFID tidak valid");
  }
  return {
    eventId,
    credentialType,
    credential,
    capturedAt: parseCapturedAt(payload.captured_at),
  };
}

function credentialReference(type, credential) {
  return `${type}:sha256:${crypto.createHash("sha256").update(credential, "utf8").digest("hex")}`;
}

function mapDecision(decision) {
  if (decision.changed && ["DEVICE_HADIR", "LATE_HADIR_RECONCILED"].includes(decision.code)) {
    return { code: "ATTENDANCE_RECORDED", message: "Hadir", ok: true, outcome: "accepted_recorded" };
  }
  if (decision.code === "ALREADY_HADIR") {
    return { code: "ALREADY_ATTENDED", message: "Kehadiran sudah tercatat", ok: true, outcome: "accepted_already_attended" };
  }
  if ([
    "IZIN_PROTECTED", "SAKIT_PROTECTED", "MANUAL_RESULT_PROTECTED", "EXISTING_RESULT_PROTECTED",
  ].includes(decision.code)) {
    return { code: "STATUS_PROTECTED", message: "Status absensi dilindungi", ok: true, outcome: "accepted_status_protected" };
  }
  throw adapterError("ATTENDANCE_POLICY_REJECTED", "Event ditolak kebijakan absensi", 409);
}

function responseEnvelope({ code, message, ok = false, httpStatus = 200, person = null, session = null, status = null, capturedAt = null }) {
  return {
    httpStatus,
    body: {
      ok,
      code,
      ...(person ? { person: { type: person.type, id: person.id, name: person.name } } : {}),
      ...(session ? { session: { id: Number(session.session_id), name: session.display_name } } : {}),
      ...(status ? { status } : {}),
      ...(capturedAt ? { captured_at: capturedAt.toISOString() } : {}),
      message,
    },
  };
}

async function inTransaction(work, client = null) {
  if (client) return work(client);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const result = await work(connection);
    await connection.query("COMMIT");
    return result;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

async function findCandidateSessions(client, tenantId, capturedAt, deviceUnitId) {
  const { rows } = await client.query(
    `WITH tenant_clock AS (
       SELECT attendance_timezone,
              ($2::timestamptz AT TIME ZONE attendance_timezone)::date AS local_date
       FROM tenants WHERE id=$1
     )
     SELECT s.id,clock.local_date::text AS occurrence_date
     FROM attendance_sessions s
     CROSS JOIN tenant_clock clock
     WHERE s.tenant_id=$1 AND s.active=true
       AND (s.unit_id=$3 OR EXISTS(SELECT 1 FROM attendance_session_units su
         WHERE su.tenant_id=s.tenant_id AND su.session_id=s.id AND su.unit_id=$3))
       AND s.start_time IS NOT NULL AND s.end_time IS NOT NULL AND s.start_time<s.end_time
       AND $2::timestamptz >= ((clock.local_date+s.start_time) AT TIME ZONE clock.attendance_timezone)
       AND $2::timestamptz < ((clock.local_date+s.end_time) AT TIME ZONE clock.attendance_timezone)
       AND (
         NOT EXISTS (SELECT 1 FROM attendance_session_weekdays w
           WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id)
         OR EXISTS (SELECT 1 FROM attendance_session_weekdays w
           WHERE w.tenant_id=s.tenant_id AND w.session_id=s.id
             AND w.day_of_week=EXTRACT(DOW FROM clock.local_date)::int)
       )
     ORDER BY s.id`,
    [tenantId, capturedAt, deviceUnitId],
  );
  return rows;
}

async function replayExistingEvent(existing, reference, capturedAt) {
  if (existing.credential_reference !== reference ||
      new Date(existing.captured_at).getTime() !== capturedAt.getTime()) {
    throw adapterError("EVENT_ID_CONFLICT", "event_id sudah dipakai untuk event berbeda", 409);
  }
  const stored = existing.provenance?.attendance_adapter?.response;
  if (!stored?.body || !Number.isInteger(stored.httpStatus)) {
    throw adapterError("EVENT_REPLAY_UNAVAILABLE", "Hasil event sebelumnya tidak tersedia", 409);
  }
  return {
    httpStatus: stored.httpStatus,
    body: { ...stored.body, idempotent_replay: true },
  };
}

async function recordAdapterEvent(client, context, response, outcome, recordEvent = recordAttendanceEvent) {
  const recorded = await recordEvent({
    tenantId: context.tenantId,
    eventKey: context.eventId,
    provider: "esp32_rfid_online",
    deviceId: context.device.id,
    credentialReference: context.reference,
    personType: context.person?.type || null,
    personId: context.person?.id || null,
    occurrenceId: context.occurrence?.id || null,
    capturedAt: context.capturedAt,
    receivedAt: context.receivedAt,
    outcome,
    provenance: {
      attendance_adapter: {
        credential_type: context.credentialType,
        device_id: context.device.device_id,
        response,
      },
    },
  }, client);
  return recorded;
}

async function rejectAndRecord(
  client, context, code, message, outcome, httpStatus = 200,
  recordEvent = recordAttendanceEvent,
) {
  const response = responseEnvelope({
    code, message, httpStatus, person: context.person,
    session: context.occurrence, capturedAt: context.capturedAt,
  });
  const recorded = await recordAdapterEvent(client, context, response, outcome, recordEvent);
  if (recorded.duplicate) {
    return replayExistingEvent(recorded.event, context.reference, context.capturedAt);
  }
  return response;
}

async function ingestOnlineRfidAttendance(
  { tenantId, device, payload, receivedAt = new Date() },
  client = null,
  dependencies = {},
) {
  const parsedTenantId = Number(tenantId);
  if (!Number.isInteger(parsedTenantId) || parsedTenantId <= 0 ||
      !device || Number(device.tenant_id) !== parsedTenantId) {
    throw adapterError("DEVICE_CONTEXT_INVALID", "Konteks device tidak valid", 403);
  }
  if (device.enabled === false || [false, "false", "disabled"].includes(device.status)) {
    throw adapterError("DEVICE_DISABLED", "Device nonaktif", 403);
  }
  const input = validatePayload(payload);
  const received = receivedAt instanceof Date ? receivedAt : new Date(receivedAt);
  if (Number.isNaN(received.getTime())) throw adapterError("INVALID_RECEIVED_TIME", "Waktu server tidak valid", 500);
  const reference = credentialReference(input.credentialType, input.credential);
  const resolveCredential = dependencies.resolveAttendanceCredential || resolveAttendanceCredential;
  const findSessions = dependencies.findCandidateSessions || findCandidateSessions;
  const resolveOccurrenceForSession = dependencies.resolveOccurrence || resolveOccurrence;
  const assertEligible = dependencies.assertParticipantEligible || assertParticipantEligible;
  const recordEvent = dependencies.recordAttendanceEvent || recordAttendanceEvent;
  const applyResult = dependencies.applyAttendanceResult || applyAttendanceResult;
  const decideTransition = dependencies.decideAttendanceTransition || decideAttendanceTransition;

  return inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `attendance-device-event:${parsedTenantId}:${input.eventId}`,
    ]);
    const prior = await db.query(
      "SELECT * FROM attendance_events WHERE tenant_id=$1 AND event_key=$2",
      [parsedTenantId, input.eventId],
    );
    if (prior.rows[0]) return replayExistingEvent(prior.rows[0], reference, input.capturedAt);

    const context = {
      tenantId: parsedTenantId,
      device,
      eventId: input.eventId,
      credentialType: input.credentialType,
      reference,
      capturedAt: input.capturedAt,
      receivedAt: received,
      person: null,
      occurrence: null,
    };
    const age = received.getTime() - input.capturedAt.getTime();
    if (age < -maxFutureSkewMs()) {
      return rejectAndRecord(db, context, "INVALID_EVENT_TIME", "captured_at terlalu jauh di masa depan", "rejected_future_time", 400, recordEvent);
    }
    if (age > MAX_OFFLINE_AGE_MS) {
      return rejectAndRecord(db, context, "EVENT_TOO_OLD", "Event melewati batas 7 hari", "rejected_offline_age", 409, recordEvent);
    }

    try {
      context.person = await resolveCredential({
        tenantId: parsedTenantId,
        credentialType: input.credentialType,
        credential: input.credential,
      }, db);
    } catch (error) {
      if (error.code !== "AMBIGUOUS_CREDENTIAL") throw error;
      return rejectAndRecord(
        db, context, "AMBIGUOUS_CREDENTIAL", "Kartu RFID terhubung ke lebih dari satu identitas",
        "rejected_ambiguous_credential", 409, recordEvent,
      );
    }
    if (!context.person) {
      return rejectAndRecord(db, context, "UNKNOWN_CREDENTIAL", "Kartu RFID tidak dikenal", "rejected_unknown_credential", 200, recordEvent);
    }

    const sessionCandidates = await findSessions(db, parsedTenantId, input.capturedAt, Number(device.unit_id));
    const occurrences = [];
    try {
      for (const session of sessionCandidates) {
        const occurrence = await resolveOccurrenceForSession({
          tenantId: parsedTenantId,
          sessionId: session.id,
          occurrenceDate: session.occurrence_date,
        }, db);
        if (occurrence.state !== "cancelled") occurrences.push(occurrence);
      }
    } catch (error) {
      if (error.code !== "AMBIGUOUS_SESSION_WINDOW") throw error;
      return rejectAndRecord(db, context, "AMBIGUOUS_SESSION", "Lebih dari satu sesi cocok", "rejected_ambiguous_session", 409, recordEvent);
    }
    if (!occurrences.length) {
      return rejectAndRecord(db, context, "NO_ACTIVE_SESSION", "Tidak ada sesi absensi aktif", "rejected_no_active_session", 200, recordEvent);
    }

    const eligible = [];
    for (const occurrence of occurrences) {
      try {
        await assertEligible({
          tenantId: parsedTenantId,
          occurrenceId: occurrence.id,
          personType: context.person.type,
          personId: context.person.id,
        }, db);
        eligible.push(occurrence);
      } catch (error) {
        if (error.code !== "PARTICIPANT_NOT_ELIGIBLE") throw error;
      }
    }
    if (!eligible.length) {
      return rejectAndRecord(db, context, "NOT_ELIGIBLE", "Participant tidak eligible pada sesi", "rejected_not_eligible", 200, recordEvent);
    }
    if (eligible.length > 1) {
      return rejectAndRecord(db, context, "AMBIGUOUS_SESSION", "Lebih dari satu sesi cocok", "rejected_ambiguous_session", 409, recordEvent);
    }

    const occurrenceResult = await db.query(
      `SELECT ao.*,s.display_name
       FROM attendance_occurrences ao
       JOIN attendance_sessions s ON s.tenant_id=ao.tenant_id AND s.id=ao.session_id
       WHERE ao.tenant_id=$1 AND ao.id=$2 FOR UPDATE OF ao`,
      [parsedTenantId, eligible[0].id],
    );
    context.occurrence = occurrenceResult.rows[0];
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `attendance-result:${parsedTenantId}:${context.occurrence.id}:${context.person.type}:${context.person.id}`,
    ]);
    const currentResult = await db.query(
      `SELECT * FROM attendance_results
       WHERE tenant_id=$1 AND occurrence_id=$2 AND person_type=$3 AND person_id=$4
       FOR UPDATE`,
      [parsedTenantId, context.occurrence.id, context.person.type, context.person.id],
    );
    const protectedLegacy = context.person.type === "santri"
      ? await getProtectedLegacyResult(db,parsedTenantId,context.person.id,context.occurrence) : null;
    const decision = decideTransition({
      current: protectedLegacy || currentResult.rows[0] || null,
      nextStatus: "H",
      source: "device",
      capturedAt: input.capturedAt,
      receivedAt: received,
      windowStart: context.occurrence.window_start,
      windowEnd: context.occurrence.window_end,
      occurrenceState: context.occurrence.state,
    });
    const mapped = mapDecision(decision);
    const response = responseEnvelope({
      code: mapped.code,
      message: mapped.message,
      ok: mapped.ok,
      person: context.person,
      session: context.occurrence,
      status: decision.changed ? "H" : protectedLegacy?.status || currentResult.rows[0]?.status || "H",
      capturedAt: input.capturedAt,
    });
    const recorded = await recordAdapterEvent(db, context, response, mapped.outcome, recordEvent);
    if (recorded.duplicate) return replayExistingEvent(recorded.event, reference, input.capturedAt);

    const applied = await applyResult({
      tenantId: parsedTenantId,
      occurrenceId: context.occurrence.id,
      personType: context.person.type,
      personId: context.person.id,
      nextStatus: "H",
      source: "device",
      effectiveAt: input.capturedAt,
      receivedAt: received,
      sourceEventId: recorded.event.id,
      provenance: { adapter: "esp32_rfid_online", device_id: device.device_id },
    }, db);
    const appliedMapped = mapDecision({ changed: applied.changed, code: applied.code });
    if (appliedMapped.code !== mapped.code) {
      throw adapterError("ATTENDANCE_DECISION_CHANGED", "Keputusan absensi berubah dalam transaksi", 409);
    }
    return response;
  }, client);
}

module.exports = {
  DEFAULT_MAX_FUTURE_SKEW_MS,
  FORBIDDEN_AUTHORITY_FIELDS,
  adapterError,
  credentialReference,
  findCandidateSessions,
  ingestOnlineRfidAttendance,
  mapDecision,
  maxFutureSkewMs,
  parseCapturedAt,
  validatePayload,
};
