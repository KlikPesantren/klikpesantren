const pool = require("../db");
const { SQL_SANTri_AKTIF } = require("../utils/santriStatus");

function normalizePeriod(bulan, tahun) {
  const month = Number(bulan);
  const year = Number(tahun);
  if (!Number.isInteger(month) || month < 1 || month > 12
      || !Number.isInteger(year) || year < 2000 || year > 2200) {
    throw Object.assign(new Error("Periode Sahriyah tidak valid"), {
      status: 400,
      code: "INVALID_BILLING_PERIOD",
    });
  }
  return { bulan: month, tahun: year };
}

async function generateSahriyah({
  tenantId,
  unitId,
  bulan,
  tahun,
  actorUserId = null,
  client = pool,
}) {
  const period = normalizePeriod(bulan, tahun);
  const generated = await client.query(
    `WITH targets AS MATERIALIZED (
       SELECT s.id AS santri_id,
              su.id AS santri_unit_id,
              ss.id AS setting_id,
              COALESCE(ss.nominal_uang, 0) AS nominal_uang,
              COALESCE(ss.nominal_beras, 0) AS nominal_beras,
              COALESCE(ss.keterangan, '') AS keterangan
       FROM santri_units su
       JOIN santri s
         ON s.id = su.santri_id
        AND s.tenant_id = su.tenant_id
       LEFT JOIN sahriyah_setting ss
         ON ss.santri_id = s.id
        AND ss.tenant_id = s.tenant_id
        AND ss.unit_id = su.unit_id
        AND ss.santri_unit_id = su.id
        AND ss.legacy_resolution_status = 'resolved'
       WHERE su.tenant_id = $1
         AND su.unit_id = $2
         AND su.status = 'active'
         AND su.left_at IS NULL
         AND ${SQL_SANTri_AKTIF}
     ), eligible AS MATERIALIZED (
       SELECT * FROM targets WHERE setting_id IS NOT NULL
     ), inserted AS (
       INSERT INTO tagihan_sahriyah (
         santri_id, bulan, tahun, nominal, nominal_beras, sisa_tagihan,
         sisa_beras, keterangan,
         tenant_id, unit_id, santri_unit_id, actor_user_id, source
       )
       SELECT santri_id, $3, $4, nominal_uang, nominal_beras, nominal_uang,
              nominal_beras, keterangan,
              $1, $2, santri_unit_id, $5, 'manual'
       FROM eligible
       WHERE NOT EXISTS (
         SELECT 1 FROM tagihan_sahriyah legacy
         WHERE legacy.tenant_id = $1
           AND legacy.santri_id = eligible.santri_id
           AND legacy.bulan = $3
           AND legacy.tahun = $4
           AND (legacy.unit_id IS NULL OR legacy.santri_unit_id IS NULL)
       )
       ON CONFLICT (tenant_id, unit_id, santri_unit_id, bulan, tahun)
         WHERE unit_id IS NOT NULL AND santri_unit_id IS NOT NULL
       DO NOTHING
       RETURNING id, santri_id, bulan, tahun, nominal
     )
     SELECT
       (SELECT COUNT(*)::integer FROM targets) AS total_target,
       (SELECT COUNT(*)::integer FROM targets WHERE setting_id IS NULL) AS skipped_no_setting_count,
       (SELECT COUNT(*)::integer FROM eligible) AS eligible_count,
       (SELECT COUNT(*)::integer FROM inserted) AS created_count,
       COALESCE((SELECT json_agg(inserted ORDER BY id) FROM inserted), '[]'::json) AS created_rows`,
    [tenantId, unitId, period.bulan, period.tahun, actorUserId],
  );
  const row = generated.rows[0];
  const createdCount = Number(row.created_count);
  const eligibleCount = Number(row.eligible_count);
  return {
    createdRows: row.created_rows || [],
    createdCount,
    totalTarget: Number(row.total_target),
    eligibleCount,
    skippedNoSettingCount: Number(row.skipped_no_setting_count),
    skippedExistingCount: eligibleCount - createdCount,
  };
}

module.exports = { generateSahriyah, normalizePeriod };
