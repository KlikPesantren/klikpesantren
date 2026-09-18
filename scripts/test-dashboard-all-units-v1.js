const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getDashboardAllUnitsV1,
  normalizeDashboardYear,
} = require("../services/dashboardAllUnitsV1Service");

const rowsByTag = {
  units: [
    { unit_id: 10, unit_name: "Unit A", sort_order: 1, wallet_enabled: true },
    { unit_id: 20, unit_name: "Unit B", sort_order: 2, wallet_enabled: false },
    { unit_id: 30, unit_name: "Unit C", sort_order: 3, wallet_enabled: true },
  ],
  students: [
    { unit_id: null, unit_name: null, count: 3 },
    { unit_id: 10, unit_name: "Unit A", count: 2 },
    { unit_id: 20, unit_name: "Unit B", count: 2 },
  ],
  classes: [
    { unit_id: 10, unit_name: "Unit A", count: 2 },
    { unit_id: 20, unit_name: "Unit B", count: 1 },
    { unit_id: 30, unit_name: "Unit C", count: 0 },
  ],
  teachers: [
    { unit_id: null, unit_name: null, count: 2 },
    { unit_id: 10, unit_name: "Unit A", count: 2 },
    { unit_id: 20, unit_name: "Unit B", count: 1 },
  ],
  cash: [
    { unit_id: 10, unit_name: "Unit A", balance: 1000 },
    { unit_id: 20, unit_name: "Unit B", balance: -200 },
    { unit_id: 30, unit_name: "Unit C", balance: 0 },
  ],
  monthly_cash: Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    closing_balance: index < 8 ? (index + 1) * 100 : null,
  })),
  wallet: [
    { unit_id: 10, unit_name: "Unit A", enabled: true, balance: 500 },
    { unit_id: 20, unit_name: "Unit B", enabled: false, balance: null },
    { unit_id: 30, unit_name: "Unit C", enabled: true, balance: 0 },
  ],
};

const fakeClient = {
  async query(sql) {
    const match = sql.match(/dashboard_all_units_v1:([a-z_]+)/);
    if (!match || !rowsByTag[match[1]]) throw new Error(`Unexpected SQL: ${sql}`);
    return { rows: rowsByTag[match[1]] };
  },
};

async function run() {
  assert.equal(normalizeDashboardYear(undefined, 2026), 2026);
  assert.equal(normalizeDashboardYear("2025", 2026), 2025);
  assert.throws(() => normalizeDashboardYear("1999"), (error) => error.status === 400 && error.code === "INVALID_YEAR");

  const result = await getDashboardAllUnitsV1(fakeClient, { tenantId: 1, year: 2026 });

  assert.equal(result.database.students.unique_total, 3, "Student KPI must use unique identity total");
  assert.equal(result.database.students.breakdown_sum, 4, "Student breakdown may exceed identity total");
  assert.equal(result.database.students.overlap_count_audit, 1, "Student overlap audit must be breakdown minus unique");
  assert.deepEqual(result.database.students.by_unit.map((row) => row.count), [2, 2, 0], "Zero-count active unit must remain visible");

  assert.equal(result.database.classes.total, 3, "Class total must sum unit-owned breakdown");
  assert.equal(result.database.classes.by_unit.reduce((sum, row) => sum + row.count, 0), 3);

  assert.equal(result.database.teachers.canonical_identity, "guru.id");
  assert.equal(result.database.teachers.unique_total, 2, "Teacher KPI must use unique guru identity");
  assert.equal(result.database.teachers.breakdown_sum, 3);
  assert.equal(result.database.teachers.overlap_count_audit, 1);

  assert.equal(result.finance.cash.total_balance, 800, "Cash total must exactly sum unit balances");
  assert.equal(result.finance.cash.by_unit.reduce((sum, row) => sum + row.balance, 0), 800);
  assert.equal(result.finance.cash.monthly_closing.length, 12);
  assert.equal(result.finance.cash.monthly_closing[8].closing_balance, null, "Future months must remain null");

  assert.equal(result.finance.wallet.total_balance, 500, "Wallet total must sum enabled unit-owned accounts");
  assert.equal(result.finance.wallet.by_unit[1].balance, null, "Disabled Wallet must not render as zero");
  assert.equal(result.finance.wallet.by_unit[2].balance, 0, "Enabled zero Wallet is a real zero");

  assert.equal(result.finance.managed.cash_total, 800);
  assert.equal(result.finance.managed.wallet_total, 500);
  assert.equal(result.finance.managed.total, 1300, "Managed total must equal cash plus Wallet");
  assert.equal(result.finance.managed.by_unit[1].total, -200, "Wallet-off unit total must equal cash only");
  assert.equal(result.finance.managed.by_unit[1].wallet_balance, null);

  const service = fs.readFileSync(path.join(__dirname, "..", "services", "dashboardAllUnitsV1Service.js"), "utf8");
  const route = fs.readFileSync(path.join(__dirname, "..", "routes", "dashboardRoutes.js"), "utf8");
  assert.match(service, /COUNT\(DISTINCT su\.santri_id\)/, "Student identity must be DISTINCT");
  assert.match(service, /COUNT\(DISTINCT gu\.guru_id\)/, "Teacher identity must be DISTINCT");
  assert.match(service, /SUM\(wa\.current_balance\)/, "Wallet must use canonical wallet_accounts current_balance");
  assert.doesNotMatch(service, /SUM\(s\.saldo\)|FROM santri[^]*saldo/, "Wallet aggregate must not use legacy santri.saldo");
  assert.match(
    service,
    /dashboard_all_units_v1:cash[\s\S]*?bk\.tanggal < \(CURRENT_DATE \+ INTERVAL '1 day'\)/,
    "All-unit cash total must exclude future-dated rows like canonical unit balances",
  );
  assert.match(
    service,
    /eligible_ledger[\s\S]*?bk\.tanggal < \(CURRENT_DATE \+ INTERVAL '1 day'\)/,
    "Monthly cash closing must exclude future-dated rows from the current balance",
  );
  assert.match(service, /l\.tanggal < \(make_date/, "Monthly chart must be cumulative closing balance");
  assert.match(route, /router\.get\("\/all-units-v1"/, "V1 must expose only a dedicated GET route");
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\("\/all-units-v1"/, "V1 must not add a write route");
  assert.match(route, /unitAccess\.mode !== "ALL"[\s\S]*UNIT_ACCESS_DENIED/, "Unit/operator scope must not elevate to all units");

  console.log("PASS Dashboard Semua Unit V1: 30 identity, reconciliation, Wallet eligibility, chart, and security assertions");
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
