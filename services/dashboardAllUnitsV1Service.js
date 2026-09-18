function normalizeDashboardYear(value, currentYear = new Date().getFullYear()) {
  if (value == null || value === "") return currentYear;
  const year = Number.parseInt(value, 10);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    const error = new Error("Tahun dashboard tidak valid");
    error.status = 400;
    error.code = "INVALID_YEAR";
    throw error;
  }
  return year;
}

function asNumber(value) {
  return Number(value || 0);
}

function normalizeCountAggregate(rows = []) {
  const totalRow = rows.find((row) => row.unit_id == null);
  const byUnit = rows
    .filter((row) => row.unit_id != null)
    .map((row) => ({
      unit_id: Number(row.unit_id),
      unit_name: row.unit_name,
      count: asNumber(row.count),
    }));
  const uniqueTotal = asNumber(totalRow?.count);
  const breakdownSum = byUnit.reduce((sum, row) => sum + row.count, 0);
  return {
    unique_total: uniqueTotal,
    by_unit: byUnit,
    breakdown_sum: breakdownSum,
    overlap_count_audit: Math.max(0, breakdownSum - uniqueTotal),
  };
}

async function getDashboardAllUnitsV1(client, { tenantId, year }) {
  const selectedYear = normalizeDashboardYear(year);
  const params = [Number(tenantId)];

  const [
    unitsResult,
    studentsResult,
    classesResult,
    teachersResult,
    cashResult,
    monthlyResult,
    walletResult,
  ] = await Promise.all([
    client.query(
      `/* dashboard_all_units_v1:units */
       SELECT u.id AS unit_id, u.nama AS unit_name, u.sort_order,
              COALESCE(wallet.enabled, false) AS wallet_enabled
       FROM unit_pendidikan u
       LEFT JOIN unit_features wallet
         ON wallet.tenant_id = u.tenant_id
        AND wallet.unit_id = u.id
        AND wallet.feature_key = 'wallet'
       WHERE u.tenant_id = $1
         AND u.is_active = true
       ORDER BY u.sort_order, u.id`,
      params,
    ),
    client.query(
      `/* dashboard_all_units_v1:students */
       SELECT su.unit_id,
              CASE WHEN GROUPING(su.unit_id) = 1 THEN NULL ELSE MAX(u.nama) END AS unit_name,
              COUNT(DISTINCT su.santri_id)::int AS count
       FROM santri_units su
       JOIN santri s
         ON s.id = su.santri_id
        AND s.tenant_id = su.tenant_id
       JOIN unit_pendidikan u
         ON u.id = su.unit_id
        AND u.tenant_id = su.tenant_id
        AND u.is_active = true
       WHERE su.tenant_id = $1
         AND su.status = 'active'
         AND su.left_at IS NULL
         AND LOWER(TRIM(COALESCE(s.status, 'Aktif'))) IN ('aktif', 'active', '')
       GROUP BY GROUPING SETS ((su.unit_id), ())
       ORDER BY su.unit_id NULLS FIRST`,
      params,
    ),
    client.query(
      `/* dashboard_all_units_v1:classes */
       SELECT u.id AS unit_id, u.nama AS unit_name,
              COUNT(DISTINCT k.id)::int AS count
       FROM unit_pendidikan u
       LEFT JOIN kelas k
         ON k.tenant_id = u.tenant_id
        AND k.unit_id = u.id
       WHERE u.tenant_id = $1
         AND u.is_active = true
       GROUP BY u.id, u.nama, u.sort_order
       ORDER BY u.sort_order, u.id`,
      params,
    ),
    client.query(
      `/* dashboard_all_units_v1:teachers */
       SELECT gu.unit_id,
              CASE WHEN GROUPING(gu.unit_id) = 1 THEN NULL ELSE MAX(u.nama) END AS unit_name,
              COUNT(DISTINCT gu.guru_id)::int AS count
       FROM guru_units gu
       JOIN guru g
         ON g.id = gu.guru_id
        AND g.tenant_id = gu.tenant_id
       JOIN unit_pendidikan u
         ON u.id = gu.unit_id
        AND u.tenant_id = gu.tenant_id
        AND u.is_active = true
       WHERE gu.tenant_id = $1
         AND gu.status = 'active'
         AND gu.left_at IS NULL
         AND LOWER(TRIM(COALESCE(g.status, 'Aktif'))) IN ('aktif', 'active', '')
       GROUP BY GROUPING SETS ((gu.unit_id), ())
       ORDER BY gu.unit_id NULLS FIRST`,
      params,
    ),
    client.query(
      `/* dashboard_all_units_v1:cash */
       SELECT u.id AS unit_id, u.nama AS unit_name,
              COALESCE(SUM(
                CASE WHEN bk.jenis = 'Masuk' THEN bk.nominal ELSE -bk.nominal END
              ), 0)::bigint AS balance
       FROM unit_pendidikan u
       LEFT JOIN buku_kas bk
         ON bk.tenant_id = u.tenant_id
        AND bk.unit_id = u.id
        AND bk.tanggal < (CURRENT_DATE + INTERVAL '1 day')
       WHERE u.tenant_id = $1
         AND u.is_active = true
       GROUP BY u.id, u.nama, u.sort_order
       ORDER BY u.sort_order, u.id`,
      params,
    ),
    client.query(
      `/* dashboard_all_units_v1:monthly_cash */
       WITH months AS (
         SELECT generate_series(1, 12)::int AS month
       ),
       eligible_ledger AS (
         SELECT bk.tanggal,
                CASE WHEN bk.jenis = 'Masuk' THEN bk.nominal ELSE -bk.nominal END AS delta
         FROM buku_kas bk
         JOIN unit_pendidikan u
           ON u.id = bk.unit_id
          AND u.tenant_id = bk.tenant_id
          AND u.is_active = true
         WHERE bk.tenant_id = $1
           AND bk.tanggal < (CURRENT_DATE + INTERVAL '1 day')
       )
       SELECT m.month,
              CASE
                WHEN make_date($2::int, m.month, 1) > date_trunc('month', CURRENT_DATE)::date
                  THEN NULL
                ELSE COALESCE(SUM(l.delta), 0)::bigint
              END AS closing_balance
       FROM months m
       LEFT JOIN eligible_ledger l
         ON l.tanggal < (make_date($2::int, m.month, 1) + INTERVAL '1 month')
       GROUP BY m.month
       ORDER BY m.month`,
      [Number(tenantId), selectedYear],
    ),
    client.query(
      `/* dashboard_all_units_v1:wallet */
       SELECT u.id AS unit_id, u.nama AS unit_name,
              COALESCE(wallet.enabled, false) AS enabled,
              CASE
                WHEN COALESCE(wallet.enabled, false)
                  THEN COALESCE(SUM(wa.current_balance), 0)::bigint
                ELSE NULL
              END AS balance
       FROM unit_pendidikan u
       LEFT JOIN unit_features wallet
         ON wallet.tenant_id = u.tenant_id
        AND wallet.unit_id = u.id
        AND wallet.feature_key = 'wallet'
       LEFT JOIN wallet_accounts wa
         ON wa.tenant_id = u.tenant_id
        AND wa.unit_id = u.id
        AND COALESCE(wallet.enabled, false) = true
       WHERE u.tenant_id = $1
         AND u.is_active = true
       GROUP BY u.id, u.nama, u.sort_order, wallet.enabled
       ORDER BY u.sort_order, u.id`,
      params,
    ),
  ]);

  const units = unitsResult.rows.map((row) => ({
    unit_id: Number(row.unit_id),
    unit_name: row.unit_name,
    wallet_enabled: row.wallet_enabled === true,
  }));

  const studentsRaw = normalizeCountAggregate(studentsResult.rows);
  const teachersRaw = normalizeCountAggregate(teachersResult.rows);
  const studentMap = new Map(studentsRaw.by_unit.map((row) => [row.unit_id, row.count]));
  const teacherMap = new Map(teachersRaw.by_unit.map((row) => [row.unit_id, row.count]));
  const classMap = new Map(classesResult.rows.map((row) => [Number(row.unit_id), asNumber(row.count)]));

  const studentsByUnit = units.map((unit) => ({
    unit_id: unit.unit_id,
    unit_name: unit.unit_name,
    count: studentMap.get(unit.unit_id) || 0,
  }));
  const teachersByUnit = units.map((unit) => ({
    unit_id: unit.unit_id,
    unit_name: unit.unit_name,
    count: teacherMap.get(unit.unit_id) || 0,
  }));
  const classesByUnit = units.map((unit) => ({
    unit_id: unit.unit_id,
    unit_name: unit.unit_name,
    count: classMap.get(unit.unit_id) || 0,
  }));

  const studentBreakdownSum = studentsByUnit.reduce((sum, row) => sum + row.count, 0);
  const teacherBreakdownSum = teachersByUnit.reduce((sum, row) => sum + row.count, 0);
  const classTotal = classesByUnit.reduce((sum, row) => sum + row.count, 0);

  const cashMap = new Map(cashResult.rows.map((row) => [Number(row.unit_id), asNumber(row.balance)]));
  const cashByUnit = units.map((unit) => ({
    unit_id: unit.unit_id,
    unit_name: unit.unit_name,
    balance: cashMap.get(unit.unit_id) || 0,
  }));
  const cashTotal = cashByUnit.reduce((sum, row) => sum + row.balance, 0);

  const walletMap = new Map(walletResult.rows.map((row) => [
    Number(row.unit_id),
    { enabled: row.enabled === true, balance: row.balance == null ? null : asNumber(row.balance) },
  ]));
  const walletByUnit = units.map((unit) => {
    const wallet = walletMap.get(unit.unit_id) || { enabled: false, balance: null };
    return {
      unit_id: unit.unit_id,
      unit_name: unit.unit_name,
      enabled: wallet.enabled,
      balance: wallet.enabled ? asNumber(wallet.balance) : null,
    };
  });
  const walletTotal = walletByUnit.reduce(
    (sum, row) => sum + (row.enabled ? asNumber(row.balance) : 0),
    0,
  );

  const managedByUnit = units.map((unit) => {
    const cashBalance = cashMap.get(unit.unit_id) || 0;
    const wallet = walletMap.get(unit.unit_id) || { enabled: false, balance: null };
    const walletBalance = wallet.enabled ? asNumber(wallet.balance) : null;
    return {
      unit_id: unit.unit_id,
      unit_name: unit.unit_name,
      cash_balance: cashBalance,
      wallet_enabled: wallet.enabled,
      wallet_balance: walletBalance,
      total: cashBalance + (wallet.enabled ? walletBalance : 0),
    };
  });

  return {
    year: selectedYear,
    database: {
      students: {
        unique_total: studentsRaw.unique_total,
        by_unit: studentsByUnit,
        breakdown_sum: studentBreakdownSum,
        overlap_count_audit: Math.max(0, studentBreakdownSum - studentsRaw.unique_total),
      },
      classes: {
        total: classTotal,
        by_unit: classesByUnit,
      },
      teachers: {
        unique_total: teachersRaw.unique_total,
        by_unit: teachersByUnit,
        breakdown_sum: teacherBreakdownSum,
        overlap_count_audit: Math.max(0, teacherBreakdownSum - teachersRaw.unique_total),
        canonical_identity: "guru.id",
      },
    },
    finance: {
      cash: {
        total_balance: cashTotal,
        by_unit: cashByUnit,
        monthly_closing: monthlyResult.rows.map((row) => ({
          month: Number(row.month),
          closing_balance: row.closing_balance == null ? null : asNumber(row.closing_balance),
        })),
      },
      wallet: {
        total_balance: walletTotal,
        by_unit: walletByUnit,
      },
      managed: {
        total: cashTotal + walletTotal,
        cash_total: cashTotal,
        wallet_total: walletTotal,
        by_unit: managedByUnit,
      },
    },
  };
}

module.exports = {
  getDashboardAllUnitsV1,
  normalizeCountAggregate,
  normalizeDashboardYear,
};
