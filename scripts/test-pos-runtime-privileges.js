const assert = require("assert");
const fs = require("fs");
const path = require("path");
const manifest = require("../config/posRuntimePrivileges");

const root = path.join(__dirname, "..");
const migrationFiles = fs.readdirSync(path.join(root, "migrations")).filter(name => /^(09[4-9]|10[0-4])_.*\.sql$/.test(name) && !name.endsWith("_rollback.sql"));
const created = new Set();
for (const name of migrationFiles) {
  const sql = fs.readFileSync(path.join(root, "migrations", name), "utf8");
  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(pos_[a-z0-9_]+)/gi)) created.add(match[1].toLowerCase());
}
assert.deepStrictEqual(Object.keys(manifest.tables).sort(), [...created].sort(), "grant manifest must cover exactly POS tables 094-104");
assert.deepStrictEqual(manifest.sequences, [], "POS 094-104 require no POS sequence grant");

const files = [];
for (const dir of ["routes", "services", "controllers", "middleware", "utils"]) {
  const walk = current => {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file); else if (entry.name.endsWith(".js")) files.push(file);
    }
  };
  walk(path.join(root, dir));
}
const required = new Map(Object.keys(manifest.tables).map(table => [table, new Set()]));
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  for (const [operation, expression] of [["select", /\b(?:FROM|JOIN)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi], ["insert", /\bINSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi], ["update", /\bUPDATE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+SET\b/gi], ["delete", /\bDELETE\s+FROM\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi]]) {
    for (const match of source.matchAll(expression)) if (required.has(match[1].toLowerCase())) required.get(match[1].toLowerCase()).add(operation);
  }
}
for (const [table, operations] of required) {
  const rule = manifest.tables[table];
  for (const operation of operations) {
    if (operation === "update") assert.ok(rule.update?.length, `${table} UPDATE must be column-scoped`);
    else assert.equal(rule[operation], true, `${table} requires ${operation.toUpperCase()}`);
  }
}
assert.deepStrictEqual(Object.entries(manifest.tables).filter(([, rule]) => rule.delete).map(([table]) => table).sort(), ["pos_merchant_activation_tokens", "pos_merchant_sessions"]);
assert.equal(manifest.tables.pos_merchant_permission_audit.update, undefined);
assert.equal(manifest.tables.pos_merchant_permission_audit.delete, undefined);
assert.equal(manifest.tables.pos_wallet_credential_audits.update, undefined);
assert.equal(manifest.tables.pos_wallet_credential_audits.delete, undefined);
assert.deepStrictEqual(manifest.tables.pos_cashier_assignments.update, ["active"]);
assert.deepStrictEqual(manifest.tables.pos_merchant_activation_tokens.update, ["token_hash", "expires_at", "created_by", "created_at"]);

const manager = fs.readFileSync(path.join(__dirname, "manage-pos-runtime-privileges.js"), "utf8");
assert.doesNotMatch(manager, /GRANT\s+ALL|GRANT[\s\S]{0,200}\bTO\s+PUBLIC\b/i);
assert.match(manager, /rolsuper/);
assert.match(manager, /rolbypassrls/);
assert.match(manager, /rolcreaterole/);
assert.match(manager, /CONFIRM_POS_GRANT_TARGET/);
assert.match(manager, /BEGIN READ ONLY/);
console.log(`PASS POS runtime privilege manifest: ${created.size} tables, 0 POS sequences, destructive grants bounded`);
