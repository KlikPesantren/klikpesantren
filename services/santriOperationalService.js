const pool = require("../db");
const { isSantriAktif, isSantriNonAktif } = require("../utils/santriStatus");
const { getBulanFilterVariants } = require("../utils/bulanNormalize");
const { sahriyahLedgerJoin, sahriyahCanonicalExpressions } = require("./sahriyahCanonicalSql");

async function getOperationalChecklist(tenantId, santriId, client = pool) {
  const santriResult = await client.query(
    `SELECT
       s.id,
       s.nama,
       s.status,
       s.uid_rfid,
       s.saldo,
       s.orang_tua,
       s.nomor_hp_ortu,
       ws.nama AS nama_wali,
       ws.nomor_hp AS nomor_hp_wali
     FROM santri s
     LEFT JOIN wali_santri ws
       ON ws.santri_id = s.id
      AND ws.tenant_id = s.tenant_id
     WHERE s.id = $1
       AND s.tenant_id = $2
     LIMIT 1`,
    [santriId, tenantId],
  );

  if (!santriResult.rows.length) {
    return null;
  }

  const santri = santriResult.rows[0];
  const now = new Date();
  const bulanVariants = getBulanFilterVariants(
    now.toLocaleString("id-ID", { month: "long" }),
  );
  const tahun = now.getFullYear();
  const bulanSahriyah = now.getMonth() + 1;

  const settingResult = await client.query(
    `SELECT id
     FROM sahriyah_setting
     WHERE santri_id = $1
       AND tenant_id = $2
     LIMIT 1`,
    [santriId, tenantId],
  );

  const pembayaranResult = await client.query(
    `SELECT id
     FROM pembayaran
     WHERE santri_id = $1
       AND tenant_id = $2
       AND tahun = $3
       AND LOWER(TRIM(bulan)) = ANY($4::text[])
     LIMIT 1`,
    [santriId, tenantId, tahun, bulanVariants],
  );

  const sahriyahResult = await client.query(
    `SELECT id
     FROM tagihan_sahriyah
     WHERE santri_id = $1
       AND tenant_id = $2
       AND bulan = $3
       AND tahun = $4
     LIMIT 1`,
    [santriId, tenantId, bulanSahriyah, tahun],
  );

  const hasWali =
    Boolean(String(santri.nama_wali || santri.orang_tua || "").trim()) &&
    Boolean(String(santri.nomor_hp_wali || santri.nomor_hp_ortu || "").trim());

  const hasSetting = settingResult.rows.length > 0;
  const hasTagihanBulan =
    pembayaranResult.rows.length > 0 || sahriyahResult.rows.length > 0;
  const hasRfidUid = Boolean(String(santri.uid_rfid || "").trim());

  return {
    santri_id: santri.id,
    nama: santri.nama,
    status: santri.status || "aktif",
    wali: { ok: hasWali, label: hasWali ? "Ada" : "Belum" },
    sahriyah_setting: { ok: hasSetting, label: hasSetting ? "Ada" : "Belum" },
    tagihan_bulan_berjalan: {
      ok: hasTagihanBulan,
      label: hasTagihanBulan ? "Ada" : "Belum",
    },
    rfid_uid: { ok: hasRfidUid, label: hasRfidUid ? "Ada" : "Belum" },
    saldo_rfid: Number(santri.saldo || 0),
  };
}

async function getExitSummary(tenantId, santriId, client = pool) {
  const checklist = await getOperationalChecklist(tenantId, santriId, client);
  if (!checklist) return null;

  const pembayaranOpen = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM pembayaran
     WHERE santri_id = $1
       AND tenant_id = $2
       AND LOWER(TRIM(COALESCE(status, ''))) != 'lunas'`,
    [santriId, tenantId],
  );

  const sahriyahOpen = await client.query(
    `SELECT COUNT(*)::int AS total
     FROM tagihan_sahriyah t
     ${sahriyahLedgerJoin("t")}
     WHERE t.santri_id = $1
       AND t.tenant_id = $2
       AND ${sahriyahCanonicalExpressions("t").status} != 'Lunas'`,
    [santriId, tenantId],
  );

  const hasWali = checklist.wali.ok;

  return {
    ...checklist,
    tagihan_pembayaran_belum_lunas: pembayaranOpen.rows[0]?.total || 0,
    tagihan_sahriyah_belum_lunas: sahriyahOpen.rows[0]?.total || 0,
    kartu_rfid_aktif: checklist.rfid_uid.ok,
    wali_terhubung: hasWali,
    is_nonaktif: isSantriNonAktif(checklist.status),
  };
}

module.exports = {
  getOperationalChecklist,
  getExitSummary,
};
