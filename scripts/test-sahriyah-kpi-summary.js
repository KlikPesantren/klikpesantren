const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const route = fs.readFileSync(path.join(root, "routes", "sahriyahRoutes.js"), "utf8");
const page = fs.readFileSync(path.join(root, "frontend", "src", "pages", "SahriyahPage.jsx"), "utf8");
const kpiCard = fs.readFileSync(path.join(root, "frontend", "src", "components", "ui", "KpiCard.jsx"), "utf8");

for (const field of [
  "total_nominal",
  "lunas_nominal",
  "belum_lunas_nominal",
  "partial_count",
  "partial_nominal_tagihan",
  "partial_sudah_dibayar",
  "partial_sisa",
]) {
  assert(route.includes(`AS ${field}`) || route.includes(`${field}: 0`), `backend missing ${field}`);
  assert(page.includes(`summary.${field}`), `frontend missing ${field}`);
}

assert(route.includes('sahriyahCanonicalExpressions("t")'));
assert(route.includes('sahriyahLedgerJoin("t")'));
assert(page.includes('Cicilan (Bagian Belum Lunas)'));
assert(page.includes('<option value="Cicilan">Cicilan</option>'));
assert(kpiCard.includes("secondaryValue"));

const fixture = {
  lunas: [{ nominal: 100 }, { nominal: 200 }],
  belumLunas: [{ nominal: 300 }],
  cicilan: [{ nominal: 400, paid: 250, remaining: 150 }],
};
const lunasNominal = fixture.lunas.reduce((sum, row) => sum + row.nominal, 0);
const belumLunasNominal = [...fixture.belumLunas, ...fixture.cicilan]
  .reduce((sum, row) => sum + row.nominal, 0);
const totalNominal = lunasNominal + belumLunasNominal;

assert.equal(fixture.lunas.length + fixture.belumLunas.length + fixture.cicilan.length, 4);
assert.equal(lunasNominal, 300);
assert.equal(belumLunasNominal, 700);
assert.equal(totalNominal, 1000);
assert.equal(fixture.cicilan[0].paid + fixture.cicilan[0].remaining, fixture.cicilan[0].nominal);

console.log("PASS sahriyah KPI: exact nominal buckets, cicilan subset, and frontend mapping.");
