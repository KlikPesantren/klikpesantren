console.log("WALI ROUTES LOADED");

const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const waliAppService = require("../services/waliAppService");
const { assertSantriInTenant } = require("../services/tenantScope");
const { getScopedUnitIds, assertSantriInScopedUnit } = require("../middleware/dataUnitScope");
const { accessError } = require("../services/unitAccessService");

const DEFAULT_PIN = "456789";
const withTenant = [tenantMiddleware];

async function getRequiredScopedUnitIds(req, client = pool) {
  const scopedUnitIds = await getScopedUnitIds(req, client);
  if (!scopedUnitIds || scopedUnitIds.length !== 1) {
    throw accessError("Pilih unit aktif untuk mengelola wali", 400, "UNIT_REQUIRED");
  }
  return scopedUnitIds;
}

function sendWaliError(res, error, fallback = "Gagal memproses data wali") {
  const status = Number(error?.status || 500);
  if (status >= 500) console.error(error);
  return res.status(status).json({
    success: false,
    error: error?.status ? error.message : fallback,
    code: error?.code || (status >= 500 ? "WALI_INTERNAL_ERROR" : undefined),
  });
}

router.get("/", ...withTenant, async (req, res) => {
  try {
    const scopedUnitIds = await getRequiredScopedUnitIds(req);
    const scopeSql = scopedUnitIds ? ` AND EXISTS (
      SELECT 1 FROM santri_units su
      WHERE su.tenant_id = wali_santri.tenant_id
        AND su.santri_id = wali_santri.santri_id
        AND su.unit_id = ANY($2::int[])
        AND su.status = 'active' AND su.left_at IS NULL
    )` : "";
    const result = await pool.query(
      `SELECT
         wali_santri.*,
         santri.nama AS nama_santri,
         santri.kamar
       FROM wali_santri
       LEFT JOIN santri
         ON wali_santri.santri_id = santri.id
        AND santri.tenant_id = wali_santri.tenant_id
       WHERE wali_santri.tenant_id = $1${scopeSql}
         AND LOWER(TRIM(COALESCE(santri.status, 'aktif'))) IN ('aktif', 'active', '')
       ORDER BY wali_santri.id DESC`,
      scopedUnitIds ? [req.tenantId, scopedUnitIds] : [req.tenantId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    sendWaliError(res, err);
  }
});

router.post("/", ...withTenant, async (req, res) => {
  const client = await pool.connect();

  try {
    const { nama, nomor_hp, alamat, santri_id } = req.body;
    await getRequiredScopedUnitIds(req, client);

    const normalizedHp = waliAppService.normalizePhone(nomor_hp);
    if (!normalizedHp) {
      return res.status(400).json({ success: false, error: "Nomor HP tidak valid" });
    }

    const santriCheck = await assertSantriInTenant(req.tenantId, santri_id, client);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const scopeCheck = await assertSantriInScopedUnit(req, santri_id, client);
    if (!scopeCheck.ok) return res.status(403).json({ success: false, error: scopeCheck.error });
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO wali_santri (nama, nomor_hp, alamat, santri_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [nama, normalizedHp, alamat, santri_id, req.tenantId]
    );

    const pinHash = await bcrypt.hash(DEFAULT_PIN, 10);

    await client.query(
      `INSERT INTO wali_akun (tenant_id, nomor_hp, nama, pin_hash, status, must_change_pin)
       VALUES ($1, $2, $3, $4, 'active', true)
       ON CONFLICT (tenant_id, nomor_hp) DO UPDATE SET
         nama       = EXCLUDED.nama,
         updated_at = NOW()`,
      [req.tenantId, normalizedHp, nama, pinHash]
    );

    await client.query("COMMIT");

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    sendWaliError(res, err);
  } finally {
    client.release();
  }
});

router.put("/:id", ...withTenant, async (req, res) => {
  const client = await pool.connect();

  try {
    const { id } = req.params;
    const { nama, nomor_hp, alamat, santri_id } = req.body;
    await getRequiredScopedUnitIds(req, client);

    const normalizedHp = waliAppService.normalizePhone(nomor_hp);
    if (!normalizedHp) {
      return res.status(400).json({ success: false, error: "Nomor HP tidak valid" });
    }

    const santriCheck = await assertSantriInTenant(req.tenantId, santri_id, client);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const scopeCheck = await assertSantriInScopedUnit(req, santri_id, client);
    if (!scopeCheck.ok) return res.status(403).json({ success: false, error: scopeCheck.error });
    const scopedUnitIds = await getRequiredScopedUnitIds(req, client);

    await client.query("BEGIN");

    const oldResult = await client.query(
      `SELECT nomor_hp FROM wali_santri
       WHERE id = $1 AND tenant_id = $2
         AND ($3::int[] IS NULL OR EXISTS (
           SELECT 1 FROM santri_units su
           WHERE su.tenant_id = wali_santri.tenant_id
             AND su.santri_id = wali_santri.santri_id
             AND su.unit_id = ANY($3::int[])
             AND su.status = 'active' AND su.left_at IS NULL
         ))`,
      [id, req.tenantId, scopedUnitIds]
    );

    if (oldResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Wali tidak ditemukan" });
    }

    const oldHp = oldResult.rows[0].nomor_hp;

    const result = await client.query(
      `UPDATE wali_santri
       SET nama = $1, nomor_hp = $2, alamat = $3, santri_id = $4
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [nama, normalizedHp, alamat, santri_id, id, req.tenantId]
    );

    if (oldHp && oldHp !== normalizedHp) {
      await client.query(
        `UPDATE wali_akun
         SET nomor_hp = $1, nama = $2, updated_at = NOW()
         WHERE nomor_hp = $3 AND tenant_id = $4`,
        [normalizedHp, nama, oldHp, req.tenantId]
      );
    }

    const pinHash = await bcrypt.hash(DEFAULT_PIN, 10);

    await client.query(
      `INSERT INTO wali_akun (tenant_id, nomor_hp, nama, pin_hash, status, must_change_pin)
       VALUES ($1, $2, $3, $4, 'active', true)
       ON CONFLICT (tenant_id, nomor_hp) DO UPDATE SET
         nama       = EXCLUDED.nama,
         updated_at = NOW()`,
      [req.tenantId, normalizedHp, nama, pinHash]
    );

    await client.query("COMMIT");

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    sendWaliError(res, err);
  } finally {
    client.release();
  }
});

router.post("/sync-akun", ...withTenant, async (req, res) => {
  try {
    const scopedUnitIds = await getRequiredScopedUnitIds(req);
    const waliList = await pool.query(
      `SELECT id, nomor_hp, nama
       FROM wali_santri
       WHERE tenant_id = $1
         AND nomor_hp IS NOT NULL
         AND TRIM(nomor_hp) <> ''
         AND ($2::int[] IS NULL OR santri_id IN (
           SELECT su.santri_id FROM santri_units su
           WHERE su.tenant_id = wali_santri.tenant_id
             AND su.unit_id = ANY($2::int[])
             AND su.status = 'active' AND su.left_at IS NULL
         ))
       ORDER BY id ASC`,
      [req.tenantId, scopedUnitIds]
    );

    let created = 0;
    let updated = 0;

    for (const wali of waliList.rows) {
      const pinHash = await bcrypt.hash(DEFAULT_PIN, 10);

      const result = await pool.query(
        `INSERT INTO wali_akun (tenant_id, nomor_hp, nama, pin_hash, status, must_change_pin)
         VALUES ($1, $2, $3, $4, 'active', true)
         ON CONFLICT (tenant_id, nomor_hp) DO UPDATE SET
           nama       = EXCLUDED.nama,
           updated_at = NOW()
         RETURNING (xmax = 0) AS is_insert`,
        [req.tenantId, wali.nomor_hp, wali.nama, pinHash]
      );

      if (result.rows[0]?.is_insert) {
        created++;
      } else {
        updated++;
      }
    }

    res.json({
      success: true,
      total: waliList.rows.length,
      created,
      updated,
    });
  } catch (err) {
    sendWaliError(res, err);
  }
});

router.delete("/:id", ...withTenant, async (req, res) => {
  try {
    const scopedUnitIds = await getRequiredScopedUnitIds(req);
    const result = await pool.query(
      `DELETE FROM wali_santri
       WHERE id = $1 AND tenant_id = $2
         AND ($3::int[] IS NULL OR santri_id IN (
           SELECT su.santri_id FROM santri_units su
           WHERE su.tenant_id = wali_santri.tenant_id
             AND su.unit_id = ANY($3::int[])
             AND su.status = 'active' AND su.left_at IS NULL
         ))
       RETURNING id`,
      [req.params.id, req.tenantId, scopedUnitIds]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Wali tidak ditemukan" });
    }

    res.json({ success: true, message: "Wali deleted" });
  } catch (err) {
    sendWaliError(res, err);
  }
});

router.put("/:id/reset-pin", ...withTenant, async (req, res) => {
  try {
    const { id } = req.params;
    const scopedUnitIds = await getRequiredScopedUnitIds(req);

    const waliResult = await pool.query(
      `SELECT nomor_hp FROM wali_santri
       WHERE id = $1 AND tenant_id = $2
         AND ($3::int[] IS NULL OR santri_id IN (
           SELECT su.santri_id FROM santri_units su
           WHERE su.tenant_id = wali_santri.tenant_id
             AND su.unit_id = ANY($3::int[])
             AND su.status = 'active' AND su.left_at IS NULL
         ))`,
      [id, req.tenantId, scopedUnitIds]
    );

    if (waliResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Data wali tidak ditemukan" });
    }

    const nomor_hp = waliResult.rows[0].nomor_hp;
    const newHash = await bcrypt.hash(DEFAULT_PIN, 10);

    const updated = await pool.query(
      `UPDATE wali_akun
       SET pin_hash = $1,
           must_change_pin = true,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE nomor_hp = $2 AND tenant_id = $3
       RETURNING id, nomor_hp, must_change_pin`,
      [newHash, nomor_hp, req.tenantId]
    );

    if (updated.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Akun wali tidak ditemukan. Wali belum punya akun login.",
      });
    }

    res.json({
      success: true,
      message: `PIN berhasil direset ke ${DEFAULT_PIN}`,
      data: updated.rows[0],
    });
  } catch (err) {
    sendWaliError(res, err);
  }
});

module.exports = router;
