const pool = require("../db");

const ACTIVE_SANTRI_SQL = "LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','')";

function unitMembershipSql(single = false) {
  return `
    SELECT su.id AS membership_id, su.santri_id, su.unit_id,
           su.unit_student_number, su.status AS membership_status,
           su.joined_at, su.left_at, su.is_primary,
           u.kode AS unit_kode, u.nama AS unit_nama,
           enrollment.id AS enrollment_id,
           enrollment.kelas_id, k.nama_kelas
    FROM santri_units su
    JOIN unit_pendidikan u
      ON u.id = su.unit_id AND u.tenant_id = su.tenant_id
    LEFT JOIN LATERAL (
      SELECT e.id, e.kelas_id
      FROM santri_kelas_enrollments e
      WHERE e.tenant_id = su.tenant_id
        AND e.santri_unit_id = su.id
        AND e.status = 'active'
        AND e.end_date IS NULL
      ORDER BY e.id DESC
      LIMIT 1
    ) enrollment ON TRUE
    LEFT JOIN kelas k
      ON k.id = enrollment.kelas_id
     AND k.tenant_id = su.tenant_id
     AND k.unit_id = su.unit_id
    WHERE su.tenant_id = $1
      AND su.status = 'active'
      AND su.left_at IS NULL
      ${single ? "AND su.santri_id = $3" : ""}
  `;
}

async function listVisibleSantri({ tenantId, unitId = null, search = "" }, client = pool) {
  const normalizedSearch = String(search || "").trim();
  const { rows } = await client.query(
    `WITH membership_rows AS (${unitMembershipSql(false)}),
     visible_memberships AS (
       SELECT * FROM membership_rows
       WHERE ($2::integer IS NULL OR unit_id = $2)
     )
     SELECT s.*,
            to_char(s.tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
            to_char(s.tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren,
            CASE WHEN $2::integer IS NULL THEN s.kelas_id ELSE MAX(vm.kelas_id) END AS kelas_id,
            CASE WHEN $2::integer IS NULL THEN legacy_kelas.nama_kelas ELSE MAX(vm.nama_kelas) END AS nama_kelas,
            MAX(vm.unit_id) FILTER (WHERE $2::integer IS NOT NULL) AS context_unit_id,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'membership_id', vm.membership_id,
                  'unit_id', vm.unit_id,
                  'unit_kode', vm.unit_kode,
                  'unit_nama', vm.unit_nama,
                  'unit_student_number', vm.unit_student_number,
                  'is_primary', vm.is_primary,
                  'kelas_id', vm.kelas_id,
                  'nama_kelas', vm.nama_kelas
                ) ORDER BY vm.is_primary DESC, vm.unit_nama, vm.membership_id
              ), '[]'::jsonb
            ) AS memberships
     FROM santri s
     JOIN visible_memberships vm ON vm.santri_id = s.id
     LEFT JOIN kelas legacy_kelas
       ON legacy_kelas.id = s.kelas_id AND legacy_kelas.tenant_id = s.tenant_id
     WHERE s.tenant_id = $1
       AND ${ACTIVE_SANTRI_SQL}
       AND ($3::text = '' OR s.nama ILIKE '%' || $3 || '%'
            OR COALESCE(s.nis, '') ILIKE '%' || $3 || '%'
            OR COALESCE(s.uid_rfid, '') ILIKE '%' || $3 || '%')
     GROUP BY s.id, legacy_kelas.nama_kelas
     ORDER BY s.id DESC`,
    [tenantId, unitId, normalizedSearch],
  );
  return rows;
}

async function getVisibleSantri({ tenantId, unitId = null, santriId }, client = pool) {
  const { rows } = await client.query(
    `WITH membership_rows AS (${unitMembershipSql(true)}),
     visible_memberships AS (
       SELECT * FROM membership_rows
       WHERE ($2::integer IS NULL OR unit_id = $2)
     )
     SELECT s.*,
            to_char(s.tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
            to_char(s.tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren,
            CASE WHEN $2::integer IS NULL THEN s.kelas_id ELSE MAX(vm.kelas_id) END AS kelas_id,
            CASE WHEN $2::integer IS NULL THEN legacy_kelas.nama_kelas ELSE MAX(vm.nama_kelas) END AS nama_kelas,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'membership_id', vm.membership_id,
                  'unit_id', vm.unit_id,
                  'unit_kode', vm.unit_kode,
                  'unit_nama', vm.unit_nama,
                  'unit_student_number', vm.unit_student_number,
                  'is_primary', vm.is_primary,
                  'kelas_id', vm.kelas_id,
                  'nama_kelas', vm.nama_kelas
                ) ORDER BY vm.is_primary DESC, vm.unit_nama, vm.membership_id
              ), '[]'::jsonb
            ) AS memberships
     FROM santri s
     JOIN visible_memberships vm ON vm.santri_id = s.id
     LEFT JOIN kelas legacy_kelas
       ON legacy_kelas.id = s.kelas_id AND legacy_kelas.tenant_id = s.tenant_id
     WHERE s.id = $3 AND s.tenant_id = $1
     GROUP BY s.id, legacy_kelas.nama_kelas`,
    [tenantId, unitId, santriId],
  );
  return rows[0] || null;
}

async function findIdentityConflict(tenantId, { santriId = null, nis = null, uidRfid = null }, client = pool) {
  const {canonicalAttendanceUid,attendanceUidSql}=require("../utils/attendanceRfidUid");
  const normalizedNis = String(nis || "").trim();
  const normalizedUid = canonicalAttendanceUid(uidRfid);
  if (!santriId && !normalizedNis && !normalizedUid) return null;
  const { rows } = await client.query(
    `SELECT id
     FROM santri s
     WHERE tenant_id = $1
       AND ($2::integer IS NULL OR id = $2)
       AND (
         $2::integer IS NOT NULL
         OR ($3::text <> '' AND TRIM(COALESCE(nis, '')) = $3)
         OR ($4::text <> '' AND (${attendanceUidSql("s.uid_rfid")}) = $4)
       )
     ORDER BY id
     LIMIT 1`,
    [tenantId, santriId || null, normalizedNis, normalizedUid],
  );
  return rows[0] || null;
}

module.exports = {
  findIdentityConflict,
  getVisibleSantri,
  listVisibleSantri,
};
