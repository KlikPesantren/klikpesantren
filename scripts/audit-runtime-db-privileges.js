// Read-only source-to-PostgreSQL privilege audit. Run with the production DB env.
const fs = require("fs");
const path = require("path");
const pool = require("../db");

const SOURCE_DIRS = ["routes", "services", "middleware", "controllers", "utils", "config"];
const OPERATIONS = ["SELECT", "INSERT", "UPDATE", "DELETE"];
// Migration ledger is owner-only maintenance code, never a normal runtime route.
const NON_RUNTIME_FILES = new Set(["utils/migrationLedger.js"]);

function sourceFiles() {
  const files = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith(".js") &&
        !NON_RUNTIME_FILES.has(path.relative(path.join(__dirname, ".."), file).replace(/\\/g, "/"))) files.push(file);
    }
  };
  for (const dir of SOURCE_DIRS) walk(path.join(__dirname, "..", dir));
  return files;
}

function collectRequirements(files) {
  const required = new Map();
  const add = (table, operation, file) => {
    const name = table.toLowerCase();
    if (!required.has(name)) required.set(name, new Map());
    if (!required.get(name).has(operation)) required.get(name).set(operation, file);
  };
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\b(?:FROM|JOIN)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) add(match[1], "SELECT", file);
    for (const match of source.matchAll(/\bUPDATE\s+(?:public\.)?([a-z_][a-z0-9_]*)\s+SET\b/gi)) add(match[1], "UPDATE", file);
    for (const match of source.matchAll(/\bDELETE\s+FROM\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) add(match[1], "DELETE", file);
    for (const match of source.matchAll(/\bINSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) add(match[1], "INSERT", file);
    // INSERT ... ON CONFLICT DO UPDATE also requires UPDATE on its target.
    for (const literal of source.matchAll(/`([^`]*?)`/gs)) {
      for (const match of literal[1].matchAll(/\bINSERT\s+INTO\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi)) {
        if (/\bON\s+CONFLICT\b[\s\S]*?\bDO\s+UPDATE\b/i.test(literal[1].slice(match.index))) {
          add(match[1], "UPDATE", file);
        }
      }
    }
    // Bounded dynamic table identifiers are selected from source-owned allowlists.
    // Include them explicitly; regex over SQL literals alone misses `${table}`.
    const normalized = file.replace(/\\/g, "/");
    if (normalized.endsWith("/services/tenantHealthService.js")) {
      for (const [name, operation] of [
        ["CLEANUP_COUNT_TABLES", "SELECT"],
        ["TENANT_ACTIVITY_TABLES", "SELECT"],
        ["DELETE_TABLE_ORDER", "DELETE"],
      ]) {
        const list = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
        if (!list) throw new Error(`Missing dynamic table allowlist: ${name}`);
        for (const entry of list[1].matchAll(/"([a-z_]+)"/g)) add(entry[1], operation, file);
      }
    }
    if (normalized.endsWith("/services/tenantScope.js")) {
      const list = source.match(/const TENANT_TABLE_LABELS = \{([\s\S]*?)\};/);
      if (!list) throw new Error("Missing tenant scope table allowlist");
      for (const entry of list[1].matchAll(/^\s*([a-z_]+):/gm)) add(entry[1], "SELECT", file);
    }
  }
  return required;
}

async function main() {
  const files = sourceFiles();
  const required = collectRequirements(files);
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
    const realTables = new Set(rows.map((row) => row.tablename));
    const gaps = [];
    const counts = Object.fromEntries(OPERATIONS.map((operation) => [operation, 0]));
    counts.SEQUENCE_USAGE = 0;
    for (const [table, operations] of required) {
      if (!realTables.has(table)) continue;
      for (const [operation, file] of operations) {
        counts[operation] += 1;
        const result = await client.query("SELECT has_table_privilege(current_user, $1, $2) AS allowed", [`public.${table}`, operation]);
        if (!result.rows[0].allowed) gaps.push({ table, operation, source: path.relative(path.join(__dirname, ".."), file) });
      }
      if (operations.has("INSERT")) {
        const columns = await client.query("SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id'", [table]);
        if (columns.rowCount) {
          const sequenceResult = await client.query("SELECT pg_get_serial_sequence($1, 'id') AS sequence", [`public.${table}`]);
          const sequence = sequenceResult.rows[0].sequence;
          if (sequence) {
            counts.SEQUENCE_USAGE += 1;
            const permission = await client.query("SELECT has_sequence_privilege(current_user, $1, 'USAGE') AS allowed", [sequence]);
            if (!permission.rows[0].allowed) gaps.push({ table, operation: "SEQUENCE_USAGE", sequence });
          }
        }
      }
    }
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ mode: "READ_ONLY", source_files: files.length, tables_covered: [...required.keys()].filter((table) => realTables.has(table)).length, required_operation_counts: counts, missing: gaps }, null, 2));
    if (gaps.length) process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
