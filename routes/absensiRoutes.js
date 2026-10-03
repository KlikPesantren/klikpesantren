const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  resolveKelasScopeAccess,
  isKelasAllowed,
  kelasScopeSql,
} = require("../middleware/kelasScope");
const {
  getActiveStudentContext,
  getAttendanceSessionInUnit,
} = require("../services/academicUnitService");
const { saveManualAttendanceBatch } = require("../services/attendanceManualService");
const { attendanceReadSql } = require("../services/attendanceReadSql");

const ATTENDANCE_STATUSES = new Set(["H", "I", "S", "A"]);
const MAX_BATCH_SIZE = 5000;

function normalizeAttendanceDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text
    ? null
    : text;
}

function normalizeBatchEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw Object.assign(new Error("Data absensi wajib diisi"), { status: 400, code: "ATTENDANCE_ENTRIES_REQUIRED" });
  }
  if (entries.length > MAX_BATCH_SIZE) {
    throw Object.assign(new Error(`Maksimal ${MAX_BATCH_SIZE} entri per simpan`), { status: 413, code: "ATTENDANCE_BATCH_TOO_LARGE" });
  }

  const unique = new Map();
  for (const raw of entries) {
    const santriId = Number(raw?.santri_id);
    const sessionId = Number(raw?.session_id);
    const tanggal = normalizeAttendanceDate(raw?.tanggal);
    const status = String(raw?.status || "").trim().toUpperCase();
    if (!Number.isInteger(santriId) || santriId <= 0 ||
        !Number.isInteger(sessionId) || sessionId <= 0 || !tanggal ||
        !ATTENDANCE_STATUSES.has(status)) {
      throw Object.assign(new Error("Format entri absensi tidak valid"), { status: 400, code: "INVALID_ATTENDANCE_ENTRY" });
    }
    unique.set(`${santriId}|${tanggal}|${sessionId}`, {
      santri_id: santriId,
      tanggal,
      session_id: sessionId,
      status,
    });
  }
  return [...unique.values()];
}

async function loadAccess(req, res) {
  const access = await resolveKelasScopeAccess(req);
  if (access.denied) {
    res.status(access.status || 403).json({
      success: false,
      error: access.error || "Akses ditolak",
    });
    return null;
  }
  return access;
}

async function assertSantriAllowed(access, santriId) {
  if (access.mode === "ALL") {
    return { ok: false, status: 400, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" };
  }
  try {
    const context = await getActiveStudentContext(access.tenantId, santriId, access.unitId);
    if (!context.kelas_id || !isKelasAllowed(access, context.kelas_id)) {
      return { ok: false, status: 403, error: "Akses kelas ditolak" };
    }
    return { ok: true, context };
  } catch (error) {
    return { ok: false, status: error.status || 403, error: error.message, code: error.code };
  }
}

router.get("/kelas", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    const params = [access.tenantId];
    let query = `SELECT id, nama_kelas
                 FROM kelas
                 WHERE tenant_id = $1`;

    const scope = kelasScopeSql(access, "id", 2);
    query += scope.clause;
    params.push(...scope.params);
    query += " ORDER BY id ASC";

    const { rows } = await pool.query(query, params);
    res.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        can_manage: Boolean(access.canManage),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/santri", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    const kelasId = req.query.kelas_id ? Number(req.query.kelas_id) : null;
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    const params = [access.tenantId, access.unitId];
    let query = `SELECT s.id, s.nis, s.nama, e.kelas_id, s.kamar,
                        su.id AS santri_unit_id, e.id AS enrollment_id
                 FROM santri s
                 JOIN santri_units su
                   ON su.tenant_id = s.tenant_id AND su.santri_id = s.id
                  AND su.unit_id = $2 AND su.status = 'active' AND su.left_at IS NULL
                 JOIN LATERAL (
                   SELECT ske.id, ske.kelas_id
                   FROM santri_kelas_enrollments ske
                   WHERE ske.tenant_id = su.tenant_id
                     AND ske.santri_unit_id = su.id
                     AND ske.status = 'active' AND ske.end_date IS NULL
                   ORDER BY ske.id DESC LIMIT 1
                 ) e ON TRUE
                 WHERE s.tenant_id = $1`;
    let idx = 2;

    idx = 3;
    const scope = kelasScopeSql(access, "e.kelas_id", idx);
    query += scope.clause;
    params.push(...scope.params);
    idx = scope.nextIndex;

    if (kelasId) {
      if (!isKelasAllowed(access, kelasId)) {
        return res.status(403).json({ success: false, error: "Akses kelas ditolak" });
      }
      query += ` AND e.kelas_id = $${idx}`;
      params.push(kelasId);
    }

    query += " ORDER BY nama ASC, id ASC";

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    const bulan = req.query.bulan ? Number(req.query.bulan) : null;
    const tahun = req.query.tahun ? Number(req.query.tahun) : null;
    const kelasId = req.query.kelas_id ? Number(req.query.kelas_id) : null;

    let query = `SELECT a.id, a.santri_id, a.session_id,
                     COALESCE(a.session_name_snapshot, a.sesi, configured.display_name) AS sesi,
                     configured.display_name AS session_current_name,
                     a.status, a.unit_id, a.kelas_id, a.santri_unit_id, a.enrollment_id,
                     (SELECT kamar FROM santri WHERE id = a.santri_id AND tenant_id = a.tenant_id) AS kamar,
                     TO_CHAR(a.tanggal::date, 'YYYY-MM-DD') AS tanggal
                 FROM (${attendanceReadSql()}) a
                 LEFT JOIN attendance_sessions configured
                   ON configured.tenant_id = a.tenant_id
                  AND configured.unit_id = a.unit_id
                  AND configured.id = a.session_id
                 WHERE a.tenant_id = $1`;
    const params = [req.tenantId];
    let paramIdx = 2;

    if (access.mode !== "ALL") {
      query += ` AND a.unit_id = $${paramIdx}`;
      params.push(access.unitId);
      paramIdx += 1;
    }

    if (kelasId) {
      if (!isKelasAllowed(access, kelasId)) {
        return res.status(403).json({ success: false, error: "Akses kelas ditolak" });
      }
      query += ` AND a.kelas_id = $${paramIdx}`;
      params.push(kelasId);
      paramIdx += 1;
    }

    if (bulan && tahun) {
      const startDate = `${tahun}-${String(bulan).padStart(2, "0")}-01`;
      const endDate = new Date(Date.UTC(tahun, bulan, 1)).toISOString().slice(0, 10);
      query += ` AND a.tanggal >= $${paramIdx}::date AND a.tanggal < $${paramIdx + 1}::date`;
      params.push(startDate, endDate);
      paramIdx += 2;
    } else if (bulan) {
      query += ` AND EXTRACT(MONTH FROM a.tanggal::date) = $${paramIdx}`;
      params.push(bulan);
      paramIdx += 1;
    } else if (tahun) {
      query += ` AND EXTRACT(YEAR FROM a.tanggal::date) = $${paramIdx}`;
      params.push(tahun);
    }

    query += " ORDER BY a.tanggal ASC, a.id ASC";

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.post("/batch", async (req, res) => {
  const handlerStarted = process.hrtime.bigint();
  let client;
  try {
    const access = await loadAccess(req, res);
    if (!access) return;
    if (!access.canManage) {
      return res.status(403).json({ success: false, error: "Role belum memiliki izin kelola absensi" });
    }
    if (access.mode === "ALL") {
      return res.status(400).json({
        success: false,
        error: "Pilih unit aktif untuk mengisi absensi",
        code: "UNIT_REQUIRED",
      });
    }

    const receivedCount = Array.isArray(req.body?.entries) ? req.body.entries.length : 0;
    const entries = normalizeBatchEntries(req.body?.entries);
    const sessionIds = [...new Set(entries.map((entry) => entry.session_id))];
    const santriIds = [...new Set(entries.map((entry) => entry.santri_id))];

    client = await pool.connect();
    const dbStarted = process.hrtime.bigint();
    await client.query("BEGIN");

    const { rows: sessions } = await client.query(
      `SELECT id, display_name, start_time, end_time
       FROM attendance_sessions
       WHERE tenant_id = $1 AND active = true AND (unit_id = $2 OR EXISTS(
         SELECT 1 FROM attendance_session_units su WHERE su.tenant_id=attendance_sessions.tenant_id
         AND su.session_id=attendance_sessions.id AND su.unit_id=$2))
         AND id = ANY($3::bigint[])`,
      [access.tenantId, access.unitId, sessionIds],
    );
    const sessionById = new Map(sessions.map((row) => [Number(row.id), row]));
    if (sessionById.size !== sessionIds.length) {
      throw Object.assign(new Error("Sesi absensi tidak aktif atau bukan milik unit ini"), {
        status: 403,
        code: "CROSS_UNIT_ATTENDANCE_SESSION",
      });
    }

    const { rows: contexts } = await client.query(
      `SELECT su.santri_id, su.id AS santri_unit_id,
              e.id AS enrollment_id, e.kelas_id
       FROM santri_units su
       JOIN LATERAL (
         SELECT ske.id, ske.kelas_id
         FROM santri_kelas_enrollments ske
         WHERE ske.tenant_id = su.tenant_id
           AND ske.santri_unit_id = su.id
           AND ske.status = 'active' AND ske.end_date IS NULL
         ORDER BY ske.id DESC LIMIT 1
       ) e ON TRUE
       WHERE su.tenant_id = $1 AND su.unit_id = $2
         AND su.status = 'active' AND su.left_at IS NULL
         AND su.santri_id = ANY($3::int[])`,
      [access.tenantId, access.unitId, santriIds],
    );
    const contextBySantriId = new Map(contexts.map((row) => [Number(row.santri_id), row]));
    if (contextBySantriId.size !== santriIds.length ||
        contexts.some((context) => !isKelasAllowed(access, context.kelas_id))) {
      throw Object.assign(new Error("Santri tidak memiliki membership/enrollment aktif pada unit atau kelas ini"), {
        status: 403,
        code: "CROSS_UNIT_STUDENT",
      });
    }

    const payload = entries.map((entry) => {
      const session = sessionById.get(entry.session_id);
      const context = contextBySantriId.get(entry.santri_id);
      return {
        ...entry,
        session_name: session.display_name,
        santri_unit_id: Number(context.santri_unit_id),
        enrollment_id: Number(context.enrollment_id),
        kelas_id: Number(context.kelas_id),
      };
    });

    const processedCount = await saveManualAttendanceBatch(client, {
      sessions: sessionById,
      entries: payload,
      tenantId: access.tenantId,
      unitId: access.unitId,
      actorUserId: req.user?.id || null,
    });
    await client.query("COMMIT");

    const dbDurationMs = Number(process.hrtime.bigint() - dbStarted) / 1e6;
    const handlerDurationMs = Number(process.hrtime.bigint() - handlerStarted) / 1e6;
    return res.json({
      success: true,
      data: {
        received: receivedCount,
        processed: processedCount,
        skipped_duplicates_in_payload: receivedCount - entries.length,
      },
      meta: {
        db_duration_ms: Number(dbDurationMs.toFixed(2)),
        handler_duration_ms: Number(handlerDurationMs.toFixed(2)),
      },
    });
  } catch (err) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch (rollbackError) { console.error(rollbackError); }
    }
    console.error(err);
    return res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
  } finally {
    if (client) client.release();
  }
});

router.post("/", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    if (!access.canManage) {
      return res.status(403).json({
        success: false,
        error: "Role belum memiliki izin kelola absensi",
      });
    }
    if (access.mode === "ALL") {
      return res.status(400).json({
        success: false,
        error: "Pilih unit aktif untuk mengisi absensi",
        code: "UNIT_REQUIRED",
      });
    }

    const { santri_id, tanggal, session_id, status } = req.body;

    if (!status || status === "") {
      return res.status(400).json({
        success: false,
        error: "Status absensi wajib diisi",
      });
    }

    const session = await getAttendanceSessionInUnit(
      req.tenantId,
      session_id,
      access.unitId,
      { requireActive: true, allowParticipantUnit: true },
    );
    const santriCheck = await assertSantriAllowed(access, santri_id);
    if (!santriCheck.ok) {
      return res.status(santriCheck.status || 400).json({
        success: false,
        error: santriCheck.error,
        code: santriCheck.code,
      });
    }

    if (session.start_time && session.end_time) {
      const entry=normalizeBatchEntries([{santri_id,tanggal,session_id,status}])[0];
      const client=await pool.connect();
      try {
        await client.query("BEGIN");
        const processed=await saveManualAttendanceBatch(client,{entries:[{...entry,
          session_name:session.display_name,...santriCheck.context}],sessions:new Map([[Number(session.id),session]]),
          tenantId:req.tenantId,unitId:access.unitId,actorUserId:req.user.id});
        await client.query("COMMIT"); return res.json({success:true,data:{processed}});
      } catch(error){await client.query("ROLLBACK");throw error;}
      finally{client.release();}
    }

    const result = await pool.query(
      `INSERT INTO absensi (
         santri_id, tanggal, sesi, session_id, session_name_snapshot, status, tenant_id,
         unit_id, santri_unit_id, enrollment_id, kelas_id, actor_user_id, source
       )
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $8, $9, $10, $11, 'admin')
       ON CONFLICT (tenant_id, unit_id, santri_id, tanggal, session_id)
       WHERE unit_id IS NOT NULL AND session_id IS NOT NULL
       DO UPDATE SET status = EXCLUDED.status,
                     santri_unit_id = EXCLUDED.santri_unit_id,
                     enrollment_id = EXCLUDED.enrollment_id,
                     kelas_id = EXCLUDED.kelas_id,
                     actor_user_id = EXCLUDED.actor_user_id,
                     source = EXCLUDED.source
       RETURNING *`,
      [
        santri_id,
        tanggal,
        session.display_name,
        session.id,
        status,
        req.tenantId,
        access.unitId,
        santriCheck.context.santri_unit_id,
        santriCheck.context.enrollment_id,
        santriCheck.context.kelas_id,
        req.user?.id || null,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
  }
});

module.exports = router;
