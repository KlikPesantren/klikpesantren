/* Destructive fixtures are confined to the literal loopback PostgreSQL database below.
 * This test never imports .env and never connects to production. */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const options = { host: '127.0.0.1', port: 55439, user: 'pos_test_owner', database: 'suq_shogir_onboarding_test', max: 8 };
const ids = Array.from({ length: 8 }, () => crypto.randomUUID());
const [existingBusiness, existingOwner, pendingBusiness, pendingOwner] = ids;
let db;
let passed = 0;
const test = async (name, work) => { await work(); passed++; console.log('PASS ' + name); };
const rejects = (work, code) => assert.rejects(work, error => error.code === code);
const request = (body = {}, user = { id: 1, tenant_id: 1, role: 'superadmin' }, query = { unit_id: 2 }, params = {}, headers = {}) => ({
  body, user, query, params, headers, tenantId: user.tenant_id,
});
const migration = name => fs.readFileSync(path.join(__dirname, '..', 'migrations', name), 'utf8');

async function setup() {
  const admin = new Pool({ ...options, database: 'postgres' });
  try {
    const identity = (await admin.query('SELECT current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
    assert.deepEqual(identity, { current_user: options.user, host: options.host, port: options.port });
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [options.database])).rowCount)
      await admin.query('CREATE DATABASE suq_shogir_onboarding_test');
  } finally { await admin.end(); }
  db = new Pool(options);
  assert.deepEqual((await db.query('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0],
    { db: options.database, current_user: options.user, host: options.host, port: options.port });
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.query(`CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL,slug text UNIQUE);
    CREATE TABLE unit_pendidikan(id integer PRIMARY KEY,tenant_id integer NOT NULL,kode text,nama text,unit_type text,preset_key text,is_active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,UNIQUE(id,tenant_id));
    CREATE TABLE users(id integer PRIMARY KEY,tenant_id integer NOT NULL,nama text,username text,role text,status text);
    CREATE TABLE user_unit_scope(user_id integer,tenant_id integer,unit_id integer,status text);
    CREATE TABLE legacy_fixture(id integer PRIMARY KEY,value text);
    INSERT INTO tenants VALUES(1,'active','synthetic-suq'),(2,'active','foreign-suq');
    INSERT INTO unit_pendidikan VALUES(2,1,'U2','Unit Dua','pesantren','pesantren',true,1),(3,1,'U3','Unit Tiga','sekolah','sekolah',true,2),(4,2,'U4','Unit Asing','pesantren','pesantren',true,1);
    INSERT INTO users VALUES(1,1,'Admin Sintetis','admin','superadmin','active'),(2,1,'Operator Sintetis','operator','operator','active'),(3,2,'Admin Asing','foreign','superadmin','active');
    INSERT INTO user_unit_scope VALUES(2,1,2,'active');
    INSERT INTO legacy_fixture VALUES(1,'preserve');`);
  await db.query(migration('097_pos_business_core_v2.sql'));
  await db.query(migration('103_pos_merchant_account_activation.sql'));
}

async function main() {
  await setup();
  await test('104 UP/DOWN/second UP is deterministic and preserves prior schema/data', async () => {
    await db.query(migration('104_suq_shogir_merchant_onboarding.sql'));
    assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='pos_businesses' AND column_name='accounting_start_date'")).rows[0].data_type, 'date');
    await db.query(migration('104_suq_shogir_merchant_onboarding_rollback.sql'));
    assert.equal((await db.query("SELECT to_regclass('public.pos_business_admin_audit') table_name")).rows[0].table_name, null);
    assert.deepEqual((await db.query('SELECT * FROM legacy_fixture')).rows, [{ id: 1, value: 'preserve' }]);
    await db.query(migration('104_suq_shogir_merchant_onboarding.sql'));
  });

  require.cache[require.resolve('../db')] = { id: require.resolve('../db'), filename: require.resolve('../db'), loaded: true, exports: db };
  const { createPosAdminService } = require('../services/posAdminService');
  const { createPosBusinessService } = require('../services/posBusinessService');
  const permissions = async () => ['pos.view', 'pos.config.manage'];
  const admin = createPosAdminService({ db, permissionList: permissions });
  const merchant = createPosBusinessService({ db });

  await test('tenant superadmin provisions a minimal merchant atomically with one-time activation', async () => {
    const body = { request_id: 'synthetic-onboarding-001', ownership: 'INTERNAL', display_name: 'Toko Sintetis',
      legal_name: 'Toko Sintetis Legal', owner_name: 'Pemilik Sintetis', owner_login: 'owner.synthetic', unit_ids: [2, 3] };
    const created = await admin.onboardBusiness(request(body, undefined, { unit_id: 2 }, {}, { 'idempotency-key': body.request_id }));
    assert.equal(created.replay, false); assert.equal(created.activation_required, true); assert.equal(typeof created.activation_code, 'string');
    const counts = (await db.query(`SELECT
      (SELECT count(*)::integer FROM pos_businesses WHERE id=$1) businesses,
      (SELECT count(*)::integer FROM pos_business_units WHERE business_id=$1) units,
      (SELECT count(*)::integer FROM pos_merchant_memberships WHERE business_id=$1 AND role='OWNER') owners,
      (SELECT count(*)::integer FROM pos_business_accounts WHERE business_id=$1) accounts,
      (SELECT count(*)::integer FROM pos_business_terminals WHERE business_id=$1) terminals,
      (SELECT count(*)::integer FROM pos_business_admin_audit WHERE business_id=$1 AND action='MERCHANT_CREATED') audits`, [created.id])).rows[0];
    assert.deepEqual(counts, { businesses: 1, units: 2, owners: 1, accounts: 0, terminals: 0, audits: 1 });
    const token = (await db.query('SELECT token_hash FROM pos_merchant_activation_tokens WHERE business_id=$1', [created.id])).rows[0].token_hash;
    assert.notEqual(token, created.activation_code);
    const activated = await merchant.activate({ body: { login: body.owner_login, activation_code: created.activation_code, password: 'Synthetic-password-1234' } });
    assert.deepEqual(activated, { activated: true });
    await rejects(() => merchant.activate({ body: { login: body.owner_login, activation_code: created.activation_code, password: 'Synthetic-password-5678' } }), 'ACTIVATION_INVALID');
  });

  await test('idempotent replay creates nothing and never repeats the activation secret', async () => {
    const body = { request_id: 'synthetic-onboarding-replay', ownership: 'EXTERNAL', display_name: 'Kantin Sintetis',
      owner_name: 'Owner Replay', owner_login: 'owner.replay', unit_ids: [2] };
    const first = await admin.onboardBusiness(request(body, undefined, { unit_id: 2 }, {}, { 'idempotency-key': body.request_id }));
    const replay = await admin.onboardBusiness(request(body, undefined, { unit_id: 2 }, {}, { 'idempotency-key': body.request_id }));
    assert.equal(replay.id, first.id); assert.equal(replay.replay, true); assert.equal(replay.activation_code, null);
    assert.equal((await db.query('SELECT count(*)::integer count FROM pos_businesses WHERE display_name=$1', [body.display_name])).rows[0].count, 1);
    await rejects(() => admin.onboardBusiness(request({ ...body, display_name: 'Payload Berbeda' }, undefined, { unit_id: 2 }, {}, { 'idempotency-key': body.request_id })), 'IDEMPOTENCY_CONFLICT');
  });

  await test('password assignment, operator access, foreign unit and cross-tenant identity fail closed', async () => {
    const base = { request_id: 'synthetic-onboarding-denied', ownership: 'INTERNAL', display_name: 'Denied',
      owner_name: 'Denied Owner', owner_login: 'denied.owner', unit_ids: [2] };
    await rejects(() => admin.onboardBusiness(request({ ...base, owner_password: 'forbidden' })), 'OWNER_PASSWORD_ASSIGNMENT_FORBIDDEN');
    await rejects(() => admin.onboardBusiness(request(base, { id: 2, tenant_id: 1, role: 'operator' })), 'TENANT_SUPERADMIN_REQUIRED');
    await rejects(() => admin.onboardBusiness(request({ ...base, unit_ids: [4] })), 'UNIT_ACCESS_DENIED');
    const foreignHash = await bcrypt.hash('Synthetic-existing-password', 12);
    await db.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$3,$4)', [pendingOwner, 'foreign.owner', 'Foreign Owner', foreignHash]);
    await db.query("INSERT INTO pos_businesses(id,tenant_id,ownership,display_name,timezone) VALUES($1,2,'EXTERNAL','Foreign Business','Asia/Jakarta')", [pendingBusiness]);
    await db.query("INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,2,$2,'OWNER')", [pendingBusiness, pendingOwner]);
    await rejects(() => admin.onboardBusiness(request({ ...base, request_id: 'synthetic-cross-tenant', owner_login: 'foreign.owner', owner_name: 'Foreign Owner' })), 'OWNER_IDENTITY_CONFLICT');
  });

  await test('existing activated same-tenant owner is reused without password or activation reset', async () => {
    const oldHash = await bcrypt.hash('Existing-password-1234', 12);
    await db.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$3,$4)', [existingOwner, 'existing.owner', 'Existing Owner', oldHash]);
    await db.query("INSERT INTO pos_businesses(id,tenant_id,ownership,display_name,timezone) VALUES($1,1,'INTERNAL','Existing Business','Asia/Jakarta')", [existingBusiness]);
    await db.query("INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,1,$2,'OWNER')", [existingBusiness, existingOwner]);
    const result = await admin.onboardBusiness(request({ request_id: 'synthetic-existing-owner', ownership: 'EXTERNAL', display_name: 'Second Business',
      owner_name: 'Existing Owner', owner_login: 'existing.owner', unit_ids: [2] }));
    assert.equal(result.owner_id, existingOwner); assert.equal(result.activation_required, false); assert.equal(result.activation_code, null);
    assert.equal((await db.query('SELECT password_hash FROM pos_merchant_users WHERE id=$1', [existingOwner])).rows[0].password_hash, oldHash);
  });

  await test('admin projections remain privacy-safe and audit status/config changes', async () => {
    const list = await admin.businessesV2(request({}, undefined, { unit_id: 2 }));
    assert(list.rows.length >= 3); assert(!/gross_profit|wallet_volume|capital|prive|supplier|payable/.test(JSON.stringify(list.rows)));
    const id = list.rows[0].id;
    const detail = await admin.businessDetail(request({}, undefined, { unit_id: 2 }, { id }));
    assert(!/gross_profit|wallet_volume|capital|prive|supplier|payable/.test(JSON.stringify(detail.business)));
    await admin.editBusinessV2(request({ active: false, integration_enabled: false, wallet_enabled: false, storefront_enabled: false }, undefined, { unit_id: 2 }, { id }));
    assert.equal((await db.query('SELECT active FROM pos_businesses WHERE id=$1', [id])).rows[0].active, false);
    assert.equal((await db.query("SELECT count(*)::integer count FROM pos_business_admin_audit WHERE business_id=$1 AND action='MERCHANT_STATUS_CHANGED'", [id])).rows[0].count, 1);
  });

  console.log(`Suq Shogir onboarding PostgreSQL: ${passed} test groups PASS`);
}

main().catch(error => {
  console.error('Suq Shogir onboarding test FAIL', { code: error.code, message: error.message, stack: error.stack });
  process.exitCode = 1;
}).finally(async () => { if (db) await db.end(); });
