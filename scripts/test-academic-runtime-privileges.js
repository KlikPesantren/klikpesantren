const assert=require('assert');
const manifest=require('../config/academicRuntimePrivileges');
const fs=require('fs');
const service=fs.readFileSync('services/academicPeriodService.js','utf8');
const routes=fs.readFileSync('routes/academicPeriodRoutes.js','utf8');
const manager=fs.readFileSync('scripts/manage-academic-runtime-privileges.js','utf8');
assert.equal(manifest.schema,'public');
assert.deepStrictEqual(Object.entries(manifest.tables).filter(([,r])=>r.delete).map(([t])=>t),[]);
for(const [table,rule] of Object.entries(manifest.tables)){
 assert(rule.select,`${table} must remain readable`);
 assert(!rule.delete,`${table} must not be deletable`);
}
assert.deepStrictEqual(manifest.tables.academic_promotion_batches.update,['summary']);
assert.deepStrictEqual(manifest.externalTables.kelas.update,['academic_grade_level_id']);
assert(!manifest.externalTables.santri.update&&!manifest.externalTables.santri_units.update);
assert(service.includes('FOR UPDATE OF ske'));
assert(routes.includes("requirePermission('kelas.manage')"));
assert(routes.includes("requirePermission('nilai.manage')"));
assert(!/GRANT\s+ALL|TO\s+PUBLIC/i.test(manager));
assert(manager.includes('BEGIN READ ONLY'));
assert(manager.includes('CONFIRM_ACADEMIC_GRANT_TARGET'));
assert(manager.includes('rolbypassrls'));
console.log(`PASS academic runtime least-privilege manifest: ${Object.keys(manifest.tables).length} owned tables, no DELETE/TRUNCATE/owner grant`);
