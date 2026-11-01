const express = require("express");
const router = express.Router();
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const {
  getActiveStudentContext,
  getMapelByNameInUnit,
  listActiveStudentsInClass,
  resolveAcademicPeriodForDate,
  resolveAcademicUnit,
  sendAcademicError,
} = require("../services/academicUnitService");

router.get("/students", async (req, res) => {
  try {
    const access = await resolveAcademicUnit(req);
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    const rows = await listActiveStudentsInClass(req.tenantId, req.query.kelas_id, access.unitId);
    res.json({ success: true, data: rows });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.get("/", async (req, res) => {
  try {
    const bulan = req.query.bulan ? Number(req.query.bulan) : null;
    const tahun = req.query.tahun ? Number(req.query.tahun) : null;

    const access = await resolveAcademicUnit(req);
    let query = `SELECT n.* FROM nilai_mingguan n WHERE n.tenant_id = $1`;
    const params = [req.tenantId];
    let paramIdx = 2;
    if (access.mode !== "ALL") {
      query += ` AND n.unit_id = $${paramIdx}`;
      params.push(access.unitId);
      paramIdx += 1;
    }

    if (bulan && tahun) {
      query += ` AND bulan = $${paramIdx} AND tahun = $${paramIdx + 1}`;
      params.push(bulan, tahun);
    } else if (bulan) {
      query += ` AND bulan = $${paramIdx}`;
      params.push(bulan);
    } else if (tahun) {
      query += ` AND tahun = $${paramIdx}`;
      params.push(tahun);
    }

    query += " ORDER BY n.id DESC";

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.post("/", requirePermission("nilai.manage"), async (req, res) => {
  try {
    const { santri_id, tanggal, mapel, nilai, bulan, tahun } = req.body;

    const access = await resolveAcademicUnit(req);
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    const context = await getActiveStudentContext(req.tenantId, santri_id, access.unitId);
    const mapelRecord = await getMapelByNameInUnit(req.tenantId, mapel, access.unitId);
    const period = await resolveAcademicPeriodForDate(
      req.tenantId,
      access.unitId,
      tanggal,
      { requireActive: true },
    );

    const cek = await pool.query(
      `SELECT n.id,n.academic_semester_id,s.status AS semester_status
       FROM nilai_mingguan n
       LEFT JOIN academic_semesters s ON s.tenant_id=n.tenant_id AND s.id=n.academic_semester_id
       WHERE n.tenant_id = $1
         AND n.unit_id = $2
         AND n.santri_id = $3
         AND n.mapel = $4
         AND n.bulan = $5
         AND n.tahun = $6`,
      [req.tenantId, access.unitId, santri_id, mapel, bulan, tahun]
    );

    if (cek.rows.length > 0) {
      if (cek.rows[0].semester_status === "CLOSED") {
        const error = new Error("Semester sudah ditutup; gunakan koreksi administratif teraudit");
        error.status = 409; error.code = "ACADEMIC_SEMESTER_CLOSED"; throw error;
      }
      if (!cek.rows[0].academic_semester_id && period) {
        const error = new Error("Nilai historis belum dipetakan ke semester dan tidak boleh diubah otomatis");
        error.status = 409; error.code = "HISTORICAL_PERIOD_UNMAPPED"; throw error;
      }
      const result = await pool.query(
        `UPDATE nilai_mingguan
         SET nilai = $1, tanggal = $2,
             santri_unit_id = $3, enrollment_id = $4, kelas_id = $5,
             mata_pelajaran_id = $6, actor_user_id = $7
         WHERE id = $8 AND tenant_id = $9 AND unit_id = $10
         RETURNING *`,
        [
          nilai, tanggal, context.santri_unit_id, context.enrollment_id, context.kelas_id,
          mapelRecord.id, req.user.id, cek.rows[0].id, req.tenantId, access.unitId,
        ]
      );

      return res.json({
        success: true,
        mode: "update",
        data: result.rows[0],
      });
    }

    const result = await pool.query(
       `INSERT INTO nilai_mingguan (
         santri_id, tanggal, mapel, nilai, bulan, tahun, tenant_id,
         unit_id, santri_unit_id, enrollment_id, kelas_id, mata_pelajaran_id,
         actor_user_id, source, academic_year_id, academic_semester_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'admin', $14, $15)
       RETURNING *`,
      [
        santri_id, tanggal, mapel, nilai, bulan, tahun, req.tenantId,
        access.unitId, context.santri_unit_id, context.enrollment_id,
        context.kelas_id, mapelRecord.id, req.user.id,
        period?.academic_year_id || null, period?.academic_semester_id || null,
      ]
    );

    res.json({ success: true, mode: "insert", data: result.rows[0] });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

module.exports = router;
