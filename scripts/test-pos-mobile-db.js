// Only the isolated Phase 1 fixture database; never uses environment DB targets.
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { Pool } = require("pg");
const express = require("express");
const jwt = require("jsonwebtoken");
const { CheckoutCoordinator } = require("../pos-app/src/domain.cjs");
const { createVault } = require("../pos-app/src/vault.cjs");
process.env.JWT_SECRET = "pos-local-test-only-not-a-deployment-secret";
process.env.WALI_JWT_SECRET =
  "pos-local-wali-test-only-not-a-deployment-secret";
process.env.DOTENV_CONFIG_QUIET = "true";
const options = {
  host: "127.0.0.1",
  port: 55439,
  user: "pos_test_owner",
  database: "pos_phase1_test",
};
const seed = spawnSync(process.execPath, ["scripts/test-pos-v1-db.js"], {
  cwd: require("node:path").join(__dirname, ".."),
  stdio: "inherit",
});
if (seed.status !== 0) process.exit(seed.status || 1);
const db = new Pool(options);
let server,
  passed = 0;
const req = (query = {}, id = 3, method = "GET") => ({
  user: {
    id,
    tenant_id: id === 4 ? 2 : 1,
    role: id === 1 ? "superadmin" : id === 5 ? "denied" : "cashier",
  },
  tenantId: id === 4 ? 2 : 1,
  method,
  query,
  body: method === "POST" ? query : {},
  params: {},
  headers: {},
});
const scope = { unit_id: 2, merchant_id: 1, terminal_id: 2 };
const test = async (name, fn) => {
  await fn();
  console.log("PASS " + name);
  passed++;
};
const reject = (fn, code) => assert.rejects(fn, (e) => e.code === code);
(async () => {
  const identity = (
    await db.query(
      "SELECT current_user,current_database() AS db,host(inet_server_addr()) AS host,inet_server_port() AS port",
    )
  ).rows[0];
  assert.deepEqual(identity, {
    current_user: options.user,
    db: options.database,
    host: options.host,
    port: options.port,
  });
  require.cache[require.resolve("../db")] = {
    id: require.resolve("../db"),
    filename: require.resolve("../db"),
    loaded: true,
    exports: db,
  };
  const mobile = require("../services/posMobileService").createPosMobileService(
    { db, featureEnabled: async () => true },
  );
  const pos = require("../services/posService").createPosService({
    db,
    featureEnabled: async () => true,
  });
  await test("096 DOWN/UP/second UP preserves financial rows; Admin image reaches scoped mobile catalog", async () => {
    const fs = require("node:fs");
    const tables = [
      "pos_sales",
      "pos_sale_items",
      "pos_payments",
      "pos_refunds",
      "pos_shifts",
      "wallet_accounts",
      "wallet_transactions",
    ];
    const fingerprint = async () => {
      const result = {};
      for (const table of tables)
        result[table] = (
          await db.query(
            `SELECT md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id::text),'')) hash FROM ${table} t`,
          )
        ).rows[0].hash;
      return result;
    };
    const before = await fingerprint();
    const products = (
      await db.query("SELECT id,sku,price FROM pos_products ORDER BY id")
    ).rows;
    const down = fs.readFileSync(
        "migrations/096_pos_product_image_url_rollback.sql",
        "utf8",
      ),
      up = fs.readFileSync("migrations/096_pos_product_image_url.sql", "utf8");
    for (let round = 0; round < 2; round++) {
      await db.query("BEGIN");
      await db.query(down);
      await db.query("COMMIT");
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM information_schema.columns WHERE table_schema='public' AND table_name='pos_products' AND column_name='image_url'",
          )
        ).rows[0].n,
        0,
      );
      assert.deepEqual(
        (await db.query("SELECT id,sku,price FROM pos_products ORDER BY id"))
          .rows,
        products,
      );
      await db.query("BEGIN");
      await db.query(up);
      await db.query("COMMIT");
      assert.equal(
        (
          await db.query(
            "SELECT count(*)::int n FROM pos_products WHERE image_url IS NOT NULL",
          )
        ).rows[0].n,
        0,
      );
    }
    assert.deepEqual(await fingerprint(), before);
    await assert.rejects(
      () =>
        db.query(
          "UPDATE pos_products SET image_url='http://example.com/image.png'",
        ),
      (e) => e.code === "23514",
    );
    const body = {
      ...scope,
      sku: "SYNTHETIC-IMAGE",
      name: "Synthetic image product",
      price: "12345",
      image_url: "https://example.com/synthetic-pos-image.png",
    };
    const created = await pos.product(req(body, 1, "POST"));
    assert.equal(created.image_url, body.image_url);
    assert.equal(
      (await mobile.catalog(req({ ...scope, search: body.name }))).products[0]
        .image_url,
      body.image_url,
    );
    const admin = require("../services/posAdminService").createPosAdminService({
      db,
      featureEnabled: async () => true,
    });
    const adminReq = {
      ...req({ ...scope, search: body.name }, 1),
      params: { kind: "products" },
    };
    assert.equal(
      (await admin.management(adminReq)).rows[0].image_url,
      body.image_url,
    );
    const update = {
      ...req({ ...body, image_url: undefined }, 1, "POST"),
      params: { id: created.id },
    };
    delete update.body.image_url;
    assert.equal((await pos.product(update)).image_url, body.image_url);
    update.body.image_url = "";
    assert.equal((await pos.product(update)).image_url, null);
    update.body.image_url = "https://localhost/private";
    await reject(() => pos.product(update), "INVALID_PRODUCT_IMAGE");
    assert.deepEqual(await fingerprint(), before);
  });
  await test("bootstrap current user/assignment only, no secrets; denied actor", async () => {
    const c = await mobile.bootstrap(req());
    assert.equal(c.user.id, 3);
    assert.equal(c.merchants.length, 1);
    assert.equal(c.merchants[0].unit_id, 2);
    assert.equal(c.shift.terminal_id, 2);
    assert.ok(c.terminals.every((t) => t.unit_id === 2 && t.merchant_id === 1));
    assert.ok(!JSON.stringify(c).includes("device_secret"));
    await reject(() => mobile.bootstrap(req({}, 5)), "PERMISSION_DENIED");
    await reject(
      () => mobile.bootstrap({ ...req(), user: null }),
      "UNAUTHENTICATED",
    );
  });
  await test("unit/merchant/terminal/Attendance/disabled/all fail closed", async () => {
    await reject(
      () => mobile.summary(req({ ...scope, unit_id: 3 })),
      "UNIT_ACCESS_DENIED",
    );
    await reject(
      () => mobile.summary(req({ ...scope, merchant_id: 2 })),
      "CASHIER_NOT_ASSIGNED",
    );
    await reject(
      () => mobile.summary(req({ ...scope, terminal_id: 4 })),
      "TERMINAL_DENIED",
    );
    await reject(
      () => mobile.summary(req({ ...scope, terminal_id: 5 })),
      "TERMINAL_DENIED",
    );
    await reject(
      () => mobile.summary(req({ merchant_id: 1, terminal_id: 2 })),
      "UNIT_REQUIRED",
    );
    await reject(
      () => mobile.summary(req({ ...scope, scope: "all" })),
      "UNIT_REQUIRED",
    );
    await db.query("UPDATE devices SET enabled=false WHERE id=2");
    try {
      await reject(() => mobile.summary(req(scope)), "TERMINAL_DENIED");
    } finally {
      await db.query("UPDATE devices SET enabled=true WHERE id=2");
    }
    await reject(
      () => mobile.summary({ ...req(scope), tenantId: 2 }),
      "TENANT_ACCESS_DENIED",
    );
  });
  await test("multiple assignments directory, open shift pins exact context", async () => {
    await db.query(
      "INSERT INTO user_unit_scope VALUES(3,1,3,'active');INSERT INTO pos_cashier_assignments(tenant_id,unit_id,merchant_id,user_id,active) VALUES(1,3,2,3,true);UPDATE merchant_rfid SET pos_enabled=true WHERE id=2;UPDATE devices SET pos_enabled=true WHERE id=3",
    );
    try {
      const c = await mobile.bootstrap(req());
      assert.equal(c.merchants.length, 2);
      await reject(
        () =>
          mobile.summary(req({ unit_id: 3, merchant_id: 2, terminal_id: 3 })),
        "ACTIVE_SHIFT_CONTEXT_LOCKED",
      );
    } finally {
      await db.query(
        "DELETE FROM user_unit_scope WHERE user_id=3 AND unit_id=3;DELETE FROM pos_cashier_assignments WHERE user_id=3 AND merchant_id=2;UPDATE merchant_rfid SET pos_enabled=false WHERE id=2;UPDATE devices SET pos_enabled=false WHERE id=3",
      );
    }
  });
  await test("catalog bounded search/category, unavailable cannot sell, server price", async () => {
    const c = await mobile.catalog(req({ ...scope, limit: 1, search: "TEST" }));
    assert.ok(c.products.length <= 1);
    assert.ok(c.total > 0);
    const p = c.products[0];
    const b = {
      ...scope,
      shift_id: (await mobile.bootstrap(req())).shift.id,
      request_id: "mobile-price-authority",
      items: [{ product_id: p.id, quantity: 1, price: "1" }],
      payment: { method: "CASH", tendered: "999999" },
    };
    const r = await pos.checkout(req(b, 3, "POST"));
    assert.equal(r.items[0].unit_price, p.price);
    await db.query("UPDATE pos_products SET available=false WHERE id=$1", [
      p.id,
    ]);
    try {
      await reject(
        () =>
          pos.checkout(
            req({ ...b, request_id: "mobile-unavailable" }, 3, "POST"),
          ),
        "PRODUCT_UNAVAILABLE",
      );
    } finally {
      await db.query("UPDATE pos_products SET available=true WHERE id=$1", [
        p.id,
      ]);
    }
  });
  await test("RFID preview read-only canonical same-unit balance + negatives", async () => {
    const b = { ...scope, credential: "0AB102FF", amount: "1" };
    const p = await mobile.preview(req(b, 3, "POST"));
    assert.equal(p.santri_name, "Synthetic Child");
    assert.equal(p.unit_id, 2);
    assert.equal(
      p.projected_balance,
      (BigInt(p.current_balance) - 1n).toString(),
    );
    assert.ok(!JSON.stringify(p).includes(b.credential));
    await reject(
      () =>
        mobile.preview(req({ ...b, credential: "test-unknown" }, 3, "POST")),
      "UNKNOWN_CREDENTIAL",
    );
    await reject(
      () => mobile.preview(req({ ...b, amount: "999999999" }, 3, "POST")),
      "INSUFFICIENT_BALANCE",
    );
    await db.query(
      "UPDATE santri_units SET status='inactive' WHERE santri_id=1 AND unit_id=2",
    );
    try {
      await reject(
        () => mobile.preview(req(b, 3, "POST")),
        "MEMBERSHIP_INACTIVE",
      );
    } finally {
      await db.query(
        "UPDATE santri_units SET status='active' WHERE santri_id=1 AND unit_id=2",
      );
    }
    await db.query(
      "UPDATE wallet_accounts SET status='frozen' WHERE santri_id=1 AND unit_id=2",
    );
    try {
      await reject(() => mobile.preview(req(b, 3, "POST")), "WALLET_FROZEN");
    } finally {
      await db.query(
        "UPDATE wallet_accounts SET status='active' WHERE santri_id=1 AND unit_id=2",
      );
    }
    const disabled =
      require("../services/posMobileService").createPosMobileService({
        db,
        featureEnabled: async () => false,
      });
    await reject(() => disabled.preview(req(b, 3, "POST")), "FEATURE_DISABLED");
    // Missing-account projection adapter: assert same-unit SQL, never allow another-unit fallback.
    const missing =
      require("../services/posMobileService").createPosMobileService({
        featureEnabled: async () => true,
        db: {
          connect: async () => {
            const c = await db.connect();
            return {
              release: () => c.release(),
              query: async (sql, args) => {
                if (
                  sql.startsWith(
                    "SELECT status,current_balance FROM wallet_accounts",
                  )
                ) {
                  assert.equal(args[1], 2);
                  return { rows: [], rowCount: 0 };
                }
                return c.query(sql, args);
              },
            };
          },
        },
      });
    await reject(
      () => missing.preview(req(b, 3, "POST")),
      "WALLET_ACCOUNT_REQUIRED",
    );
  });
  // Billing/tenant branding not part of this fixture schema. Tenant lookup adapter only;
  // actual login, password verification, JWT and session middleware run unmodified.
  const getTenant = async (id) =>
    (await db.query("SELECT id,status FROM tenants WHERE id=$1", [id])).rows[0];
  require.cache[require.resolve("../services/tenantService")] = {
    loaded: true,
    exports: {
      getTenantById: getTenant,
      resolveTenantForLogin: async (slug) =>
        slug === "synthetic-pos"
          ? { tenant: { ...(await getTenant(1)), slug, nama: "Synthetic POS" } }
          : { error: "Not found", status: 404 },
      buildInactiveTenantPayload: () => ({ success: false }),
    },
  };
  require.cache[require.resolve("../services/tenantFeatureService")] = {
    loaded: true,
    exports: { getEnabledFeatureKeys: async () => [] },
  };
  await db.query("ALTER TABLE users ADD COLUMN password text");
  await db.query("UPDATE users SET password=$1 WHERE id=3", [
    await require("bcryptjs").hash("synthetic-login-only", 10),
  ]);
  const app = express();
  app.use(express.json());
  app.use("/auth", require("../routes/authRoutes"));
  app.use("/pos", require("../routes/posRoutes").createPosRouter({ pos }));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const token = jwt.sign(
      { id: 3, role: "cashier", tenant_id: 1, token_version: 0 },
      process.env.JWT_SECRET,
    ),
    base = `http://127.0.0.1:${server.address().port}`;
  const api = async (path, { method = "GET", body, query } = {}) => {
    const qs = query ? "?" + new URLSearchParams(query) : "";
    const r = await fetch(base + path + qs, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    if (!r.ok)
      throw Object.assign(Error(j.code), { code: j.code, status: r.status });
    return j.data;
  };
  await test("real JWT HTTP unauthenticated/invalid rejected; route uses same scope", async () => {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_slug: "synthetic-pos",
        username: "cashier-b",
        password: "synthetic-login-only",
      }),
    });
    assert.equal(login.status, 200);
    const logged = await login.json();
    assert.ok(logged.token);
    const invalid = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_slug: "synthetic-pos",
        username: "cashier-b",
        password: "wrong-test-only",
      }),
    });
    assert.equal(invalid.status, 401);
    assert.equal((await fetch(base + "/pos/mobile/context")).status, 401);
    assert.equal(
      (
        await fetch(base + "/pos/mobile/context", {
          headers: { Authorization: "Bearer invalid-test-only" },
        })
      ).status,
      401,
    );
    assert.equal((await api("/pos/mobile/context")).user.id, 3);
    assert.equal(
      (await api("/pos/mobile/summary", { query: scope })).shift.status,
      "OPEN",
    );
  });
  await test("real HTTP timeout/restart: exactly one sale/payment/Wallet debit; retry original", async () => {
    const p = (await mobile.catalog(req({ ...scope, search: "TEST-1" })))
        .products[0],
      shift = (await mobile.bootstrap(req())).shift;
    await db.query("UPDATE pos_products SET price=1000 WHERE id=$1", [p.id]);
    const data = new Map(),
      vault = createVault({
        getItemAsync: async (k) => data.get(k) || null,
        setItemAsync: async (k, v) => data.set(k, v),
        deleteItemAsync: async (k) => data.delete(k),
      });
    const counts = async () =>
      (
        await db.query(
          `SELECT (SELECT count(*) FROM pos_sales)::integer AS sales,(SELECT count(*) FROM pos_payments)::integer AS payments,(SELECT count(*) FROM wallet_transactions WHERE direction='debit')::integer AS debits`,
        )
      ).rows[0];
    const before = await counts(),
      f = new CheckoutCoordinator({
        owner: "1:3",
        vault,
        newId: () => "mobile-real-timeout-key",
        api: async (path, opts) => {
          await api(path, opts);
          throw Error("simulated-response-loss");
        },
      });
    await assert.rejects(
      f.pay({
        ...scope,
        shift_id: shift.id,
        items: [{ product_id: p.id, quantity: 1 }],
        payment: { method: "RFID", credential: "0ab102ff" },
      }),
    );
    assert.equal(f.state, "UNKNOWN");
    const g = new CheckoutCoordinator({
      owner: "1:3",
      vault,
      newId: () => {
        throw Error("unexpected new ID");
      },
      api,
    });
    await g.restore();
    await g.recover();
    assert.equal(g.state, "SUCCESS");
    const after = await counts();
    assert.deepEqual(after, {
      sales: before.sales + 1,
      payments: before.payments + 1,
      debits: before.debits + 1,
    });
    assert.equal(g.result.payment.santri_name, "Synthetic Child");
    assert.ok(!JSON.stringify(g.result).includes("uid_rfid"));
    assert.ok(!JSON.stringify(g.result).includes("request_hash"));
  });
  await test("history detail cashier isolation + summary cash math, readonly fingerprint", async () => {
    const before = (
      await db.query(
        "SELECT sum(current_balance)::text AS total FROM wallet_accounts",
      )
    ).rows[0];
    const h = await mobile.history(req({ ...scope, limit: 1 }));
    assert.equal(h.rows.length, 1);
    const d = await mobile.sale({
      ...req(scope),
      params: { id: h.rows[0].id },
    });
    assert.equal(d.sale.cashier_name, "Synthetic Cashier B");
    await reject(
      () =>
        mobile.sale({
          ...req({ ...scope, terminal_id: 1 }, 2),
          params: { id: d.sale.id },
        }),
      "SALE_NOT_FOUND",
    );
    const s = await mobile.summary(req(scope));
    assert.equal(
      s.expected_cash,
      (
        BigInt(s.shift.opening_cash) +
        BigInt(s.cash_sales) -
        BigInt(s.cash_refunds)
      ).toString(),
    );
    assert.deepEqual(
      (
        await db.query(
          "SELECT sum(current_balance)::text AS total FROM wallet_accounts",
        )
      ).rows[0],
      before,
    );
  });
  await test("read projections run under existing least-privilege fixture role; close stops sale", async () => {
    const runtime = new Pool({ ...options, user: "pos_fixture_runtime" });
    try {
      const limited =
        require("../services/posMobileService").createPosMobileService({
          db: runtime,
          featureEnabled: async () => true,
        });
      assert.equal((await limited.bootstrap(req())).user.id, 3);
      const s = await limited.summary(req(scope));
      assert.equal(s.shift.status, "OPEN");
      await limited.catalog(req(scope));
      await limited.history(req(scope));
    } finally {
      await runtime.end();
    }
    const s = await mobile.summary(req(scope));
    const p = (await mobile.catalog(req(scope))).products[0];
    await pos.closeShift({
      ...req({ ...scope, actual_cash: s.expected_cash }, 3, "POST"),
      params: { id: s.shift.id },
    });
    assert.equal((await mobile.bootstrap(req())).shift, null);
    await reject(
      () =>
        pos.checkout(
          req(
            {
              ...scope,
              shift_id: s.shift.id,
              request_id: "mobile-after-closed-shift",
              items: [{ product_id: p.id, quantity: 1 }],
              payment: { method: "CASH", tendered: "999999" },
            },
            3,
            "POST",
          ),
        ),
      "SHIFT_NOT_OPEN",
    );
  });
  await test("refund of a prior-shift sale reduces current cash drawer but not current-shift net revenue", async () => {
    const previous=(await db.query("SELECT p.id FROM pos_payments p JOIN pos_sales s ON s.id=p.sale_id WHERE s.tenant_id=1 AND s.unit_id=2 AND s.merchant_id=1 AND s.status='PAID' AND p.method='CASH' AND p.status='CONFIRMED' AND p.amount > (SELECT coalesce(sum(amount),0) FROM pos_refunds WHERE payment_id=p.id) ORDER BY p.id LIMIT 1")).rows[0];
    assert.ok(previous);
    const shift=await pos.openShift(req({...scope,opening_cash:'10000'},3,'POST'));
    await pos.refund(req({...scope,shift_id:shift.id,payment_id:previous.id,amount:'100',reason:'Synthetic previous shift return',request_id:'mobile-cross-shift-refund'},3,'POST'));
    const summary=await mobile.summary(req(scope));
    assert.equal(summary.sales,'0');assert.equal(summary.refunds,'0');
    assert.equal(summary.cash_refunds,'100');assert.equal(summary.expected_cash,'9900');
    await pos.closeShift({...req({...scope,actual_cash:'9900'},3,'POST'),params:{id:shift.id}});
  });
  console.log(
    `POS mobile: ${passed}/${passed} groups PASS; production untouched`,
  );
})()
  .catch((e) => {
    console.error({ code: e.code || e.name, message: e.message });
    process.exitCode = 1;
  })
  .finally(async () => {
    if (server) await new Promise((r) => server.close(r));
    await db.end();
  });
