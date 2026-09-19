const pool = require("../db");
const { getTenantById } = require("./tenantService");
const { getTenantHealth } = require("./tenantHealthService");
const { sahriyahLedgerJoin, sahriyahCanonicalExpressions } = require("./sahriyahCanonicalSql");

function getDateRanges(now = new Date()) {
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  );
  const startOfTomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1
  );

  return {
    startOfMonth,
    startOfNextMonth,
    startOfToday,
    startOfTomorrow,
    bulan: now.getMonth() + 1,
    tahun: now.getFullYear(),
  };
}

function pct(hadir, total) {
  const h = Number(hadir || 0);
  const t = Number(total || 0);
  if (t === 0) return 0;
  return Math.round((h / t) * 100);
}

async function getOperasionalStats(tenantId) {
  const [santri, guru, wali, kelas] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n FROM santri
       WHERE tenant_id = $1 AND LOWER(status) = 'aktif'`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM guru
       WHERE tenant_id = $1 AND LOWER(status) = 'aktif'`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM wali_santri WHERE tenant_id = $1`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM kelas WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);

  return {
    total_santri: santri.rows[0].n,
    total_guru: guru.rows[0].n,
    total_wali: wali.rows[0].n,
    total_kelas: kelas.rows[0].n,
  };
}

async function getKeuanganStats(tenantId, ranges) {
  const { startOfMonth, startOfNextMonth } = ranges;
  const canonical = sahriyahCanonicalExpressions("t");

  const [tagihan, pembayaran, bukuKas, kasInstansi] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(${canonical.remaining}), 0)::bigint AS nominal
       FROM tagihan_sahriyah t
       ${sahriyahLedgerJoin("t")}
       WHERE t.tenant_id = $1
         AND ${canonical.remaining} > 0`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS cnt, COALESCE(SUM(nominal_bayar), 0)::bigint AS nominal
       FROM pembayaran
       WHERE tenant_id = $1
         AND tanggal_bayar >= $2
         AND tanggal_bayar < $3`,
      [tenantId, startOfMonth, startOfNextMonth]
    ),
    pool.query(
      `SELECT COALESCE(
         SUM(CASE WHEN jenis = 'Masuk' THEN nominal ELSE -nominal END),
         0
       )::bigint AS saldo
       FROM buku_kas
       WHERE tenant_id = $1`,
      [tenantId]
    ),
    pool.query(
      `SELECT COALESCE(
         SUM(CASE WHEN t.jenis = 'Masuk' THEN t.nominal ELSE -t.nominal END),
         0
       )::bigint AS saldo
       FROM kas_instansi_transaksi t
       INNER JOIN unit_pendidikan u ON u.id = t.unit_id
       WHERE u.tenant_id = $1`,
      [tenantId]
    ),
  ]);

  return {
    tagihan_aktif_count: tagihan.rows[0].cnt,
    tagihan_aktif_nominal: Number(tagihan.rows[0].nominal),
    pembayaran_bulan_ini_count: pembayaran.rows[0].cnt,
    pembayaran_bulan_ini_nominal: Number(pembayaran.rows[0].nominal),
    saldo_buku_kas: Number(bukuKas.rows[0].saldo),
    saldo_kas_instansi: Number(kasInstansi.rows[0].saldo),
  };
}

async function getPendidikanStats(tenantId, ranges) {
  const { startOfMonth, startOfNextMonth, bulan, tahun } = ranges;

  const [absensiSantri, absensiGuru, hafalan, nilai] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*) FILTER (
           WHERE status IN ('H', 'Hadir', 'hadir')
         )::int AS hadir,
         COUNT(*)::int AS total
       FROM absensi
       WHERE tenant_id = $1
         AND tanggal >= $2
         AND tanggal < $3`,
      [tenantId, startOfMonth, startOfNextMonth]
    ),
    pool.query(
      `SELECT
         COALESCE(SUM(total_hadir), 0)::int AS hadir,
         COALESCE(
           SUM(total_hadir + total_izin + total_sakit + total_alfa),
           0
         )::int AS total
       FROM absensi_guru
       WHERE tenant_id = $1 AND bulan = $2 AND tahun = $3`,
      [tenantId, bulan, tahun]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM hafalan WHERE tenant_id = $1`,
      [tenantId]
    ),
    pool.query(
      `SELECT COALESCE(AVG(nilai), 0)::float AS rata
       FROM nilai_mingguan
       WHERE tenant_id = $1`,
      [tenantId]
    ),
  ]);

  return {
    kehadiran_santri_pct: pct(
      absensiSantri.rows[0].hadir,
      absensiSantri.rows[0].total
    ),
    kehadiran_guru_pct: pct(
      absensiGuru.rows[0].hadir,
      absensiGuru.rows[0].total
    ),
    total_hafalan: hafalan.rows[0].n,
    rata_nilai: Math.round(Number(nilai.rows[0].rata) * 100) / 100,
  };
}

async function getKeamananStats(tenantId, ranges) {
  const { startOfMonth, startOfNextMonth } = ranges;

  const [izin, pelanggaran] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS n
       FROM perizinan
       WHERE tenant_id = $1 AND status = 'keluar'`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
       FROM pelanggaran
       WHERE tenant_id = $1
         AND tanggal >= $2
         AND tanggal < $3`,
      [tenantId, startOfMonth, startOfNextMonth]
    ),
  ]);

  return {
    santri_izin_aktif: izin.rows[0].n,
    pelanggaran_bulan_ini: pelanggaran.rows[0].n,
  };
}

async function getRfidStats(tenantId, ranges) {
  const { startOfToday, startOfTomorrow } = ranges;

  const [topup, transaksi, devices, merchant] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(nominal), 0)::bigint AS total
       FROM transaksi_rfid
       WHERE tenant_id = $1
         AND trx_type = 'topup'
         AND created_at >= $2
         AND created_at < $3`,
      [tenantId, startOfToday, startOfTomorrow]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
       FROM transaksi_rfid
       WHERE tenant_id = $1
         AND created_at >= $2
         AND created_at < $3`,
      [tenantId, startOfToday, startOfTomorrow]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
       FROM devices
       WHERE tenant_id = $1 AND status = 'online'`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n
       FROM merchant_rfid
       WHERE tenant_id = $1 AND status = true`,
      [tenantId]
    ),
  ]);

  return {
    topup_hari_ini: Number(topup.rows[0].total),
    transaksi_hari_ini: transaksi.rows[0].n,
    device_online: devices.rows[0].n,
    merchant_aktif: merchant.rows[0].n,
  };
}

async function getTenantPlatformDashboard(tenantId) {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {
    return null;
  }

  const ranges = getDateRanges();
  const tid = Number(tenantId);

  const [operasional, keuangan, pendidikan, keamanan, rfid, health] = await Promise.all([
    getOperasionalStats(tid),
    getKeuanganStats(tid, ranges),
    getPendidikanStats(tid, ranges),
    getKeamananStats(tid, ranges),
    getRfidStats(tid, ranges),
    getTenantHealth(tid),
  ]);

  return {
    success: true,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.nama,
      status: tenant.status,
      onboarded_at: tenant.onboarded_at,
    },
    operasional,
    keuangan,
    pendidikan,
    keamanan,
    rfid,
    health,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getDateRanges,
  getTenantPlatformDashboard,
};
