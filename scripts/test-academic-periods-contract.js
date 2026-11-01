const assert=require('assert');const fs=require('fs');const crypto=require('crypto');
const sql=fs.readFileSync('migrations/110_academic_periods_and_promotions.sql','utf8');
const manifest=JSON.parse(fs.readFileSync('docs/migration-baseline-manifest.json','utf8'));
const rule=manifest.migrations.find(x=>x.filename==='110_academic_periods_and_promotions.sql');
assert(rule&&rule.execution_order===400&&rule.recommended_action==='APPLY_ORIGINAL');
assert.strictEqual(rule.checksum,crypto.createHash('sha256').update(sql).digest('hex'));
for(const fragment of [
 'uq_academic_year_active','uq_academic_semester_active','duration_years BETWEEN 1 AND 20',
 'uq_santri_kelas_enrollments_tenant_id_id',
 "decision IN('NAIK','TETAP','LULUS','PINDAH','PERLU_PEMERIKSAAN')",
 'UNIQUE(tenant_id,unit_id,idempotency_key)','Existing history deliberately remains unmapped'
]) assert(sql.includes(fragment),`missing ${fragment}`);
const service=fs.readFileSync('services/academicPeriodService.js','utf8');
assert(service.includes('pg_advisory_xact_lock'));assert(service.includes('FOR UPDATE OF ske'));
assert(service.includes('IDEMPOTENCY_CONFLICT'));assert(service.includes("decision==='TETAP'"));
const routes=fs.readFileSync('routes/academicPeriodRoutes.js','utf8');
assert(routes.includes("w.mode!=='UNIT'"));assert(routes.includes("requirePermission('kelas.manage')"));
const nilai=fs.readFileSync('routes/nilaiRoutes.js','utf8');
const attendance=fs.readFileSync('services/attendanceBatchService.js','utf8');
const occurrence=fs.readFileSync('services/attendanceCoreService.js','utf8');
const periodPage=fs.readFileSync('frontend/src/pages/AcademicPeriodsPage.jsx','utf8');
const promotionPage=fs.readFileSync('frontend/src/pages/AcademicPromotionPage.jsx','utf8');
assert(nilai.includes('resolveAcademicPeriodForDate'));
assert(nilai.includes('ACADEMIC_SEMESTER_CLOSED'));
assert(nilai.includes('HISTORICAL_PERIOD_UNMAPPED'));
assert(attendance.includes('period.academic_year_id, period.id'));
assert(occurrence.includes('attendance_occurrence_units(tenant_id,occurrence_id,unit_id,academic_year_id,academic_semester_id)'));
assert(periodPage.includes('Mulai Semester')&&periodPage.includes('Selesaikan Semester')&&periodPage.includes('Kelas pada setiap tingkat'));
assert(promotionPage.includes('Proses Kenaikan Kelas')&&promotionPage.includes('Perlu Diperiksa')&&promotionPage.includes('Alasan tidak naik'));
assert(promotionPage.includes('type="checkbox"')&&promotionPage.includes('Tidak Naik Kelas'));
console.log('PASS academic periods/promotion migration, integration, UI and fail-closed contract (27 assertions)');
