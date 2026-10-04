const pool = require("../db");
const {
  decideAttendanceTransition,
  maxFutureSkewMs,
  MAX_OFFLINE_AGE_MS,
} = require("./attendanceStatusPolicy");

function attendanceError(code, message, status = 409) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function inTransaction(work, client = null) {
  if (client) return work(client);
  const connection = await pool.connect();
  try {
    await connection.query("BEGIN");
    const value = await work(connection);
    await connection.query("COMMIT");
    return value;
  } catch (error) {
    await connection.query("ROLLBACK");
    throw error;
  } finally {
    connection.release();
  }
}

function requireId(value, code) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw attendanceError(code, "Identifier tidak valid", 400);
  return parsed;
}

function requireDate(value) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw attendanceError("INVALID_OCCURRENCE_DATE", "Tanggal occurrence tidak valid", 400);
  return date;
}

async function getSessionUnits(client, tenantId, sessionId) {
  const { rows } = await client.query(
    `SELECT unit_id FROM (
       SELECT unit_id FROM attendance_sessions WHERE tenant_id=$1 AND id=$2
       UNION
       SELECT unit_id FROM attendance_session_units WHERE tenant_id=$1 AND session_id=$2
     ) scoped ORDER BY unit_id`,
    [tenantId, sessionId],
  );
  return rows.map((row) => Number(row.unit_id));
}

async function setSessionAdditionalUnits({ tenantId, sessionId, unitIds }, client = null) {
  return inTransaction(async (db) => {
    const sid = requireId(sessionId, "INVALID_SESSION");
    if (!Array.isArray(unitIds) || unitIds.some((id) => String(id).toLowerCase() === "all")) {
      throw attendanceError("INVALID_SESSION_UNITS", "Unit sesi harus berupa daftar unit spesifik", 400);
    }
    const parsed = unitIds.map((id) => requireId(id, "INVALID_UNIT"));
    if (new Set(parsed).size !== parsed.length) throw attendanceError("DUPLICATE_SESSION_UNIT", "Unit sesi duplikat", 409);
    const session = await db.query(
      "SELECT unit_id FROM attendance_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
      [tenantId, sid],
    );
    if (!session.rows[0]) throw attendanceError("SESSION_NOT_FOUND", "Sesi tidak ditemukan", 404);
    if (parsed.includes(Number(session.rows[0].unit_id))) {
      throw attendanceError("PRIMARY_UNIT_DUPLICATE", "Unit pemilik tidak perlu ditambahkan ulang", 409);
    }
    if (parsed.length) {
      const units = await db.query(
        "SELECT id FROM unit_pendidikan WHERE tenant_id=$1 AND id=ANY($2::int[]) AND is_active=true",
        [tenantId, parsed],
      );
      if (units.rowCount !== parsed.length) throw attendanceError("CROSS_TENANT_UNIT", "Unit tidak valid untuk tenant", 403);
    }
    await db.query("DELETE FROM attendance_session_units WHERE tenant_id=$1 AND session_id=$2", [tenantId, sid]);
    if (parsed.length) {
      await db.query(
        `INSERT INTO attendance_session_units(tenant_id,session_id,unit_id)
         SELECT $1,$2,unit_id FROM UNNEST($3::int[]) unit_id`,
        [tenantId, sid, parsed],
      );
    }
    return getSessionUnits(db, tenantId, sid);
  }, client);
}

async function resolveOccurrence({ tenantId, sessionId, occurrenceDate }, client = null) {
  return inTransaction(async (db) => {
    const sid = requireId(sessionId, "INVALID_SESSION");
    const date = requireDate(occurrenceDate);
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attendance-occurrence:${tenantId}:${date}`]);
    const materialized=await db.query('SELECT * FROM attendance_occurrences WHERE tenant_id=$1 AND session_id=$2 AND occurrence_date=$3',[tenantId,sid,date]);
    if(materialized.rows[0])return materialized.rows[0];
    const { rows } = await db.query(
      `SELECT s.id,s.unit_id,s.start_time,s.end_time,s.active,t.attendance_timezone,
              COUNT(w.day_of_week)::int AS weekday_count,
              BOOL_OR(w.day_of_week=EXTRACT(DOW FROM $3::date)::int) AS scheduled_today
       FROM attendance_sessions s
       JOIN tenants t ON t.id=s.tenant_id
       LEFT JOIN attendance_session_weekdays w ON w.tenant_id=s.tenant_id AND w.session_id=s.id
       WHERE s.tenant_id=$1 AND s.id=$2
       GROUP BY s.id,s.unit_id,s.start_time,s.end_time,s.active,t.attendance_timezone`,
      [tenantId, sid, date],
    );
    const session = rows[0];
    if (!session) throw attendanceError("SESSION_NOT_FOUND", "Sesi tidak ditemukan", 404);
    if (!session.active) throw attendanceError("SESSION_INACTIVE", "Sesi tidak aktif");
    if (!session.start_time || !session.end_time || session.start_time >= session.end_time) {
      throw attendanceError("INVALID_SESSION_WINDOW", "Sesi wajib memiliki window satu hari yang valid", 422);
    }
    if (session.weekday_count > 0 && !session.scheduled_today) {
      throw attendanceError("SESSION_NOT_SCHEDULED", "Sesi tidak dijadwalkan pada tanggal ini", 409);
    }

    const candidate = await db.query(
      `SELECT (($1::date+$2::time) AT TIME ZONE $4)::timestamptz AS window_start,
              (($1::date+$3::time) AT TIME ZONE $4)::timestamptz AS window_end`,
      [date, session.start_time, session.end_time, session.attendance_timezone],
    );
    const window = candidate.rows[0];
    const unitIds = await getSessionUnits(db, tenantId, sid);
    const overlap = await db.query(
      `SELECT ao.id FROM attendance_occurrences ao
       WHERE ao.tenant_id=$1 AND ao.occurrence_date=$2 AND ao.session_id<>$3
         AND ao.state<>'cancelled' AND ao.window_start<$5 AND ao.window_end>$4
         AND EXISTS (
           SELECT 1 FROM attendance_occurrence_units occupied
           WHERE occupied.tenant_id=$1 AND occupied.occurrence_id=ao.id
             AND occupied.unit_id=ANY($6::int[])
         ) LIMIT 1`,
      [tenantId, date, sid, window.window_start, window.window_end, unitIds],
    );
    if (overlap.rows[0]) throw attendanceError("AMBIGUOUS_SESSION_WINDOW", "Window sesi bertumpuk untuk participant unit yang sama", 409);

    const inserted = await db.query(
      `INSERT INTO attendance_occurrences(
         tenant_id,session_id,occurrence_date,timezone,window_start,window_end
       ) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(tenant_id,session_id,occurrence_date) DO NOTHING
       RETURNING *`,
      [tenantId, sid, date, session.attendance_timezone, window.window_start, window.window_end],
    );
    let occurrence = inserted.rows[0];
    if (occurrence) {
      await db.query(
        `INSERT INTO attendance_occurrence_units(tenant_id,occurrence_id,unit_id)
         SELECT $1,$2,unit_id FROM UNNEST($3::int[]) unit_id
         ON CONFLICT(tenant_id,occurrence_id,unit_id) DO NOTHING`,
        [tenantId,occurrence.id,unitIds],
      );
    } else {
      const existing = await db.query(
        "SELECT * FROM attendance_occurrences WHERE tenant_id=$1 AND session_id=$2 AND occurrence_date=$3",
        [tenantId,sid,date],
      );
      occurrence = existing.rows[0];
    }
    return occurrence;
  }, client);
}

async function assertParticipantEligible({ tenantId, occurrenceId, personType, personId }, client = pool) {
  if (!["santri", "guru"].includes(personType)) throw attendanceError("INVALID_PERSON_TYPE", "Tipe participant tidak valid", 400);
  const oid = requireId(occurrenceId, "INVALID_OCCURRENCE");
  const pid = requireId(personId, "INVALID_PERSON");
  const base = `WITH allowed_units AS (
    SELECT unit_id FROM attendance_occurrence_units WHERE tenant_id=$1 AND occurrence_id=$2
  )`;
  const sql = personType === "santri"
    ? `${base} SELECT su.id AS membership_id,su.unit_id FROM santri_units su
       JOIN santri s ON s.tenant_id=su.tenant_id AND s.id=su.santri_id
       WHERE su.tenant_id=$1 AND su.santri_id=$3 AND su.status='active' AND su.left_at IS NULL
         AND su.unit_id IN(SELECT unit_id FROM allowed_units)
         AND EXISTS(SELECT 1 FROM santri_kelas_enrollments e WHERE e.tenant_id=su.tenant_id
           AND e.santri_unit_id=su.id AND e.status='active' AND e.end_date IS NULL)
         AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN('aktif','active','') LIMIT 1`
    : `${base} SELECT gu.id AS membership_id,gu.unit_id FROM guru_units gu
       JOIN guru g ON g.tenant_id=gu.tenant_id AND g.id=gu.guru_id
       WHERE gu.tenant_id=$1 AND gu.guru_id=$3 AND gu.status='active' AND gu.left_at IS NULL
         AND gu.unit_id IN(SELECT unit_id FROM allowed_units)
         AND LOWER(TRIM(COALESCE(g.status,'aktif'))) IN('aktif','active','') LIMIT 1`;
  const result = await client.query(sql, [tenantId, oid, pid]);
  if (!result.rows[0]) throw attendanceError("PARTICIPANT_NOT_ELIGIBLE", "Participant tidak eligible pada sesi ini", 403);
  return result.rows[0];
}

async function getProtectedLegacyResult(db,tenantId,personId,occurrence) {
  const legacy = await db.query(`SELECT a.status FROM absensi a
    WHERE a.tenant_id=$1 AND a.santri_id=$2 AND a.session_id=$3 AND a.tanggal=$4
    AND (a.status IN ('I','S') OR a.source IN ('admin','manual'))
    AND EXISTS(SELECT 1 FROM attendance_occurrence_units u
      WHERE u.tenant_id=$1 AND u.occurrence_id=$5 AND u.unit_id=a.unit_id) LIMIT 1`,
  [tenantId,personId,occurrence.session_id,occurrence.occurrence_date,occurrence.id]);
  return legacy.rows[0] ? {...legacy.rows[0],protected_manual:true,source:"admin"} : null;
}

async function applyAttendanceResult(input, client = null) {
  return inTransaction(async (db) => {
    const { tenantId, occurrenceId, personType, personId, nextStatus, source } = input;
    const oid = requireId(occurrenceId, "INVALID_OCCURRENCE");
    const pid = requireId(personId, "INVALID_PERSON");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attendance-result:${tenantId}:${oid}:${personType}:${pid}`]);
    const occurrenceResult = await db.query(
      "SELECT * FROM attendance_occurrences WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId, oid],
    );
    const occurrence = occurrenceResult.rows[0];
    if (!occurrence) throw attendanceError("OCCURRENCE_NOT_FOUND", "Occurrence tidak ditemukan", 404);
    if (occurrence.state === "cancelled") throw attendanceError("OCCURRENCE_CANCELLED", "Occurrence dibatalkan");
    await assertParticipantEligible({ tenantId, occurrenceId: oid, personType, personId: pid }, db);
    if (source === "device" && personType === "santri") {
      // Legacy manual records remain authoritative until an explicit Admin
      // correction. Never let new RFID/canonical rows hide an existing I/S.
      const legacy = await getProtectedLegacyResult(db,tenantId,pid,occurrence);
      if (legacy) return {changed:false,code:"MANUAL_RESULT_PROTECTED",result:legacy};
    }
    const existing = await db.query(
      `SELECT * FROM attendance_results
       WHERE tenant_id=$1 AND occurrence_id=$2 AND person_type=$3 AND person_id=$4 FOR UPDATE`,
      [tenantId, oid, personType, pid],
    );
    const current = existing.rows[0] || null;
    const decision = decideAttendanceTransition({
      current, nextStatus, source, adminExplicit: input.adminExplicit === true,
      capturedAt: input.effectiveAt, receivedAt: input.receivedAt || new Date(),
      windowStart: occurrence.window_start, windowEnd: occurrence.window_end,
      occurrenceState: occurrence.state,
    });
    if (!decision.allowed || !decision.changed) return { changed: false, code: decision.code, result: current };
    const values = [tenantId,oid,personType,pid,nextStatus,source,input.effectiveAt||null,
      input.sourceEventId||null,input.actorUserId||null,decision.protectedManual===true,
      decision.autoGenerated===true,JSON.stringify({...input.provenance,
        ...(source === "admin" || source === "manual" ? {previous_result:current ?
          {status:current.status,source:current.source,actor_user_id:current.actor_user_id} : null} : {})})];
    const result = current
      ? await db.query(
          `UPDATE attendance_results SET status=$5,source=$6,effective_at=$7,source_event_id=$8,
             actor_user_id=$9,protected_manual=$10,auto_generated=$11,provenance=$12::jsonb,updated_at=NOW()
           WHERE tenant_id=$1 AND occurrence_id=$2 AND person_type=$3 AND person_id=$4 RETURNING *`, values)
      : await db.query(
          `INSERT INTO attendance_results(tenant_id,occurrence_id,person_type,person_id,status,source,
             effective_at,source_event_id,actor_user_id,protected_manual,auto_generated,provenance)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING *`, values);
    return { changed: true, code: decision.code, result: result.rows[0] };
  }, client);
}

async function recordAttendanceEvent(input, client = null) {
  return inTransaction(async (db) => {
    const eventKey = String(input.eventKey || "").trim();
    const provider = String(input.provider || "").trim();
    if (!eventKey || !provider) throw attendanceError("INVALID_EVENT_IDENTITY", "Event key dan provider wajib", 400);
    const capturedAt = new Date(input.capturedAt);
    const receivedAt = new Date(input.receivedAt || Date.now());
    if (Number.isNaN(capturedAt.getTime()) || Number.isNaN(receivedAt.getTime())) {
      throw attendanceError("INVALID_EVENT_TIME", "Timestamp event tidak valid", 400);
    }
    const age = receivedAt.getTime() - capturedAt.getTime();
    const outcome = age < -maxFutureSkewMs() || age > MAX_OFFLINE_AGE_MS
      ? "rejected_offline_age"
      : String(input.outcome || "accepted");
    const inserted = await db.query(
      `INSERT INTO attendance_events(tenant_id,event_key,provider,device_id,credential_reference,
         person_type,person_id,occurrence_id,captured_at,received_at,outcome,provenance)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT(tenant_id,event_key) DO NOTHING RETURNING *`,
      [input.tenantId,eventKey,provider,input.deviceId||null,input.credentialReference||null,
        input.personType||null,input.personId||null,input.occurrenceId||null,capturedAt,receivedAt,
        outcome,JSON.stringify(input.provenance||{})],
    );
    if (inserted.rows[0]) return { duplicate: false, event: inserted.rows[0] };
    const existing = await db.query("SELECT * FROM attendance_events WHERE tenant_id=$1 AND event_key=$2", [input.tenantId,eventKey]);
    return { duplicate: true, event: existing.rows[0] };
  }, client);
}

async function closeOccurrence({ tenantId, occurrenceId, now = new Date() }, client = null) {
  return inTransaction(async (db) => {
    const oid = requireId(occurrenceId, "INVALID_OCCURRENCE");
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`attendance-close:${tenantId}:${oid}`]);
    const locked = await db.query(
      "SELECT * FROM attendance_occurrences WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,oid],
    );
    const occurrence = locked.rows[0];
    if (!occurrence) throw attendanceError("OCCURRENCE_NOT_FOUND", "Occurrence tidak ditemukan", 404);
    if (occurrence.state === "cancelled") return { changed:false, code:"OCCURRENCE_CANCELLED", inserted:0 };
    if (occurrence.state === "closed") return { changed:false, code:"ALREADY_CLOSED", inserted:0 };
    if (new Date(now) < new Date(occurrence.window_end)) {
      throw attendanceError("OCCURRENCE_WINDOW_OPEN", "Attendance window belum berakhir");
    }
    const inserted = await db.query(
      `WITH allowed_units AS (
         SELECT unit_id FROM attendance_occurrence_units WHERE tenant_id=$1 AND occurrence_id=$2
       ), eligible AS (
         SELECT DISTINCT 'santri'::varchar person_type,su.santri_id::bigint person_id
         FROM santri_units su JOIN santri s ON s.tenant_id=su.tenant_id AND s.id=su.santri_id
         WHERE su.tenant_id=$1 AND su.unit_id IN(SELECT unit_id FROM allowed_units)
           AND su.status='active' AND su.left_at IS NULL
           AND EXISTS(SELECT 1 FROM santri_kelas_enrollments e WHERE e.tenant_id=su.tenant_id
             AND e.santri_unit_id=su.id AND e.status='active' AND e.end_date IS NULL)
           AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN('aktif','active','')
         UNION
         SELECT DISTINCT 'guru'::varchar,gu.guru_id::bigint
         FROM guru_units gu JOIN guru g ON g.tenant_id=gu.tenant_id AND g.id=gu.guru_id
         WHERE gu.tenant_id=$1 AND gu.unit_id IN(SELECT unit_id FROM allowed_units)
           AND gu.status='active' AND gu.left_at IS NULL
           AND LOWER(TRIM(COALESCE(g.status,'aktif'))) IN('aktif','active','')
       )
       INSERT INTO attendance_results(tenant_id,occurrence_id,person_type,person_id,status,source,protected_manual,auto_generated)
       SELECT $1,$2,person_type,person_id,'A','system',false,true FROM eligible e
       WHERE e.person_type<>'santri' OR NOT EXISTS(
         SELECT 1 FROM absensi a JOIN attendance_occurrences o
           ON o.tenant_id=a.tenant_id AND o.session_id=a.session_id AND o.occurrence_date=a.tanggal
         JOIN attendance_occurrence_units ou ON ou.tenant_id=o.tenant_id AND ou.occurrence_id=o.id AND ou.unit_id=a.unit_id
         WHERE a.tenant_id=$1 AND o.id=$2 AND a.santri_id=e.person_id)
       ON CONFLICT(tenant_id,occurrence_id,person_type,person_id) DO NOTHING RETURNING id`,
      [tenantId,oid],
    );
    await db.query("UPDATE attendance_occurrences SET state='closed',closed_at=$3 WHERE tenant_id=$1 AND id=$2", [tenantId,oid,now]);
    await db.query(`UPDATE attendance_results SET provenance=(provenance-'pending_schedule_edit_event_id')||
      jsonb_build_object('finalized_schedule_edit_event_id',provenance->'pending_schedule_edit_event_id'),updated_at=NOW()
      WHERE tenant_id=$1 AND occurrence_id=$2 AND status='A' AND source='system' AND auto_generated=true
        AND protected_manual=false AND provenance ? 'pending_schedule_edit_event_id'`,[tenantId,oid]);
    return { changed:true, code:"OCCURRENCE_CLOSED", inserted:inserted.rowCount };
  }, client);
}

async function setSessionWeekdays({ tenantId, sessionId, weekdays }, client = null) {
  return inTransaction(async (db) => {
    const sid = requireId(sessionId, "INVALID_SESSION");
    if (!Array.isArray(weekdays)) throw attendanceError("INVALID_WEEKDAYS", "Weekday harus berupa daftar", 400);
    const parsed = weekdays.map(Number);
    if (parsed.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      throw attendanceError("INVALID_WEEKDAYS", "Weekday harus bernilai 0 sampai 6", 400);
    }
    if (new Set(parsed).size !== parsed.length) throw attendanceError("DUPLICATE_WEEKDAY", "Weekday duplikat", 409);
    const session = await db.query("SELECT id FROM attendance_sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,sid]);
    if (!session.rows[0]) throw attendanceError("SESSION_NOT_FOUND", "Sesi tidak ditemukan", 404);
    await db.query("DELETE FROM attendance_session_weekdays WHERE tenant_id=$1 AND session_id=$2", [tenantId,sid]);
    if (parsed.length) {
      await db.query(
        `INSERT INTO attendance_session_weekdays(tenant_id,session_id,day_of_week)
         SELECT $1,$2,day FROM UNNEST($3::smallint[]) day`,
        [tenantId,sid,parsed],
      );
    }
    return parsed;
  }, client);
}

async function cancelOccurrence({ tenantId, occurrenceId, reason }, client = null) {
  return inTransaction(async (db) => {
    const oid = requireId(occurrenceId, "INVALID_OCCURRENCE");
    const current = await db.query(
      "SELECT state FROM attendance_occurrences WHERE tenant_id=$1 AND id=$2 FOR UPDATE", [tenantId,oid],
    );
    if (!current.rows[0]) throw attendanceError("OCCURRENCE_NOT_FOUND", "Occurrence tidak ditemukan", 404);
    if (current.rows[0].state === "closed") throw attendanceError("OCCURRENCE_ALREADY_CLOSED", "Occurrence sudah ditutup");
    if (current.rows[0].state === "cancelled") return { changed:false, code:"ALREADY_CANCELLED" };
    await db.query(
      `UPDATE attendance_occurrences SET state='cancelled',cancellation_reason=$3
       WHERE tenant_id=$1 AND id=$2`, [tenantId,oid,String(reason||"").trim()||null],
    );
    return { changed:true, code:"OCCURRENCE_CANCELLED" };
  }, client);
}


module.exports = {
  getProtectedLegacyResult,
  MAX_OFFLINE_AGE_MS,
  applyAttendanceResult,
  assertParticipantEligible,
  attendanceError,
  cancelOccurrence,
  closeOccurrence,
  getSessionUnits,
  recordAttendanceEvent,
  resolveOccurrence,
  setSessionAdditionalUnits,
  setSessionWeekdays,
};
