const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const waliRoute = read("routes/waliRoutes.js");
const waliPage = read("frontend/src/pages/WaliPage.jsx");
const absensiGuruRoute = read("routes/absensiGuruRoutes.js");
const absensiGuruPage = read("frontend/src/pages/AbsensiGuruPage.jsx");
const alumniPage = read("frontend/src/pages/AlumniPage.jsx");
const nilaiPage = read("frontend/src/pages/NilaiPage.jsx");
const hafalanPage = read("frontend/src/pages/HafalanPage.jsx");

assert.match(waliRoute, /getRequiredScopedUnitIds/);
assert.match(waliRoute, /UNIT_REQUIRED/);
assert.match(waliRoute, /su\.unit_id = ANY\(\$2::int\[\]\)/);
assert.match(waliRoute, /su\.status = 'active' AND su\.left_at IS NULL/);
assert.match(waliRoute, /sendWaliError\(res, err\)/);
assert.match(waliPage, /api\.get\("\/wali", \{ params \}\)/);
assert.match(waliPage, /api\.get\("\/santri", \{ params \}\)/);
assert.match(waliPage, /requestIdRef\.current !== requestId/);
assert.doesNotMatch(waliPage, /api\.get\("\/wali"\)/);

const aggregateSource = waliPage.slice(
  waliPage.indexOf("function aggregateWaliAccounts"),
  waliPage.indexOf("function WaliPage"),
);
const aggregateContext = {
  rows: [
    { id: 1, nomor_hp: "081", nama: "Wali", santri_id: 10, nama_santri: "Anak A" },
    { id: 2, nomor_hp: "081", nama: "Wali", santri_id: 10, nama_santri: "Anak A" },
    { id: 3, nomor_hp: "081", nama: "Wali", santri_id: 11, nama_santri: "Anak B" },
  ],
};
vm.runInNewContext(`${aggregateSource}; result = aggregateWaliAccounts(rows);`, aggregateContext);
assert.equal(aggregateContext.result.length, 1);
assert.equal(aggregateContext.result[0].jumlah_anak, 2);
assert.deepEqual(Array.from(aggregateContext.result[0].anak, (child) => child.santri_id), [10, 11]);

assert.match(absensiGuruRoute, /unitAccess\.mode !== "UNIT"/);
assert.match(absensiGuruRoute, /AND ag\.unit_id = \$2/);
assert.match(absensiGuruRoute, /getGuruInUnit/);
assert.match(absensiGuruRoute, /requirePermission\("absensi_guru\.manage"\)/);
assert.match(absensiGuruRoute, /ON CONFLICT \(tenant_id, unit_id, guru_id, bulan, tahun\) WHERE unit_id IS NOT NULL/);
assert.doesNotMatch(absensiGuruPage, /scope:\s*"all"/);
assert.match(absensiGuruPage, /api\.get\("\/absensi-guru", \{ params \}\)/);
assert.match(absensiGuruPage, /requestIdRef\.current !== requestId/);

assert.doesNotMatch(alumniPage, /<TableScroll stickyScrollbar>/);
for (const source of [nilaiPage, hafalanPage]) {
  assert.match(source, /const scopeParams = activeUnitId \? \{ unit_id: activeUnitId \} : null/);
  assert.doesNotMatch(source, /buildUnitScopeParams/);
  assert.match(source, /dirtyKeys/);
  assert.match(source, /Promise\.all/);
  assert.match(source, /savingRef\.current/);
  assert.match(source, /alert\(`.*berhasil disimpan/);
  assert.match(source, /err\.response\?\.data\?\.error/);
}

console.log("PASS Admin tenant five-fix regression");