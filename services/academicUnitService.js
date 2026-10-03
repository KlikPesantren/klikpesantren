const pool = require("../db");
const { resolveActiveUnit } = require("./unitAccessService");

const ACCESS_CODES = new Set([
  "UNIT_ACCESS_DENIED",
  "UNIT_REQUIRED",
  "INVALID_UNIT",
  "UNIT_NOT_FOUND",
  "UNIT_INACTIVE",
]);

function academicError(message, status = 400, code = "ACADEMIC_UNIT_ERROR") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sendAcademicError(res, error) {
  const status = Number(error?.status || 500);
  const safeStatus = status >= 400 && status < 500 ? status : 500;
  if (safeStatus >= 500) console.error(error);
  return res.status(safeStatus).json({
    success: false,
    error: error?.message || "Akses akademik ditolak",
    code: error?.code || (safeStatus === 500 ? "ACADEMIC_INTERNAL_ERROR" : "ACADEMIC_ACCESS_DENIED"),
  });
}

async function resolveAcademicUnit(req, client = pool) {
  try {
    return await resolveActiveUnit(req, client);
  } catch (error) {
    if (ACCESS_CODES.has(error?.code) || error?.status === 403 || error?.status === 400 || error?.status === 404) {
      throw error;
    }
    throw error;
  }
}

async function assertUnitFeature(tenantId, unitId, featureKey, client = pool) {
  if (!unitId || !featureKey) return { enabled: true };
  const { rows } = await client.query(
    `SELECT enabled
     FROM unit_features
     WHERE tenant_id = $1 AND unit_id = $2 AND feature_key = $3
     LIMIT 1`,
    [tenantId, unitId, featureKey],
  );
  if (!rows[0] || rows[0].enabled !== false) return { enabled: true };
  throw academicError("Fitur belum aktif untuk unit ini", 403, "UNIT_FEATURE_DISABLED");
}

async function getActiveStudentContext(tenantId, santriId, unitId, kelasId = null, client = pool) {
  const { rows } = await client.query(
    `SELECT su.id AS santri_unit_id, su.unit_id,
            e.id AS enrollment_id, e.kelas_id
     FROM santri_units su
     LEFT JOIN LATERAL (
       SELECT ske.id, ske.kelas_id
       FROM santri_kelas_enrollments ske
       WHERE ske.tenant_id = su.tenant_id
         AND ske.santri_unit_id = su.id
         AND ske.status = 'active'
         AND ske.end_date IS NULL
       ORDER BY ske.id DESC
       LIMIT 1
     ) e ON TRUE
     WHERE su.tenant_id = $1
       AND su.santri_id = $2
       AND su.unit_id = $3
       AND su.status = 'active'
       AND su.left_at IS NULL
       AND ($4::integer IS NULL OR e.kelas_id = $4)
     LIMIT 1`,
    [tenantId, santriId, unitId, kelasId || null],
  );
  if (!rows[0]) {
    throw academicError("Santri tidak memiliki membership/enrollment aktif pada unit ini", 403, "CROSS_UNIT_STUDENT");
  }
  return rows[0];
}

async function getClassInUnit(tenantId, kelasId, unitId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, tenant_id, unit_id, nama_kelas
     FROM kelas
     WHERE tenant_id = $1 AND id = $2 AND unit_id = $3
     LIMIT 1`,
    [tenantId, kelasId, unitId],
  );
  if (!rows[0]) {
    throw academicError("Kelas tidak berada pada unit aktif", 403, "CROSS_UNIT_CLASS");
  }
  return rows[0];
}

async function listActiveStudentsInClass(tenantId, kelasId, unitId, client = pool) {
  const parsedClassId = Number(kelasId);
  if (!Number.isInteger(parsedClassId) || parsedClassId <= 0) {
    throw academicError("Kelas wajib dipilih", 400, "CLASS_REQUIRED");
  }

  await getClassInUnit(tenantId, parsedClassId, unitId, client);
  const { rows } = await client.query(
    `SELECT DISTINCT ON (s.id)
            s.id, s.nama, s.nis,
            su.id AS santri_unit_id,
            ske.id AS enrollment_id,
            ske.kelas_id
     FROM santri_kelas_enrollments ske
     JOIN santri_units su
       ON su.id = ske.santri_unit_id
      AND su.tenant_id = ske.tenant_id
      AND su.unit_id = $3
      AND su.status = 'active'
      AND su.left_at IS NULL
     JOIN santri s
       ON s.id = su.santri_id
      AND s.tenant_id = su.tenant_id
     WHERE ske.tenant_id = $1
       AND ske.kelas_id = $2
       AND ske.status = 'active'
       AND ske.end_date IS NULL
       AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','')
     ORDER BY s.id, ske.id DESC`,
    [tenantId, parsedClassId, unitId],
  );
  return rows;
}

async function getMapelInUnit(tenantId, mapelId, unitId, client = pool) {
  const { rows } = await client.query(
    `SELECT id, tenant_id, unit_id, nama, aktif
     FROM mata_pelajaran
     WHERE tenant_id = $1
       AND id = $2
       AND aktif = true
       AND unit_id = $3
     LIMIT 1`,
    [tenantId, mapelId, unitId],
  );
  if (!rows[0]) {
    throw academicError("Mata pelajaran tidak berada pada unit aktif", 403, "CROSS_UNIT_MAPEL");
  }
  return rows[0];
}

async function getMapelByNameInUnit(tenantId, mapelName, unitId, client = pool) {
  const name = String(mapelName || "").trim();
  if (!name) throw academicError("Mata pelajaran wajib diisi", 400, "MAPEL_REQUIRED");
  const { rows } = await client.query(
    `SELECT id, tenant_id, unit_id, nama, aktif
     FROM mata_pelajaran
     WHERE tenant_id = $1
       AND LOWER(TRIM(nama)) = LOWER(TRIM($2))
       AND aktif = true
       AND unit_id = $3
     LIMIT 1`,
    [tenantId, name, unitId],
  );
  if (!rows[0]) {
    throw academicError("Mata pelajaran tidak berada pada unit aktif", 403, "CROSS_UNIT_MAPEL");
  }
  return rows[0];
}

async function getGuruInUnit(tenantId, guruId, unitId, client = pool) {
  const { rows } = await client.query(
    `SELECT gu.id AS guru_unit_id, gu.guru_id, gu.unit_id
     FROM guru_units gu
     JOIN guru g ON g.id = gu.guru_id AND g.tenant_id = gu.tenant_id
     WHERE gu.tenant_id = $1
       AND gu.guru_id = $2
       AND gu.unit_id = $3
       AND gu.status = 'active'
       AND gu.left_at IS NULL
       AND LOWER(TRIM(COALESCE(g.status, 'Aktif'))) IN ('aktif','active','')
     LIMIT 1`,
    [tenantId, guruId, unitId],
  );
  if (!rows[0]) {
    throw academicError("Guru tidak berada pada unit aktif", 403, "CROSS_UNIT_GURU");
  }
  return rows[0];
}

async function getAttendanceSessionInUnit(
  tenantId,
  sessionId,
  unitId,
  { requireActive = true, allowParticipantUnit = false } = {},
  client = pool,
) {
  const parsedSessionId = Number(sessionId);
  if (!Number.isInteger(parsedSessionId) || parsedSessionId <= 0) {
    throw academicError("Sesi absensi wajib dipilih", 400, "ATTENDANCE_SESSION_REQUIRED");
  }
  const { rows } = await client.query(
    `SELECT id, tenant_id, unit_id, code, display_name,
            start_time, end_time, sort_order, active
     FROM attendance_sessions
     WHERE tenant_id = $1 AND id = $2
     LIMIT 1`,
    [tenantId, parsedSessionId],
  );
  const session = rows[0];
  const participant = session && allowParticipantUnit && (await client.query(
    "SELECT 1 FROM attendance_session_units WHERE tenant_id=$1 AND session_id=$2 AND unit_id=$3",
    [tenantId,parsedSessionId,unitId],
  )).rows.length>0;
  if (!session || (Number(session.unit_id) !== Number(unitId) && !participant)) {
    throw academicError(
      "Sesi absensi tidak berada pada unit aktif",
      403,
      "CROSS_UNIT_SESSION",
    );
  }
  if (requireActive && !session.active) {
    throw academicError("Sesi absensi sudah tidak aktif", 409, "ATTENDANCE_SESSION_INACTIVE");
  }
  return session;
}

module.exports = {
  academicError,
  assertUnitFeature,
  getActiveStudentContext,
  getAttendanceSessionInUnit,
  getClassInUnit,
  getGuruInUnit,
  listActiveStudentsInClass,
  getMapelByNameInUnit,
  getMapelInUnit,
  resolveAcademicUnit,
  sendAcademicError,
};
