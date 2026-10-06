// Read-only cashier projections. Financial mutations remain exclusively Phase 1.
const pool = require("../db");
const permissions = require("../middleware/requirePermission");
const {
  loadVerifiedUser,
  getAllowedUnitIds,
  assertUnitAccess,
} = require("./unitAccessService");
const { isUnitFeatureEnabled } = require("./unitFeatureService");
const { integer, credential } = require("./posService");
const fail = (code, status = 400) => {
  throw Object.assign(new Error(code), { code, status });
};
const positive = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647)
    fail("INVALID_CONTEXT");
  return n;
};
const uuid = (v) => {
  if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(v)))
    fail("INVALID_ID");
  return v;
};
function createPosMobileService({
  db = pool,
  permissionList = permissions.getPermissionList,
  featureEnabled = isUnitFeatureEnabled,
} = {}) {
  async function read(work) {
    const c = await db.connect();
    try {
      await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await work(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async function actor(req, c) {
    if (!req.user?.id) fail("UNAUTHENTICATED", 401);
    if (req.user.platform || req.user.role === "platform_superadmin")
      fail("TENANT_AUTH_REQUIRED", 403);
    const tenantId = positive(req.user.tenant_id);
    if (req.tenantId != null && Number(req.tenantId) !== tenantId)
      fail("TENANT_ACCESS_DENIED", 403);
    const user = await loadVerifiedUser(req.user, tenantId, c);
    const tenant = (
      await c.query(
        "SELECT status,attendance_timezone FROM tenants WHERE id=$1",
        [tenantId],
      )
    ).rows[0];
    if (tenant?.status !== "active") fail("TENANT_INACTIVE", 403);
    const allowed = await permissionList(user.role, {
      tenantScoped: true,
      tenantId,
    });
    if (!allowed.includes("pos.view") || !allowed.includes("pos.sell"))
      fail("PERMISSION_DENIED", 403);
    return { user, tenantId, allowed, timezone: tenant.attendance_timezone };
  }
  async function context(req, c) {
    const a = await actor(req, c),
      b = req.method === "POST" ? req.body : req.query;
    if (
      String(
        req.query?.scope || req.headers?.["x-unit-scope"] || "",
      ).toLowerCase() === "all" ||
      !b?.unit_id
    )
      fail("UNIT_REQUIRED");
    a.unitId = positive(b.unit_id);
    await assertUnitAccess(a.user, a.unitId, a.tenantId, c);
    const m = (
      await c.query(
        `SELECT m.id,m.nama_merchant FROM merchant_rfid m JOIN pos_cashier_assignments a
      ON a.tenant_id=m.tenant_id AND a.unit_id=m.unit_id AND a.merchant_id=m.id AND a.active
      WHERE m.tenant_id=$1 AND m.unit_id=$2 AND m.id=$3 AND a.user_id=$4 AND m.status AND m.pos_enabled AND m.location_resolution_status='resolved'`,
        [a.tenantId, a.unitId, positive(b.merchant_id), a.user.id],
      )
    ).rows[0];
    if (!m) fail("CASHIER_NOT_ASSIGNED", 403);
    const t = (
      await c.query(
        `SELECT id,nama_device,enabled,pos_enabled FROM devices WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 AND id=$4
      AND enabled AND pos_enabled AND attendance_mode IS NULL AND location_resolution_status='resolved'`,
        [a.tenantId, a.unitId, m.id, positive(b.terminal_id)],
      )
    ).rows[0];
    if (!t) fail("TERMINAL_DENIED", 403);
    const active = (
      await c.query(
        `SELECT id,unit_id,merchant_id,terminal_id FROM pos_shifts WHERE tenant_id=$1 AND cashier_id=$2 AND status='OPEN'`,
        [a.tenantId, a.user.id],
      )
    ).rows[0];
    if (
      active &&
      (Number(active.unit_id) !== a.unitId ||
        Number(active.merchant_id) !== m.id ||
        Number(active.terminal_id) !== t.id)
    )
      fail("ACTIVE_SHIFT_CONTEXT_LOCKED", 409);
    return { ...a, m, t, active };
  }
  async function bootstrap(req) {
    return read(async (c) => {
      const a = await actor(req, c),
        units = await getAllowedUnitIds(a.user, a.tenantId, c);
      const profile = (
        await c.query(
          "SELECT id,nama,username FROM users WHERE id=$1 AND tenant_id=$2",
          [a.user.id, a.tenantId],
        )
      ).rows[0];
      const choices = (
        await c.query(
          `SELECT m.id AS merchant_id,m.nama_merchant,m.unit_id,u.nama AS unit_name FROM pos_cashier_assignments a
      JOIN merchant_rfid m ON m.id=a.merchant_id AND m.tenant_id=a.tenant_id AND m.unit_id=a.unit_id
      JOIN unit_pendidikan u ON u.id=m.unit_id AND u.tenant_id=m.tenant_id AND u.is_active
      WHERE a.tenant_id=$1 AND a.user_id=$2 AND a.active AND m.status AND m.pos_enabled AND m.location_resolution_status='resolved'
      AND ($3::integer[] IS NULL OR m.unit_id=ANY($3)) ORDER BY u.sort_order,m.id`,
          [a.tenantId, a.user.id, units],
        )
      ).rows;
      const terminals = (
        await c.query(
          `SELECT d.id,d.nama_device,d.unit_id,d.merchant_id,d.enabled,d.pos_enabled FROM devices d
      JOIN pos_cashier_assignments a ON a.tenant_id=d.tenant_id AND a.unit_id=d.unit_id AND a.merchant_id=d.merchant_id AND a.active
      WHERE d.tenant_id=$1 AND a.user_id=$2 AND d.enabled AND d.pos_enabled AND d.attendance_mode IS NULL AND d.location_resolution_status='resolved'
      ORDER BY d.id`,
          [a.tenantId, a.user.id],
        )
      ).rows.filter((t) =>
        choices.some(
          (m) => m.merchant_id === t.merchant_id && m.unit_id === t.unit_id,
        ),
      );
      const shift =
        (
          await c.query(
            `SELECT id,unit_id,merchant_id,terminal_id,status,opening_cash,opened_at FROM pos_shifts WHERE tenant_id=$1 AND cashier_id=$2 AND status='OPEN'`,
            [a.tenantId, a.user.id],
          )
        ).rows[0] || null;
      return {
        user: profile,
        tenant_id: a.tenantId,
        permissions: a.allowed,
        merchants: choices,
        terminals,
        shift,
      };
    });
  }
  async function summary(req) {
    return read(async (c) => {
      const a = await context(req, c),
        shift = a.active
          ? (
              await c.query("SELECT * FROM pos_shifts WHERE id=$1", [
                a.active.id,
              ])
            ).rows[0]
          : null;
      if (!shift)
        return {
          shift: null,
          count: 0,
          sales: "0",
          payments: [],
          refunds: "0",
          cash_sales: "0",
          cash_refunds: "0",
          expected_cash: "0",
        };
      const p = (
        await c.query(
          `SELECT p.method,count(*)::integer AS count,sum(p.amount)::text AS amount FROM pos_payments p
      JOIN pos_sales s ON s.id=p.sale_id WHERE s.shift_id=$1 AND s.status='PAID' AND p.status='CONFIRMED' GROUP BY p.method`,
          [shift.id],
        )
      ).rows;
      const r = (
        await c.query(
          `SELECT coalesce(sum(r.amount),0)::text AS total,coalesce(sum(r.amount) FILTER(WHERE p.method='CASH' AND r.shift_id=$1),0)::text AS cash
      FROM pos_refunds r JOIN pos_payments p ON p.id=r.payment_id JOIN pos_sales s ON s.id=p.sale_id
      WHERE r.status='CONFIRMED' AND (s.shift_id=$1 OR r.shift_id=$1)`,
          [shift.id],
        )
      ).rows[0];
      const cash = p.find((p) => p.method === "CASH")?.amount || "0";
      return {
        shift,
        payments: p,
        count: p.reduce((n, p) => n + p.count, 0),
        sales: p.reduce((n, p) => n + BigInt(p.amount), 0n).toString(),
        refunds: r.total,
        cash_sales: cash,
        cash_refunds: r.cash,
        expected_cash: (
          BigInt(shift.opening_cash) +
          BigInt(cash) -
          BigInt(r.cash)
        ).toString(),
      };
    });
  }
  async function catalog(req) {
    return read(async (c) => {
      const a = await context(req, c),
        page = positive(req.query.page || 1),
        limit = Math.min(50, positive(req.query.limit || 30)),
        q = String(req.query.search || "").slice(0, 120);
      const category = req.query.category_id
        ? uuid(req.query.category_id)
        : null;
      const values = [a.tenantId, a.unitId, a.m.id, q, category];
      const where = `tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 AND active AND ($4='' OR name ILIKE '%'||$4||'%' OR sku ILIKE '%'||$4||'%') AND ($5::uuid IS NULL OR category_id=$5)`;
      const products = (
        await c.query(
          `SELECT id,category_id,sku,name,price,available FROM pos_products WHERE ${where} ORDER BY name,id LIMIT $6 OFFSET $7`,
          [...values, limit, (page - 1) * limit],
        )
      ).rows;
      const total = Number(
        (
          await c.query(
            `SELECT count(*) AS n FROM pos_products WHERE ${where}`,
            values,
          )
        ).rows[0].n,
      );
      const categories = (
        await c.query(
          "SELECT id,name FROM pos_categories WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 AND active ORDER BY name,id",
          [a.tenantId, a.unitId, a.m.id],
        )
      ).rows;
      return { products, categories, page, total, limit };
    });
  }
  async function preview(req) {
    return read(async (c) => {
      const a = await context(req, c);
      if (
        !(await featureEnabled(a.tenantId, a.unitId, "wallet", c)) ||
        !(await featureEnabled(a.tenantId, a.unitId, "rfid", c))
      )
        fail("FEATURE_DISABLED", 403);
      const uid = credential(req.body.credential),
        amount = integer(req.body.amount, "AMOUNT", true);
      const people = (
        await c.query(
          `SELECT id,nama,status FROM santri WHERE tenant_id=$1 AND CASE WHEN btrim(uid_rfid) ~ '^[0-9a-fA-F]+$'
      THEN lower(btrim(uid_rfid)) ELSE btrim(uid_rfid) END=$2 LIMIT 2`,
          [a.tenantId, uid],
        )
      ).rows;
      if (!people.length) fail("UNKNOWN_CREDENTIAL", 404);
      if (people.length !== 1) fail("AMBIGUOUS_CREDENTIAL", 409);
      const s = people[0];
      if (!["active", "aktif"].includes(String(s.status).toLowerCase().trim()))
        fail("MEMBERSHIP_INACTIVE", 403);
      if (
        !(
          await c.query(
            `SELECT id FROM santri_units WHERE tenant_id=$1 AND unit_id=$2 AND santri_id=$3 AND status='active' AND left_at IS NULL`,
            [a.tenantId, a.unitId, s.id],
          )
        ).rowCount
      )
        fail("MEMBERSHIP_INACTIVE", 403);
      const w = (
        await c.query(
          "SELECT status,current_balance FROM wallet_accounts WHERE tenant_id=$1 AND unit_id=$2 AND santri_id=$3",
          [a.tenantId, a.unitId, s.id],
        )
      ).rows[0];
      if (!w) fail("WALLET_ACCOUNT_REQUIRED", 409);
      if (w.status !== "active")
        fail(w.status === "frozen" ? "WALLET_FROZEN" : "WALLET_CLOSED", 403);
      if (BigInt(w.current_balance) < amount) fail("INSUFFICIENT_BALANCE", 409);
      return {
        santri_name: s.nama,
        unit_id: a.unitId,
        current_balance: w.current_balance,
        projected_balance: (BigInt(w.current_balance) - amount).toString(),
        preview_only: true,
      };
    });
  }
  async function detail(c, a, saleId) {
    const sale = (
      await c.query(
        `SELECT id,receipt,created_at,merchant_name,cashier_name,terminal_name,shift_id,status,subtotal,discount,discount_reason,grand_total,void_reason
      FROM pos_sales WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4 AND cashier_id=$5`,
        [saleId, a.tenantId, a.unitId, a.m.id, a.user.id],
      )
    ).rows[0];
    if (!sale) fail("SALE_NOT_FOUND", 404);
    const payment = (
      await c.query(
        `SELECT p.id,p.method,p.status,p.amount,p.tendered,p.change,p.provider,p.external_reference,
      w.balance_after AS wallet_balance_after,s.nama AS santri_name FROM pos_payments p LEFT JOIN wallet_transactions w ON w.id=p.wallet_transaction_id
      LEFT JOIN wallet_accounts a ON a.id=p.wallet_account_id LEFT JOIN santri s ON s.id=a.santri_id AND s.tenant_id=a.tenant_id WHERE p.sale_id=$1`,
        [saleId],
      )
    ).rows[0];
    const items = (
      await c.query(
        "SELECT id,name,quantity,unit_price,gross,discount,total FROM pos_sale_items WHERE sale_id=$1 ORDER BY product_id",
        [saleId],
      )
    ).rows;
    const refunds = (
      await c.query(
        "SELECT id,amount,status,reason,created_at,external_reference FROM pos_refunds WHERE payment_id=$1 ORDER BY created_at,id",
        [payment.id],
      )
    ).rows;
    return { sale, payment, items, refunds };
  }
  async function sale(req) {
    return read(async (c) =>
      detail(c, await context(req, c), uuid(req.params.id)),
    );
  }
  async function lookup(req) {
    return read(async (c) => {
      const a = await context(req, c),
        key = String(req.query.request_id || "");
      if (key.length < 8 || key.length > 160) fail("INVALID_REQUEST");
      const s = (
        await c.query(
          `SELECT id FROM pos_sales WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 AND terminal_id=$4 AND cashier_id=$5 AND request_id=$6`,
          [a.tenantId, a.unitId, a.m.id, a.t.id, a.user.id, key],
        )
      ).rows[0];
      // NOT_FOUND is not permission to generate another key: original request may still be in-flight.
      return s
        ? { found: true, ...(await detail(c, a, s.id)) }
        : { found: false };
    });
  }
  async function history(req) {
    return read(async (c) => {
      const a = await context(req, c),
        page = positive(req.query.page || 1),
        limit = Math.min(50, positive(req.query.limit || 30));
      const method = req.query.method || null,
        status = req.query.status || null;
      if (method && !["RFID", "CASH", "TRANSFER_QRIS"].includes(method))
        fail("INVALID_FILTER");
      if (status && !["DRAFT", "PAID", "VOID"].includes(status))
        fail("INVALID_FILTER");
      const shift = req.query.shift_id
        ? uuid(req.query.shift_id)
        : a.active?.id || null;
      const values = [
        a.tenantId,
        a.unitId,
        a.m.id,
        a.user.id,
        shift,
        String(req.query.search || "").slice(0, 120),
        method,
        status,
        a.timezone,
      ];
      const where = `s.tenant_id=$1 AND s.unit_id=$2 AND s.merchant_id=$3 AND s.cashier_id=$4 AND
      (($5::uuid IS NOT NULL AND s.shift_id=$5) OR ($5::uuid IS NULL AND s.business_date=(now() AT TIME ZONE $9)::date))
      AND ($6='' OR s.receipt ILIKE '%'||$6||'%') AND ($7::text IS NULL OR p.method=$7) AND ($8::text IS NULL OR s.status=$8)`;
      const rows = (
        await c.query(
          `SELECT s.id,s.receipt,s.created_at,s.grand_total,s.status,p.method,p.status AS payment_status FROM pos_sales s
      JOIN pos_payments p ON p.sale_id=s.id WHERE ${where} ORDER BY s.created_at DESC,s.id LIMIT $10 OFFSET $11`,
          [...values, limit, (page - 1) * limit],
        )
      ).rows;
      const total = Number(
        (
          await c.query(
            `SELECT count(*) AS n FROM pos_sales s JOIN pos_payments p ON p.sale_id=s.id WHERE ${where}`,
            values,
          )
        ).rows[0].n,
      );
      return { rows, total, page, limit };
    });
  }
  return { bootstrap, summary, catalog, preview, sale, lookup, history };
}
module.exports = { createPosMobileService, ...createPosMobileService() };
