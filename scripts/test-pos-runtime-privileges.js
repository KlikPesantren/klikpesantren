const assert = require("assert");
const fs = require("fs");
const path = require("path");
const manifest = require("../config/posRuntimePrivileges");

const root = path.join(__dirname, "..");
const migrationFiles = fs.readdirSync(path.join(root, "migrations")).filter(name => /^(09[4-9]|10[0-7])_.*\.sql$/.test(name) && !name.endsWith("_rollback.sql"));
const created = new Set();
for (const name of migrationFiles) {
  const sql = fs.readFileSync(path.join(root, "migrations", name), "utf8");
  for (const match of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(pos_[a-z0-9_]+)/gi)) created.add(match[1].toLowerCase());
}
assert.deepStrictEqual(Object.keys(manifest.tables).sort(), [...created].sort(), "grant manifest must cover exactly POS tables 094-107");
assert.deepStrictEqual(manifest.sequences, [], "POS 094-107 require no POS-owned sequence grant");
assert.deepStrictEqual(manifest.externalTables,{cash_accounts:{select:true},cash_account_transactions:{select:true,insert:true}});
assert.deepStrictEqual(manifest.externalSequences,["cash_account_transactions_id_seq"]);

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
assert.deepStrictEqual(Object.entries(manifest.tables).filter(([, rule]) => rule.delete).map(([table]) => table).sort(), ["pos_businesses", "pos_merchant_activation_tokens", "pos_merchant_sessions"]);
assert.equal(manifest.tables.pos_merchant_permission_audit.update, undefined);
assert.equal(manifest.tables.pos_merchant_permission_audit.delete, undefined);
assert.equal(manifest.tables.pos_wallet_credential_audits.update, undefined);
assert.equal(manifest.tables.pos_wallet_credential_audits.delete, undefined);
assert.deepStrictEqual(manifest.tables.pos_cashier_assignments.update, ["active"]);
assert.deepStrictEqual(manifest.tables.pos_merchant_activation_tokens.update, ["token_hash", "expires_at", "created_by", "created_at"]);
assert.deepStrictEqual(manifest.tables.pos_merchant_sessions.update, ["token_hash"],
  "session authentication row lock requires one bounded UPDATE column privilege");
const businessService = fs.readFileSync(path.join(root, "services", "posBusinessService.js"), "utf8");
assert.match(businessService, /pos_merchant_sessions\s+s[\s\S]*FOR\s+SHARE\s+OF\s+u\s*,\s*s/i,
  "runtime manifest must retain the bounded privilege required by session FOR SHARE locking");

const manager = fs.readFileSync(path.join(__dirname, "manage-pos-runtime-privileges.js"), "utf8");
assert.doesNotMatch(manager, /GRANT\s+ALL|GRANT[\s\S]{0,200}\bTO\s+PUBLIC\b/i);
assert.match(manager, /rolsuper/);
assert.match(manager, /rolbypassrls/);
assert.match(manager, /rolcreaterole/);
assert.match(manager, /CONFIRM_POS_GRANT_TARGET/);
assert.match(manager, /BEGIN READ ONLY/);
assert.match(manager, /hasOwnProperty\.call\(manifest\.tables, table\)/,
  "external canonical tables must not make unrelated existing app privileges look like POS grant drift");
assert.doesNotMatch(manager, /GRANT\s+ALL/i);
console.log(`PASS POS runtime privilege manifest: ${created.size} POS tables, 2 canonical treasury dependencies, destructive grants bounded`);
