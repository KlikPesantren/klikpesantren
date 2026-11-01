const crypto = require("crypto");
const { attendanceReadSql } = require("./attendanceReadSql");

function reportError(code, message, status = 409) {
  const error = new Error(message); error.code = code; error.status = status; return error;
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function checksum(value) { return crypto.createHash("sha256").update(stable(value)).digest("hex"); }
function numberId(value, code) { const id = Number(value); if (!Number.isInteger(id) || id <= 0) throw reportError(code, "Identifier tidak valid", 400); return id; }

async function transaction(db, callback) {
  const client = typeof db.connect === "function" ? await db.connect() : db;
  try { await client.query("BEGIN"); const result = await callback(client); await client.query("COMMIT"); return result; }
  catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { if (client !== db) client.release(); }
}

async function workspace(client, tenantId, unitId, semesterId, kelasId, { lock = false } = {}) {
  const result = await client.query(
    `SELECT s.id semester_id,s.term,s.status semester_status,s.start_date,s.end_date,
            y.id academic_year_id,y.name academic_year_name,k.id kelas_id,k.nama_kelas,u.nama unit_name
     FROM academic_semesters s
     JOIN academic_years y ON y.tenant_id=s.tenant_id AND y.id=s.academic_year_id AND y.unit_id=s.unit_id
     JOIN kelas k ON k.tenant_id=s.tenant_id AND k.unit_id=s.unit_id AND k.id=$4
     JOIN unit_pendidikan u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id
     WHERE s.tenant_id=$1 AND s.unit_id=$2 AND s.id=$3${lock ? " FOR UPDATE OF s" : ""}`,
    [tenantId, unitId, numberId(semesterId, "SEMESTER_REQUIRED"), numberId(kelasId, "CLASS_REQUIRED")],
  );
  if (!result.rows[0]) throw reportError("REPORT_WORKSPACE_NOT_FOUND", "Workspace rapor tidak ditemukan", 404);
  return result.rows[0];
}

async function currentConfig(client, tenantId, unitId, configId = null) {
  const result = await client.query(
    `SELECT * FROM academic_report_config_versions
     WHERE tenant_id=$1 AND unit_id=$2 AND active=true AND ($3::bigint IS NULL OR id=$3)
     ORDER BY version DESC LIMIT 1`, [tenantId, unitId, configId],
  );
  if (!result.rows[0]) throw reportError("REPORT_CONFIG_REQUIRED", "Konfigurasi E-Rapor unit belum tersedia", 409);
  return result.rows[0];
}

async function configSubjects(client, tenantId, unitId, configId) {
  return (await client.query(
    `SELECT cs.*,mp.nama FROM academic_report_config_subjects cs
     JOIN mata_pelajaran mp ON mp.tenant_id=cs.tenant_id AND mp.id=cs.mata_pelajaran_id
     WHERE cs.tenant_id=$1 AND cs.unit_id=$2 AND cs.config_version_id=$3
     ORDER BY cs.display_order,cs.id`, [tenantId, unitId, configId],
  )).rows;
}

async function createConfig(db, input) {
  return transaction(db, async (client) => {
    const { tenantId, unitId, actorId } = input;
    const subjects = Array.isArray(input.subjects) ? input.subjects : [];
    if (!subjects.length) throw reportError("REPORT_SUBJECTS_REQUIRED", "Pilih minimal satu mata pelajaran", 400);
    const next = await client.query("SELECT COALESCE(MAX(version),0)+1 version FROM academic_report_config_versions WHERE tenant_id=$1 AND unit_id=$2", [tenantId, unitId]);
    await client.query("UPDATE academic_report_config_versions SET active=false WHERE tenant_id=$1 AND unit_id=$2 AND active=true", [tenantId, unitId]);
    const config = (await client.query(
      `INSERT INTO academic_report_config_versions
       (tenant_id,unit_id,version,name,template_code,institution_identity,grading_config,attendance_enabled,
        homeroom_notes_enabled,development_notes_enabled,ranking_enabled,wali_publication_enabled,signer,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [tenantId, unitId, next.rows[0].version, input.name, input.template_code || "STANDARD_A4",
       input.institution_identity || {}, input.grading_config || { scale_min: 0, scale_max: 100, rounding_scale: 2 },
       input.attendance_enabled !== false, input.homeroom_notes_enabled !== false, Boolean(input.development_notes_enabled),
       input.ranking_enabled !== false, input.wali_publication_enabled !== false, input.signer || {}, actorId],
    )).rows[0];
    for (const [index, subject] of subjects.entries()) {
      const mapelId = numberId(subject.mata_pelajaran_id, "MAPEL_REQUIRED");
      const valid = await client.query("SELECT 1 FROM mata_pelajaran WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND aktif=true", [tenantId, unitId, mapelId]);
      if (!valid.rows[0]) throw reportError("CROSS_UNIT_MAPEL", "Mata pelajaran tidak berada pada unit", 403);
      await client.query(
        `INSERT INTO academic_report_config_subjects
         (tenant_id,unit_id,config_version_id,mata_pelajaran_id,display_order,required,include_in_ranking,mastery_score)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, unitId, config.id, mapelId, subject.display_order ?? index, subject.required !== false,
         subject.include_in_ranking !== false, subject.mastery_score ?? null],
      );
    }
    return config;
  });
}

async function assignTeacher(db, input) {
  const result = await db.query(
    `INSERT INTO academic_report_teacher_assignments
     (tenant_id,unit_id,user_id,mata_pelajaran_id,kelas_id,assigned_by)
     SELECT $1,$2,u.id,mp.id,k.id,$6 FROM users u
     JOIN mata_pelajaran mp ON mp.tenant_id=$1 AND mp.unit_id=$2 AND mp.id=$4
     LEFT JOIN kelas k ON k.tenant_id=$1 AND k.unit_id=$2 AND k.id=$5
     WHERE u.tenant_id=$1 AND u.id=$3 AND ($5::int IS NULL OR k.id IS NOT NULL)
     ON CONFLICT DO NOTHING RETURNING *`,
    [input.tenantId,input.unitId,input.user_id,input.mata_pelajaran_id,input.kelas_id || null,input.actorId],
  );
  if (!result.rows[0]) throw reportError("INVALID_TEACHER_ASSIGNMENT", "Penugasan guru tidak valid atau sudah tersedia", 409);
  return result.rows[0];
}

async function listWorkspace(db, input) {
  const ws = await workspace(db,input.tenantId,input.unitId,input.semesterId,input.kelasId);
  const config = await currentConfig(db,input.tenantId,input.unitId,input.configId || null);
  const subjects = await configSubjects(db,input.tenantId,input.unitId,config.id);
  const students = (await db.query(
    `SELECT e.id enrollment_id,e.santri_unit_id,e.kelas_id,s.id santri_id,s.nama,s.nis,
            rc.id report_card_id,COALESCE(rc.status,'DRAFT') report_status,rc.homeroom_notes,rc.development_notes
     FROM santri_kelas_enrollments e JOIN santri_units su ON su.tenant_id=e.tenant_id AND su.id=e.santri_unit_id
     JOIN santri s ON s.tenant_id=su.tenant_id AND s.id=su.santri_id
     LEFT JOIN LATERAL(SELECT * FROM academic_report_cards r WHERE r.tenant_id=e.tenant_id
       AND r.academic_semester_id=$3 AND r.enrollment_id=e.id ORDER BY r.version DESC LIMIT 1) rc ON true
     WHERE e.tenant_id=$1 AND su.unit_id=$2 AND e.kelas_id=$4 AND e.academic_year_id=$5
     ORDER BY s.nama,s.id`, [input.tenantId,input.unitId,input.semesterId,input.kelasId,ws.academic_year_id],
  )).rows;
  const grades = (await db.query(
    `SELECT g.* FROM academic_semester_grades g WHERE tenant_id=$1 AND unit_id=$2
       AND academic_semester_id=$3 AND kelas_id=$4`, [input.tenantId,input.unitId,input.semesterId,input.kelasId],
  )).rows;
  return { workspace:ws,config,subjects,students,grades };
}

async function saveGrades(db, input) {
  return transaction(db, async (client) => {
    const ws = await workspace(client,input.tenantId,input.unitId,input.semesterId,input.kelasId,{lock:true});
    if (ws.semester_status !== "ACTIVE") throw reportError("ACADEMIC_SEMESTER_CLOSED", "Nilai semester hanya dapat diubah pada semester ACTIVE", 409);
    const config = await currentConfig(client,input.tenantId,input.unitId,input.configId || null);
    const allowed = new Map((await configSubjects(client,input.tenantId,input.unitId,config.id)).map((row)=>[Number(row.mata_pelajaran_id),row]));
    const grading = config.grading_config || {};
    const min = Number(grading.scale_min ?? 0), max = Number(grading.scale_max ?? 100);
    const entries = Array.isArray(input.grades) ? input.grades : [];
    if (!entries.length) throw reportError("SEMESTER_GRADES_REQUIRED", "Tidak ada nilai semester untuk disimpan", 400);
    for (const entry of entries) {
      const enrollmentId=numberId(entry.enrollment_id,"ENROLLMENT_REQUIRED"), mapelId=numberId(entry.mata_pelajaran_id,"MAPEL_REQUIRED");
      if (!allowed.has(mapelId)) throw reportError("MAPEL_NOT_IN_REPORT_CONFIG", "Mata pelajaran tidak termasuk konfigurasi rapor", 403);
      if (entry.final_score === "" || entry.final_score === null || entry.final_score === undefined) throw reportError("FINAL_SCORE_REQUIRED", "Nilai kosong tidak boleh disimpan sebagai nol", 400);
      const finalScore=Number(entry.final_score); if(!Number.isFinite(finalScore)||finalScore<min||finalScore>max) throw reportError("FINAL_SCORE_OUT_OF_RANGE",`Nilai harus berada pada rentang ${min}-${max}`,400);
      const enrollment=(await client.query(
        `SELECT e.id,e.santri_unit_id,e.kelas_id FROM santri_kelas_enrollments e JOIN santri_units su ON su.tenant_id=e.tenant_id AND su.id=e.santri_unit_id
         WHERE e.tenant_id=$1 AND su.unit_id=$2 AND e.id=$3 AND e.kelas_id=$4 AND e.academic_year_id=$5 FOR UPDATE OF e`,
        [input.tenantId,input.unitId,enrollmentId,input.kelasId,ws.academic_year_id],)).rows[0];
      if(!enrollment) throw reportError("CROSS_UNIT_ENROLLMENT","Enrollment tidak berada pada workspace rapor",403);
      if(!input.isManager){
        const assignment=await client.query(`SELECT 1 FROM academic_report_teacher_assignments WHERE tenant_id=$1 AND unit_id=$2
          AND user_id=$3 AND mata_pelajaran_id=$4 AND active=true AND (kelas_id IS NULL OR kelas_id=$5)`,
          [input.tenantId,input.unitId,input.actorId,mapelId,input.kelasId]);
        if(!assignment.rows[0]) throw reportError("SUBJECT_ASSIGNMENT_REQUIRED","Guru tidak ditugaskan pada mata pelajaran/kelas ini",403);
      }
      const published=await client.query(`SELECT 1 FROM academic_report_cards WHERE tenant_id=$1 AND academic_semester_id=$2 AND enrollment_id=$3 AND status='PUBLISHED'`,[input.tenantId,input.semesterId,enrollmentId]);
      if(published.rows[0]) throw reportError("PUBLISHED_REPORT_IMMUTABLE","Rapor terbit tidak dapat diubah diam-diam",409);
      await client.query(
        `INSERT INTO academic_semester_grades(tenant_id,unit_id,academic_year_id,academic_semester_id,enrollment_id,santri_unit_id,kelas_id,mata_pelajaran_id,final_score,achievement_description,actor_user_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(tenant_id,unit_id,academic_semester_id,enrollment_id,mata_pelajaran_id)
         DO UPDATE SET final_score=EXCLUDED.final_score,achievement_description=EXCLUDED.achievement_description,actor_user_id=EXCLUDED.actor_user_id,updated_at=NOW()`,
        [input.tenantId,input.unitId,ws.academic_year_id,input.semesterId,enrollmentId,enrollment.santri_unit_id,input.kelasId,mapelId,finalScore,entry.achievement_description || null,input.actorId],
      );
    }
    return { saved:entries.length };
  });
}

async function ensureReportCard(client,input,ws,config) {
  let row=(await client.query(`SELECT * FROM academic_report_cards WHERE tenant_id=$1 AND unit_id=$2 AND academic_semester_id=$3 AND enrollment_id=$4 AND status<>'PUBLISHED' ORDER BY version DESC LIMIT 1`,[input.tenantId,input.unitId,input.semesterId,input.enrollmentId])).rows[0];
  if(row) return row;
  const enrollment=(await client.query(`SELECT e.id,e.santri_unit_id,e.kelas_id FROM santri_kelas_enrollments e JOIN santri_units su ON su.tenant_id=e.tenant_id AND su.id=e.santri_unit_id WHERE e.tenant_id=$1 AND su.unit_id=$2 AND e.id=$3 AND e.kelas_id=$4 AND e.academic_year_id=$5`,[input.tenantId,input.unitId,input.enrollmentId,input.kelasId,ws.academic_year_id])).rows[0];
  if(!enrollment) throw reportError("CROSS_UNIT_ENROLLMENT","Enrollment tidak berada pada workspace rapor",403);
  row=(await client.query(`INSERT INTO academic_report_cards(tenant_id,unit_id,academic_year_id,academic_semester_id,enrollment_id,santri_unit_id,kelas_id,config_version_id,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[input.tenantId,input.unitId,ws.academic_year_id,input.semesterId,enrollment.id,enrollment.santri_unit_id,input.kelasId,config.id,input.actorId])).rows[0];
  return row;
}

async function saveReportNotes(db,input){return transaction(db,async(client)=>{const ws=await workspace(client,input.tenantId,input.unitId,input.semesterId,input.kelasId);const config=await currentConfig(client,input.tenantId,input.unitId,input.configId||null);const card=await ensureReportCard(client,input,ws,config);if(!['DRAFT','REVISION_REQUIRED'].includes(card.status))throw reportError('REPORT_NOT_EDITABLE','Rapor tidak berada pada status yang dapat diedit',409);return(await client.query(`UPDATE academic_report_cards SET homeroom_notes=$1,development_notes=$2,updated_at=NOW() WHERE tenant_id=$3 AND id=$4 RETURNING *`,[input.homeroom_notes||null,input.development_notes||null,input.tenantId,card.id])).rows[0];});}

const TRANSITIONS={DRAFT:['REVIEW'],REVISION_REQUIRED:['REVIEW'],REVIEW:['APPROVED','REVISION_REQUIRED']};
async function transitionReport(db,input){return transaction(db,async(client)=>{const card=(await client.query(`SELECT * FROM academic_report_cards WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 FOR UPDATE`,[input.tenantId,input.unitId,input.reportCardId])).rows[0];if(!card)throw reportError('REPORT_NOT_FOUND','Rapor tidak ditemukan',404);if(!(TRANSITIONS[card.status]||[]).includes(input.to_status))throw reportError('INVALID_REPORT_TRANSITION',`Transisi ${card.status} ke ${input.to_status} tidak diizinkan`,409);if(input.to_status==='REVISION_REQUIRED'&&!String(input.reason||'').trim())throw reportError('REVISION_REASON_REQUIRED','Alasan revisi wajib diisi',400);const fields=input.to_status==='REVIEW'?`submitted_by=$4,submitted_at=NOW()`:input.to_status==='APPROVED'?`approved_by=$4,approved_at=NOW()`:`submitted_by=$4,submitted_at=NOW(),approved_by=NULL,approved_at=NULL`;const updated=(await client.query(`UPDATE academic_report_cards SET status=$1,${fields},updated_at=NOW() WHERE tenant_id=$2 AND id=$3 RETURNING *`,[input.to_status,input.tenantId,card.id,input.actorId])).rows[0];await client.query(`INSERT INTO academic_report_workflow_events(tenant_id,unit_id,report_card_id,from_status,to_status,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.tenantId,input.unitId,card.id,card.status,input.to_status,input.reason||null,input.actorId]);return updated;});}

async function correctSemesterGrade(db,input){return transaction(db,async(client)=>{if(input.confirmation!=='CORRECT_PUBLISHED_REPORT')throw reportError('CORRECTION_CONFIRMATION_REQUIRED','Konfirmasi koreksi rapor tidak valid',400);if(!String(input.reason||'').trim())throw reportError('CORRECTION_REASON_REQUIRED','Alasan koreksi wajib diisi',400);const grade=(await client.query(`SELECT g.*,s.status semester_status,c.grading_config FROM academic_semester_grades g JOIN academic_semesters s ON s.tenant_id=g.tenant_id AND s.id=g.academic_semester_id JOIN academic_report_config_versions c ON c.tenant_id=g.tenant_id AND c.unit_id=g.unit_id AND c.id=(SELECT rc.config_version_id FROM academic_report_cards rc WHERE rc.tenant_id=g.tenant_id AND rc.unit_id=g.unit_id AND rc.academic_semester_id=g.academic_semester_id AND rc.enrollment_id=g.enrollment_id ORDER BY rc.version DESC LIMIT 1) WHERE g.tenant_id=$1 AND g.unit_id=$2 AND g.id=$3 FOR UPDATE OF g`,[input.tenantId,input.unitId,input.gradeId])).rows[0];if(!grade)throw reportError('SEMESTER_GRADE_NOT_FOUND','Nilai semester tidak ditemukan',404);const revision=(await client.query(`SELECT 1 FROM academic_report_cards WHERE tenant_id=$1 AND unit_id=$2 AND academic_semester_id=$3 AND enrollment_id=$4 AND revision_of_id IS NOT NULL AND status IN('DRAFT','REVISION_REQUIRED')`,[input.tenantId,input.unitId,grade.academic_semester_id,grade.enrollment_id])).rows[0];if(!revision)throw reportError('REPORT_REVISION_REQUIRED','Buat versi revisi rapor sebelum mengoreksi nilai terbit',409);const newScore=Number(input.final_score),min=Number(grade.grading_config?.scale_min??0),max=Number(grade.grading_config?.scale_max??100);if(!Number.isFinite(newScore)||newScore<min||newScore>max)throw reportError('FINAL_SCORE_OUT_OF_RANGE',`Nilai harus berada pada rentang ${min}-${max}`,400);await client.query(`INSERT INTO academic_semester_grade_corrections(tenant_id,unit_id,semester_grade_id,old_score,new_score,old_description,new_description,reason,actor_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[input.tenantId,input.unitId,grade.id,grade.final_score,newScore,grade.achievement_description,input.achievement_description??grade.achievement_description,input.reason,input.actorId]);return(await client.query(`UPDATE academic_semester_grades SET final_score=$1,achievement_description=$2,actor_user_id=$3,updated_at=NOW() WHERE tenant_id=$4 AND id=$5 RETURNING *`,[newScore,input.achievement_description??grade.achievement_description,input.actorId,input.tenantId,grade.id])).rows[0];});}

function rankRows(rows, roundingScale=2){const factor=10**roundingScale;const normalized=rows.map(row=>({...row,average:Math.round((Number(row.total)/Number(row.subject_count))*factor)/factor})).sort((a,b)=>b.average-a.average||Number(a.enrollment_id)-Number(b.enrollment_id));let previous=null,rank=0;return normalized.map((row,index)=>{if(previous===null||row.average!==previous)rank=index+1;previous=row.average;return{enrollment_id:Number(row.enrollment_id),average:row.average,total:Number(row.total),rank};});}

async function rankingInput(client,input,config){const subjects=(await configSubjects(client,input.tenantId,input.unitId,config.id)).filter(s=>s.include_in_ranking);const required=subjects.filter(s=>s.required);if(!subjects.length)throw reportError('RANKING_SUBJECTS_REQUIRED','Tidak ada mata pelajaran untuk ranking',409);const rows=(await client.query(`SELECT e.id enrollment_id,COUNT(g.id)::int subject_count,COALESCE(SUM(g.final_score),0)::numeric total
  FROM santri_kelas_enrollments e JOIN santri_units su ON su.tenant_id=e.tenant_id AND su.id=e.santri_unit_id
  LEFT JOIN academic_semester_grades g ON g.tenant_id=e.tenant_id AND g.enrollment_id=e.id AND g.academic_semester_id=$3 AND g.mata_pelajaran_id=ANY($6::int[])
  WHERE e.tenant_id=$1 AND su.unit_id=$2 AND e.kelas_id=$4 AND e.academic_year_id=$5 GROUP BY e.id ORDER BY e.id`,[input.tenantId,input.unitId,input.semesterId,input.kelasId,input.academicYearId,subjects.map(s=>s.mata_pelajaran_id)])).rows;
  if(!rows.length)throw reportError('REPORT_PARTICIPANTS_REQUIRED','Tidak ada peserta rapor pada rombel',409);if(rows.some(r=>Number(r.subject_count)<required.length))throw reportError('REQUIRED_GRADES_INCOMPLETE','Nilai wajib belum lengkap untuk seluruh peserta rombel',409);return{rows,subjects};}

async function previewRanking(db,input){const ws=await workspace(db,input.tenantId,input.unitId,input.semesterId,input.kelasId);const config=await currentConfig(db,input.tenantId,input.unitId,input.configId||null);const data=await rankingInput(db,{...input,academicYearId:ws.academic_year_id},config);return rankRows(data.rows,Number(config.grading_config?.rounding_scale??2));}

async function finalizeRanking(db,input){return transaction(db,async(client)=>{await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`report-ranking:${input.tenantId}:${input.unitId}:${input.semesterId}:${input.kelasId}`]);const ws=await workspace(client,input.tenantId,input.unitId,input.semesterId,input.kelasId,{lock:true});if(ws.semester_status!=='CLOSED')throw reportError('SEMESTER_MUST_BE_CLOSED','Tutup semester sebelum finalisasi ranking',409);const config=await currentConfig(client,input.tenantId,input.unitId,input.configId||null);const cardState=await client.query(`SELECT COUNT(e.id)::int participants,COUNT(rc.id) FILTER(WHERE rc.status='APPROVED')::int approved FROM santri_kelas_enrollments e JOIN santri_units su ON su.tenant_id=e.tenant_id AND su.id=e.santri_unit_id LEFT JOIN academic_report_cards rc ON rc.tenant_id=e.tenant_id AND rc.unit_id=su.unit_id AND rc.academic_semester_id=$3 AND rc.enrollment_id=e.id AND rc.status<>'PUBLISHED' WHERE e.tenant_id=$1 AND su.unit_id=$2 AND e.academic_year_id=$4 AND e.kelas_id=$5`,[input.tenantId,input.unitId,input.semesterId,ws.academic_year_id,input.kelasId]);if(Number(cardState.rows[0].participants)!==Number(cardState.rows[0].approved))throw reportError('REPORTS_NOT_APPROVED','Semua peserta rombel harus memiliki rapor APPROVED sebelum ranking difinalisasi',409);const data=await rankingInput(client,{...input,academicYearId:ws.academic_year_id},config);const ranking=rankRows(data.rows,Number(config.grading_config?.rounding_scale??2));const inputChecksum=checksum({grades:data.rows,subjects:data.subjects.map(s=>s.mata_pelajaran_id)});const next=(await client.query(`SELECT COALESCE(MAX(version),0)+1 version FROM academic_report_ranking_finalizations WHERE tenant_id=$1 AND unit_id=$2 AND academic_semester_id=$3 AND kelas_id=$4`,[input.tenantId,input.unitId,input.semesterId,input.kelasId])).rows[0].version;return(await client.query(`INSERT INTO academic_report_ranking_finalizations(tenant_id,unit_id,academic_year_id,academic_semester_id,kelas_id,config_version_id,version,input_checksum,ranking_snapshot,participant_count,finalized_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[input.tenantId,input.unitId,ws.academic_year_id,input.semesterId,input.kelasId,config.id,next,inputChecksum,JSON.stringify(ranking),ranking.length,input.actorId])).rows[0];});}

async function attendanceFor(client,tenantId,unitId,enrollmentId,semester){const projection=attendanceReadSql('$1');const rows=(await client.query(`SELECT status,COUNT(*)::int count FROM (${projection}) a WHERE a.unit_id=$2 AND a.enrollment_id=$3 AND a.tanggal BETWEEN $4 AND $5 GROUP BY status`,[tenantId,unitId,enrollmentId,semester.start_date,semester.end_date])).rows;const result={sakit:0,izin:0,alfa:0};for(const row of rows){const key=String(row.status||'').toUpperCase();if(key==='S')result.sakit+=Number(row.count);if(key==='I')result.izin+=Number(row.count);if(key==='A')result.alfa+=Number(row.count);}return result;}

async function publishClass(db,input){return transaction(db,async(client)=>{await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`report-publish:${input.tenantId}:${input.unitId}:${input.semesterId}:${input.kelasId}`]);const ws=await workspace(client,input.tenantId,input.unitId,input.semesterId,input.kelasId,{lock:true});if(ws.semester_status!=='CLOSED')throw reportError('SEMESTER_MUST_BE_CLOSED','Semester wajib CLOSED sebelum publikasi',409);const config=await currentConfig(client,input.tenantId,input.unitId,input.configId||null);const finalization=(await client.query(`SELECT * FROM academic_report_ranking_finalizations WHERE tenant_id=$1 AND unit_id=$2 AND academic_semester_id=$3 AND kelas_id=$4 ORDER BY version DESC LIMIT 1`,[input.tenantId,input.unitId,input.semesterId,input.kelasId])).rows[0];if(!finalization)throw reportError('RANKING_NOT_FINALIZED','Ranking rombel belum difinalisasi',409);const data=await rankingInput(client,{...input,academicYearId:ws.academic_year_id},config);const currentChecksum=checksum({grades:data.rows,subjects:data.subjects.map(s=>s.mata_pelajaran_id)});if(currentChecksum!==finalization.input_checksum)throw reportError('RANKING_STALE','Nilai berubah setelah ranking difinalisasi',409);const cards=(await client.query(`SELECT rc.*,s.nama,s.nis FROM academic_report_cards rc JOIN santri_units su ON su.tenant_id=rc.tenant_id AND su.id=rc.santri_unit_id JOIN santri s ON s.tenant_id=su.tenant_id AND s.id=su.santri_id WHERE rc.tenant_id=$1 AND rc.unit_id=$2 AND rc.academic_semester_id=$3 AND rc.kelas_id=$4 AND rc.status='APPROVED' ORDER BY rc.enrollment_id FOR UPDATE OF rc`,[input.tenantId,input.unitId,input.semesterId,input.kelasId])).rows;if(cards.length!==finalization.participant_count)throw reportError('REPORT_GROUP_INCOMPLETE','Jumlah rapor APPROVED tidak sama dengan peserta ranking',409);const rankMap=new Map(finalization.ranking_snapshot.map(r=>[Number(r.enrollment_id),r]));const subjects=await configSubjects(client,input.tenantId,input.unitId,config.id);const published=[];for(const card of cards){const grades=(await client.query(`SELECT g.final_score,g.achievement_description,mp.nama FROM academic_semester_grades g JOIN mata_pelajaran mp ON mp.tenant_id=g.tenant_id AND mp.id=g.mata_pelajaran_id WHERE g.tenant_id=$1 AND g.academic_semester_id=$2 AND g.enrollment_id=$3 ORDER BY array_position($4::int[],g.mata_pelajaran_id)`,[input.tenantId,input.semesterId,card.enrollment_id,subjects.map(s=>s.mata_pelajaran_id)])).rows;const rank=rankMap.get(Number(card.enrollment_id));const attendance=await attendanceFor(client,input.tenantId,input.unitId,card.enrollment_id,ws);const snapshot={schema_version:1,institution:config.institution_identity,unit_name:ws.unit_name,student:{id:card.santri_unit_id,name:card.nama,nis:card.nis},period:{academic_year:ws.academic_year_name,semester:ws.term,academic_year_id:ws.academic_year_id,academic_semester_id:Number(input.semesterId)},class_name:ws.nama_kelas,kelas_id:Number(input.kelasId),subjects:grades.map(g=>({name:g.nama,final_score:Number(g.final_score),description:g.achievement_description})),summary:{total:rank.total,average:rank.average},ranking:{rank:rank.rank,participant_count:finalization.participant_count},attendance,homeroom_notes:card.homeroom_notes,development_notes:card.development_notes,signer:config.signer,template:{code:config.template_code,config_version:config.version},issue_place:config.institution_identity?.city||'',issue_date:new Date().toISOString().slice(0,10),published_at:new Date().toISOString(),published_by:input.actorId,report_version:card.version};const snapshotChecksum=checksum(snapshot);await client.query(`UPDATE academic_report_publications p SET is_current=false FROM academic_report_cards old WHERE p.tenant_id=$1 AND p.report_card_id=old.id AND old.enrollment_id=$2 AND old.academic_semester_id=$3 AND p.is_current`,[input.tenantId,card.enrollment_id,input.semesterId]);const pub=(await client.query(`INSERT INTO academic_report_publications(tenant_id,unit_id,report_card_id,ranking_finalization_id,version,snapshot,snapshot_checksum,published_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[input.tenantId,input.unitId,card.id,finalization.id,card.version,JSON.stringify(snapshot),snapshotChecksum,input.actorId])).rows[0];await client.query(`UPDATE academic_report_cards SET status='PUBLISHED',published_by=$1,published_at=NOW(),updated_at=NOW() WHERE tenant_id=$2 AND id=$3`,[input.actorId,input.tenantId,card.id]);await client.query(`INSERT INTO academic_report_workflow_events(tenant_id,unit_id,report_card_id,from_status,to_status,actor_user_id) VALUES($1,$2,$3,'APPROVED','PUBLISHED',$4)`,[input.tenantId,input.unitId,card.id,input.actorId]);published.push(pub.id);}return{published:published.length,publication_ids:published};});}

async function createRevision(db,input){return transaction(db,async(client)=>{const old=(await client.query(`SELECT * FROM academic_report_cards WHERE tenant_id=$1 AND unit_id=$2 AND id=$3 AND status='PUBLISHED' FOR UPDATE`,[input.tenantId,input.unitId,input.reportCardId])).rows[0];if(!old)throw reportError('PUBLISHED_REPORT_NOT_FOUND','Rapor terbit tidak ditemukan',404);if(!String(input.reason||'').trim())throw reportError('REVISION_REASON_REQUIRED','Alasan revisi wajib diisi',400);return(await client.query(`INSERT INTO academic_report_cards(tenant_id,unit_id,academic_year_id,academic_semester_id,enrollment_id,santri_unit_id,kelas_id,config_version_id,version,revision_of_id,status,homeroom_notes,development_notes,revision_reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'REVISION_REQUIRED',$11,$12,$13,$14) RETURNING *`,[old.tenant_id,old.unit_id,old.academic_year_id,old.academic_semester_id,old.enrollment_id,old.santri_unit_id,old.kelas_id,old.config_version_id,Number(old.version)+1,old.id,old.homeroom_notes,old.development_notes,input.reason,input.actorId])).rows[0];});}

async function listPublishedForWali(db,{tenantId,unitId,santriId}){return(await db.query(`SELECT p.id,p.published_at,p.snapshot->'period' period,p.snapshot->>'class_name' class_name,p.snapshot->'summary' summary,p.snapshot->'ranking' ranking FROM academic_report_publications p JOIN academic_report_cards rc ON rc.tenant_id=p.tenant_id AND rc.id=p.report_card_id JOIN santri_units su ON su.tenant_id=rc.tenant_id AND su.id=rc.santri_unit_id JOIN academic_report_config_versions cfg ON cfg.tenant_id=p.tenant_id AND cfg.id=rc.config_version_id WHERE p.tenant_id=$1 AND p.unit_id=$2 AND su.santri_id=$3 AND p.is_current=true AND cfg.wali_publication_enabled=true ORDER BY p.published_at DESC`,[tenantId,unitId,santriId])).rows;}
async function getPublicationForWali(db,{tenantId,unitId,santriId,publicationId}){const row=(await db.query(`SELECT p.* FROM academic_report_publications p JOIN academic_report_cards rc ON rc.tenant_id=p.tenant_id AND rc.id=p.report_card_id JOIN santri_units su ON su.tenant_id=rc.tenant_id AND su.id=rc.santri_unit_id JOIN academic_report_config_versions cfg ON cfg.tenant_id=p.tenant_id AND cfg.id=rc.config_version_id WHERE p.tenant_id=$1 AND p.unit_id=$2 AND p.id=$3 AND su.santri_id=$4 AND p.is_current=true AND cfg.wali_publication_enabled=true`,[tenantId,unitId,publicationId,santriId])).rows[0];if(!row)throw reportError('REPORT_NOT_AVAILABLE','Rapor tidak tersedia',404);return row;}

module.exports={assignTeacher,checksum,correctSemesterGrade,createConfig,createRevision,finalizeRanking,listPublishedForWali,getPublicationForWali,listWorkspace,previewRanking,publishClass,rankRows,reportError,saveGrades,saveReportNotes,transitionReport};
