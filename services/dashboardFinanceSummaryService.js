const { getBulanFilterVariants } = require('../utils/bulanNormalize');
const { sahriyahLedgerJoin, sahriyahCanonicalExpressions } = require('./sahriyahCanonicalSql');

function normalizeScopeUnitId(unitId) {
  if (unitId == null || unitId === '') return null;
  const parsed = Number(unitId);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Dashboard unit_id tidak valid');
  return parsed;
}

async function getDashboardFinanceSummary(client, { tenantId, unitId, month, year }) {
  const canonical = sahriyahCanonicalExpressions('t');
  const scopedUnitId = normalizeScopeUnitId(unitId);
  const monthVariants = getBulanFilterVariants(month);
  const commonParams = [Number(tenantId), scopedUnitId];

  const [cash, cashChart, recentCash, payment, recentPayments, sahriyah, topArrears] = await Promise.all([
    client.query(
      `SELECT
         COALESCE(SUM(bk.nominal) FILTER (WHERE bk.jenis = 'Masuk'), 0)::bigint AS masuk,
         COALESCE(SUM(bk.nominal) FILTER (WHERE bk.jenis = 'Keluar'), 0)::bigint AS keluar
       FROM buku_kas bk
       JOIN unit_pendidikan u
         ON u.id = bk.unit_id AND u.tenant_id = bk.tenant_id AND u.is_active = true
       WHERE bk.tenant_id = $1
         AND ($2::int IS NULL OR bk.unit_id = $2)
         AND EXTRACT(MONTH FROM bk.tanggal) = $3
         AND EXTRACT(YEAR FROM bk.tanggal) = $4`,
      [...commonParams, Number(month), Number(year)],
    ),
    client.query(
      `SELECT
         EXTRACT(MONTH FROM bk.tanggal)::int AS bulan,
         COALESCE(SUM(bk.nominal) FILTER (WHERE bk.jenis = 'Masuk'), 0)::bigint AS masuk,
         COALESCE(SUM(bk.nominal) FILTER (WHERE bk.jenis = 'Keluar'), 0)::bigint AS keluar
       FROM buku_kas bk
       JOIN unit_pendidikan u
         ON u.id = bk.unit_id AND u.tenant_id = bk.tenant_id AND u.is_active = true
       WHERE bk.tenant_id = $1
         AND ($2::int IS NULL OR bk.unit_id = $2)
         AND EXTRACT(YEAR FROM bk.tanggal) = $3
       GROUP BY EXTRACT(MONTH FROM bk.tanggal)
       ORDER BY bulan`,
      [...commonParams, Number(year)],
    ),
    client.query(
      `SELECT bk.id, bk.tanggal, bk.jenis, bk.kategori, bk.keterangan,
              bk.nominal, bk.petugas, bk.unit_id
       FROM buku_kas bk
       JOIN unit_pendidikan u
         ON u.id = bk.unit_id AND u.tenant_id = bk.tenant_id AND u.is_active = true
       WHERE bk.tenant_id = $1
         AND ($2::int IS NULL OR bk.unit_id = $2)
       ORDER BY bk.tanggal DESC, bk.id DESC
       LIMIT 10`,
      commonParams,
    ),
    client.query(
      `SELECT
         COALESCE(SUM(p.nominal_tagihan), 0)::bigint AS nominal_tagihan,
         COALESCE(SUM(p.nominal_bayar), 0)::bigint AS sudah_dibayar,
         (COALESCE(SUM(p.nominal_tagihan), 0) - COALESCE(SUM(p.nominal_bayar), 0))::bigint AS sisa_belum_dibayar,
         COUNT(*) FILTER (
           WHERE GREATEST(COALESCE(p.nominal_tagihan, 0) - COALESCE(p.nominal_bayar, 0), 0) > 0
         )::int AS tagihan_belum_lunas,
         COALESCE((
           SELECT SUM(pd.nominal)
           FROM pembayaran_detail pd
           JOIN unit_pendidikan pdu
             ON pdu.id = pd.unit_id AND pdu.tenant_id = pd.tenant_id AND pdu.is_active = true
           WHERE pd.tenant_id = $1
             AND ($2::int IS NULL OR pd.unit_id = $2)
             AND pd.tanggal = CURRENT_DATE
         ), 0)::bigint AS pembayaran_hari_ini
       FROM pembayaran p
       JOIN unit_pendidikan u
         ON u.id = p.unit_id AND u.tenant_id = p.tenant_id AND u.is_active = true
       WHERE p.tenant_id = $1
         AND ($2::int IS NULL OR p.unit_id = $2)
         AND LOWER(TRIM(p.bulan)) = ANY($3::text[])
         AND p.tahun = $4`,
      [...commonParams, monthVariants, Number(year)],
    ),
    client.query(
      `SELECT p.id, p.nama_tagihan, p.nominal_bayar, p.sisa_tunggakan,
              p.status, p.unit_id, s.nama
       FROM pembayaran p
       JOIN unit_pendidikan u
         ON u.id = p.unit_id AND u.tenant_id = p.tenant_id AND u.is_active = true
       LEFT JOIN santri s ON s.id = p.santri_id AND s.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1
         AND ($2::int IS NULL OR p.unit_id = $2)
       ORDER BY p.id DESC
       LIMIT 10`,
      commonParams,
    ),
    client.query(
      `WITH scoped_memberships AS (
         SELECT su.id AS santri_unit_id, su.santri_id, su.unit_id
         FROM santri_units su
         JOIN santri s ON s.id = su.santri_id AND s.tenant_id = su.tenant_id
         JOIN unit_pendidikan u
           ON u.id = su.unit_id AND u.tenant_id = su.tenant_id AND u.is_active = true
         WHERE su.tenant_id = $1
           AND ($2::int IS NULL OR su.unit_id = $2)
           AND su.status = 'active'
           AND su.left_at IS NULL
           AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
       ), current_bills AS (
         SELECT DISTINCT ON (t.unit_id, t.santri_unit_id)
           t.unit_id, t.santri_unit_id, ${canonical.status} AS status,
           t.nominal, ${canonical.paid} AS total_bayar,
           ${canonical.remaining} AS sisa_tagihan
         FROM tagihan_sahriyah t
         JOIN scoped_memberships sm
           ON sm.unit_id = t.unit_id AND sm.santri_unit_id = t.santri_unit_id
         ${sahriyahLedgerJoin('t')}
         WHERE t.tenant_id = $1 AND t.bulan = $3 AND t.tahun = $4
         ORDER BY t.unit_id, t.santri_unit_id, t.id DESC
       ), current_settings AS (
         SELECT DISTINCT ON (ss.unit_id, ss.santri_unit_id)
           ss.unit_id, ss.santri_unit_id, ss.nominal_uang
         FROM sahriyah_setting ss
         JOIN scoped_memberships sm
           ON sm.unit_id = ss.unit_id AND sm.santri_unit_id = ss.santri_unit_id
         WHERE ss.tenant_id = $1
         ORDER BY ss.unit_id, ss.santri_unit_id, ss.id DESC
       )
       SELECT
         COUNT(*)::int AS total_santri,
         COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(b.status, ''))) = 'lunas')::int AS lunas,
         COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(b.status, ''))) LIKE '%cicil%')::int AS cicilan,
         COUNT(*) FILTER (
           WHERE b.santri_unit_id IS NULL OR (
             LOWER(TRIM(COALESCE(b.status, ''))) <> 'lunas'
             AND LOWER(TRIM(COALESCE(b.status, ''))) NOT LIKE '%cicil%'
           )
         )::int AS belum_bayar,
         COALESCE(SUM(COALESCE(b.total_bayar, 0)), 0)::bigint AS sudah_dibayar,
         COALESCE(SUM(
           CASE
             WHEN b.santri_unit_id IS NULL THEN COALESCE(cs.nominal_uang, 0)
             ELSE b.sisa_tagihan
           END
         ), 0)::bigint AS sisa_belum_dibayar
       FROM scoped_memberships sm
       LEFT JOIN current_bills b
         ON b.unit_id = sm.unit_id AND b.santri_unit_id = sm.santri_unit_id
       LEFT JOIN current_settings cs
         ON cs.unit_id = sm.unit_id AND cs.santri_unit_id = sm.santri_unit_id`,
      [...commonParams, Number(month), Number(year)],
    ),
    client.query(
      `SELECT s.nama, ${canonical.remaining} AS sisa_tagihan, t.unit_id
       FROM tagihan_sahriyah t
       JOIN unit_pendidikan u
         ON u.id = t.unit_id AND u.tenant_id = t.tenant_id AND u.is_active = true
       LEFT JOIN santri s ON s.id = t.santri_id AND s.tenant_id = t.tenant_id
       ${sahriyahLedgerJoin('t')}
       WHERE t.tenant_id = $1
         AND ($2::int IS NULL OR t.unit_id = $2)
         AND t.santri_unit_id IS NOT NULL
         AND ${canonical.remaining} > 0
       ORDER BY ${canonical.remaining} DESC
       LIMIT 10`,
      commonParams,
    ),
  ]);

  const cashRow = cash.rows[0] || {};
  const paymentRow = payment.rows[0] || {};
  const sahriyahRow = sahriyah.rows[0] || {};
  const masuk = Number(cashRow.masuk || 0);
  const keluar = Number(cashRow.keluar || 0);

  return {
    cash: { masuk, keluar, saldo: masuk - keluar },
    payment: {
      nominal_tagihan: Number(paymentRow.nominal_tagihan || 0),
      sudah_dibayar: Number(paymentRow.sudah_dibayar || 0),
      sisa_belum_dibayar: Number(paymentRow.sisa_belum_dibayar || 0),
      pembayaran_hari_ini: Number(paymentRow.pembayaran_hari_ini || 0),
      tagihan_belum_lunas: Number(paymentRow.tagihan_belum_lunas || 0),
    },
    sahriyah: {
      sudah_dibayar: Number(sahriyahRow.sudah_dibayar || 0),
      sisa_belum_dibayar: Number(sahriyahRow.sisa_belum_dibayar || 0),
      status: {
        total_santri: Number(sahriyahRow.total_santri || 0),
        lunas: Number(sahriyahRow.lunas || 0),
        cicilan: Number(sahriyahRow.cicilan || 0),
        belum_bayar: Number(sahriyahRow.belum_bayar || 0),
      },
    },
    grafik_kas: cashChart.rows,
    transaksi_terbaru: recentCash.rows,
    pembayaran_terbaru: recentPayments.rows,
    top_tunggakan: topArrears.rows,
  };
}

module.exports = {
  getDashboardFinanceSummary,
  normalizeScopeUnitId,
};
