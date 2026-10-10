// Audit/apply reviewed POS-only runtime grants with explicit target guards.
const { Client } = require("pg");
const manifest = require("../config/posRuntimePrivileges");

const required = name => { const value = process.env[name]; if (!value) throw new Error(`Missing required environment variable: ${name}`); return value; };
const quote = value => `"${String(value).replace(/"/g, '""')}"`;

async function identity(client) {
  const row = (await client.query(`SELECT current_database() database,current_user,
    current_setting('neon.project_id',true) project_id,current_setting('neon.branch_id',true) branch_id,
    current_setting('neon.endpoint_id',true) endpoint_id`)).rows[0];
  for (const [field, env] of [["project_id", "EXPECTED_DB_PROJECT_ID"], ["branch_id", "EXPECTED_DB_BRANCH_ID"], ["endpoint_id", "EXPECTED_DB_ENDPOINT_ID"], ["database", "EXPECTED_DB_NAME"]]) {
    if (row[field] !== required(env)) throw new Error(`Target identity mismatch: ${field}`);
  }
  return row;
}

async function audit(client, runtimeRole) {
  const role = (await client.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,
    rolcanlogin,(SELECT count(*)::int FROM pg_class WHERE relowner=r.oid) owned_objects FROM pg_roles r WHERE rolname=$1`, [runtimeRole])).rows[0];
  if (!role || !role.rolcanlogin || role.rolsuper || role.rolcreatedb || role.rolcreaterole || role.rolreplication || role.rolbypassrls || role.owned_objects !== 0) throw new Error("Runtime role safety check failed");
  const currentUser = (await client.query("SELECT current_user")).rows[0].current_user;
  if (currentUser === runtimeRole) throw new Error("Owner connection required; runtime role cannot grant itself");
  const actualTables = (await client.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename LIKE 'pos_%' ORDER BY tablename", [manifest.schema])).rows.map(r => r.tablename);
  const expectedTables = Object.keys(manifest.tables).sort();
  if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) throw new Error("POS table manifest/schema mismatch");
  const sequences = (await client.query("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema=$1 AND sequence_name LIKE 'pos_%' ORDER BY sequence_name", [manifest.schema])).rows.map(r => r.sequence_name);
  if (JSON.stringify(sequences) !== JSON.stringify([...manifest.sequences])) throw new Error("POS sequence manifest/schema mismatch");
  const owners = (await client.query("SELECT DISTINCT tableowner FROM pg_tables WHERE schemaname=$1 AND tablename=ANY($2::text[])", [manifest.schema, expectedTables])).rows.map(r => r.tableowner);
  if (owners.length !== 1 || owners[0] !== currentUser) throw new Error("POS objects are not owned by the migration owner");

  const missing = [], excessive = [];
  const schemaUsage = (await client.query("SELECT has_schema_privilege($1,$2,'USAGE') allowed", [runtimeRole, manifest.schema])).rows[0].allowed;
  const schemaCreate = (await client.query("SELECT has_schema_privilege($1,$2,'CREATE') allowed", [runtimeRole, manifest.schema])).rows[0].allowed;
  if (!schemaUsage) missing.push({ object: manifest.schema, privilege: "USAGE" });
  if (schemaCreate) excessive.push({ object: manifest.schema, privilege: "CREATE" });
  for (const [table, rule] of Object.entries(manifest.tables)) {
    for (const operation of ["SELECT", "INSERT", "DELETE"]) {
      const allowed = (await client.query("SELECT has_table_privilege($1,$2,$3) allowed", [runtimeRole, `${manifest.schema}.${table}`, operation])).rows[0].allowed;
      const wanted = Boolean(rule[operation.toLowerCase()]);
      if (wanted && !allowed) missing.push({ object: table, privilege: operation });
      if (!wanted && allowed) excessive.push({ object: table, privilege: operation });
    }
    for (const operation of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      if ((await client.query("SELECT has_table_privilege($1,$2,$3) allowed", [runtimeRole, `${manifest.schema}.${table}`, operation])).rows[0].allowed) excessive.push({ object: table, privilege: operation });
    }
    const columns = (await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position", [manifest.schema, table])).rows.map(r => r.column_name);
    const wantedUpdates = new Set(rule.update || []);
    for (const column of columns) {
      const allowed = (await client.query("SELECT has_column_privilege($1,$2,$3,'UPDATE') allowed", [runtimeRole, `${manifest.schema}.${table}`, column])).rows[0].allowed;
      if (wantedUpdates.has(column) && !allowed) missing.push({ object: `${table}.${column}`, privilege: "UPDATE" });
      if (!wantedUpdates.has(column) && allowed) excessive.push({ object: `${table}.${column}`, privilege: "UPDATE" });
    }
    for (const column of wantedUpdates) if (!columns.includes(column)) throw new Error(`Unknown update column in manifest: ${table}.${column}`);
  }
  const publicGrants = Number((await client.query("SELECT count(*) count FROM information_schema.table_privileges WHERE table_schema=$1 AND table_name=ANY($2::text[]) AND grantee='PUBLIC'", [manifest.schema, expectedTables])).rows[0].count);
  if (publicGrants) excessive.push({ object: "PUBLIC", privilege: "POS_TABLE_PRIVILEGE" });
  return { role, table_count: expectedTables.length, sequence_count: sequences.length, missing, excessive };
}

async function apply(client, runtimeRole) {
  await client.query(`GRANT USAGE ON SCHEMA ${quote(manifest.schema)} TO ${quote(runtimeRole)}`);
  for (const [table, rule] of Object.entries(manifest.tables)) {
    const operations = [rule.select && "SELECT", rule.insert && "INSERT", rule.delete && "DELETE"].filter(Boolean);
    if (operations.length) await client.query(`GRANT ${operations.join(", ")} ON TABLE ${quote(manifest.schema)}.${quote(table)} TO ${quote(runtimeRole)}`);
    if (rule.update?.length) await client.query(`GRANT UPDATE (${rule.update.map(quote).join(", ")}) ON TABLE ${quote(manifest.schema)}.${quote(table)} TO ${quote(runtimeRole)}`);
  }
}

async function main() {
  const mode = process.argv[2] || "audit";
  if (!new Set(["audit", "apply"]).has(mode)) throw new Error("Usage: node scripts/manage-pos-runtime-privileges.js <audit|apply>");
  const runtimeRole = required("POS_RUNTIME_DB_ROLE");
  const client = new Client({ user: required("DB_USER"), host: required("DB_HOST"), database: required("DB_NAME"), password: required("DB_PASSWORD"), port: Number(process.env.DB_PORT || 5432), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const target = await identity(client);
    await client.query(mode === "apply" ? "BEGIN" : "BEGIN READ ONLY");
    const before = await audit(client, runtimeRole);
    if (mode === "apply") {
      const expectedConfirmation = `${target.project_id}:${target.branch_id}:${target.endpoint_id}:${target.database}:${runtimeRole}`;
      if (process.env.CONFIRM_POS_GRANT_TARGET !== expectedConfirmation) throw new Error("Explicit grant target confirmation mismatch");
      if (before.excessive.length) throw new Error("Refusing to apply over unexpected broad POS privileges");
      await apply(client, runtimeRole);
      const after = await audit(client, runtimeRole);
      if (after.missing.length || after.excessive.length) throw new Error("Post-grant privilege verification failed");
      await client.query("COMMIT");
      console.log(JSON.stringify({ mode: "APPLY", target: { project_id: target.project_id, branch_id: target.branch_id, endpoint_id: target.endpoint_id, database: target.database }, runtime_role: runtimeRole, table_count: after.table_count, sequence_count: after.sequence_count, missing: 0, excessive: 0 }, null, 2));
    } else {
      await client.query("ROLLBACK");
      console.log(JSON.stringify({ mode: "READ_ONLY_AUDIT", target: { project_id: target.project_id, branch_id: target.branch_id, endpoint_id: target.endpoint_id, database: target.database }, runtime_role: runtimeRole, table_count: before.table_count, sequence_count: before.sequence_count, missing: before.missing, excessive: before.excessive }, null, 2));
      if (before.missing.length || before.excessive.length) process.exitCode = 2;
    }
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; } finally { await client.end(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { audit, apply };
