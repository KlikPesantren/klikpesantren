const { getEffectiveUnitFeatures } = require("./unitFeatureService");
const { isFeatureEnabled } = require("./tenantFeatureService");
const { getUnitCashRunningBalance } = require("./financeCashService");
const { sahriyahLedgerJoin, sahriyahCanonicalExpressions } = require("./sahriyahCanonicalSql");

function normalizeYear(value, currentYear = new Date().getFullYear()) {
  if (value == null || value === "") return currentYear;
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw Object.assign(new Error("Tahun dashboard tidak valid"), { status: 400, code: "INVALID_YEAR" });
  }
  return year;
}

function buildEligibility({ permissions = [], effectiveFeatures = [], cashEnabled = false }) {
  const perms = new Set(permissions);
  const features = new Map(effectiveFeatures.map((item) => [item.key, item.effective_enabled === true]));
  const allowed = (feature, keys) => features.get(feature) === true && keys.some((key) => perms.has(key));
  return {
    students: allowed("santri", ["santri.view"]), classes: allowed("kelas", ["kelas.view"]),
    teachers: allowed("guru", ["guru.view"]), health: allowed("kesehatan", ["kesehatan.view"]),
    permits: allowed("perizinan", ["perizinan.view"]), cash: cashEnabled === true && perms.has("bukukas.view"),
    wallet: allowed("wallet", ["wallet.view", "rfid.view"]), sahriyah: allowed("sahriyah", ["sahriyah.view"]),
    violations: allowed("pelanggaran", ["pelanggaran.view"]), grades: allowed("nilai", ["nilai.view"]),
    attendance: allowed("absensi", ["absensi.view"]),
  };
}

const num = (value) => Number(value || 0);

async function getDashboardSpecificUnit(client, { tenantId, unitId, kelasId, year, permissions = [] }) {
  const canonicalSahriyah = sahriyahCanonicalExpressions("t");
  const selectedYear = normalizeYear(year);
  const selectedMonth = new Date().getMonth() + 1;
  const params = [Number(tenantId), Number(unitId)];
  const [effectiveFeatures, cashEnabled, classResult] = await Promise.all([
    getEffectiveUnitFeatures(tenantId, unitId, client),
    isFeatureEnabled(tenantId, "buku_kas", client),
    client.query(`SELECT k.id,k.nama_kelas FROM kelas k JOIN unit_pendidikan u
      ON u.id=k.unit_id AND u.tenant_id=k.tenant_id AND u.is_active=true
      WHERE k.tenant_id=$1 AND k.unit_id=$2 ORDER BY k.nama_kelas,k.id`, params),
  ]);
  const eligibility = buildEligibility({ permissions, effectiveFeatures, cashEnabled });
  const classes = classResult.rows.map((row) => ({ id: Number(row.id), name: row.nama_kelas }));
  const selectedClassId = kelasId == null || kelasId === "" ? classes[0]?.id || null : Number(kelasId);
  if (selectedClassId != null && (!Number.isInteger(selectedClassId) || !classes.some((item) => item.id === selectedClassId))) {
    throw Object.assign(new Error("Kelas tidak tersedia pada unit aktif"), { status: 403, code: "CLASS_ACCESS_DENIED" });
  }

  const [counts, health, permits, cash, chart, wallet, sahriyah, violations] = await Promise.all([
    client.query(`/* dashboard_specific_unit:counts */ SELECT
      (SELECT COUNT(DISTINCT su.santri_id)::int FROM santri_units su JOIN santri s ON s.id=su.santri_id AND s.tenant_id=su.tenant_id
       WHERE su.tenant_id=$1 AND su.unit_id=$2 AND su.status='active' AND su.left_at IS NULL
       AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN ('aktif','active','')) AS students,
      (SELECT COUNT(DISTINCT id)::int FROM kelas WHERE tenant_id=$1 AND unit_id=$2) AS classes,
      (SELECT COUNT(DISTINCT gu.guru_id)::int FROM guru_units gu JOIN guru g ON g.id=gu.guru_id AND g.tenant_id=gu.tenant_id
       WHERE gu.tenant_id=$1 AND gu.unit_id=$2 AND gu.status='active' AND gu.left_at IS NULL
       AND LOWER(TRIM(COALESCE(g.status,'aktif'))) IN ('aktif','active','')) AS teachers`, params),
    client.query(`/* dashboard_specific_unit:health */ WITH memberships AS (
      SELECT su.id FROM santri_units su JOIN santri s ON s.id=su.santri_id AND s.tenant_id=su.tenant_id
      WHERE su.tenant_id=$1 AND su.unit_id=$2 AND su.status='active' AND su.left_at IS NULL
      AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN ('aktif','active','')), latest AS (
      SELECT DISTINCT ON (ks.santri_unit_id) ks.santri_unit_id,ks.status_kesehatan FROM kesehatan_santri ks
      JOIN memberships m ON m.id=ks.santri_unit_id WHERE ks.tenant_id=$1 AND ks.unit_id=$2
      ORDER BY ks.santri_unit_id,ks.created_at DESC,ks.id DESC)
      SELECT COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(status_kesehatan,'')))='sakit')::int AS sick FROM latest`, params),
    client.query(`SELECT COUNT(DISTINCT santri_id)::int AS permitted FROM perizinan
      WHERE tenant_id=$1 AND unit_id=$2 AND LOWER(TRIM(COALESCE(status,'')))='keluar'`, params),
    getUnitCashRunningBalance(client, { tenantId, unitId }),
    client.query(`/* dashboard_specific_unit:monthly_cash */ WITH months AS (SELECT generate_series(1,12)::int AS month), ledger AS (
      SELECT tanggal,CASE WHEN jenis='Masuk' THEN nominal ELSE -nominal END AS delta FROM buku_kas WHERE tenant_id=$1 AND unit_id=$2)
      SELECT m.month,CASE WHEN make_date($3::int,m.month,1)>date_trunc('month',CURRENT_DATE)::date THEN NULL
      ELSE COALESCE(SUM(l.delta),0)::bigint END AS closing_balance FROM months m
      LEFT JOIN ledger l ON l.tanggal<(make_date($3::int,m.month,1)+INTERVAL '1 month') GROUP BY m.month ORDER BY m.month`, [...params, selectedYear]),
    client.query(`SELECT COALESCE(SUM(current_balance),0)::bigint AS balance FROM wallet_accounts WHERE tenant_id=$1 AND unit_id=$2`, params),
    client.query(`/* dashboard_specific_unit:sahriyah */ WITH memberships AS (
      SELECT su.id AS santri_unit_id FROM santri_units su JOIN santri s ON s.id=su.santri_id AND s.tenant_id=su.tenant_id
      WHERE su.tenant_id=$1 AND su.unit_id=$2 AND su.status='active' AND su.left_at IS NULL
      AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN ('aktif','active','')), bills AS (
      SELECT DISTINCT ON (t.santri_unit_id) t.santri_unit_id,${canonicalSahriyah.status} AS status FROM tagihan_sahriyah t
      JOIN memberships m ON m.santri_unit_id=t.santri_unit_id
      ${sahriyahLedgerJoin("t")}
      WHERE t.tenant_id=$1 AND t.unit_id=$2
      AND t.bulan=$3 AND t.tahun=$4 ORDER BY t.santri_unit_id,t.id DESC)
      SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(b.status,'')))='lunas')::int AS paid,
      COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(b.status,''))) LIKE '%cicil%')::int AS partial,
      COUNT(*) FILTER (WHERE b.santri_unit_id IS NULL OR (LOWER(TRIM(COALESCE(b.status,'')))<>'lunas'
      AND LOWER(TRIM(COALESCE(b.status,''))) NOT LIKE '%cicil%'))::int AS unpaid
      FROM memberships m LEFT JOIN bills b ON b.santri_unit_id=m.santri_unit_id`, [...params, selectedMonth, selectedYear]),
    client.query(`SELECT s.id,s.nama,COUNT(p.id)::int AS count,COALESCE(SUM(p.poin),0)::int AS points
      FROM pelanggaran p JOIN santri s ON s.id=p.santri_id AND s.tenant_id=p.tenant_id
      WHERE p.tenant_id=$1 AND p.unit_id=$2 AND EXTRACT(MONTH FROM p.tanggal)=$3 AND EXTRACT(YEAR FROM p.tanggal)=$4
      GROUP BY s.id,s.nama ORDER BY count DESC,points DESC,s.nama LIMIT 5`, [...params, selectedMonth, selectedYear]),
  ]);

  let grades = [];
  let alpha = [];
  if (selectedClassId != null) {
    const classParams = [...params, selectedClassId, selectedMonth, selectedYear];
    [grades, alpha] = await Promise.all([
      client.query(`SELECT s.id,s.nama,ROUND(AVG(n.nilai::numeric),1) AS score,COUNT(n.id)::int AS entries
        FROM nilai_mingguan n JOIN santri s ON s.id=n.santri_id AND s.tenant_id=n.tenant_id
        WHERE n.tenant_id=$1 AND n.unit_id=$2 AND n.kelas_id=$3 AND n.bulan=$4 AND n.tahun=$5
        GROUP BY s.id,s.nama ORDER BY score DESC,s.nama LIMIT 3`, classParams),
      client.query(`SELECT s.id,s.nama,COUNT(a.id)::int AS alpha_count FROM absensi a
        JOIN santri_kelas_enrollments e ON e.tenant_id=a.tenant_id AND e.id=a.enrollment_id AND e.kelas_id=$3
        JOIN santri_units su ON su.tenant_id=e.tenant_id AND su.id=e.santri_unit_id AND su.unit_id=$2
        JOIN santri s ON s.tenant_id=su.tenant_id AND s.id=su.santri_id
        WHERE a.tenant_id=$1 AND a.unit_id=$2 AND EXTRACT(MONTH FROM a.tanggal)=$4 AND EXTRACT(YEAR FROM a.tanggal)=$5
        AND LOWER(TRIM(COALESCE(a.status,''))) IN ('a','alfa','alpha','alpa')
        GROUP BY s.id,s.nama ORDER BY alpha_count DESC,s.nama LIMIT 3`, classParams),
    ]).then(([gradeResult, alphaResult]) => [gradeResult.rows, alphaResult.rows]);
  }

  const countRow = counts.rows[0] || {};
  const cashBalance = num(cash.saldo);
  const walletBalance = eligibility.wallet ? num(wallet.rows[0]?.balance) : null;
  const visibleCashBalance = eligibility.cash ? cashBalance : null;
  const sahriyahRow = sahriyah.rows[0] || {};
  return {
    year: selectedYear, month: selectedMonth, eligibility,
    counts: {
      students: eligibility.students ? num(countRow.students) : null,
      classes: eligibility.classes ? num(countRow.classes) : null,
      teachers: eligibility.teachers ? num(countRow.teachers) : null,
      sick: eligibility.health ? num(health.rows[0]?.sick) : null,
      permits: eligibility.permits ? num(permits.rows[0]?.permitted) : null,
    },
    finance: { cash_balance: visibleCashBalance, wallet_enabled: eligibility.wallet, wallet_balance: walletBalance,
      total: (visibleCashBalance || 0) + (walletBalance || 0),
      monthly_closing: eligibility.cash ? chart.rows.map((row) => ({ month: Number(row.month), closing_balance: row.closing_balance == null ? null : num(row.closing_balance) })) : [] },
    sahriyah: eligibility.sahriyah
      ? { total: num(sahriyahRow.total), paid: num(sahriyahRow.paid), partial: num(sahriyahRow.partial), unpaid: num(sahriyahRow.unpaid) }
      : null,
    violations: eligibility.violations
      ? violations.rows.map((row) => ({ id: Number(row.id), name: row.nama, count: num(row.count), points: num(row.points) }))
      : [],
    classes, selected_class_id: selectedClassId,
    grades: eligibility.grades ? grades.map((row) => ({ id: Number(row.id), name: row.nama, score: Number(row.score || 0), entries: num(row.entries) })) : [],
    alpha: eligibility.attendance ? alpha.map((row) => ({ id: Number(row.id), name: row.nama, count: num(row.alpha_count) })) : [],
  };
}

module.exports = { buildEligibility, getDashboardSpecificUnit, normalizeYear };
