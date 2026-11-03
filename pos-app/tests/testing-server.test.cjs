const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  STORAGE_KEY,
  normalizeTestingServerAddress,
  loadTestingServerAddress,
  saveTestingServerAddress,
  verifyTestingServer,
} = require("../src/testingServer.cjs");

test("testing server address is normalized, persisted and restored", async () => {
  const values = new Map();
  const store = {
    getItemAsync: async key => values.get(key) ?? null,
    setItemAsync: async (key, value) => values.set(key, value),
  };
  assert.equal(normalizeTestingServerAddress(" http://10.10.6.39:55440/ "), "http://10.10.6.39:55440");
  await saveTestingServerAddress(store, "http://10.10.6.39:55440/");
  assert.equal(values.get(STORAGE_KEY), "http://10.10.6.39:55440");
  assert.equal(await loadTestingServerAddress(store, "http://10.0.2.2:55440"), "http://10.10.6.39:55440");
  assert.throws(() => normalizeTestingServerAddress("http://user:secret@10.10.6.39:55440/api"), { code: "INVALID_TEST_SERVER" });
});

test("health check accepts only an explicit local testing backend", async () => {
  const ok = await verifyTestingServer("http://10.10.6.39:55440", async url => ({
    ok: true,
    json: async () => ({ local: true, fixture: "suq-local-acceptance", url }),
  }));
  assert.deepEqual(ok, { address: "http://10.10.6.39:55440", fixture: "suq-local-acceptance" });
  await assert.rejects(
    () => verifyTestingServer("http://10.10.6.40:55440", async () => { throw Error("ECONNREFUSED"); }, 10),
    { code: "TEST_SERVER_UNREACHABLE" },
  );
  await assert.rejects(
    () => verifyTestingServer("https://api.klikpesantren.com", async () => ({ ok: true, json: async () => ({ ok: true }) })),
    { code: "TEST_SERVER_NOT_LOCAL" },
  );
});

test("health check uses the entered origin and diagnoses HTTP, JSON and timeout", async () => {
  await verifyTestingServer(" http://192.168.2.7:55440/ ", async (url, options) => {
    assert.equal(url, "http://192.168.2.7:55440/health");
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ local: true }) };
  });
  await assert.rejects(() => verifyTestingServer("http://localhost:55440", async () => ({ ok: false, status: 503 })), { code: "TEST_SERVER_HTTP" });
  await assert.rejects(() => verifyTestingServer("http://localhost:55440", async () => ({ ok: true, json: async () => { throw SyntaxError("HTML"); } })), { code: "TEST_SERVER_JSON" });
  await assert.rejects(() => verifyTestingServer("http://localhost:55440", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(Error("aborted"), { name: "AbortError" })));
  }), 5), { code: "TEST_SERVER_TIMEOUT" });
});

test("restored selection drives actual login, authenticated API and download URLs", async () => {
  const vm = require("node:vm");
  const values = new Map();
  const store = { getItemAsync: async key => values.get(key), setItemAsync: async (key, value) => values.set(key, value) };
  await saveTestingServerAddress(store, "http://192.168.2.7:55440");
  const restored = await loadTestingServerAddress({ getItemAsync: async key => values.get(key) }, "http://127.0.0.1:55440");
  const calls = [];
  const source = fs.readFileSync(path.join(__dirname, "../src/api.js"), "utf8")
    .replace(/^import .*;\r?\n/gm, "").replace("export function makeApi", "function makeApi");
  const sandbox = { AbortController, URLSearchParams, setTimeout, clearTimeout,
    Constants: { expoConfig: { extra: { posEnvironment: "development", apiUrl: "http://127.0.0.1:55440" } } },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ data: { token: "test-token" } }) }; },
    FileSystem: { createDownloadResumable: url => ({ downloadAsync: async () => { calls.push({ url }); return { status: 200 }; } }) },
  };
  vm.runInNewContext(source, sandbox);
  const auth = await sandbox.makeApi(null, undefined, restored)("/pos-business/login", { method: "POST", body: { login: "test", password: "test" } });
  const client = sandbox.makeApi(auth.token, undefined, restored);
  await client("/pos-business/memberships");
  await client.download("/pos-business/1/export", "test-file");
  assert.deepEqual(calls.map(call => call.url), ["/pos-business/login", "/pos-business/memberships", "/pos-business/1/export"].map(route => restored + route));
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-token");
});

test("tracked native plugin enables testing HTTP and preserves production configuration", () => {
  const vm = require("node:vm");
  const { configureTestingNetwork } = require("../plugins/withTestingNetwork.cjs");
  const source = fs.readFileSync(path.join(__dirname, "../app.config.js"), "utf8");
  for (const mode of ["development", "staging", "production", "acceptance"]) {
    const sandbox = { module: { exports: {} }, URL, process: { env: { POS_ENV: mode,
      ...(mode === "acceptance" ? { POS_REVIEW: "1", EXPO_PUBLIC_POS_ACCEPTANCE: "1" } : {}),
      ...(mode === "staging" ? { EXPO_PUBLIC_POS_API_URL: "https://staging.example.test" } : {}),
    } } };
    vm.runInNewContext(source, sandbox);
    const config = sandbox.module.exports.expo;
    const plugin = config.plugins.find(item => Array.isArray(item) && item[0] === "./plugins/withTestingNetwork.cjs");
    assert.ok(plugin);
    const manifest = { manifest: { application: [{ $: {} }] } };

    configureTestingNetwork(manifest, plugin[1]);
    if (mode === "development") assert.equal(manifest.manifest.application[0].$["android:usesCleartextTraffic"], "true");
    else assert.equal(manifest.manifest.application[0].$["android:usesCleartextTraffic"], "false");
    if (mode === "production") assert.equal(config.extra.apiUrl, "https://api.klikpesantren.com");
  }
});

test("every POS API client uses the selected base and production hides testing controls", () => {
  const app = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "../src/api.js"), "utf8");
  assert.match(api, /apiBase = Constants\.expoConfig\.extra\.apiUrl/);
  const clients = app.split(/\r?\n/).filter(line => line.includes("makeApi("));
  assert.ok(clients.length >= 5);
  assert.ok(clients.every(line => line.includes("serverBase")));
  assert.match(app, /TESTING_BUILD = Constants\.expoConfig\.extra\.posEnvironment === "development"/);
  assert.match(app, /testingBuild&&<Card title="Alamat Server Pengujian"/);
  assert.match(app, /saveTestingServerAddress\(vaultStore/);
});
