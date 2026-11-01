const crypto = require("crypto");

function fail(message, code, status = 400) { const e = new Error(message); e.code = code; e.status = status; throw e; }
function stableHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

function createAcademicPeriodService(db) {
  async function list(tenantId, unitId) {
    const [years, semesters, levels, classes] = await Promise.all([
      db.query("SELECT * FROM academic_years WHERE tenant_id=$1 AND ($2::int IS NULL OR unit_id=$2) ORDER BY start_date DESC", [tenantId, unitId]),
      db.query("SELECT * FROM academic_semesters WHERE tenant_id=$1 AND ($2::int IS NULL OR unit_id=$2) ORDER BY start_date DESC", [tenantId, unitId]),
      db.query("SELECT * FROM academic_grade_levels WHERE tenant_id=$1 AND ($2::int IS NULL OR unit_id=$2) ORDER BY sort_order", [tenantId, unitId]),
      db.query("SELECT id,nama_kelas,unit_id,academic_grade_level_id FROM kelas WHERE tenant_id=$1 AND ($2::int IS NULL OR unit_id=$2) ORDER BY nama_kelas", [tenantId, unitId]),
    ]);
    return { years: years.rows, semesters: semesters.rows, levels: levels.rows, classes: classes.rows };
  }

  async function createYear(ctx, input) {
    const { rows } = await db.query(`INSERT INTO academic_years(tenant_id,unit_id,name,start_date,end_date,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [ctx.tenantId,ctx.unitId,input.name,input.start_date,input.end_date,ctx.userId]);
    return rows[0];
  }
  async function createSemester(ctx, input) {
    const { rows } = await db.query(`INSERT INTO academic_semesters(tenant_id,unit_id,academic_year_id,term,start_date,end_date,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [ctx.tenantId,ctx.unitId,input.academic_year_id,input.term,input.start_date,input.end_date,ctx.userId]);
    return rows[0];
  }
  async function createLevel(ctx,input){const {rows}=await db.query(`INSERT INTO academic_grade_levels(tenant_id,unit_id,code,name,sort_order,duration_years,is_terminal) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[ctx.tenantId,ctx.unitId,input.code,input.name,input.sort_order,input.duration_years||1,Boolean(input.is_terminal)]);return rows[0];}
  async function mapClass(ctx,classId,levelId){const {rows}=await db.query(`UPDATE kelas SET academic_grade_level_id=$1 WHERE id=$2 AND tenant_id=$3 AND unit_id=$4 RETURNING *`,[levelId,classId,ctx.tenantId,ctx.unitId]);if(!rows[0])fail('Kelas tidak ditemukan pada unit aktif','NOT_FOUND',404);return rows[0];}
  async function transitionSemester(ctx, id, action) {
    if (!['activate','close'].includes(action)) fail('Aksi semester tidak valid','INVALID_ACTION');
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(`SELECT * FROM academic_semesters WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 FOR UPDATE`,[id,ctx.tenantId,ctx.unitId]);
      if (!current.rows[0]) fail('Semester tidak ditemukan','NOT_FOUND',404);
      if (action==='activate' && current.rows[0].status!=='DRAFT') fail('Hanya semester DRAFT yang dapat dibuka','INVALID_STATE');
      if (action==='close' && current.rows[0].status!=='ACTIVE') fail('Hanya semester ACTIVE yang dapat ditutup','INVALID_STATE');
      if(action==='activate'){
        const parent=await client.query('SELECT status FROM academic_years WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 FOR UPDATE',[current.rows[0].academic_year_id,ctx.tenantId,ctx.unitId]);
        if(!parent.rows[0]||parent.rows[0].status==='CLOSED')fail('Tahun ajaran sudah ditutup; semester tidak dapat diaktifkan','ACADEMIC_YEAR_CLOSED',409);
      }
      const status=action==='activate'?'ACTIVE':'CLOSED';
      const stamp=action==='activate'?'activated_at':'closed_at';
      const result=await client.query(`UPDATE academic_semesters SET status=$1, ${stamp}=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *`,[status,id]);
      await client.query(`UPDATE academic_years SET status=CASE WHEN $1='ACTIVE' THEN 'ACTIVE' ELSE status END,
        activated_at=CASE WHEN $1='ACTIVE' THEN COALESCE(activated_at,NOW()) ELSE activated_at END WHERE id=$2`,[status,current.rows[0].academic_year_id]);
      await client.query('COMMIT'); return result.rows[0];
    } catch(e){ await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async function transitionYear(ctx,id,action){
    if(!['activate','close'].includes(action))fail('Aksi tahun ajaran tidak valid','INVALID_ACTION');
    const client=await db.connect();try{await client.query('BEGIN');const current=await client.query(`SELECT * FROM academic_years WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 FOR UPDATE`,[id,ctx.tenantId,ctx.unitId]);if(!current.rows[0])fail('Tahun ajaran tidak ditemukan','NOT_FOUND',404);
      if(action==='activate'&&current.rows[0].status!=='DRAFT')fail('Hanya tahun DRAFT yang dapat dibuka','INVALID_STATE');
      if(action==='close'){if(current.rows[0].status!=='ACTIVE')fail('Hanya tahun ACTIVE yang dapat ditutup','INVALID_STATE');const active=await client.query(`SELECT 1 FROM academic_semesters WHERE academic_year_id=$1 AND status='ACTIVE'`,[id]);if(active.rows[0])fail('Tutup semester aktif terlebih dahulu','ACTIVE_SEMESTER_EXISTS',409);}
      const status=action==='activate'?'ACTIVE':'CLOSED',stamp=action==='activate'?'activated_at':'closed_at';const result=await client.query(`UPDATE academic_years SET status=$1,${stamp}=NOW(),updated_at=NOW() WHERE id=$2 RETURNING *`,[status,id]);await client.query('COMMIT');return result.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }

  async function preview(ctx, input) {
    const { rows } = await db.query(`SELECT su.id santri_unit_id,s.id santri_id,s.nama,ske.id source_enrollment_id,
      ske.kelas_id source_kelas_id,k.nama_kelas source_kelas,agl.id source_grade_level_id,agl.name source_level,
      agl.duration_years,agl.is_terminal,
      (SELECT COUNT(DISTINCT ay.id) FROM santri_kelas_enrollments eh JOIN academic_years ay ON ay.id=eh.academic_year_id
       WHERE eh.tenant_id=su.tenant_id AND eh.santri_unit_id=su.id AND eh.academic_grade_level_id=agl.id) years_in_level
      FROM santri_units su JOIN santri s ON s.id=su.santri_id AND s.tenant_id=su.tenant_id
      JOIN santri_kelas_enrollments ske ON ske.santri_unit_id=su.id AND ske.tenant_id=su.tenant_id AND ske.status='active' AND ske.end_date IS NULL
      JOIN kelas k ON k.id=ske.kelas_id AND k.tenant_id=ske.tenant_id
      LEFT JOIN academic_grade_levels agl ON agl.id=k.academic_grade_level_id AND agl.tenant_id=k.tenant_id
      WHERE su.tenant_id=$1 AND su.unit_id=$2 AND su.status='active' ORDER BY s.nama`,[ctx.tenantId,ctx.unitId]);
    const mappings=new Map((input.mappings||[]).map(x=>[Number(x.source_kelas_id),x]));
    return rows.map(row=>{
      const mapping=mappings.get(Number(row.source_kelas_id));
      let decision='PERLU_PEMERIKSAAN';
      const years=Number(row.years_in_level||0);
      if(!row.source_grade_level_id || years===0) decision='PERLU_PEMERIKSAAN';
      else if(years < Number(row.duration_years)) decision='TETAP';
      else if(row.is_terminal) decision='LULUS';
      else if(mapping?.target_kelas_id && mapping?.target_grade_level_id) decision='NAIK';
      return {...row,target_kelas_id:mapping?.target_kelas_id||null,target_grade_level_id:mapping?.target_grade_level_id||null,recommendation:decision};
    });
  }

  async function execute(ctx, input) {
    if(!input.idempotency_key || !Array.isArray(input.decisions)) fail('Idempotency key dan keputusan wajib','INVALID_REQUEST');
    if(input.decisions.some(x=>x.decision==='PERLU_PEMERIKSAAN')) fail('Semua baris perlu diselesaikan sebelum konfirmasi','UNRESOLVED_DECISION');
    const client=await db.connect(), hash=stableHash(input);
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${ctx.tenantId}:${ctx.unitId}:promotion`]);
      const years=await client.query(`SELECT id,status,start_date FROM academic_years WHERE tenant_id=$1 AND unit_id=$2 AND id=ANY($3::bigint[]) FOR UPDATE`,[ctx.tenantId,ctx.unitId,[input.source_academic_year_id,input.target_academic_year_id]]);
      const sourceYear=years.rows.find(x=>Number(x.id)===Number(input.source_academic_year_id));
      const targetYear=years.rows.find(x=>Number(x.id)===Number(input.target_academic_year_id));
      if(!sourceYear||!targetYear||sourceYear.status!=='CLOSED'||!['DRAFT','ACTIVE'].includes(targetYear.status)||new Date(targetYear.start_date)<=new Date(sourceYear.start_date)) fail('Periode asal/tujuan tidak lagi valid','STALE_ACADEMIC_PERIOD',409);
      const old=await client.query(`SELECT * FROM academic_promotion_batches WHERE tenant_id=$1 AND unit_id=$2 AND idempotency_key=$3`,[ctx.tenantId,ctx.unitId,input.idempotency_key]);
      if(old.rows[0]) { if(old.rows[0].request_hash!==hash) fail('Kunci idempotensi dipakai untuk payload berbeda','IDEMPOTENCY_CONFLICT',409); await client.query('ROLLBACK'); return old.rows[0]; }
      const batchId=crypto.randomUUID(); const counts={};
      await client.query(`INSERT INTO academic_promotion_batches(id,tenant_id,unit_id,source_academic_year_id,target_academic_year_id,idempotency_key,request_hash,actor_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[batchId,ctx.tenantId,ctx.unitId,input.source_academic_year_id,input.target_academic_year_id,input.idempotency_key,hash,ctx.userId]);
      for(const d of input.decisions){
        const locked=await client.query(`SELECT ske.*,k.academic_grade_level_id FROM santri_kelas_enrollments ske JOIN santri_units su ON su.id=ske.santri_unit_id AND su.tenant_id=ske.tenant_id JOIN kelas k ON k.id=ske.kelas_id AND k.tenant_id=ske.tenant_id
          WHERE ske.id=$1 AND ske.tenant_id=$2 AND su.unit_id=$3 AND ske.status='active' AND ske.end_date IS NULL FOR UPDATE OF ske`,[d.source_enrollment_id,ctx.tenantId,ctx.unitId]);
        if(!locked.rows[0]) fail('Keanggotaan kelas berubah; muat ulang preview','STALE_PREVIEW',409);
        const src=locked.rows[0]; let targetEnrollment=null;
        await client.query(`UPDATE santri_kelas_enrollments SET status=CASE WHEN $1='PINDAH' THEN 'moved' ELSE 'completed' END,end_date=$2,updated_at=NOW() WHERE id=$3`,[d.decision,input.effective_date,src.id]);
        if(['NAIK','TETAP'].includes(d.decision)){
          const targetClass=d.decision==='TETAP'?(d.target_kelas_id||src.kelas_id):d.target_kelas_id;
          if(!targetClass) fail('Rombel tujuan wajib','TARGET_CLASS_REQUIRED');
          const ins=await client.query(`INSERT INTO santri_kelas_enrollments(tenant_id,santri_unit_id,kelas_id,academic_year_id,academic_grade_level_id,level_started_academic_year_id,start_date,status)
            SELECT $1::int,$2::bigint,k.id,$3::bigint,k.academic_grade_level_id,CASE WHEN $4::text='TETAP' THEN COALESCE($5::bigint,$3::bigint) ELSE $3::bigint END,$6::date,'active' FROM kelas k WHERE k.id=$7::int AND k.tenant_id=$1::int AND k.unit_id=$8::int AND k.academic_grade_level_id IS NOT NULL RETURNING id,academic_grade_level_id`,[ctx.tenantId,src.santri_unit_id,input.target_academic_year_id,d.decision,src.level_started_academic_year_id,input.effective_date,targetClass,ctx.unitId]);
          if(!ins.rows[0]) fail('Rombel tujuan tidak valid atau belum memiliki tingkat','TARGET_CLASS_INVALID'); targetEnrollment=ins.rows[0].id; d.target_grade_level_id=ins.rows[0].academic_grade_level_id;
        }
        await client.query(`INSERT INTO academic_promotion_decisions(tenant_id,unit_id,batch_id,santri_unit_id,source_enrollment_id,target_enrollment_id,source_kelas_id,target_kelas_id,source_grade_level_id,target_grade_level_id,decision,reason,effective_date,actor_user_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[ctx.tenantId,ctx.unitId,batchId,src.santri_unit_id,src.id,targetEnrollment,src.kelas_id,d.target_kelas_id||null,src.academic_grade_level_id,d.target_grade_level_id||null,d.decision,d.reason||null,input.effective_date,ctx.userId]);
        counts[d.decision]=(counts[d.decision]||0)+1;
      }
      const result=await client.query(`UPDATE academic_promotion_batches SET summary=$1 WHERE id=$2 RETURNING *`,[counts,batchId]);
      await client.query('COMMIT'); return result.rows[0];
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }
  async function correctClosedGrade(ctx, nilaiId, input) {
    if (input.confirmation !== 'CORRECT_CLOSED_SEMESTER' || !String(input.reason || '').trim()) {
      fail('Konfirmasi dan alasan koreksi wajib', 'CORRECTION_CONFIRMATION_REQUIRED');
    }
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const grade = await client.query(`SELECT n.id,n.nilai,n.academic_semester_id,s.status
        FROM nilai_mingguan n JOIN academic_semesters s ON s.id=n.academic_semester_id AND s.tenant_id=n.tenant_id
        WHERE n.id=$1 AND n.tenant_id=$2 AND n.unit_id=$3 FOR UPDATE OF n`, [nilaiId,ctx.tenantId,ctx.unitId]);
      if (!grade.rows[0]) fail('Nilai terpetakan tidak ditemukan pada unit aktif','NOT_FOUND',404);
      if (grade.rows[0].status !== 'CLOSED') fail('Endpoint koreksi hanya untuk semester CLOSED','SEMESTER_NOT_CLOSED',409);
      await client.query(`INSERT INTO academic_grade_corrections(tenant_id,unit_id,nilai_id,academic_semester_id,old_value,new_value,reason,actor_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[ctx.tenantId,ctx.unitId,nilaiId,grade.rows[0].academic_semester_id,grade.rows[0].nilai,input.nilai,String(input.reason).trim(),ctx.userId]);
      const updated=await client.query(`UPDATE nilai_mingguan SET nilai=$1,actor_user_id=$2 WHERE id=$3 RETURNING *`,[input.nilai,ctx.userId,nilaiId]);
      await client.query('COMMIT'); return updated.rows[0];
    } catch(e){await client.query('ROLLBACK');throw e;} finally {client.release();}
  }
  return { list,createYear,createSemester,createLevel,mapClass,transitionSemester,transitionYear,preview,execute,correctClosedGrade };
}
module.exports={createAcademicPeriodService,stableHash};
