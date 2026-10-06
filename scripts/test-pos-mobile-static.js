const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.join(__dirname, ".."),
  read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const app = read("pos-app/App.js"),
  domain = read("pos-app/src/domain.cjs"),
  vault = read("pos-app/src/vault.cjs"),
  service = read("services/posMobileService.js");
const ast = require("../pos-app/node_modules/@babel/parser").parse(app, {
  sourceType: "module",
  plugins: ["jsx"],
});
const compactApp = app.replace(/\s/g, "").replace(/"/g, "'");
const compactDomain = domain.replace(/\s/g, "").replace(/"/g, "'");
function visit(n, parent) {
  if (!n || typeof n !== "object") return;
  if (n.type === "JSXText" && n.value.trim())
    assert.ok(
      parent?.openingElement?.name?.name === "Text",
      `Native literal text outside Text: ${n.value.trim().slice(0, 30)}`,
    );
  for (const [key, value] of Object.entries(n)) {
    if (["loc", "start", "end", "extra"].includes(key)) continue;
    if (Array.isArray(value)) for (const v of value) visit(v, n);
    else if (value && typeof value === "object") visit(value, n);
  }
}
visit(ast, null);
for (const tab of ["BERANDA", "KASIR", "TRANSAKSI", "PRODUK", "LAINNYA"])
  assert.ok(compactApp.includes(`'${tab}'`));
for (const endpoint of [
  "/auth/login",
  "/pos/mobile/context",
  "/pos/mobile/catalog",
  "/pos/mobile/credential-preview",
  "/pos/checkout",
  "/pos/refunds",
])
  assert.ok((app + domain).includes(endpoint));
assert.ok(
  !/AsyncStorage|localStorage|wallet\.manage|\/rfid\/(payment|refund)|wali\/|santri\.saldo/.test(
    (app + domain + vault).replace(/^\s*\/\/.*$/gm, ""),
  ),
);
assert.ok(
  !/console\.(log|error|warn)/.test(
    app + domain + vault + read("pos-app/src/api.js"),
  ),
);
assert.ok(!/\b(INSERT|UPDATE|DELETE|GRANT|ALTER)\s/.test(service));
assert.ok(service.includes("READ ONLY"));
assert.ok(service.includes("a.user.id"));
assert.ok(service.includes("ACTIVE_SHIFT_CONTEXT_LOCKED"));
assert.ok(
  compactApp.includes(
    "__DEV__&&Constants.expoConfig.extra.posEnvironment==='development'",
  ),
);
assert.ok(app.includes("generation.current"));
assert.ok(compactDomain.includes("awaitthis.vault.write('pending',p)"));
assert.ok(compactDomain.includes("request_id:this.newId()"));
assert.ok(domain.includes("return this.send()"));
for (const [file, expected] of [
  [
    "094_pos_v1_foundation.sql",
    "0605eef6c75d82d076269aa12aac4f52aede96b74add5a48a7188f886fb30e51",
  ],
  [
    "095_pos_admin_control_center.sql",
    "8cd8d6e2ff84b4bf1bd83613d2b872dfbc6ab68f4667e1349184d35dee2e3f10",
  ],
]) {
  assert.equal(
    crypto
      .createHash("sha256")
      .update(read("migrations/" + file).replace(/\r\n/g, "\n"))
      .digest("hex"),
    expected,
  );
}
const config = read("pos-app/app.config.js");
assert.ok(config.includes("com.klikpesantren.pos"));
assert.ok(!config.includes("com.klikpesantren.wali"));
assert.ok(!config.includes("projectId"));
console.log(
  "PASS mobile identity, native Text contract, scoped read-only APIs, secure journal, reader gate, frozen migrations, no UID/secret logging",
);
