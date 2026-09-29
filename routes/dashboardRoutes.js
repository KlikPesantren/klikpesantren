const express = require("express");

const pool = require("../db");
const { accessError, resolveActiveUnit } = require("../services/unitAccessService");
const { getDashboardAllUnitsV1 } = require("../services/dashboardAllUnitsV1Service");
const { getDashboardFinanceSummary } = require("../services/dashboardFinanceSummaryService");
const { getDashboardUnitSummary } = require("../services/dashboardUnitSummaryService");
const {
  getTenantSubscriptionNotice,
} = require("../services/tenantSubscriptionNoticeService");

const router = express.Router();

router.get("/subscription-billing", async (req, res) => {
  try {
    const data = await getTenantSubscriptionNotice(req.tenantId);
    if (!data) {
      return res.status(404).json({ success: false, error: "Tenant tidak ditemukan" });
    }
    return res.json({ success: true, data });
  } catch (err) {
    console.error("[tenantSubscriptionBilling]", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memuat informasi langganan",
    });
  }
});

const UNIT_NATIVE_DASHBOARD_FIELDS = [
  "total_santri",
  "santri_aktif",
  "santri_non_aktif",
  "total_kelas",
  "total_guru",
  "persentase_kehadiran_santri",
  "persentase_kehadiran_guru",
  "total_hafalan",
  "rata_nilai",
  "absensi_hari_ini",
  "nilai_terisi",
  "kehadiran_santri_hadir",
  "kehadiran_santri_total",
  "kehadiran_guru_hadir",
  "kehadiran_guru_total",
  "nilai_total",
  "total_pelanggaran",
  "persentase_melanggar",
  "total_perizinan",
  "belum_kembali",
  "santri_poin_tertinggi",
  "total_pengumuman",
  "pengumuman_aktif",
  "pengumuman_terbaru",
  "recent_perizinan",
  "kesehatan_sehat",
  "kesehatan_sakit",
  "kesehatan_perlu_tindak_lanjut",
  "kas_masuk",
  "kas_keluar",
  "saldo_kas",
  "nominal_tagihan",
  "sudah_dibayar",
  "sisa_belum_dibayar",
  "pembayaran_hari_ini",
  "tagihan_belum_lunas",
  "total_pembayaran",
  "total_tunggakan",
  "sahriyah_status",
  "grafik_kas",
  "transaksi_terbaru",
  "pembayaran_terbaru",
  "top_tunggakan",
];

const TENANT_WIDE_DASHBOARD_FIELDS = [
  "total_alumni",
  "total_wali",
  "total_saldo",
  "total_wali_akun",
  "wali_belum_ganti_pin",
  "tamu_hari_ini",
  "tamu_bulan_ini",
  "tamu_masih_didalam",
];

async function queryDashboardSantriCounts(client, tenantId, unitAccess) {
  if (unitAccess.mode === "UNIT") {
    const { rows } = await client.query(
      `SELECT
         COUNT(DISTINCT su.santri_id) FILTER (
           WHERE su.status = 'active'
             AND su.left_at IS NULL
             AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
         )::int AS total,
         COUNT(DISTINCT su.santri_id) FILTER (
           WHERE su.status = 'active'
             AND su.left_at IS NULL
             AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
         )::int AS aktif,
         COUNT(DISTINCT su.santri_id) FILTER (
           WHERE NOT (
             su.status = 'active'
             AND su.left_at IS NULL
             AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
           )
         )::int AS non_aktif
       FROM santri_units su
       JOIN santri s
         ON s.id = su.santri_id
        AND s.tenant_id = su.tenant_id
       WHERE su.tenant_id = $1
         AND su.unit_id = $2`,
      [tenantId, unitAccess.unitId],
    );
    return rows[0] || { total: 0, aktif: 0, non_aktif: 0 };
  }

  const { rows } = await client.query(
    `SELECT
       COUNT(DISTINCT id) FILTER (
         WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')
       )::int AS total,
       COUNT(DISTINCT id) FILTER (
         WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')
       )::int AS aktif,
       COUNT(DISTINCT id) FILTER (
         WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) NOT IN ('aktif', 'active', '')
       )::int AS non_aktif
     FROM santri
     WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0] || { total: 0, aktif: 0, non_aktif: 0 };
}

async function queryDashboardKelasCount(client, tenantId, unitAccess) {
  if (unitAccess.mode === "UNIT") {
    const { rows } = await client.query(
      `SELECT COUNT(DISTINCT k.id)::int AS total
       FROM kelas k
       JOIN unit_pendidikan u
         ON u.id = k.unit_id
        AND u.tenant_id = k.tenant_id
        AND u.is_active = true
       WHERE k.tenant_id = $1
         AND k.unit_id = $2`,
      [tenantId, unitAccess.unitId],
    );
    return Number(rows[0]?.total || 0);
  }

  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT k.id)::int AS total
     FROM kelas k
     JOIN unit_pendidikan u
       ON u.id = k.unit_id
      AND u.tenant_id = k.tenant_id
      AND u.is_active = true
     WHERE k.tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]?.total || 0);
}

function buildDashboardErrorResponse(err) {
  const status = Number(err?.status || 500);
  if (status >= 400 && status < 500) {
    return {
      status,
      body: {
        success: false,
        error: err.message || "Akses dashboard ditolak",
        code: err.code || "DASHBOARD_ACCESS_DENIED",
        meta: {
          scope: "unresolved",
          data_quality: "access_denied",
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: err?.message || "Dashboard belum dapat dimuat",
      code: "DASHBOARD_SUMMARY_FAILED",
    },
  };
}

// ======================
// DASHBOARD SEMUA UNIT V1 (READ ONLY)
// ======================

router.get("/all-units-v1", async (req, res) => {
  try {
    const unitAccess = await resolveActiveUnit(req);
    if (unitAccess.mode !== "ALL") {
      throw accessError("Dashboard Semua Unit hanya tersedia untuk superadmin", 403, "UNIT_ACCESS_DENIED");
    }
    const data = await getDashboardAllUnitsV1(pool, {
      tenantId: req.tenantId,
      year: req.query?.year,
    });
    res.json({
      success: true,
      meta: {
        scope: "all",
        all_units: true,
        read_only: true,
        contract: "dashboard_all_units_v1",
        generated_at: new Date().toISOString(),
      },
      data,
    });
  } catch (err) {
    const response = buildDashboardErrorResponse(err);
    if (response.status >= 500) console.error(err);
    res.status(response.status).json(response.body);
  }
});

// ======================
// DASHBOARD SUMMARY
// ======================

router.get(

  "/summary",

  async (req, res) => {

    try {

      const tenantId = req.tenantId;
      const unitAccess = await resolveActiveUnit(req);
      const isUnitScope = unitAccess.mode === "UNIT";
      const bulanIni = new Date().getMonth() + 1;
      const tahunIni = new Date().getFullYear();

      const santri = await queryDashboardSantriCounts(pool, tenantId, unitAccess);

      const alumni =
        await pool.query(
          `SELECT COUNT(*) AS total FROM alumni WHERE tenant_id = $1`,
          [tenantId]
        );

      const totalKelas = await queryDashboardKelasCount(pool, tenantId, unitAccess);

      const wali =
        await pool.query(
          `SELECT COUNT(*) AS total FROM wali_santri WHERE tenant_id = $1`,
          [tenantId]
        );

      const saldo =
        await pool.query(
          `
          SELECT COALESCE(SUM(saldo), 0) AS total_saldo
          FROM santri
          WHERE tenant_id = $1
          `,
          [tenantId]
        );

      // ======================
      // SANTRI AKTIF / NON AKTIF
      // ======================

      let santriAktif = Number(santri.aktif || santri.total || 0);
      let santriNonAktif = Number(santri.non_aktif || 0);

      // ======================
      // WALI AKUN
      // ======================

      let totalWaliAkun     = 0;
      let waliBelumGantiPin = 0;

      try {
        const waliAkunResult = await pool.query(
          `SELECT
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE must_change_pin = true) AS belum_ganti
           FROM wali_akun
           WHERE tenant_id = $1`,
          [tenantId]
        );
        totalWaliAkun     = Number(waliAkunResult.rows[0].total);
        waliBelumGantiPin = Number(waliAkunResult.rows[0].belum_ganti);
      } catch { /* wali_akun belum dibuat */ }

      const financeSummary = await getDashboardFinanceSummary(pool, {
        tenantId,
        unitId: isUnitScope ? unitAccess.unitId : null,
        month: bulanIni,
        year: tahunIni,
      });
      const unitSummary = await getDashboardUnitSummary(pool, {
        tenantId,
        unitId: isUnitScope ? unitAccess.unitId : null,
        month: bulanIni,
        year: tahunIni,
      });

      res.json({

        success: true,

        meta: {
          scope: isUnitScope ? "unit" : "all",
          all_units: !isUnitScope,
          unit_id: isUnitScope ? unitAccess.unitId : null,
          unit_name: isUnitScope ? unitAccess.unit?.nama || null : null,
          generated_at: new Date().toISOString(),
          data_quality: "unit_native_with_explicit_tenant_fields",
          tenant_kpi_contract: { tamu: "TENANT" },
          unit_native_fields: UNIT_NATIVE_DASHBOARD_FIELDS,
          tenant_wide_fields: TENANT_WIDE_DASHBOARD_FIELDS,
        },

        data: {

          total_santri:
            Number(santri.total || 0),

          total_alumni:
            Number(alumni.rows[0].total),

          santri_aktif:
            santriAktif,

          santri_non_aktif:
            santriNonAktif,

          total_kelas:
            totalKelas,

          total_guru:
            unitSummary.academic.total_guru,

          total_wali:
            Number(wali.rows[0].total),

          total_saldo:
            Number(saldo.rows[0].total_saldo),

          persentase_kehadiran_santri:
            unitSummary.academic.persentase_kehadiran_santri,

          persentase_kehadiran_guru:
            unitSummary.academic.persentase_kehadiran_guru,

          total_hafalan:
            unitSummary.academic.total_hafalan,

          rata_nilai:
            unitSummary.academic.rata_nilai,

          absensi_hari_ini:
            unitSummary.academic.absensi_hari_ini,

          nilai_terisi:
            unitSummary.academic.nilai_terisi,

          kehadiran_santri_hadir:
            unitSummary.academic.santri_hadir,

          kehadiran_santri_total:
            unitSummary.academic.santri_absensi_total,

          kehadiran_guru_hadir:
            unitSummary.academic.guru_hadir,

          kehadiran_guru_total:
            unitSummary.academic.guru_absensi_total,

          nilai_total:
            unitSummary.academic.nilai_total,

          santri_poin_tertinggi:
            unitSummary.operational.santri_poin_tertinggi,

          total_wali_akun:
            totalWaliAkun,

          wali_belum_ganti_pin:
            waliBelumGantiPin,

belum_kembali:
  unitSummary.operational.belum_kembali,

total_perizinan:
  unitSummary.operational.total_perizinan,

total_pelanggaran:
  unitSummary.operational.total_pelanggaran,

recent_perizinan:
  unitSummary.operational.recent_perizinan,

total_pengumuman:
  unitSummary.operational.total_pengumuman,

pengumuman_aktif:
  unitSummary.operational.pengumuman_aktif,

pengumuman_terbaru:
  unitSummary.operational.pengumuman_terbaru,

persentase_melanggar:
  unitSummary.health.total === 0
    ? 0
    : Math.round((unitSummary.operational.santri_melanggar / unitSummary.health.total) * 100),

  kas_masuk:
  financeSummary.cash.masuk,

kas_keluar:
  financeSummary.cash.keluar,

saldo_kas:
  financeSummary.cash.saldo,

nominal_tagihan:
  financeSummary.payment.nominal_tagihan,

sudah_dibayar:
  financeSummary.payment.sudah_dibayar,

sisa_belum_dibayar:
  financeSummary.payment.sisa_belum_dibayar,

pembayaran_hari_ini:
  financeSummary.payment.pembayaran_hari_ini,

tagihan_belum_lunas:
  financeSummary.payment.tagihan_belum_lunas,

total_pembayaran:
  financeSummary.sahriyah.sudah_dibayar,

total_tunggakan:
  financeSummary.sahriyah.sisa_belum_dibayar,

sahriyah_status:
  financeSummary.sahriyah.status,

grafik_kas:
  financeSummary.grafik_kas,

transaksi_terbaru:
  financeSummary.transaksi_terbaru,

pembayaran_terbaru:
  financeSummary.pembayaran_terbaru,

top_tunggakan:
  financeSummary.top_tunggakan,

tamu_hari_ini:
  unitSummary.guests.hari_ini,

tamu_bulan_ini:
  unitSummary.guests.bulan_ini,

tamu_masih_didalam:
  unitSummary.guests.masih_didalam,

kesehatan_sehat:
  unitSummary.health.sehat,

kesehatan_sakit:
  unitSummary.health.sakit,

kesehatan_perlu_tindak_lanjut:
  unitSummary.health.perlu_tindak_lanjut,

        }

      });

    }

    catch (err) {

      const response = buildDashboardErrorResponse(err);
      if (response.status >= 500) console.log(err);

      res.status(response.status).json(response.body);

    }

  }

);

router._test = {
  buildDashboardErrorResponse,
  getDashboardAllUnitsV1,
  queryDashboardKelasCount,
  queryDashboardSantriCounts,
};

module.exports = router;
