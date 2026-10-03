// Shared READ projection, never a second ledger. Canonical result shadows legacy
// only for the same tenant/person/session/local date/unit. Unmatched history stays.
function attendanceReadSql(tenantParameter = "$1") {
  if (!/^\$[1-9][0-9]*$/.test(tenantParameter)) throw new Error("Invalid attendance SQL parameter");
  return `WITH canonical AS (
    SELECT -r.id AS id,r.tenant_id,r.person_id AS santri_id,o.session_id,
      s.display_name AS sesi,s.display_name AS session_name_snapshot,
      o.occurrence_date AS tanggal,r.status,ou.unit_id,
      membership.id AS santri_unit_id,enrollment.id AS enrollment_id,enrollment.kelas_id
    FROM attendance_results r
    JOIN attendance_occurrences o ON o.tenant_id=r.tenant_id AND o.id=r.occurrence_id
    JOIN attendance_sessions s ON s.tenant_id=o.tenant_id AND s.id=o.session_id
    JOIN attendance_occurrence_units ou ON ou.tenant_id=o.tenant_id AND ou.occurrence_id=o.id
    JOIN LATERAL (
      SELECT su.id FROM santri_units su
      WHERE su.tenant_id=r.tenant_id AND su.santri_id=r.person_id AND su.unit_id=ou.unit_id
        AND (su.joined_at IS NULL OR su.joined_at<=o.occurrence_date)
        AND (su.left_at IS NULL OR su.left_at>=o.occurrence_date)
      ORDER BY su.id DESC LIMIT 1
    ) membership ON true
    LEFT JOIN LATERAL (
      SELECT e.id,e.kelas_id FROM santri_kelas_enrollments e
      WHERE e.tenant_id=r.tenant_id AND e.santri_unit_id=membership.id
        AND (e.start_date IS NULL OR e.start_date<=o.occurrence_date)
        AND (e.end_date IS NULL OR e.end_date>=o.occurrence_date)
      ORDER BY e.id DESC LIMIT 1
    ) enrollment ON true
    WHERE r.tenant_id=${tenantParameter} AND r.person_type='santri' AND o.state<>'cancelled'
  ) SELECT * FROM canonical
  UNION ALL
  SELECT a.id::bigint,a.tenant_id,a.santri_id::bigint,a.session_id::bigint,
    a.sesi,a.session_name_snapshot,a.tanggal::date,a.status,a.unit_id,
    a.santri_unit_id,a.enrollment_id,a.kelas_id
  FROM absensi a WHERE a.tenant_id=${tenantParameter} AND NOT EXISTS (
    SELECT 1 FROM canonical c WHERE c.tenant_id=a.tenant_id AND c.santri_id=a.santri_id
      AND c.unit_id=a.unit_id AND c.session_id=a.session_id AND c.tanggal=a.tanggal::date
  )`;
}

module.exports = { attendanceReadSql };
