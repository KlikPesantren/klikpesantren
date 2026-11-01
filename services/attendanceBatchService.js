async function upsertAttendanceBatch(client, {
  entries,
  tenantId,
  unitId,
  actorUserId,
}) {
  const result = await client.query(
    `WITH input AS (
       SELECT * FROM JSONB_TO_RECORDSET($1::jsonb) AS item(
         santri_id integer, tanggal date, session_id bigint, status varchar,
         session_name varchar, santri_unit_id bigint, enrollment_id bigint, kelas_id integer
       )
     )
     INSERT INTO absensi (
       santri_id, tanggal, sesi, session_id, session_name_snapshot, status, tenant_id,
       unit_id, santri_unit_id, enrollment_id, kelas_id, actor_user_id, source,
       academic_year_id, academic_semester_id
     )
     SELECT santri_id, tanggal, session_name, session_id, session_name, status, $2,
            $3, santri_unit_id, enrollment_id, kelas_id, $4, 'admin',
            period.academic_year_id, period.id
     FROM input
     LEFT JOIN LATERAL (
       SELECT s.id,s.academic_year_id FROM academic_semesters s
       WHERE s.tenant_id=$2 AND s.unit_id=$3 AND input.tanggal BETWEEN s.start_date AND s.end_date
         AND s.status IN('ACTIVE','CLOSED')
       ORDER BY CASE s.status WHEN 'ACTIVE' THEN 0 ELSE 1 END,s.id DESC LIMIT 1
     ) period ON TRUE
     ON CONFLICT (tenant_id, unit_id, santri_id, tanggal, session_id)
     WHERE unit_id IS NOT NULL AND session_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status,
                   santri_unit_id = EXCLUDED.santri_unit_id,
                   enrollment_id = EXCLUDED.enrollment_id,
                   kelas_id = EXCLUDED.kelas_id,
                   academic_year_id = EXCLUDED.academic_year_id,
                   academic_semester_id = EXCLUDED.academic_semester_id,
                   actor_user_id = EXCLUDED.actor_user_id,
                   source = EXCLUDED.source
     RETURNING id`,
    [JSON.stringify(entries), tenantId, unitId, actorUserId || null],
  );
  return result.rowCount;
}

module.exports = { upsertAttendanceBatch };
