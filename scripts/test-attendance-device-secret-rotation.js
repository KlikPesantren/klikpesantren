const assert = require("assert");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const dbPath = require.resolve("../db");
const tenantServicePath = require.resolve("../services/tenantService");
const controllerPath = require.resolve("../controllers/rfidDeviceController");
const middlewarePath = require.resolve("../middleware/secureDeviceAuthMiddleware");

const TARGET_TENANT_ID = 101;
const TARGET_DEVICE_ID = "fixture-attendance-device";
const TARGET_TENANT_SLUG = "fixture-tenant-a";
const OLD_SECRET = "fixture-old-secret-not-production";

let storedHash;
let storedEnabled = true;
let rotationCount = 0;

const fakePool = {
  async query(sql, params = []) {
    if (/^\s*UPDATE\s+devices\s+SET\s+device_secret\s*=/i.test(sql)) {
      const [, nextHash, tenantId, deviceId] = params;
      if (Number(tenantId) !== TARGET_TENANT_ID || deviceId !== TARGET_DEVICE_ID) {
        return { rows: [] };
      }
      storedHash = nextHash;
      rotationCount += 1;
      return {
        rows: [{
          id: 501,
          device_id: TARGET_DEVICE_ID,
          nama_device: "Fixture Attendance Device",
          merchant_id: null,
          status: "active",
          enabled: storedEnabled,
          connection_state: "offline",
          firmware_version: null,
          tenant_id: TARGET_TENANT_ID,
          secret_rotated_at: new Date().toISOString(),
        }],
      };
    }

    if (/^\s*SELECT[\s\S]+FROM\s+devices/i.test(sql)) {
      const [tenantId, deviceId] = params;
      if (params.length === 1 && Number(tenantId) === TARGET_TENANT_ID) {
        return {
          rows: [{
            id: 501,
            tenant_id: TARGET_TENANT_ID,
            device_id: TARGET_DEVICE_ID,
            device_secret: "__HASHED_V1__",
            device_secret_hash: storedHash,
            enabled: storedEnabled,
            status: "active",
          }],
        };
      }
      if (Number(tenantId) !== TARGET_TENANT_ID || deviceId !== TARGET_DEVICE_ID) {
        return { rows: [] };
      }
      return {
        rows: [{
          id: 501,
          tenant_id: TARGET_TENANT_ID,
          device_id: TARGET_DEVICE_ID,
          device_secret: "__HASHED_V1__",
          device_secret_hash: storedHash,
          enabled: storedEnabled,
          status: "active",
          merchant_id: null,
          merchant_tenant_id: null,
        }],
      };
    }

    if (/^\s*UPDATE\s+devices\s+SET\s+last_authenticated_at/i.test(sql)) {
      return { rows: [] };
    }
    throw new Error("Unexpected test query");
  },
};

require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: fakePool,
};
require.cache[tenantServicePath] = {
  id: tenantServicePath,
  filename: tenantServicePath,
  loaded: true,
  exports: {
    resolveTenantForLogin: async (slug) => {
      if (slug === TARGET_TENANT_SLUG) {
        return { tenant: { id: TARGET_TENANT_ID, slug } };
      }
      if (slug === "fixture-tenant-b") {
        return { tenant: { id: 202, slug } };
      }
      return { error: "Tenant fixture tidak ditemukan", status: 404 };
    },
  },
};
delete require.cache[controllerPath];
delete require.cache[middlewarePath];

const controller = require(controllerPath);
const secureDeviceAuthMiddleware = require(middlewarePath);

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    set(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function authenticate({ secret, tenantSlug = TARGET_TENANT_SLUG, deviceId = TARGET_DEVICE_ID }) {
  const req = {
    query: {},
    body: {},
    headers: {
      "x-device-id": deviceId,
      "x-device-secret": secret,
      "x-tenant-slug": tenantSlug,
    },
  };
  const res = mockResponse();
  let nextCalls = 0;
  await secureDeviceAuthMiddleware(req, res, () => {
    nextCalls += 1;
  });
  return { req, res, nextCalls };
}

async function main() {
  const capturedLogs = [];
  const originalError = console.error;
  console.error = (...args) => capturedLogs.push(args.map(String).join(" "));
  try {
    storedHash = await bcrypt.hash(OLD_SECRET, 4);

    const rotateRes = mockResponse();
    await controller.rotateSecret(
      {
        tenantId: TARGET_TENANT_ID,
        params: { deviceId: TARGET_DEVICE_ID },
      },
      rotateRes,
    );
    assert.equal(rotateRes.statusCode, 200);
    assert.equal(rotateRes.body.success, true);
    assert.equal(rotateRes.body.rotated, true);
    assert.match(rotateRes.body.device_secret, /^[a-f0-9]{64}$/);
    assert.notEqual(rotateRes.body.device_secret, OLD_SECRET);
    assert.equal(rotationCount, 1);
    assert.equal(rotateRes.headers["cache-control"], "no-store");
    assert.equal(rotateRes.headers.pragma, "no-cache");
    assert.equal("device_secret_hash" in rotateRes.body.device, false);
    assert.equal("device_secret" in rotateRes.body.device, false);

    const freshSecret = rotateRes.body.device_secret;
    assert.equal(await bcrypt.compare(freshSecret, storedHash), true);
    assert.equal(await bcrypt.compare(OLD_SECRET, storedHash), false);

    const freshAuth = await authenticate({ secret: freshSecret });
    assert.equal(freshAuth.nextCalls, 1);
    assert.equal(freshAuth.req.tenantId, TARGET_TENANT_ID);
    assert.equal("device_secret" in freshAuth.req.device, false);
    assert.equal("device_secret_hash" in freshAuth.req.device, false);

    const listRes = mockResponse();
    await controller.list({ tenantId: TARGET_TENANT_ID }, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.data.length, 1);
    assert.equal("device_secret" in listRes.body.data[0], false);
    assert.equal("device_secret_hash" in listRes.body.data[0], false);

    const oldAuth = await authenticate({ secret: OLD_SECRET });
    assert.equal(oldAuth.nextCalls, 0);
    assert.equal(oldAuth.res.statusCode, 401);

    const wrongTenant = await authenticate({
      secret: freshSecret,
      tenantSlug: "fixture-tenant-b",
    });
    assert.equal(wrongTenant.nextCalls, 0);
    assert.equal(wrongTenant.res.statusCode, 401);

    const wrongDevice = await authenticate({
      secret: freshSecret,
      deviceId: "fixture-foreign-device",
    });
    assert.equal(wrongDevice.nextCalls, 0);
    assert.equal(wrongDevice.res.statusCode, 401);

    storedEnabled = false;
    const disabled = await authenticate({ secret: freshSecret });
    assert.equal(disabled.nextCalls, 0);
    assert.equal(disabled.res.statusCode, 403);
    storedEnabled = true;

    const foreignRotate = mockResponse();
    await controller.rotateSecret(
      {
        tenantId: 202,
        params: { deviceId: TARGET_DEVICE_ID },
      },
      foreignRotate,
    );
    assert.equal(foreignRotate.statusCode, 404);
    assert.equal(rotationCount, 1);

    const logs = capturedLogs.join("\n");
    assert.equal(logs.includes(OLD_SECRET), false);
    assert.equal(logs.includes(freshSecret), false);

    const routeSource = fs.readFileSync(
      path.join(__dirname, "../routes/rfidDeviceRoutes.js"),
      "utf8",
    );
    const rotationRoute = routeSource.match(
      /router\.post\(\s*"\/:deviceId\/rotate-secret"[\s\S]*?deviceController\.rotateSecret\s*\)/,
    );
    assert.ok(rotationRoute);
    assert.match(rotationRoute[0], /authMiddleware/);
    assert.match(rotationRoute[0], /tenantMiddleware/);
    assert.match(rotationRoute[0], /requireTenantFeature\("rfid"\)/);
    assert.match(rotationRoute[0], /requirePermission\("rfid\.manage"\)/);

    const loggerSource = fs.readFileSync(
      path.join(__dirname, "../middleware/logger.js"),
      "utf8",
    );
    assert.equal(/req\.body|res\.body|req\.headers/.test(loggerSource), false);
    const legacyMiddlewareSource = fs.readFileSync(
      path.join(__dirname, "../middleware/deviceMiddleware.js"),
      "utf8",
    );
    assert.equal(/console\.log\(req\.body\)/.test(legacyMiddlewareSource), false);

    console.log("Attendance device secret rotation: PASS");
    console.log("Checks: fresh accepted; old/cross-tenant/wrong-device/disabled rejected; no leakage");
  } finally {
    console.error = originalError;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
