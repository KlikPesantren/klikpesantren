const express = require("express");
const multer = require("multer");
const pool = require("../db");
const {canonicalAttendanceUid,attendanceUidSql}=require("../utils/attendanceRfidUid");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const requireUnitFeature = require("../middleware/requireUnitFeature");
const { syncWaliFromSantri } = require("../services/waliSyncService");
const {
  getOperationalChecklist,
  getExitSummary,
} = require("../services/santriOperationalService");
const { isSantriNonAktif } = require("../utils/santriStatus");
const {
  ensureAlumni,
  isAlumniStatus,
  resolveEffectiveExitDate,
} = require("../services/alumniService");
const { resolveActiveUnit } = require("../services/unitAccessService");
const {
  assertSantriUnitAccess,
  assignClassEnrollment,
  createMembershipWithEnrollment,
  getClassInUnit,
  syncLegacyClass,
} = require("../services/santriUnitService");
const {
  findIdentityConflict,
  getVisibleSantri,
  listVisibleSantri,
} = require("../services/santriMultiUnitService");
const {
  buildTemplateWorkbook,
  previewImport,
  commitImport,
} = require("../services/santriImportService");

const router = express.Router();
const withTenant = [authMiddleware, tenantMiddleware, requireUnitFeature("santri")];

function normalizeLimitHarian(value) {
  if (value === null) return null;
  if (value === undefined || value === "") return 0;

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("Limit jajan harian harus angka minimal 0");
  }

  return Math.floor(normalized);
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || "").toLowerCase();
    if (!name.endsWith(".xlsx")) {
      return cb(new Error("Format file harus .xlsx"));
    }
    cb(null, true);
  },
});

const withImportAuth = [
  ...withTenant,
  requirePermission("santri.create"),
];

function sendScopedError(res, error, fallback = "Gagal memproses data santri") {
  const duplicateIdentity = error.code === "23505";
  const status = duplicateIdentity ? 409 : (Number(error.status) || 500);
  return res.status(status).json({
    success: false,
    error: duplicateIdentity
      ? "Identitas atau membership santri sudah terdaftar"
      : status >= 500 ? fallback : error.message,
    code: duplicateIdentity ? "SANTRI_IDENTITY_EXISTS" : error.code,
  });
}

async function resolveSantriWorkspace(req, client = pool, { requireUnit = false } = {}) {
  const workspace = await resolveActiveUnit(req, client);
  if (requireUnit && workspace.mode !== "UNIT") {
    const error = new Error("Pilih satu unit aktif untuk melanjutkan");
    error.status = 400;
    error.code = "UNIT_REQUIRED";
    throw error;
  }
  return workspace;
}

router.get("/import/template", ...withImportAuth, (_req, res) => {
  try {
    const buffer = buildTemplateWorkbook();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_santri.xlsx"'
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/import/preview", ...withImportAuth, (req, res) => {
  importUpload.single("file")(req, res, async (err) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Ukuran file maksimal 5MB"
          : err.message || "Upload gagal";
      return res.status(400).json({ success: false, error: message });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "File Excel wajib diupload",
      });
    }

    try {
      const workspace = await resolveSantriWorkspace(req, pool, { requireUnit: true });
      const preview = await previewImport(req.tenantId, req.file.buffer, {
        unitId: workspace.unitId,
      });
      res.json(preview);
    } catch (parseErr) {
      console.error(parseErr);
      sendScopedError(res, parseErr, "Gagal membaca file Excel");
    }
  });
});

router.post("/import/commit", ...withImportAuth, async (req, res) => {
  try {
    const { rows } = req.body;
    const workspace = await resolveSantriWorkspace(req, pool, { requireUnit: true });
    const result = await commitImport(req.tenantId, rows, { unitId: workspace.unitId });
    res.json(result);
  } catch (err) {
    console.error(err);
    sendScopedError(res, err, "Gagal mengimport santri");
  }
});

router.get("/", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const workspace = await resolveSantriWorkspace(req);
    const rows = await listVisibleSantri({
      tenantId: req.tenantId,
      unitId: workspace.unitId,
      search: req.query.search,
    });
    res.json({
      success: true,
      data: rows,
      access: { all_units: workspace.mode === "ALL", unit_id: workspace.unitId },
      totals: { unique_individuals: rows.length },
    });
  } catch (err) {
    console.log(err);
    sendScopedError(res, err, "Gagal memuat data santri");
  }
});

router.get(
  "/identity-candidates",
  ...withTenant,
  requirePermission("santri.create"),
  async (req, res) => {
    try {
      const workspace = await resolveSantriWorkspace(req, pool, { requireUnit: true });
      const search = String(req.query.search || "").trim();
      const { rows } = await pool.query(
        `SELECT s.id, s.nama, s.nis,
                COALESCE(string_agg(DISTINCT u.nama, ', ' ORDER BY u.nama), '') AS unit_names
         FROM santri s
         LEFT JOIN santri_units existing
           ON existing.tenant_id = s.tenant_id AND existing.santri_id = s.id
          AND existing.status = 'active' AND existing.left_at IS NULL
         LEFT JOIN unit_pendidikan u
           ON u.id = existing.unit_id AND u.tenant_id = existing.tenant_id
         WHERE s.tenant_id = $1
           AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','')
           AND NOT EXISTS (
             SELECT 1 FROM santri_units current_unit
             WHERE current_unit.tenant_id = s.tenant_id
               AND current_unit.santri_id = s.id
               AND current_unit.unit_id = $2
               AND current_unit.status = 'active'
               AND current_unit.left_at IS NULL
           )
           AND ($3::text = '' OR s.nama ILIKE '%' || $3 || '%' OR COALESCE(s.nis, '') ILIKE '%' || $3 || '%')
         GROUP BY s.id
         ORDER BY s.nama, s.id
         LIMIT 100`,
        [req.tenantId, workspace.unitId, search],
      );
      res.json({ success: true, data: rows });
    } catch (error) {
      sendScopedError(res, error, "Gagal mencari identitas santri");
    }
  },
);

router.post(
  "/",
  ...withTenant,
  requirePermission("santri.create"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        nis,
        nama,
        tempat_lahir,
        tanggal_lahir,
        jenis_kelamin,
        tanggal_masuk_pesantren,
        uid_rfid,
        alamat,
        orang_tua,
        nomor_hp_ortu,
        kelas_id,
        kamar,
        foto,
        limit_harian,
        existing_santri_id,
        unit_student_number,
      } = req.body;

      if (!existing_santri_id && (!String(nis || "").trim() || !String(nama || "").trim())) {
        return res.status(400).json({
          success: false,
          error: "NIS dan nama santri wajib diisi",
          code: "SANTRI_VALIDATION_ERROR",
        });
      }

      let normalizedLimitHarian;
      try {
        normalizedLimitHarian = normalizeLimitHarian(limit_harian);
      } catch (limitErr) {
        return res.status(400).json({ success: false, error: limitErr.message });
      }

      await client.query("BEGIN");
      const workspace = await resolveSantriWorkspace(req, client, { requireUnit: true });
      await getClassInUnit(req.tenantId, kelas_id, workspace.unitId, client);

      const conflict = await findIdentityConflict(req.tenantId, {
        santriId: existing_santri_id || null,
        nis,
        uidRfid: canonicalAttendanceUid(uid_rfid),
      }, client);

      let santri;
      let waliSync = null;
      if (existing_santri_id) {
        if (!conflict || Number(conflict.id) !== Number(existing_santri_id)) {
          throw Object.assign(new Error("Identitas santri tidak ditemukan pada tenant ini"), {
            status: 404,
            code: "SANTRI_IDENTITY_NOT_FOUND",
          });
        }
        const existing = await client.query(
          `SELECT * FROM santri WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [existing_santri_id, req.tenantId],
        );
        santri = existing.rows[0];
      } else {
        if (conflict) {
          throw Object.assign(new Error("Identitas santri kemungkinan sudah terdaftar. Hubungkan identitas melalui superadmin."), {
            status: 409,
            code: "SANTRI_IDENTITY_EXISTS",
          });
        }
        const result = await client.query(
          `INSERT INTO santri (
             nis, nama, tempat_lahir, tanggal_lahir, jenis_kelamin,
             tanggal_masuk_pesantren, uid_rfid, alamat, orang_tua,
             nomor_hp_ortu, kelas_id, kamar, foto, limit_harian, tenant_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
           RETURNING *,
             to_char(tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
             to_char(tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren`,
          [nis, nama, tempat_lahir || null, tanggal_lahir || null,
            jenis_kelamin || null, tanggal_masuk_pesantren || null, canonicalAttendanceUid(uid_rfid) || null,
            alamat, orang_tua, nomor_hp_ortu, kelas_id || null, kamar || null,
            foto, normalizedLimitHarian, req.tenantId],
        );
        santri = result.rows[0];
        waliSync = await syncWaliFromSantri(client, { tenantId: req.tenantId, santri });
      }

      const primaryCheck = await client.query(
        `SELECT 1 FROM santri_units
         WHERE tenant_id = $1 AND santri_id = $2
           AND status = 'active' AND left_at IS NULL AND is_primary = true`,
        [req.tenantId, santri.id],
      );
      const membership = await createMembershipWithEnrollment({
        tenant_id: req.tenantId,
        santri_id: santri.id,
        unit_id: workspace.unitId,
        unit_student_number: unit_student_number || nis || null,
        joined_at: tanggal_masuk_pesantren || null,
        is_primary: primaryCheck.rows.length === 0,
        kelas_id: kelas_id || null,
      }, client);

      await client.query("COMMIT");

      res.json({
        success: true,
        data: santri,
        membership,
        wali_sync: waliSync,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.log(err);
      sendScopedError(res, err);
    } finally {
      client.release();
    }
  }
);

router.get("/:id/operational-checklist", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const workspace = await resolveSantriWorkspace(req);
    const visible = await getVisibleSantri({
      tenantId: req.tenantId,
      unitId: workspace.unitId,
      santriId: req.params.id,
    });
    if (!visible) return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    const data = await getOperationalChecklist(req.tenantId, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    sendScopedError(res, err);
  }
});

router.get("/:id/exit-summary", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const workspace = await resolveSantriWorkspace(req);
    const visible = await getVisibleSantri({
      tenantId: req.tenantId,
      unitId: workspace.unitId,
      santriId: req.params.id,
    });
    if (!visible) return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    const data = await getExitSummary(req.tenantId, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    sendScopedError(res, err);
  }
});

router.put(
  "/:id",
  ...withTenant,
  requirePermission("santri.update"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { id } = req.params;
      const {
        nis,
        nama,
        tempat_lahir,
        tanggal_lahir,
        jenis_kelamin,
        tanggal_masuk_pesantren,
        uid_rfid,
        alamat,
        orang_tua,
        nomor_hp_ortu,
        kelas_id,
        kamar,
        foto,
        status,
        limit_harian,
        effective_exit_date,
      } = req.body;

      let normalizedLimitHarian;
      try {
        normalizedLimitHarian = normalizeLimitHarian(limit_harian);
      } catch (limitErr) {
        return res.status(400).json({ success: false, error: limitErr.message });
      }
      await client.query("BEGIN");

      const workspace = await resolveSantriWorkspace(req, client, { requireUnit: true });
      const membership = await assertSantriUnitAccess(
        req.tenantId,
        id,
        workspace.unitId,
        client,
      );
      await getClassInUnit(req.tenantId, kelas_id, workspace.unitId, client);

      const existing = await client.query(
        `SELECT id, status, uid_rfid
         FROM santri
         WHERE id = $1 AND tenant_id = $2`,
        [id, req.tenantId],
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
      }

      const nextStatus = status ?? existing.rows[0].status ?? "aktif";
      // Unrelated edits preserve the exact existing value, including legacy case.
      const nextUid = uid_rfid === undefined || uid_rfid === existing.rows[0].uid_rfid
        ? existing.rows[0].uid_rfid : canonicalAttendanceUid(uid_rfid) || null;
      if(nextUid && nextUid!==existing.rows[0].uid_rfid){
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`santri-uid:${req.tenantId}:${nextUid}`]);
        const collision=await client.query(`SELECT s.id FROM santri s WHERE s.tenant_id=$1 AND s.id<>$2
          AND (${attendanceUidSql("s.uid_rfid")})=$3 LIMIT 1`,[req.tenantId,id,nextUid]);
        if(collision.rows[0])throw Object.assign(new Error("UID sudah terdaftar pada identitas lain"),{status:409,code:"RFID_CREDENTIAL_CONFLICT"});
      }
      const wasAktif = !isSantriNonAktif(existing.rows[0].status);
      const willNonAktif = isSantriNonAktif(nextStatus);
      const remainingMemberships = willNonAktif
        ? await client.query(
          `SELECT COUNT(*)::integer AS count FROM santri_units
           WHERE tenant_id = $1 AND santri_id = $2 AND id <> $3
             AND status = 'active' AND left_at IS NULL`,
          [req.tenantId, id, membership.id],
        )
        : { rows: [{ count: 0 }] };
      const hasOtherActiveMembership = Number(remainingMemberships.rows[0]?.count) > 0;
      const nextGlobalStatus = willNonAktif && hasOtherActiveMembership ? "aktif" : nextStatus;

      const result = await client.query(
        `UPDATE santri
         SET nis = $1,
             nama = $2,
             tempat_lahir = $3,
             tanggal_lahir = $4,
             jenis_kelamin = $5,
             tanggal_masuk_pesantren = $6,
             uid_rfid = $7,
             alamat = $8,
             orang_tua = $9,
             nomor_hp_ortu = $10,
             kamar = $11,
             foto = $12,
             status = $13,
             limit_harian = $14
         WHERE id = $15 AND tenant_id = $16
          RETURNING *,
            to_char(tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
            to_char(tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren`,
        [
          nis,
          nama,
          tempat_lahir || null,
          tanggal_lahir || null,
          jenis_kelamin || null,
          tanggal_masuk_pesantren || null,
          nextUid,
          alamat,
          orang_tua,
          nomor_hp_ortu,
          kamar || null,
          foto,
          nextGlobalStatus,
          normalizedLimitHarian,
          id,
          req.tenantId,
        ]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
      }

      const santri = result.rows[0];
      if (!willNonAktif) {
        await assignClassEnrollment({
          tenantId: req.tenantId,
          membership,
          kelasId: kelas_id || null,
        }, client);
        await syncLegacyClass(req.tenantId, id, membership, kelas_id || null, client);
      }
      if (willNonAktif) {
        const effectiveExitDate = await resolveEffectiveExitDate(client, effective_exit_date);
        const membershipStatus = String(nextStatus).trim().toLowerCase() === "lulus"
          ? "graduated"
          : String(nextStatus).trim().toLowerCase() === "keluar" ? "left" : "inactive";
        const enrollmentStatus = membershipStatus === "graduated"
          ? "completed"
          : membershipStatus === "left" ? "moved" : "cancelled";
        await client.query(
          `UPDATE santri_units
           SET status = $1, left_at = $2, is_primary = false, updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4 AND santri_id = $5
             AND status = 'active' AND left_at IS NULL`,
          [membershipStatus, effectiveExitDate, membership.id, req.tenantId, id],
        );
        await client.query(
          `UPDATE santri_kelas_enrollments
           SET status = $1, end_date = $2, updated_at = NOW()
           WHERE tenant_id = $3 AND santri_unit_id = $4
              AND status = 'active' AND end_date IS NULL`,
          [enrollmentStatus, effectiveExitDate, req.tenantId, membership.id],
        );
        if (hasOtherActiveMembership && membership.is_primary === true) {
          const promoted = await client.query(
            `WITH candidate AS (
               SELECT id FROM santri_units
               WHERE tenant_id = $1 AND santri_id = $2
                 AND status = 'active' AND left_at IS NULL
               ORDER BY id
               LIMIT 1
             )
             UPDATE santri_units su
             SET is_primary = true, updated_at = NOW()
             FROM candidate
             WHERE su.id = candidate.id
             RETURNING su.id`,
            [req.tenantId, id],
          );
          if (promoted.rows[0]) {
            await client.query(
              `UPDATE santri s
               SET kelas_id = (
                 SELECT e.kelas_id
                 FROM santri_kelas_enrollments e
                 WHERE e.tenant_id = $1 AND e.santri_unit_id = $2
                   AND e.status = 'active' AND e.end_date IS NULL
                 ORDER BY e.id DESC LIMIT 1
               )
               WHERE s.id = $3 AND s.tenant_id = $1`,
              [req.tenantId, promoted.rows[0].id, id],
            );
          }
        }
        if (isAlumniStatus(nextStatus)) {
          await ensureAlumni(client, {
            tenantId: req.tenantId,
            santri,
            status: nextStatus,
            membership,
            unitId: workspace.unitId,
            effectiveExitDate,
          });
        }
      }
      const waliSync = await syncWaliFromSantri(client, {
        tenantId: req.tenantId,
        santri,
      });

      const exitSummary =
        wasAktif && willNonAktif
          ? await getExitSummary(req.tenantId, id, client)
          : null;

      await client.query("COMMIT");

      res.json({
        success: true,
        data: santri,
        membership_status: willNonAktif ? nextStatus : "aktif",
        identity_status: nextGlobalStatus,
        wali_sync: waliSync,
        exit_summary: exitSummary,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.log(err);
      sendScopedError(res, err);
    } finally {
      client.release();
    }
  }
);

router.delete(
  "/:id",
  ...withTenant,
  requirePermission("santri.delete"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const workspace = await resolveSantriWorkspace(req, client, { requireUnit: true });
      const membership = await assertSantriUnitAccess(
        req.tenantId,
        req.params.id,
        workspace.unitId,
        client,
      );
      const santriResult = await client.query(
        `SELECT * FROM santri WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [req.params.id, req.tenantId],
      );
      if (!santriResult.rows[0]) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
      }
      const effectiveExitDate = await resolveEffectiveExitDate(
        client,
        req.body?.effective_exit_date ?? req.query?.effective_exit_date,
      );
      const memberships = await client.query(
        `SELECT COUNT(*)::integer AS count FROM santri_units
         WHERE tenant_id = $1 AND santri_id = $2
           AND id <> $3
           AND status = 'active' AND left_at IS NULL`,
        [req.tenantId, req.params.id, membership.id],
      );
      const hasOtherActiveMembership = Number(memberships.rows[0]?.count) > 0;

      await client.query(
        `UPDATE santri_units
         SET status = 'left', left_at = $1, is_primary = false, updated_at = NOW()
         WHERE id = $2 AND tenant_id = $3 AND santri_id = $4
           AND status = 'active' AND left_at IS NULL`,
        [effectiveExitDate, membership.id, req.tenantId, req.params.id],
      );
      await client.query(
        `UPDATE santri_kelas_enrollments
         SET status = 'moved', end_date = $1, updated_at = NOW()
         WHERE tenant_id = $2 AND santri_unit_id = $3
           AND status = 'active' AND end_date IS NULL`,
        [effectiveExitDate, req.tenantId, membership.id],
      );
      await ensureAlumni(client, {
        tenantId: req.tenantId,
        santri: santriResult.rows[0],
        status: "keluar",
        membership,
        unitId: workspace.unitId,
        effectiveExitDate,
      });
      await client.query(
        `UPDATE santri SET status = $1 WHERE id = $2 AND tenant_id = $3`,
        [hasOtherActiveMembership ? "aktif" : "keluar", req.params.id, req.tenantId],
      );
      if (hasOtherActiveMembership && membership.is_primary === true) {
        await client.query(
          `WITH candidate AS (
             SELECT id FROM santri_units
             WHERE tenant_id = $1 AND santri_id = $2
               AND status = 'active' AND left_at IS NULL
             ORDER BY id LIMIT 1
           ), promoted AS (
             UPDATE santri_units su
             SET is_primary = true, updated_at = NOW()
             FROM candidate WHERE su.id = candidate.id
             RETURNING su.id
           )
           UPDATE santri s
           SET kelas_id = (
             SELECT e.kelas_id FROM santri_kelas_enrollments e
             JOIN promoted p ON p.id = e.santri_unit_id
             WHERE e.tenant_id = $1 AND e.status = 'active' AND e.end_date IS NULL
             ORDER BY e.id DESC LIMIT 1
           )
           WHERE s.id = $2 AND s.tenant_id = $1`,
          [req.tenantId, req.params.id],
        );
      }

      await client.query("COMMIT");
      res.json({
        success: true,
        transition: "keluar",
        effective_exit_date: effectiveExitDate,
        identity_preserved: true,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.log(err);
      sendScopedError(res, err);
    } finally {
      client.release();
    }
  }
);

// RFID lookup — admin + tenant scoped
router.get("/rfid/:uid", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nama, uid_rfid, saldo, limit_harian, kamar
       FROM santri
       WHERE uid_rfid = $1
         AND tenant_id = $2`,
      [req.params.uid, req.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const workspace = await resolveSantriWorkspace(req);
    const santri = await getVisibleSantri({
      tenantId: req.tenantId,
      unitId: workspace.unitId,
      santriId: req.params.id,
    });
    if (!santri) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }
    res.json({ success: true, data: santri });
  } catch (err) {
    console.log(err);
    sendScopedError(res, err, "Gagal memuat detail santri");
  }
});

module.exports = router;
