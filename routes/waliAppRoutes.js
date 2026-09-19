console.log(
  "WALI APP ROUTES LOADED"
);

const express =
  require("express");

const router =
  express.Router();

const pool =
  require("../db");

const waliAppService =
  require("../services/waliAppService");

const waliAppAuthMiddleware =
  require("../middleware/waliAppAuthMiddleware");

const waliSantriGuard =
  require("../middleware/waliSantriGuard");
const { requireWaliUnit, requireWaliUnitFeature } = require("../middleware/waliUnitFeatureGuard");

const notificationService =
  require("../services/notificationService");

const pushNotificationService =
  require("../services/pushNotificationService");

const {
  resolveTenantForLogin,
} = require("../services/tenantService");
const { getWhiteLabelTenantSlug } = require("../services/appBrandProfileService");

const requireTenantFeature = require("../middleware/requireTenantFeature");
const { isFeatureEnabled } = require("../services/tenantFeatureService");
const { getEffectiveUnitFeatures } = require("../services/unitFeatureService");
const { isUnitFeatureEnabled } = require("../services/unitFeatureService");
const { buildWaliCapabilities } = require("../services/waliCapabilitiesService");
const {
  sahriyahLedgerJoin,
  sahriyahCanonicalSelect,
  projectCanonicalSahriyah,
} = require("../services/sahriyahCanonicalSql");

const withWaliAuth = [waliAppAuthMiddleware, requireTenantFeature("wali_app")];

function getYoutubeVideoId(url) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.hostname.includes("youtu.be")) {
      return parsed.pathname.split("/").filter(Boolean)[0] || null;
    }
    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v");
    }
  } catch {
    return null;
  }
  return null;
}

function resolveHomeLinkThumbnail(row) {
  if (row.thumbnail_url) return row.thumbnail_url;
  if (String(row.type || "").toLowerCase() !== "youtube") return null;
  const videoId = getYoutubeVideoId(row.url);
  return videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : null;
}

// =====================
// POST /wali-app/login
// =====================

router.post(

  "/login",

  async (req, res) => {

    console.log("WALI APP LOGIN HIT");

    try {

      const {

        tenant_slug,
        brand_key,
        nomor_hp,
        pin

      } = req.body;

      const resolvedTenantSlug = brand_key && brand_key !== "universal"
        ? await getWhiteLabelTenantSlug(brand_key)
        : tenant_slug;

      if (brand_key && brand_key !== "universal" && !resolvedTenantSlug) {
        return res.status(404).json({ success: false, error: "Brand aplikasi tidak aktif", code: "BRAND_NOT_AVAILABLE" });
      }

      const tenantResult =
        await resolveTenantForLogin(
          resolvedTenantSlug
        );

      if (tenantResult.error) {

        return res.status(
          tenantResult.status || 400
        ).json({

          success: false,

          error: tenantResult.error,

          message: tenantResult.error,

        });

      }

      const tenant =
        tenantResult.tenant;

      if (!(await isFeatureEnabled(tenant.id, "wali_app"))) {
        return res.status(403).json({
          success: false,
          error: "Fitur aplikasi wali tidak aktif untuk pesantren ini",
          feature: "wali_app",
          code: "FEATURE_DISABLED",
        });
      }

      const normalized =
        waliAppService.normalizePhone(
          nomor_hp
        );

      if (
        !normalized ||
        !waliAppService.isValidPinFormat(pin)
      ) {

        return res.status(400).json({

          success: false,

          error:
            "Nomor HP atau PIN tidak valid"

        });

      }

      const akun =
        await waliAppService.findAkunByPhone(
          normalized,
          tenant.id
        );

      if (!akun) {

        await waliAppService.writeAudit({

          nomorHp: normalized,

          event: "login_failed",

          ipAddress: req.ip,

          userAgent:
            req.headers["user-agent"]

        });

        return res.status(401).json({

          success: false,

          error:
            "Nomor HP atau PIN salah"

        });

      }

      if (
        akun.status !== "active"
      ) {

        return res.status(403).json({

          success: false,

          error:
            "Akun wali ditangguhkan"

        });

      }

      if (
        waliAppService.isAccountLocked(
          akun
        )
      ) {

        return res.status(423).json({

          success: false,

          error:
            "Akun terkunci. Coba lagi nanti."

        });

      }

      const pinValid =
        await waliAppService.verifyPin(
          pin,
          akun.pin_hash
        );

      if (!pinValid) {

        await waliAppService.registerFailedLogin(
          akun.id
        );

        await waliAppService.writeAudit({

          nomorHp: normalized,

          event: "login_failed",

          ipAddress: req.ip,

          userAgent:
            req.headers["user-agent"]

        });

        return res.status(401).json({

          success: false,

          error:
            "Nomor HP atau PIN salah"

        });

      }

      await waliAppService.registerSuccessfulLogin(
        akun.id
      );

      const freshAkun =
        await waliAppService.findAkunByPhone(
          normalized,
          tenant.id
        );

      const loginData =
        await waliAppService.buildLoginResponse(
          freshAkun,
          tenant
        );

      await waliAppService.writeAudit({

        nomorHp: normalized,

        event: "login_success",

        ipAddress: req.ip,

        userAgent:
          req.headers["user-agent"]

      });

      res.json({

        success: true,

        ...loginData

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

router.get("/features", ...withWaliAuth, waliSantriGuard, requireWaliUnit, async (req, res) => {
  try {
    const unitFeatures = await getEffectiveUnitFeatures(
      req.wali.tenant_id,
      req.waliUnit.unit_id,
    );
    res.json({
      success: true,
      data: buildWaliCapabilities(unitFeatures, req.waliUnit),
    });
  } catch (err) {
    console.error("[wali-app features]", err);
    res.status(500).json({
      success: false,
      error: "Gagal memuat fitur aplikasi wali",
    });
  }
});

router.get("/home-links", ...withWaliAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, url, type, thumbnail_url, sort_order, created_at
       FROM wali_home_links
       WHERE tenant_id = $1
         AND is_active = true
       ORDER BY sort_order ASC, id ASC`,
      [req.wali.tenant_id]
    );

    res.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        resolved_thumbnail_url: resolveHomeLinkThumbnail(row),
      })),
    });
  } catch (err) {
    console.error("[wali-app home-links]", err);
    res.status(500).json({
      success: false,
      error: "Gagal memuat tautan beranda wali",
    });
  }
});

// =====================
// GET /wali-app/me
// =====================

router.get(

  "/me",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const anak =
        await waliAppService.getAnakList(
          req.wali.nomor_hp,
          req.tenantId
        );

      res.json({

        success: true,

        wali:
          waliAppService.buildWaliProfile({

            nomor_hp:
              req.wali.nomor_hp,

            nama:
              req.wali.nama,

            must_change_pin:
              req.wali.must_change_pin

          }),

        anak,

        santri_ids:
          req.wali.santri_ids

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// =====================
// GET /wali-app/anak
// =====================

router.get(

  "/anak",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const anak =
        await waliAppService.getAnakList(
          req.wali.nomor_hp,
          req.tenantId
        );

      res.json({

        success: true,

        data: anak,

        total: anak.length

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/dashboard
// ======================

router.get(

  "/dashboard",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnit,

  async (req, res) => {

    const santriId = req.santriId;
    const tenantId = req.tenantId;

    try {

      const effectiveFeatures = await getEffectiveUnitFeatures(
        tenantId,
        req.waliUnit.unit_id
      );
      const capabilities = buildWaliCapabilities(effectiveFeatures, req.waliUnit);
      const isEnabled = (key) => capabilities[key] === true;

      const santri =
        await pool.query(

          `
          SELECT
            s.id,
            s.nis,
            s.nama,
            s.kamar,
            s.foto,
            COALESCE(wa.current_balance, 0) AS saldo,
            k.nama_kelas,
            su.unit_id,
            u.kode AS unit_kode,
            u.nama AS unit_nama
          FROM santri s
          JOIN santri_units su
            ON su.santri_id = s.id AND su.tenant_id = s.tenant_id
           AND su.status = 'active' AND su.left_at IS NULL
          JOIN unit_pendidikan u
            ON u.id = su.unit_id AND u.tenant_id = su.tenant_id
          LEFT JOIN santri_kelas_enrollments e
            ON e.santri_unit_id = su.id AND e.tenant_id = su.tenant_id
           AND e.status = 'active'
          LEFT JOIN kelas k
            ON k.id = e.kelas_id AND k.tenant_id = e.tenant_id
          LEFT JOIN wallet_accounts wa
            ON wa.tenant_id = su.tenant_id AND wa.unit_id = su.unit_id
           AND wa.santri_id = su.santri_id AND wa.status = 'active'
          WHERE s.id = $1
            AND s.tenant_id = $2
            AND su.unit_id = $3
          LIMIT 1
          `,

          [santriId, tenantId, req.waliUnit.unit_id]

        );

      if (
        santri.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          error: "Santri tidak ditemukan"

        });

      }

      const now = new Date();

      const bulan =
        now.getMonth() + 1;

      const tahun =
        now.getFullYear();

      const emptyRows = { rows: [] };
      const queryWhenEnabled = (featureKey, sql, params) =>
        isEnabled(featureKey) ? pool.query(sql, params) : Promise.resolve(emptyRows);

      const [
        kehadiran,
        sahriyahAktif,
        izinAktif,
        pelanggaranBulanIni,
        kesehatanAktif,
        hafalanBulanIni,
        rataNilai,
        statistikPesantren,
      ] = await Promise.all([
        queryWhenEnabled(
          "absensi",

          `
          SELECT
            COUNT(*) FILTER (
              WHERE status = 'H'
              OR status = 'Hadir'
            ) AS hadir,
            COUNT(*) AS total
          FROM absensi
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND EXTRACT(MONTH FROM tanggal::date) = $4
            AND EXTRACT(YEAR FROM tanggal::date) = $5
          `,

          [santriId, tenantId, req.waliUnit.unit_id, bulan, tahun]
        ),
        queryWhenEnabled(
          "sahriyah",

          `
          SELECT
            t.id,
            t.bulan,
            t.tahun,
            t.nominal,
            ${sahriyahCanonicalSelect("t")}
          FROM tagihan_sahriyah t
          ${sahriyahLedgerJoin("t")}
          WHERE t.santri_id = $1
            AND t.tenant_id = $2
            AND t.unit_id = $3
            AND t.bulan = $4
            AND t.tahun = $5
          LIMIT 1
          `,

          [santriId, tenantId, req.waliUnit.unit_id, bulan, tahun]
        ),
        queryWhenEnabled(
          "perizinan",

          `
          SELECT COUNT(*) AS total
          FROM perizinan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND status = 'keluar'
          `,

          [santriId, tenantId, req.waliUnit.unit_id]
        ),
        queryWhenEnabled(
          "pelanggaran",

          `
          SELECT COUNT(*) AS total
          FROM pelanggaran
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND EXTRACT(MONTH FROM tanggal::date) = $4
            AND EXTRACT(YEAR FROM tanggal::date) = $5
          `,

          [santriId, tenantId, req.waliUnit.unit_id, bulan, tahun]
        ),
        queryWhenEnabled(
          "kesehatan",

          `
          SELECT
            id,
            status_kesehatan,
            status_penanganan,
            keluhan,
            tindakan_pertama,
            created_at,
            updated_at
          FROM kesehatan_santri
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          ORDER BY created_at DESC
          LIMIT 1
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        ),
        queryWhenEnabled(
          "hafalan",

          `
          SELECT COUNT(*) AS total
          FROM hafalan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND bulan = $4
            AND tahun = $5
          `,

          [santriId, tenantId, req.waliUnit.unit_id, bulan, tahun]
        ),
        queryWhenEnabled(
          "nilai",

          `
          SELECT COALESCE(
            ROUND(AVG(nilai::numeric), 0),
            0
          ) AS rata
          FROM nilai_mingguan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND bulan = $4
            AND tahun = $5
          `,

          [santriId, tenantId, req.waliUnit.unit_id, bulan, tahun]
        ),
        waliAppService.getStatistikPesantren(tenantId, req.waliUnit.unit_id),
      ]);

      const kHadir =
        Number(
          kehadiran.rows[0]?.hadir || 0
        );

      const kTotal =
        Number(
          kehadiran.rows[0]?.total || 0
        );

      const pctHadir =
        kTotal === 0
          ? 0
          : Math.round(
              (kHadir / kTotal) * 100
            );

      res.json({

        success: true,

        santri_id: santriId,

        data: {

          profil: {
            ...santri.rows[0],
            saldo: isEnabled("wallet") ? Number(santri.rows[0].saldo || 0) : null,
          },

          capabilities,

          bulan,

          tahun,

          kehadiran: isEnabled("absensi") ? {

            hadir: kHadir,

            total: kTotal,

            persentase: pctHadir

          } : null,

          sahriyah_aktif:
            isEnabled("sahriyah") && sahriyahAktif.rows[0]
              ? projectCanonicalSahriyah(sahriyahAktif.rows[0])
              : null,

          saldo_dompet:
            isEnabled("wallet") ? Number(santri.rows[0].saldo || 0) : null,

          saldo_rfid:
            isEnabled("wallet") && isEnabled("rfid") ? Number(
              santri.rows[0].saldo || 0
            ) : null,

          izin_aktif:
            isEnabled("perizinan") ? Number(
              izinAktif.rows[0]?.total || 0
            ) : null,

          pelanggaran_bulan_ini:
            isEnabled("pelanggaran") ? Number(
              pelanggaranBulanIni.rows[0]?.total || 0
            ) : null,

          kesehatan_aktif:
            isEnabled("kesehatan") ? (kesehatanAktif.rows[0] || {
              status_kesehatan: "sehat",
              status_penanganan: "observasi",
            }) : null,

          hafalan_bulan_ini:
            isEnabled("hafalan") ? Number(
              hafalanBulanIni.rows[0]?.total || 0
            ) : null,

          rata_nilai_bulan_ini:
            isEnabled("nilai") ? Number(
              rataNilai.rows[0]?.rata || 0
            ) : null,

          statistik_pesantren: statistikPesantren,

        }

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/santri/profil
// ======================

router.get(

  "/santri/profil",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnit,

  async (req, res) => {

    const santriId = req.santriId;
    const tenantId = req.tenantId;

    try {

      const result =
        await pool.query(

          `
          SELECT
            s.id AS santri_id,
            s.nis,
            s.nama,
            s.kamar,
            s.alamat,
            s.orang_tua,
            s.nomor_hp_ortu,
            s.foto,
            COALESCE(wa.current_balance, 0) AS saldo,
            s.limit_harian,
            k.nama_kelas,
            su.unit_id,
            u.kode AS unit_kode,
            u.nama AS unit_nama,
            ws.nama AS nama_wali,
            ws.nomor_hp AS nomor_hp_wali,
            ws.alamat AS alamat_wali
          FROM santri s
          JOIN santri_units su
            ON su.santri_id = s.id AND su.tenant_id = s.tenant_id
           AND su.status = 'active' AND su.left_at IS NULL
          JOIN unit_pendidikan u
            ON u.id = su.unit_id AND u.tenant_id = su.tenant_id
          LEFT JOIN santri_kelas_enrollments e
            ON e.santri_unit_id = su.id AND e.tenant_id = su.tenant_id
           AND e.status = 'active'
          LEFT JOIN kelas k
            ON k.id = e.kelas_id AND k.tenant_id = e.tenant_id
          LEFT JOIN wallet_accounts wa
            ON wa.tenant_id = su.tenant_id AND wa.unit_id = su.unit_id
           AND wa.santri_id = su.santri_id AND wa.status = 'active'
          LEFT JOIN wali_santri ws
            ON ws.santri_id = s.id
           AND ws.tenant_id = s.tenant_id
           AND ws.nomor_hp = $2
          WHERE s.id = $1
            AND s.tenant_id = $3
            AND su.unit_id = $4
          LIMIT 1
          `,

          [santriId, req.wali.nomor_hp, tenantId, req.waliUnit.unit_id]

        );

      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          error: "Santri tidak ditemukan"

        });

      }

      res.json({

        success: true,

        data: result.rows[0]

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/sahriyah
// ======================

router.get(

  "/sahriyah",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("sahriyah"),

  async (req, res) => {

    const santriId = req.santriId;
    const tenantId = req.tenantId;

    const bulan =
      req.query.bulan
        ? Number(req.query.bulan)
        : null;

    const tahun =
      req.query.tahun
        ? Number(req.query.tahun)
        : null;

    try {

      let queryText = `
        SELECT
          t.id,
          t.bulan,
          t.tahun,
          t.nominal,
          t.nominal_beras,
          t.petugas,
          t.tanggal_bayar,
          t.keterangan,
          ${sahriyahCanonicalSelect("t")}
        FROM tagihan_sahriyah t
        ${sahriyahLedgerJoin("t")}
        WHERE t.santri_id = $1
          AND t.tenant_id = $2
          AND t.unit_id = $3
      `;

      const params = [santriId, tenantId, req.waliUnit.unit_id];

      if (
        bulan &&
        bulan >= 1 &&
        bulan <= 12
      ) {

        params.push(bulan);

        queryText +=
          ` AND t.bulan = $${params.length}`;

      }

      if (tahun && tahun > 2000) {

        params.push(tahun);

        queryText +=
          ` AND t.tahun = $${params.length}`;

      }

      queryText +=
        " ORDER BY t.tahun DESC, t.bulan DESC";

      const result =
        await pool.query(
          queryText,
          params
        );

      res.json({

        success: true,

        santri_id: santriId,

        data: result.rows.map(projectCanonicalSahriyah),

        total: result.rows.length

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/sahriyah/:tagihan_id/riwayat
// ======================

router.get(

  "/sahriyah/:tagihan_id/riwayat",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("sahriyah"),

  async (req, res) => {

    const santriId = req.santriId;
    const tenantId = req.tenantId;

    const tagihanId =
      Number(req.params.tagihan_id);

    if (
      !Number.isInteger(tagihanId) ||
      tagihanId <= 0
    ) {

      return res.status(400).json({

        success: false,

        error: "tagihan_id tidak valid"

      });

    }

    try {

      const check =
        await pool.query(

          `
          SELECT id
          FROM tagihan_sahriyah
          WHERE id = $1
            AND santri_id = $2
            AND tenant_id = $3
            AND unit_id = $4
          LIMIT 1
          `,

          [tagihanId, santriId, tenantId, req.waliUnit.unit_id]

        );

      if (check.rows.length === 0) {

        return res.status(403).json({

          success: false,

          error: "Tagihan tidak ditemukan atau bukan milik santri ini"

        });

      }

      const result =
        await pool.query(

          `
          SELECT
            id,
            nominal,
            nominal_beras,
            petugas,
            tanggal
          FROM pembayaran_sahriyah
          WHERE tagihan_id = $1
            AND tenant_id = $2
            AND unit_id = $3
          ORDER BY tanggal DESC
          `,

          [tagihanId, tenantId, req.waliUnit.unit_id]

        );

      res.json({

        success: true,

        tagihan_id: tagihanId,

        santri_id: santriId,

        data: result.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/rfid/saldo
// ======================

router.get(

  "/rfid/saldo",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("wallet"),

  async (req, res) => {

    const santriId = req.santriId;

    try {

      const result =
        await pool.query(

          `
          SELECT s.id AS santri_id, s.nama, s.kamar, s.uid_rfid,
                 COALESCE(wa.current_balance, 0) AS saldo,
                 COALESCE(s.limit_harian, 0) AS limit_harian
          FROM santri_units su
          JOIN santri s ON s.id = su.santri_id AND s.tenant_id = su.tenant_id
          LEFT JOIN wallet_accounts wa
            ON wa.tenant_id = su.tenant_id AND wa.unit_id = su.unit_id
           AND wa.santri_id = su.santri_id AND wa.status = 'active'
          WHERE su.santri_id = $1
            AND su.tenant_id = $2
            AND su.unit_id = $3
            AND su.status = 'active'
            AND su.left_at IS NULL
          LIMIT 1
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        );

      if (
        result.rows.length === 0
      ) {

        return res.status(404).json({

          success: false,

          error: "Santri tidak ditemukan"

        });

      }

      const row = result.rows[0];
      const rfidEnabled = await isUnitFeatureEnabled(
        req.tenantId,
        req.waliUnit.unit_id,
        "rfid",
      );

      res.json({

        success: true,

        data: {

          santri_id: row.santri_id,

          nama: row.nama,

          uid_rfid: rfidEnabled ? row.uid_rfid : null,

          saldo: Number(
            row.saldo || 0
          ),

          limit_harian: Number(
            row.limit_harian || 0
          ),

          kartu_aktif: rfidEnabled ? row.uid_rfid !== null : null,
          rfid_enabled: rfidEnabled,

        }

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/rfid/mutasi
// ======================

router.get(

  "/rfid/mutasi",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("wallet"),

  async (req, res) => {

    const santriId = req.santriId;

    const limit =
      Math.min(
        Number(req.query.limit) || 20,
        100
      );

    const offset =
      Math.max(
        Number(req.query.offset) || 0,
        0
      );

    try {

      const result =
        await pool.query(

          `
          SELECT wt.id, wt.created_at, wt.type AS trx_type,
            wt.amount AS nominal, NULL::bigint AS saldo_awal,
            wt.balance_after AS saldo_akhir, wt.reference_id AS trx_id,
            m.nama_merchant
          FROM wallet_transactions wt
          JOIN wallet_accounts wa
            ON wa.id = wt.wallet_account_id AND wa.tenant_id = wt.tenant_id
           AND wa.unit_id = wt.unit_id
           AND wa.status = 'active'
          LEFT JOIN merchant_rfid m
            ON m.id = wt.merchant_id AND m.tenant_id = wt.tenant_id
          WHERE wa.santri_id = $1
            AND wt.tenant_id = $2
            AND wt.unit_id = $3
          ORDER BY wt.created_at DESC
          LIMIT $4
          OFFSET $5
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, limit, offset]

        );

      const countResult =
        await pool.query(

          `
          SELECT COUNT(*) AS total
          FROM wallet_transactions wt
          JOIN wallet_accounts wa
            ON wa.id = wt.wallet_account_id AND wa.tenant_id = wt.tenant_id
           AND wa.unit_id = wt.unit_id
           AND wa.status = 'active'
          WHERE wa.santri_id = $1
            AND wt.tenant_id = $2
            AND wt.unit_id = $3
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        );

      res.json({

        success: true,

        santri_id: santriId,

        pagination: {

          limit,

          offset,

          total: Number(
            countResult.rows[0]?.total || 0
          )

        },

        data: result.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/hafalan
// ======================

router.get(

  "/hafalan",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("hafalan"),

  async (req, res) => {

    const santriId = req.santriId;

    const now = new Date();

    const bulan =
      req.query.bulan
        ? Number(req.query.bulan)
        : now.getMonth() + 1;

    const tahun =
      req.query.tahun
        ? Number(req.query.tahun)
        : now.getFullYear();

    if (
      !Number.isInteger(bulan) ||
      bulan < 1 ||
      bulan > 12
    ) {

      return res.status(400).json({

        success: false,

        error: "Parameter bulan tidak valid (1-12)"

      });

    }

    if (
      !Number.isInteger(tahun) ||
      tahun < 2000 ||
      tahun > 2100
    ) {

      return res.status(400).json({

        success: false,

        error: "Parameter tahun tidak valid"

      });

    }

    try {

      const dataResult =
        await pool.query(

          `
          SELECT
            id,
            santri_id,
            tanggal,
            kitab,
            awal,
            akhir,
            catatan,
            bulan,
            tahun,
            pekan
          FROM hafalan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND bulan = $4
            AND tahun = $5
          ORDER BY pekan ASC, tanggal ASC
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, bulan, tahun]

        );

      const ringkasanResult =
        await pool.query(

          `
          SELECT
            COUNT(*)                         AS total_entri,
            COUNT(DISTINCT pekan)            AS total_pekan
          FROM hafalan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND bulan = $4
            AND tahun = $5
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, bulan, tahun]

        );

      const raw = ringkasanResult.rows[0];

      res.json({

        success: true,

        santri_id: santriId,

        bulan,

        tahun,

        ringkasan: {

          total_entri: Number(raw?.total_entri || 0),

          total_pekan: Number(raw?.total_pekan || 0)

        },

        data: dataResult.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/nilai
// ======================

router.get(

  "/nilai",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("nilai"),

  async (req, res) => {

    const santriId = req.santriId;

    const now = new Date();

    const bulan =
      req.query.bulan
        ? Number(req.query.bulan)
        : now.getMonth() + 1;

    const tahun =
      req.query.tahun
        ? Number(req.query.tahun)
        : now.getFullYear();

    if (
      !Number.isInteger(bulan) ||
      bulan < 1 ||
      bulan > 12
    ) {

      return res.status(400).json({

        success: false,

        error: "Parameter bulan tidak valid (1-12)"

      });

    }

    if (
      !Number.isInteger(tahun) ||
      tahun < 2000 ||
      tahun > 2100
    ) {

      return res.status(400).json({

        success: false,

        error: "Parameter tahun tidak valid"

      });

    }

    try {

      const dataResult =
        await pool.query(

          `
          SELECT
            id,
            santri_id,
            tanggal,
            mapel,
            nilai,
            bulan,
            tahun
          FROM nilai_mingguan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND bulan = $4
            AND tahun = $5
          ORDER BY tanggal DESC, mapel ASC
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, bulan, tahun]

        );

      const ringkasanResult =
        await pool.query(

          `
          SELECT
            COUNT(*)                                     AS total_mapel,
            COALESCE(ROUND(AVG(nilai::numeric), 1), 0)  AS rata_rata,
            COALESCE(MAX(nilai::numeric), 0)             AS nilai_tertinggi,
            COALESCE(MIN(nilai::numeric), 0)             AS nilai_terendah
          FROM nilai_mingguan
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND bulan = $4
            AND tahun = $5
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, bulan, tahun]

        );

      const raw = ringkasanResult.rows[0];

      res.json({

        success: true,

        santri_id: santriId,

        bulan,

        tahun,

        ringkasan: {

          total_mapel: Number(raw?.total_mapel || 0),

          rata_rata: Number(raw?.rata_rata || 0),

          nilai_tertinggi: Number(raw?.nilai_tertinggi || 0),

          nilai_terendah: Number(raw?.nilai_terendah || 0)

        },

        data: dataResult.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/kesehatan
// ======================

router.get(

  "/kesehatan",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("kesehatan"),

  async (req, res) => {

    const santriId = req.santriId;

    try {

      const records =
        await pool.query(

          `
          SELECT
            id,
            santri_id,
            status_kesehatan,
            keluhan,
            tindakan_pertama,
            status_penanganan,
            created_at,
            updated_at
          FROM kesehatan_santri
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          ORDER BY created_at ASC
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        );

      const rows = records.rows;
      const current = rows.length
        ? rows[rows.length - 1]
        : {
            status_kesehatan: "sehat",
            status_penanganan: "observasi",
            keluhan: null,
            tindakan_pertama: null,
          };

      const timeline = [];

      for (const row of rows) {
        if (row.keluhan) {
          timeline.push({
            time: row.created_at,
            text: row.keluhan,
          });
        }
        if (row.tindakan_pertama) {
          timeline.push({
            time: row.created_at,
            text: row.tindakan_pertama,
          });
        }
        if (row.status_penanganan) {
          timeline.push({
            time: row.updated_at || row.created_at,
            text: `Status penanganan: ${String(row.status_penanganan).replace(/_/g, " ")}`,
          });
        }
      }

      res.json({

        success: true,

        santri_id: santriId,

        current,

        timeline,

        data: rows,

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/pelanggaran
// ======================

router.get(

  "/pelanggaran",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("pelanggaran"),

  async (req, res) => {

    const santriId = req.santriId;

    const limit =
      Math.min(
        Number(req.query.limit) || 30,
        100
      );

    const offset =
      Math.max(
        Number(req.query.offset) || 0,
        0
      );

    try {

      const dataResult =
        await pool.query(

          `
          SELECT
            id,
            santri_id,
            tanggal,
            jam,
            jenis,
            tingkat,
            poin,
            catatan,
            tindakan,
            petugas
          FROM pelanggaran
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          ORDER BY tanggal DESC, id DESC
          LIMIT $4
          OFFSET $5
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, limit, offset]

        );

      const ringkasanResult =
        await pool.query(

          `
          SELECT
            COUNT(*)      AS total,
            COALESCE(SUM(poin), 0) AS total_poin
          FROM pelanggaran
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        );

      const countResult =
        await pool.query(

          `
          SELECT COUNT(*) AS total
          FROM pelanggaran
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        );

      const raw = ringkasanResult.rows[0];

      res.json({

        success: true,

        santri_id: santriId,

        ringkasan: {

          total: Number(raw?.total || 0),

          total_poin: Number(raw?.total_poin || 0)

        },

        pagination: {

          limit,

          offset,

          total: Number(
            countResult.rows[0]?.total || 0
          )

        },

        data: dataResult.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/perizinan
// ======================

router.get(

  "/perizinan",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("perizinan"),

  async (req, res) => {

    const santriId = req.santriId;

    const limit =
      Math.min(
        Number(req.query.limit) || 20,
        100
      );

    const offset =
      Math.max(
        Number(req.query.offset) || 0,
        0
      );

    try {

      const result =
        await pool.query(

          `
          SELECT
            id,
            santri_id,
            tanggal,
            alasan,
            tujuan,
            tanggal_kembali,
            jam_keluar,
            jam_kembali,
            status,
            catatan
          FROM perizinan
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          ORDER BY tanggal DESC, id DESC
          LIMIT $4
          OFFSET $5
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, limit, offset]

        );

      const countResult =
        await pool.query(

          `
          SELECT COUNT(*) AS total
          FROM perizinan
          WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id]

        );

      res.json({

        success: true,

        santri_id: santriId,

        pagination: {

          limit,

          offset,

          total: Number(
            countResult.rows[0]?.total || 0
          )

        },

        data: result.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/absensi
// ======================

router.get(

  "/absensi",

  ...withWaliAuth,

  waliSantriGuard,
  requireWaliUnitFeature("absensi"),

  async (req, res) => {

    const santriId = req.santriId;

    const now = new Date();

    const bulan =
      req.query.bulan
        ? Number(req.query.bulan)
        : now.getMonth() + 1;

    const tahun =
      req.query.tahun
        ? Number(req.query.tahun)
        : now.getFullYear();

    if (
      !Number.isInteger(bulan) ||
      bulan < 1 ||
      bulan > 12
    ) {

      return res.status(400).json({

        success: false,

        error: "Parameter bulan tidak valid (1-12)"

      });

    }

    if (
      !Number.isInteger(tahun) ||
      tahun < 2000 ||
      tahun > 2100
    ) {

      return res.status(400).json({

        success: false,

        error: "Parameter tahun tidak valid"

      });

    }

    try {

      // =====================
      // RINGKASAN
      // =====================

      const ringkasanResult =
        await pool.query(

          `
          SELECT
            COUNT(*) FILTER (
              WHERE status IN ('H', 'Hadir')
            ) AS hadir,
            COUNT(*) FILTER (
              WHERE status IN ('I', 'Izin')
            ) AS izin,
            COUNT(*) FILTER (
              WHERE status IN ('S', 'Sakit')
            ) AS sakit,
            COUNT(*) FILTER (
              WHERE status IN ('A', 'Alpa', 'Alfa')
            ) AS alpa,
            COUNT(*) AS total
          FROM absensi
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND EXTRACT(MONTH FROM tanggal::date) = $4
            AND EXTRACT(YEAR  FROM tanggal::date) = $5
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, bulan, tahun]

        );

      // =====================
      // RIWAYAT PER HARI
      // =====================

      const riwayatResult =
        await pool.query(

          `
          SELECT
            id,
            tanggal,
            sesi,
            status
          FROM absensi
          WHERE santri_id = $1
            AND tenant_id = $2
            AND unit_id = $3
            AND EXTRACT(MONTH FROM tanggal::date) = $4
            AND EXTRACT(YEAR  FROM tanggal::date) = $5
          ORDER BY tanggal ASC, sesi ASC
          `,

          [santriId, req.tenantId, req.waliUnit.unit_id, bulan, tahun]

        );

      const raw =
        ringkasanResult.rows[0];

      res.json({

        success: true,

        santri_id: santriId,

        bulan,

        tahun,

        ringkasan: {

          hadir:
            Number(raw?.hadir || 0),

          izin:
            Number(raw?.izin || 0),

          sakit:
            Number(raw?.sakit || 0),

          alpa:
            Number(raw?.alpa || 0),

          total:
            Number(raw?.total || 0)

        },

        riwayat: riwayatResult.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// PUT /wali-app/pin
// ======================

router.put(

  "/pin",

  ...withWaliAuth,

  async (req, res) => {

    const {
      pin_lama,
      pin_baru,
      konfirmasi_pin
    } = req.body;

    const akunId =
      req.wali?.wali_akun_id;

    // ── Validasi input dasar ──

    if (
      !pin_lama ||
      !pin_baru ||
      !konfirmasi_pin
    ) {

      return res.status(400).json({

        success: false,

        error:
          "pin_lama, pin_baru, dan konfirmasi_pin wajib diisi"

      });

    }

    // ── Konfirmasi harus cocok ──

    if (
      String(pin_baru) !==
      String(konfirmasi_pin)
    ) {

      return res.status(400).json({

        success: false,

        error:
          "PIN baru dan konfirmasi PIN tidak cocok"

      });

    }

    // ── PIN baru harus valid (6 digit, tidak trivial) ──

    if (
      !waliAppService.isValidPin(pin_baru)
    ) {

      return res.status(400).json({

        success: false,

        error:
          "PIN baru tidak valid. Gunakan 6 digit angka dan hindari PIN yang mudah ditebak."

      });

    }

    // ── PIN baru tidak boleh sama dengan PIN lama ──

    if (
      String(pin_lama) ===
      String(pin_baru)
    ) {

      return res.status(400).json({

        success: false,

        error:
          "PIN baru tidak boleh sama dengan PIN lama"

      });

    }

    try {

      // ── Ambil akun ──

      const akunResult =
        await pool.query(

          `
          SELECT id, nomor_hp, pin_hash, status
          FROM wali_akun
          WHERE id = $1
            AND tenant_id = $2
          LIMIT 1
          `,

          [akunId, req.tenantId]

        );

      const akun =
        akunResult.rows[0];

      if (!akun) {

        return res.status(401).json({

          success: false,

          error: "Akun tidak ditemukan"

        });

      }

      if (akun.status !== "active") {

        return res.status(401).json({

          success: false,

          error: "Akun tidak aktif"

        });

      }

      // ── Verifikasi PIN lama ──

      const pinLamaValid =
        await waliAppService.verifyPin(
          pin_lama,
          akun.pin_hash
        );

      if (!pinLamaValid) {

        return res.status(401).json({

          success: false,

          error: "PIN lama tidak benar"

        });

      }

      // ── Hash PIN baru ──

      const newHash =
        await waliAppService.hashPin(
          pin_baru
        );

      // ── Simpan ──

      const tokenVersionEnabled =
        waliAppService.isTokenVersionEnabled();

      const updateResult = await pool.query(

        tokenVersionEnabled ? `
        UPDATE wali_akun
        SET
          pin_hash        = $1,
          must_change_pin = false,
          token_version   = token_version + 1,
          updated_at      = NOW()
        WHERE id = $2
          AND tenant_id = $3
        RETURNING token_version
        ` : `
        UPDATE wali_akun
        SET
          pin_hash        = $1,
          must_change_pin = false,
          updated_at      = NOW()
        WHERE id = $2
          AND tenant_id = $3
        `,

        [newHash, akunId, req.tenantId]

      );

      const replacementToken = tokenVersionEnabled
        ? waliAppService.signWaliToken(
            {
              id: akunId,
              nomor_hp: akun.nomor_hp,
              token_version: updateResult.rows[0]?.token_version,
            },
            req.wali.santri_ids,
            { id: req.tenantId, slug: req.tenantSlug }
          )
        : null;

      // ── Audit ──

      await waliAppService.writeAudit({

        nomorHp:   akun.nomor_hp,

        event:     "PIN_CHANGED",

        ipAddress:
          req.headers["x-forwarded-for"] ||
          req.socket?.remoteAddress ||
          null,

        userAgent:
          req.headers["user-agent"] || null

      });

      res.json({

        success: true,

        ...(replacementToken ? { token: replacementToken } : {}),

        message:
          "PIN berhasil diubah. Gunakan PIN baru untuk login berikutnya."

      });

    }

    catch (err) {

      res.status(500).json({

        success: false,

        error: "Gagal mengubah PIN. Silakan coba lagi."

      });

    }

  }

);

// ================================
// GET /wali-app/profil-pesantren
// ================================

router.get(

  "/profil-pesantren",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const result =
        await pool.query(

          `
          SELECT
            id,
            nama_pesantren,
            alamat,
            telepon,
            email,
            website,
            logo_url,
            banner_url,
            COALESCE(banner_active, TRUE) AS banner_active,
            splash_logo_url,
            app_icon_url,
            tagline,
            tentang,
            visi,
            misi,
            tahun_berdiri,
            updated_at
          FROM profil_pesantren
          WHERE tenant_id = $1
          LIMIT 1
          `,

          [req.tenantId]

        );

      const row = result.rows[0] ?? null;
      console.log("[WALI PROFIL RESPONSE tenant]", req.tenantId);
      console.log("[WALI PROFIL RESPONSE banner_url]", row?.banner_url ?? null);
      console.log("[WALI PROFIL RESPONSE updated_at]", row?.updated_at ?? null);

      res.json({

        success: true,

        data: row

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ======================
// GET /wali-app/pengumuman
// ======================

router.get(

  "/pengumuman",

  ...withWaliAuth,
  waliSantriGuard,
  requireWaliUnitFeature("pengumuman"),

  async (req, res) => {

    try {

      const limit =
        Math.min(
          Number(req.query.limit) || 20,
          50
        );

      const offset =
        Number(req.query.offset) || 0;

      const countResult =
        await pool.query(

          `
          SELECT COUNT(*) AS total
          FROM pengumuman
          WHERE is_active = true
            AND tenant_id = $1
            AND unit_id = $2
            AND (
              expires_at IS NULL
              OR expires_at > NOW()
            )
          `,

          [req.tenantId, req.waliUnit.unit_id]

        );

      const dataResult =
        await pool.query(

          `
          SELECT
            id,
            judul,
            isi,
            cover_url,
            prioritas,
            published_at,
            expires_at,
            created_at
          FROM pengumuman
          WHERE is_active = true
            AND tenant_id = $1
            AND unit_id = $2
            AND (
              expires_at IS NULL
              OR expires_at > NOW()
            )
          ORDER BY
            CASE prioritas
              WHEN 'urgent'  THEN 1
              WHEN 'penting' THEN 2
              ELSE 3
            END,
            published_at DESC
          LIMIT $3 OFFSET $4
          `,

          [req.tenantId, req.waliUnit.unit_id, limit, offset]

        );

      res.json({

        success: true,

        total: Number(
          countResult.rows[0]?.total || 0
        ),

        limit,

        offset,

        data: dataResult.rows

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message

      });

    }

  }

);

// ================================
// GET /wali-app/notifications
// Phase 1: in-app notifications only
// ================================

router.get(

  "/notifications",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const result =
        await notificationService.listInAppNotifications({

          tenantId: req.tenantId,

          waliAkunId: req.wali.wali_akun_id,

          limit: req.query.limit,

          offset: req.query.offset,

          unreadOnly:
            String(req.query.unread_only || "").toLowerCase() === "true",

        });

      res.json({

        success: true,

        ...result,

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// GET /wali-app/notifications/unread-count
// ================================

router.get(

  "/notifications/unread-count",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const result =
        await notificationService.listInAppNotifications({

          tenantId: req.tenantId,

          waliAkunId: req.wali.wali_akun_id,

          limit: 1,

          offset: 0,

        });

      res.json({

        success: true,

        unread_count: result.unread_count,

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// PUT /wali-app/notifications/read-all
// ================================

router.put(

  "/notifications/read-all",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const updated =
        await notificationService.markAllInAppNotificationsRead({

          tenantId: req.tenantId,

          waliAkunId: req.wali.wali_akun_id,

        });

      res.json({

        success: true,

        updated,

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// PUT /wali-app/notifications/:id/read
// ================================

router.put(

  "/notifications/:id/read",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const notificationId =
        Number(req.params.id);

      if (
        !Number.isInteger(notificationId) ||
        notificationId <= 0
      ) {

        return res.status(400).json({

          success: false,

          error: "notification id tidak valid",

        });

      }

      const row =
        await notificationService.markInAppNotificationRead({

          tenantId: req.tenantId,

          waliAkunId: req.wali.wali_akun_id,

          notificationId,

        });

      if (!row) {

        return res.status(404).json({

          success: false,

          error: "Notifikasi tidak ditemukan",

        });

      }

      res.json({

        success: true,

        data: row,

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// GET /wali-app/device-token/status
// ================================

router.get(

  "/device-token/status",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const status =
        await pushNotificationService.getWaliDeviceTokenStatus({

          tenantId: req.tenantId,

          waliId: req.wali.wali_akun_id,

        });

      res.json({

        success: true,

        ...status,

      });

    }

    catch (err) {

      console.error("[PUSH] DEVICE TOKEN STATUS ERROR", {
        wali_id: req.wali?.wali_akun_id,
        tenant_id: req.tenantId,
        message: err.message,
      });

      res.status(500).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// POST /wali-app/device-token
// ================================

router.post(

  "/device-token",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const {
        expo_push_token,
        platform,
        device_name,
      } = req.body;

      console.log("[PUSH] DEVICE TOKEN REGISTER", {
        wali_id: req.wali?.wali_akun_id,
        user_id: req.wali?.wali_akun_id,
        tenant_id: req.tenantId,
        token_prefix: expo_push_token
          ? `${String(expo_push_token).slice(0, 20)}...`
          : null,
        platform,
        device_name,
      });

      const row =
        await pushNotificationService.registerWaliDeviceToken({

          tenantId: req.tenantId,

          waliId: req.wali.wali_akun_id,

          expoPushToken: expo_push_token,

          platform,

          deviceName: device_name,

        });

      console.log("[PUSH] DEVICE TOKEN REGISTER SUCCESS", {
        id: row.id,
        wali_id: row.wali_id,
        tenant_id: row.tenant_id,
        token_prefix: row.expo_push_token
          ? `${String(row.expo_push_token).slice(0, 20)}...`
          : null,
        is_active: row.is_active,
        last_seen: row.last_seen,
        action: "insert_or_update",
      });

      res.json({

        success: true,

        data: {

          id: row.id,

          platform: row.platform,

          device_name: row.device_name,

          is_active: row.is_active,

          last_seen_at: row.last_seen_at || row.last_seen,

        },

      });

    }

    catch (err) {

      console.error("[PUSH] DEVICE TOKEN REGISTER ERROR", {
        wali_id: req.wali?.wali_akun_id,
        tenant_id: req.tenantId,
        message: err.message,
        stack: err.stack,
      });

      const status =
        err.statusCode || 500;

      res.status(status).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// DELETE /wali-app/device-token
// ================================

router.delete(

  "/device-token",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const row =
        await pushNotificationService.unregisterWaliDeviceToken({

          tenantId: req.tenantId,

          waliId: req.wali.wali_akun_id,

          expoPushToken: req.body?.expo_push_token,

        });

      res.json({

        success: true,

        data: row,

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ================================
// POST /wali-app/push-token
// ================================

router.post(

  "/push-token",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const {
        expo_push_token,
        device_id,
        platform,
      } = req.body;

      if (!expo_push_token) {

        return res.status(400).json({

          success: false,

          error: "expo_push_token wajib diisi",

        });

      }

      const row =
        await notificationService.registerPushToken({

          tenantId: req.tenantId,

          waliAkunId: req.wali.wali_akun_id,

          expoPushToken: expo_push_token,

          deviceId: device_id,

          platform,

        });

      res.json({

        success: true,

        data: {

          id: row.id,

          platform: row.platform,

          is_active: row.is_active,

          last_seen_at: row.last_seen_at,

        },

      });

    }

    catch (err) {

      console.log(err);

      const status =
        err.statusCode || 500;

      res.status(status).json({

        success: false,

        error: err.message,

      });

    }

  }

);

// ===================================
// POST /wali-app/test-notification
// Authenticated wali-only diagnostic endpoint.
// ===================================

router.post(

  "/test-notification",

  ...withWaliAuth,

  async (req, res) => {

    try {

      const title =
        String(req.body?.title || "Test").trim();

      const body =
        String(
          req.body?.body ||
            "Push notification berhasil"
        ).trim();

      const result =
        await pushNotificationService.sendPushToWali({

          tenantId: req.tenantId,

          waliId: req.wali.wali_akun_id,

          title,

          body,

          data: {
            type: "test",
            screen: "Beranda",
          },

        });

      res.json({

        success: result.success,

        data: {

          sent: result.sent,

          errors: result.errors ?? [],

          token_count: result.token_count ?? 0,

          expo_response: result.expo_response ?? result.tickets ?? [],

          reason: result.reason ?? null,

        },

        message: result.success
          ? "Notifikasi test dikirim"
          : result.error ||
            result.reason ||
            result.errors?.[0] ||
            "Gagal mengirim notifikasi test",

      });

    }

    catch (err) {

      console.log(err);

      const status =
        err.statusCode || 500;

      res.status(status).json({

        success: false,

        error: err.message,

      });

    }

  }

);

module.exports = router;
