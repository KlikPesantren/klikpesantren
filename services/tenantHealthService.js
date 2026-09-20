const pool = require("../db");
const { detectPackageFromFeatures } = require("../config/tenantPackageConfig");

const FEATURE_STATUS_KEYS = ["rfid", "wali_app", "sahriyah", "kas_instansi"];

const CLEANUP_COUNT_TABLES = [
  ["users", "users"],
  ["santri", "santri"],
  ["guru", "guru"],
  ["wali_santri", "wali"],
  ["kelas", "kelas"],
  ["pembayaran", "pembayaran"],
  ["tagihan_sahriyah", "sahriyah"],
  ["transaksi_rfid", "rfid_transactions"],
];

const TENANT_ACTIVITY_TABLES = [
  "audit_logs",
  "users",
  "santri",
  "guru",
  "wali_santri",
  "kelas",
  "pembayaran",
  "tagihan_sahriyah",
  "pembayaran_sahriyah",
  "transaksi_rfid",
  "buku_kas",
  "kas_instansi_transaksi",
  "pengumuman",
  "perizinan",
  "pelanggaran",
  "wali_akun",
];

const DELETE_TABLE_ORDER = [
  "absensi",
  "absensi_guru",
  "absensi_santri",
  "alumni_units",
  "app_brand_profiles",
  "audit_logs",
  "devices",
  "guru",
  "hafalan",
  "jenis_tagihan",
  "kas_instansi_transaksi",
  "kelas_mata_pelajaran",
  "kesehatan_santri",
  "mata_pelajaran",
  "merchant_rfid",
  "nilai_mingguan",
  "pelanggaran",
  "pembayaran",
  "pembayaran_detail",
  "pembayaran_sahriyah",
  "pengumuman",
  "perizinan",
  "profil_pesantren",
  "program_unit",
  "program_unit_evaluasi",
  "rfid_limit_override",
  "rfid_limit_settings",
  "rfid_override_logs",
  "rfid_sync_queue",
  "sahriyah_setting",
  "santri_kelas_enrollments",
  "tagihan_sahriyah",
  "tamu",
  "tenant_role_permissions",
  "transaksi",
  "transaksi_rfid",
  "user_unit_scope",
  "wali_akun",
  "wallet_transaction_correction_audits",
  "wallet_transactions",
  "attendance_sessions",
  "buku_kas",
  "cash_account_transactions",
  "guru_units",
  "kelas",
  "santri_units",
  "users",
  "wallet_accounts",
  "cash_transfers",
  "santri",
  "unit_pendidikan",
  "wali_santri",
];

// These tenant-owned tables have a verified direct ON DELETE CASCADE FK to
// tenants. They do not require an extra runtime DELETE grant.
const CASCADE_TABLES = [
  "alumni",
  "cash_accounts",
  "multi_unit_backfill_review",
  "notification_logs",
  "tenant_domains",
  "tenant_features",
  "tenant_role_overrides",
  "unit_features",
  "user_kelas_scope",
  "wali_device_tokens",
  "wali_home_links",
  "wali_in_app_notifications",
  "wali_push_tokens",
];

let tableColumnsCache = null;

async function getTableColumns(client = pool) {
  if (tableColumnsCache) return tableColumnsCache;

  const { rows } = await client.query(
    `SELECT c.relname AS table_name, a.attname AS column_name
     FROM pg_catalog.pg_class c
     JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
     JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND a.attnum > 0 AND NOT a.attisdropped`
  );

  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.table_name)) map.set(row.table_name, new Set());
    map.get(row.table_name).add(row.column_name);
  }

  tableColumnsCache = map;
  return map;
}

function hasTenantColumn(columns, tableName) {
  return columns.has(tableName) && columns.get(tableName).has("tenant_id");
}

async function assertNoCrossTenantReferences(client, columns, tenantId) {
  const { rows } = await client.query(
    `SELECT child.relname AS child_table, parent.relname AS parent_table,
       array_agg(child_column.attname::text ORDER BY keys.position) AS child_columns,
       array_agg(parent_column.attname::text ORDER BY keys.position) AS parent_columns
     FROM pg_catalog.pg_constraint fk
     JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid
     JOIN pg_catalog.pg_class parent ON parent.oid = fk.confrelid
     JOIN pg_catalog.pg_namespace child_schema ON child_schema.oid = child.relnamespace
     JOIN pg_catalog.pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
     JOIN LATERAL unnest(fk.conkey, fk.confkey) WITH ORDINALITY
       AS keys(child_attnum, parent_attnum, position) ON true
     JOIN pg_catalog.pg_attribute child_column
       ON child_column.attrelid = child.oid AND child_column.attnum = keys.child_attnum
     JOIN pg_catalog.pg_attribute parent_column
       ON parent_column.attrelid = parent.oid AND parent_column.attnum = keys.parent_attnum
     WHERE fk.contype = 'f' AND child_schema.nspname = 'public'
       AND parent_schema.nspname = 'public'
     GROUP BY fk.oid, child.relname, parent.relname`
  );
  const identifier = (value) => {
    if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error("Identifier FK tidak aman");
    return value;
  };
  for (const fk of rows) {
    if (!hasTenantColumn(columns, fk.parent_table)) continue;
    const child = identifier(fk.child_table);
    const parent = identifier(fk.parent_table);
    const join = fk.child_columns.map((column, index) =>
      `child.${identifier(column)} = parent.${identifier(fk.parent_columns[index])}`
    ).join(" AND ");
    const foreignScope = hasTenantColumn(columns, child)
      ? "AND child.tenant_id IS DISTINCT FROM parent.tenant_id"
      : "";
    const conflict = await client.query(
      `SELECT 1 FROM ${child} child JOIN ${parent} parent ON ${join}
       WHERE parent.tenant_id = $1 ${foreignScope} LIMIT 1`,
      [tenantId]
    );
    if (conflict.rowCount) {
      const err = new Error("Relasi lintas tenant perlu peninjauan sebelum hard delete");
      err.status = 409;
      err.code = "TENANT_CROSS_REFERENCE";
      throw err;
    }
  }
}

async function countTenantRows(client, columns, tableName, tenantId) {
  if (!hasTenantColumn(columns, tableName)) return 0;
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM ${tableName} WHERE tenant_id = $1`,
    [tenantId]
  );
  return rows[0].n;
}

async function getTenantFeatureSummary(tenantIds, client = pool) {
  const ids = tenantIds.map(Number).filter(Boolean);
  if (ids.length === 0) return new Map();

  const { rows } = await client.query(
    `SELECT
       fc.key,
       fc.label,
       fc.is_core,
       tenant_ids.tenant_id,
       COALESCE(tf.enabled, true) AS enabled
     FROM feature_catalog fc
     CROSS JOIN unnest($1::int[]) tenant_ids(tenant_id)
     LEFT JOIN tenant_features tf
       ON tf.feature_key = fc.key AND tf.tenant_id = tenant_ids.tenant_id
     ORDER BY fc.sort_order ASC, fc.key ASC`,
    [ids]
  );

  const byTenant = new Map();
  for (const row of rows) {
    if (!byTenant.has(row.tenant_id)) byTenant.set(row.tenant_id, []);
    byTenant.get(row.tenant_id).push({
      key: row.key,
      label: row.label,
      is_core: row.is_core === true,
      enabled: row.is_core === true ? true : row.enabled === true,
    });
  }

  const summary = new Map();
  for (const tenantId of ids) {
    const features = byTenant.get(tenantId) || [];
    const enabled = features.filter((feature) => feature.enabled);
    const disabled = features.filter(
      (feature) => !feature.enabled && !feature.is_core
    );
    const enabledSet = new Set(enabled.map((feature) => feature.key));

    summary.set(tenantId, {
      current_package: detectPackageFromFeatures(features),
      feature_enabled_count: enabled.length,
      feature_disabled_count: disabled.length,
      feature_status: Object.fromEntries(
        FEATURE_STATUS_KEYS.map((key) => [key, enabledSet.has(key)])
      ),
    });
  }

  return summary;
}

async function getLastActivity(tenantId, client = pool) {
  const columns = await getTableColumns(client);
  const candidates = TENANT_ACTIVITY_TABLES.filter(
    (table) =>
      hasTenantColumn(columns, table) && columns.get(table).has("created_at")
  );

  const values = await Promise.all(
    candidates.map(async (table) => {
      const { rows } = await client.query(
        `SELECT MAX(created_at) AS last_at FROM ${table} WHERE tenant_id = $1`,
        [tenantId]
      );
      return rows[0].last_at;
    })
  );

  return values
    .filter(Boolean)
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

async function getTenantHealth(tenantId, client = pool) {
  const tid = Number(tenantId);
  const featureSummary = await getTenantFeatureSummary([tid], client);
  const { rows } = await client.query(
    `SELECT
       t.id,
       t.slug,
       t.nama,
       t.status,
       (SELECT COUNT(*)::int FROM users u WHERE u.tenant_id = t.id) AS total_user,
       (SELECT COUNT(*)::int FROM santri s WHERE s.tenant_id = t.id AND LOWER(s.status) = 'aktif') AS total_santri,
       (SELECT COUNT(*)::int FROM guru g WHERE g.tenant_id = t.id AND LOWER(g.status) = 'aktif') AS total_guru,
       (SELECT COUNT(*)::int FROM wali_santri w WHERE w.tenant_id = t.id) AS total_wali,
       (SELECT COUNT(*)::int FROM kelas k WHERE k.tenant_id = t.id) AS total_kelas
     FROM tenants t
     WHERE t.id = $1`,
    [tid]
  );

  if (rows.length === 0) return null;

  const feature = featureSummary.get(tid) || {
    current_package: { id: "custom", label: "Custom" },
    feature_enabled_count: 0,
    feature_disabled_count: 0,
    feature_status: {},
  };

  return {
    tenant_id: tid,
    total_santri: rows[0].total_santri,
    total_guru: rows[0].total_guru,
    total_wali: rows[0].total_wali,
    total_user: rows[0].total_user,
    total_kelas: rows[0].total_kelas,
    status: rows[0].status,
    feature_enabled_count: feature.feature_enabled_count,
    feature_disabled_count: feature.feature_disabled_count,
    current_package: feature.current_package,
    last_activity_at: await getLastActivity(tid, client),
    feature_status: feature.feature_status,
  };
}

async function attachTenantListHealth(rows, client = pool) {
  const ids = rows.map((row) => Number(row.id)).filter(Boolean);
  const featureSummary = await getTenantFeatureSummary(ids, client);

  return rows.map((row) => {
    const feature = featureSummary.get(Number(row.id)) || {
      current_package: { id: "custom", label: "Custom" },
      feature_enabled_count: 0,
      feature_disabled_count: 0,
    };

    return {
      ...row,
      current_package: feature.current_package,
      feature_enabled_count: feature.feature_enabled_count,
      feature_disabled_count: feature.feature_disabled_count,
    };
  });
}

async function getTenantCleanupSummary(tenantId, client = pool) {
  const columns = await getTableColumns(client);
  const counts = {};

  for (const [tableName, key] of CLEANUP_COUNT_TABLES) {
    counts[key] = await countTenantRows(client, columns, tableName, tenantId);
  }

  return counts;
}

async function deleteTenantSafely(tenant, platformUser, client) {
  const columns = await getTableColumns(client);
  const explicit = new Set(DELETE_TABLE_ORDER);
  const cascaded = new Set(CASCADE_TABLES);
  const tenantTables = [...columns].filter(([, fields]) => fields.has("tenant_id"))
    .map(([table]) => table);
  const uncovered = tenantTables.filter((table) => !explicit.has(table) && !cascaded.has(table));
  const missingExplicit = DELETE_TABLE_ORDER.filter((table) => !hasTenantColumn(columns, table));
  const missingCascade = CASCADE_TABLES.filter((table) => !hasTenantColumn(columns, table));
  const cascadeResult = await client.query(
    `SELECT child.relname AS table_name
     FROM pg_catalog.pg_constraint fk
     JOIN pg_catalog.pg_class child ON child.oid = fk.conrelid
     WHERE fk.contype = 'f' AND fk.confrelid = 'public.tenants'::regclass
       AND fk.confdeltype = 'c'`
  );
  const verifiedCascade = new Set(cascadeResult.rows.map((row) => row.table_name));
  const invalidCascade = CASCADE_TABLES.filter((table) => !verifiedCascade.has(table));
  if (uncovered.length || missingExplicit.length || missingCascade.length || invalidCascade.length) {
    const err = new Error("Skema tenant belum aman untuk hard delete");
    err.status = 409;
    err.code = "TENANT_DELETE_SCHEMA_UNSUPPORTED";
    throw err;
  }
  await assertNoCrossTenantReferences(client, columns, tenant.id);
  const deleted = {};

  for (const tableName of DELETE_TABLE_ORDER) {
    const { rowCount } = await client.query(
      `DELETE FROM ${tableName} WHERE tenant_id = $1`,
      [tenant.id]
    );
    deleted[tableName] = rowCount;
  }

  const tenantDelete = await client.query(
    `DELETE FROM tenants WHERE id = $1 RETURNING id, slug, nama, status`,
    [tenant.id]
  );

  if (tenantDelete.rows.length === 0) {
    const err = new Error("Tenant tidak ditemukan saat delete");
    err.status = 404;
    throw err;
  }

  await client.query(
    `INSERT INTO audit_logs (device_id, event_type, detail, tenant_id)
     VALUES ($1, $2, $3, NULL)`,
    [
      `platform:${platformUser?.id ?? "system"}`,
      "platform.tenant.deleted",
      JSON.stringify({
        deleted_tenant_id: tenant.id,
        slug: tenant.slug,
        nama: tenant.nama,
        status: tenant.status,
        deleted_by: platformUser?.id ?? null,
        deleted_by_username: platformUser?.username ?? null,
        deleted_counts: deleted,
      }),
    ]
  );

  return deleted;
}

module.exports = {
  attachTenantListHealth,
  getTenantHealth,
  getTenantCleanupSummary,
  deleteTenantSafely,
};
