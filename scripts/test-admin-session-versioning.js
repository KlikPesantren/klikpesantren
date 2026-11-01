const assert = require("assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

process.env.JWT_SECRET ||= "test-admin-session-versioning-secret";
process.env.WALI_JWT_SECRET ||= "test-wali-session-versioning-secret";

const state = {
  tenant: { id: 91, slug: "session-test", nama: "Session Test", status: "active" },
  user: {
    id: 501,
    nama: "Admin Session Test",
    username: "admin-session-test",
    password: "test-password",
    role: "pendidikan",
    status: "Aktif",
    tenant_id: 91,
    token_version: 0,
  },
  units: [
    {
      id: 701,
      kode: "PESANTREN",
      nama: "Pesantren",
      unit_type: "PESANTREN",
      preset_key: "PESANTREN",
      is_active: true,
      sort_order: 0,
      settings: {},
      created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: new Date("2026-01-01T00:00:00Z"),
    },
  ],
};

function normalized(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

const fakePool = {
  async query(sql, params = []) {
    const query = normalized(sql);

    // Tenant resolution now enforces expiry before reading the active tenant.
    // This fixture has no expired subscription; billing behavior is tested separately.
    if (query.startsWith('WITH suspended AS') && query.includes('platform.tenant.billing.auto_suspended')) {
      state.billingChecks = (state.billingChecks || 0) + 1;
      return { rows: [] };
    }

    if (query.includes("FROM tenants") && query.includes("WHERE slug = $1")) {
      return { rows: params[0] === state.tenant.slug ? [{ ...state.tenant }] : [] };
    }
    if (query.includes("FROM tenants") && query.includes("WHERE id = $1")) {
      return { rows: Number(params[0]) === state.tenant.id ? [{ ...state.tenant }] : [] };
    }
    if (query.includes("SELECT * FROM users") && query.includes("username = $1")) {
      const matches = params[0] === state.user.username && Number(params[1]) === state.user.tenant_id;
      return { rows: matches ? [{ ...state.user }] : [] };
    }
    if (query.includes("token_version") && query.includes("FROM users") && query.includes("WHERE id = $1")) {
      return { rows: Number(params[0]) === state.user.id ? [{ ...state.user }] : [] };
    }
    if (query.includes("FROM tenant_role_overrides tro") && query.includes("r.is_system = true")) {
      return { rows: [] };
    }
    if (query.startsWith("SELECT r.name AS role, p.key AS perm")) {
      return {
        rows: [
          { role: "pendidikan", perm: "dashboard.view" },
          { role: "superadmin", perm: "dashboard.view" },
          { role: "superadmin", perm: "unit.view" },
          { role: "superadmin", perm: "unit.manage" },
        ],
      };
    }
    if (query.includes("FROM feature_catalog fc")) {
      return {
        rows: [{ key: "dashboard", label: "Dashboard", description: "", is_core: true, sort_order: 1, enabled: true }],
      };
    }
    if (query.startsWith("SELECT id, tenant_id, role, status FROM users")) {
      const matches = Number(params[0]) === state.user.id && Number(params[1]) === state.user.tenant_id;
      return { rows: matches ? [{ ...state.user }] : [] };
    }
    if (query.includes("FROM unit_pendidikan WHERE tenant_id = $1")) {
      return { rows: Number(params[0]) === state.user.tenant_id ? state.units.map((unit) => ({ ...unit })) : [] };
    }

    throw new Error(`Unexpected mock SQL: ${query}`);
  },
};

const dbPath = require.resolve("../db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };

const express = require("express");
const jwt = require("jsonwebtoken");
const authRoutes = require("../routes/authRoutes");
const unitRoutes = require("../routes/unitRoutes");
const { JWT_SECRET } = require("../config/authSecrets");

async function request(baseUrl, method, pathname, token, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

async function run() {
  const migration = fs.readFileSync(
    path.join(__dirname, "../migrations/070_admin_token_version.sql"),
    "utf8",
  );
  assert.match(migration, /ADD COLUMN IF NOT EXISTS token_version BIGINT NOT NULL DEFAULT 0/i);
  assert.match(migration, /trg_users_bump_token_version/i);
  assert.match(migration, /trg_role_permissions_bump_token_version/i);
  const frontendApi = fs.readFileSync(path.join(__dirname, "../frontend/src/services/api.js"), "utf8");
  const loginPage = fs.readFileSync(path.join(__dirname, "../frontend/src/pages/LoginPage.jsx"), "utf8");
  const unitRoute = fs.readFileSync(path.join(__dirname, "../routes/unitRoutes.js"), "utf8");
  const roleRoute = fs.readFileSync(path.join(__dirname, "../routes/roleRoutes.js"), "utf8");
  assert.match(frontendApi, /data\?\.code === "SESSION_EXPIRED"/);
  assert.match(frontendApi, /clearSession\(\)/);
  assert.match(loginPage, /sessionStorage\.getItem\("auth_message"\)/);
  assert.match(unitRoute, /router\.get\("\/presets\/:unitType", requirePermission\("unit\.view"\)/);
  assert.match(roleRoute, /if \(!permissionsChanged && !labelChanged\)/);

  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);
  app.use("/units", unitRoutes);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const oldLogin = await request(baseUrl, "POST", "/auth/login", null, {
      tenant_slug: state.tenant.slug,
      username: state.user.username,
      password: state.user.password,
    });
    assert.equal(oldLogin.status, 200);
    assert.equal(jwt.verify(oldLogin.body.token, JWT_SECRET).token_version, 0);

    // Simulates the migration trigger after an operator changes the user's role.
    state.user.role = "superadmin";
    state.user.token_version += 1;

    const rejected = await request(baseUrl, "GET", "/units/presets/PESANTREN", oldLogin.body.token);
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.code, "SESSION_EXPIRED");

    const newLogin = await request(baseUrl, "POST", "/auth/login", null, {
      tenant_slug: state.tenant.slug,
      username: state.user.username,
      password: state.user.password,
    });
    assert.equal(newLogin.status, 200);
    assert.equal(jwt.verify(newLogin.body.token, JWT_SECRET).token_version, 1);

    const units = await request(baseUrl, "GET", "/units/presets/PESANTREN", newLogin.body.token);
    assert.equal(units.status, 200);
    assert.equal(units.body.success, true);

    // Simulates the role_permissions trigger after the role matrix changes.
    state.user.token_version += 1;
    const permissionChangeRejected = await request(baseUrl, "GET", "/units/presets/PESANTREN", newLogin.body.token);
    assert.equal(permissionChangeRejected.status, 401);
    assert.equal(permissionChangeRejected.body.code, "SESSION_EXPIRED");

    assert.ok(state.billingChecks > 0, 'tenant billing validation remains in the login/context path');
    console.log("PASS admin session versioning: 21 assertions");
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
