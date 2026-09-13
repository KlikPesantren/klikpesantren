const express = require("express");
const router = express.Router();
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const {
  getGuruInUnit,
  resolveAcademicUnit,
  sendAcademicError,
} = require("../services/academicUnitService");

router.get("/", async (req, res) => {
  try {
    const unitAccess = await resolveAcademicUnit(req);
    if (unitAccess.mode !== "UNIT") {
      return res.status(400).json({ success: false, error: "Pilih unit aktif untuk absensi guru", code: "UNIT_REQUIRED" });
    }
    const params = [req.tenantId];
    let query = `SELECT ag.*,
                        g.nama AS guru_nama,
                        g.jabatan AS guru_jabatan,
                        u.kode AS unit_kode,
                        u.nama AS unit_nama
                 FROM absensi_guru ag
                 JOIN guru g ON g.id = ag.guru_id AND g.tenant_id = ag.tenant_id
                 LEFT JOIN unit_pendidikan u
                   ON u.id = ag.unit_id AND u.tenant_id = ag.tenant_id
                 WHERE ag.tenant_id = $1
                   AND ag.unit_id IS NOT NULL`;

    if (unitAccess.mode === "UNIT") {
      params.push(unitAccess.unitId);
      query += ` AND ag.unit_id = $2`;
    }

    query += ` ORDER BY ag.tahun DESC, ag.bulan DESC, g.nama ASC, ag.id DESC`;

    const result = await pool.query(
      query,
      params
    );

    res.json({
      success: true,
      meta: {
        scope: unitAccess.mode === "UNIT" ? "unit" : "all",
        unit_id: unitAccess.mode === "UNIT" ? unitAccess.unitId : null,
        unit_name: unitAccess.mode === "UNIT" ? unitAccess.unit?.nama || null : null,
      },
      data: result.rows,
    });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.post("/", requirePermission("absensi_guru.manage"), async (req, res) => {
  try {
    const {
      guru_id,
      bulan,
      tahun,
      total_hadir,
      total_izin,
      total_sakit,
      total_alfa,
      unit_id,
    } = req.body;

    const unitRequest = unit_id ? { ...req, query: { ...req.query, unit_id } } : req;
    const unitAccess = await resolveAcademicUnit(unitRequest);
    if (unitAccess.mode !== "UNIT") {
      return res.status(400).json({
        success: false,
        error: "Pilih unit aktif untuk absensi guru",
        code: "UNIT_REQUIRED",
      });
    }
    const guruUnit = await getGuruInUnit(req.tenantId, guru_id, unitAccess.unitId);

    const result = await pool.query(
      `INSERT INTO absensi_guru (
         guru_id, bulan, tahun,
         total_hadir, total_izin, total_sakit, total_alfa,
         tenant_id, unit_id, guru_unit_id, actor_user_id, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (tenant_id, unit_id, guru_id, bulan, tahun) WHERE unit_id IS NOT NULL
       DO UPDATE SET
         total_hadir = EXCLUDED.total_hadir,
         total_izin  = EXCLUDED.total_izin,
         total_sakit = EXCLUDED.total_sakit,
         total_alfa  = EXCLUDED.total_alfa,
         tenant_id   = EXCLUDED.tenant_id,
         guru_unit_id = EXCLUDED.guru_unit_id,
         actor_user_id = EXCLUDED.actor_user_id,
         source = EXCLUDED.source
       RETURNING *`,
      [
        guru_id,
        bulan,
        tahun,
        total_hadir || 0,
        total_izin || 0,
        total_sakit || 0,
        total_alfa || 0,
        req.tenantId,
        unitAccess.unitId,
        guruUnit.guru_unit_id,
        req.user?.id || null,
        "admin",
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

module.exports = router;
