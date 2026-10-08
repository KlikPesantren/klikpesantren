// Destructive fixture reset ONLY at a literal guarded localhost test target.
// Does not import db/.env; never reads production credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const express = require('express');
const { createPosBusinessService } = require('../services/posBusinessService');
const { createPosBusinessRouter } = require('../routes/posBusinessRoutes');
const options = { host: '127.0.0.1', port: 55439, user: 'pos_test_owner', database: 'pos_business_v2_test', max: 12 };
const db = new Pool(options);
const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
const [business, external, foreign, owner, cashier, supervisor, otherOwner] = ids;
const password = 'Synthetic-only-V2-password';
let passed = 0, server, ownerToken, cashierToken, supervisorToken, product, supplier, account, bank, purchase, customer, shift, creditSale;
const test = async (name, work) => { await work(); passed++; console.log('PASS ' + name); };
const rejects = (work, code) => assert.rejects(work, e => e.code === code);
const query = async (sql, values = []) => (await db.query(sql, values)).rows;
const req = (body = {}, token = ownerToken, target = business) => ({ headers: { authorization: 'Bearer ' + token }, params: { businessId: target }, body, query: {} });
const key = () => 'synthetic-' + crypto.randomUUID();
const money = (kind, value, extra = {}) => core.money(req({ kind, account_id: account, amount: value, reason: 'Synthetic audited fixture', request_id: key(), ...extra }));
const core = createPosBusinessService({ db });
async function fingerprint() {
  return (await query(`SELECT (SELECT count(*) FROM pos_business_operations)::text ops,
    (SELECT count(*) FROM pos_inventory_movements)::text stock,
    (SELECT count(*) FROM pos_inventory_allocations)::text allocations,
    (SELECT coalesce(sum(amount),0) FROM pos_money_movements)::text money,
    (SELECT coalesce(sum(amount),0) FROM pos_debt_movements)::text debt`))[0];
}
async function setup() {
  const admin = new Pool({ ...options, database: 'postgres' });
  try {
    const i = (await admin.query('SELECT current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
    assert.deepEqual(i, { current_user: options.user, host: options.host, port: options.port });
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [options.database])).rowCount) await admin.query('CREATE DATABASE pos_business_v2_test');
  } finally { await admin.end(); }
  const i = (await query('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port'))[0];
  assert.deepEqual(i, { db: options.database, current_user: options.user, host: options.host, port: options.port });
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.query(`CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL);
    CREATE TABLE unit_pendidikan(id integer PRIMARY KEY,tenant_id integer REFERENCES tenants(id),kode text,nama text,unit_type text,preset_key text,is_active boolean NOT NULL DEFAULT true,sort_order integer NOT NULL DEFAULT 0,UNIQUE(id,tenant_id));
    CREATE TABLE users(id integer PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),nama text,role text,status text);
    CREATE TABLE legacy_fixture(id integer PRIMARY KEY,value text); INSERT INTO legacy_fixture VALUES(1,'preserve');
    INSERT INTO tenants VALUES(1,'active'),(2,'active');
    INSERT INTO unit_pendidikan(id,tenant_id,kode,nama,unit_type,preset_key,sort_order) VALUES(2,1,'U2','Unit 2','pesantren','pesantren',1),(3,1,'U3','Unit 3','sekolah','sekolah',2),(4,2,'U4','Unit 4','pesantren','pesantren',1);
    INSERT INTO users VALUES(99,1,'Synthetic Tenant Admin','superadmin','active'),(100,2,'Foreign Admin','superadmin','active');`);
  const up = fs.readFileSync(path.join(__dirname, '../migrations/097_pos_business_core_v2.sql'), 'utf8');
  const down = fs.readFileSync(path.join(__dirname, '../migrations/097_pos_business_core_v2_rollback.sql'), 'utf8');
  await test('097 UP/DOWN/second UP: only introduced schema removed, legacy preserved', async () => {
    await db.query(up); await db.query(down);
    assert.equal((await query("SELECT to_regclass('pos_businesses') value"))[0].value, null);
    assert.deepEqual(await query('SELECT * FROM legacy_fixture'), [{ id: 1, value: 'preserve' }]);
    assert.equal((await query('SELECT count(*) count FROM tenants'))[0].count, '2');
    await db.query(up);
  });
  await db.query(fs.readFileSync(path.join(__dirname, '../migrations/102_pos_online_product_pricing.sql'), 'utf8'));
  const pHash = await bcrypt.hash(password, 12);
  for (const [id, login] of [[owner, 'owner'], [cashier, 'cashier'], [supervisor, 'supervisor'], [otherOwner, 'other-owner']])
    await db.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$2,$3)', [id, login, pHash]);
  for (const [id, tenant, ownership] of [[business, 1, 'INTERNAL'], [external, 1, 'EXTERNAL'], [foreign, 2, 'EXTERNAL']])
    await db.query(`INSERT INTO pos_businesses(id,tenant_id,ownership,display_name,timezone) VALUES($1,$2,$3,'Synthetic Merchant','Asia/Jakarta')`, [id, tenant, ownership]);
  for (const [biz, tenant, user, role, perms] of [[business, 1, owner, 'OWNER', []], [business, 1, cashier, 'CASHIER', []],
    [business, 1, supervisor, 'SUPERVISOR', ['purchases.post']], [external, 1, otherOwner, 'OWNER', []], [foreign, 2, otherOwner, 'OWNER', []]])
    await db.query('INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role,permissions) VALUES($1,$2,$3,$4,$5)', [biz, tenant, user, role, perms]);
  ownerToken = (await core.login({ body: { login: 'owner', password } })).token;
  cashierToken = (await core.login({ body: { login: 'cashier', password } })).token;
  supervisorToken = (await core.login({ body: { login: 'supervisor', password } })).token;
}
async function main() {
  await setup();
  await test('owner profile; merchant session hashes only; no password/token leaks in context', async () => {
    const c = await core.context(req()); assert.equal(c.role, 'OWNER');
    assert.ok(!JSON.stringify(c).includes('password')); assert.ok(!JSON.stringify(c).includes(ownerToken));
    assert.equal((await query('SELECT token_hash FROM pos_merchant_sessions')).some(s => s.token_hash === ownerToken), false);
  });
  await test('Admin token/non-member/cross-tenant/external-private-book access denied', async () => {
    await rejects(() => core.books(req({}, 'tenant-admin-token')), 'MERCHANT_AUTH_REQUIRED');
    await rejects(() => core.books(req({}, ownerToken, foreign)), 'MERCHANT_ACCESS_DENIED');
    await rejects(() => core.books(req({}, ownerToken, external)), 'MERCHANT_ACCESS_DENIED');
    await rejects(() => core.books(req({ tenant_id: 2 })), 'CLIENT_AUTHORITY_REJECTED');
  });
  await test('cashier cannot read HPP/AP/money/private books or manage user roles', async () => {
    await rejects(() => core.books(req({}, cashierToken)), 'MERCHANT_PERMISSION_DENIED');
    await rejects(() => core.account(req({ kind: 'CASH', name: 'spoof' }, cashierToken)), 'MERCHANT_PERMISSION_DENIED');
    await rejects(() => core.member(req({ role: 'OWNER' }, cashierToken)), 'MERCHANT_PERMISSION_DENIED');
  });
  await test('supervisor explicit subset; no implied owner escalation', async () => {
    assert.equal((await core.context(req({}, supervisorToken))).role, 'SUPERVISOR');
    await rejects(() => core.books(req({}, supervisorToken)), 'MERCHANT_PERMISSION_DENIED');
    await db.query("UPDATE pos_merchant_memberships SET permissions=ARRAY['users.manage'] WHERE business_id=$1 AND user_id=$2", [business, supervisor]);
    await rejects(() => core.member(req({ role: 'OWNER' }, supervisorToken)), 'OWNER_REQUIRED');
  });
  await test('single user may hold independent authorized merchant memberships', async () => {
    const token = (await core.login({ body: { login: 'other-owner', password } })).token;
    assert.equal((await core.context(req({}, token, external))).business.id, external);
    assert.equal((await core.context(req({}, token, foreign))).business.id, foreign);
  });
  await test('disabled user/membership/business rejects session immediately', async () => {
    await db.query('UPDATE pos_merchant_users SET active=false WHERE id=$1', [cashier]);
    await rejects(() => core.context(req({}, cashierToken)), 'MERCHANT_SESSION_INVALID');
    await db.query('UPDATE pos_merchant_users SET active=true WHERE id=$1', [cashier]);
    await db.query('UPDATE pos_merchant_memberships SET active=false WHERE user_id=$1 AND business_id=$2', [cashier, business]);
    await rejects(() => core.context(req({}, cashierToken)), 'MERCHANT_ACCESS_DENIED');
    await db.query('UPDATE pos_merchant_memberships SET active=true WHERE user_id=$1', [cashier]);
    await db.query('UPDATE pos_businesses SET active=false WHERE id=$1', [business]);
    await rejects(() => core.context(req()), 'MERCHANT_ACCESS_DENIED');
    await db.query('UPDATE pos_businesses SET active=true WHERE id=$1', [business]);
  });
  await test('product/account/supplier/customer masters without santri copy', async () => {
    product = (await core.product(req({ sku: 'SYN-01', name: 'Synthetic noodles', selling_price: '4000', minimum_stock: 10 }))).id;
    account = (await core.account(req({ name: 'Drawer funding account', kind: 'CASH' }))).id;
    bank = (await core.account(req({ name: 'Synthetic bank', kind: 'BANK' }))).id;
    supplier = (await core.party(req({ kind: 'SUPPLIER', name: 'Synthetic supplier' }))).id;
    const customerRow = await core.party(req({ kind: 'CUSTOMER', name: 'Synthetic registered customer', credit_allowed: true, credit_limit: 10000 }));
    customer = customerRow.id; assert.equal(customerRow.kind, 'CUSTOMER');
    const cat = await core.catalog(req({}, cashierToken));
    assert.equal(cat[0].on_hand, '0'); assert.ok(!JSON.stringify(cat).includes('unit_cost'));
  });
  await test('integer Rupiah only; malformed/fractional/unsafe numeric input rejected', async () => {
    for (const value of [0.1, -1, '1.5', '01', Number.MAX_SAFE_INTEGER + 1])
      await rejects(() => core.money(req({ kind: 'CAPITAL', account_id: account, amount: value, reason: 'fixture', request_id: key() })), 'INVALID_INTEGER');
  });
  await test('capital/opening ledger not sale; no mutation of legacy table', async () => {
    await money('CAPITAL', 1000000);
    assert.equal((await core.books(req())).accounts.find(a => a.id === account).balance, '1000000');
    assert.equal((await query("SELECT count(*) count FROM pos_business_operations WHERE kind='SALE'"))[0].count, '0');
    assert.deepEqual(await query('SELECT * FROM legacy_fixture'), [{ id: 1, value: 'preserve' }]);
  });
  await test('credit purchase 100 x 2500 -> stock +100, AP 250000, cash unchanged', async () => {
    const b = { items: [{ product_id: product, quantity: 100, unit_cost: 2500 }], supplier_id: supplier, paid: 0, due_date: '2026-11-01', request_id: key() };
    purchase = await core.purchase(req(b)); assert.equal(purchase.payable, '250000');
    const books = await core.books(req()); assert.equal(books.stock[0].on_hand, '100');
    assert.equal(books.debts[0].outstanding, '250000'); assert.equal(books.accounts.find(a => a.id === account).balance, '1000000');
    assert.equal((await core.purchase(req(b))).replay, true);
    await rejects(() => core.purchase(req({ ...b, paid: 1, account_id: account })), 'IDEMPOTENCY_CONFLICT');
  });
  await test('AP partial payment/retry does not create purchase twice', async () => {
    const b = { kind: 'AP', source_id: purchase.id, account_id: account, amount: 50000, request_id: key() };
    assert.equal((await core.payDebt(req(b))).remaining, '200000');
    assert.equal((await core.payDebt(req(b))).replay, true);
    assert.equal((await query("SELECT count(*) count FROM pos_business_operations WHERE kind='PURCHASE'"))[0].count, '1');
    assert.equal((await core.books(req())).accounts.find(a => a.id === account).balance, '950000');
  });
  await test('AP concurrent overpay: one payment only and Rp0 reconciliation', async () => {
    const results = await Promise.allSettled([1, 2].map(() => core.payDebt(req({ kind: 'AP', source_id: purchase.id, account_id: account, amount: 150000, request_id: key() }))));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'DEBT_OVERPAYMENT');
    assert.equal((await core.books(req())).debts[0].outstanding, '50000');
  });
  await test('purchase paid/partial server totals snapshot and currency legs reconcile', async () => {
    const p = await core.purchase(req({ items: [{ product_id: product, quantity: 10, unit_cost: 3000 }], supplier_id: supplier, paid: 10000, account_id: bank, due_date: '2026-11-01', request_id: key() })).catch(e => e);
    assert.equal(p.code, 'INSUFFICIENT_BUSINESS_FUNDS');
    await money('TRANSFER', 100000, { destination_account_id: bank });
    const out = await core.purchase(req({ items: [{ product_id: product, quantity: 10, unit_cost: 3000 }], supplier_id: supplier, paid: 10000, account_id: bank, due_date: '2026-11-01', request_id: key() }));
    assert.equal(out.total, '30000'); assert.equal(out.payable, '20000');
  });
  await test('FIFO adjustment consumes original exact cost; no stock overwrite', async () => {
    await core.adjustment(req({ direction: 'OUT', product_id: product, quantity: 105, reason: 'Synthetic stock count correction', request_id: key() }));
    assert.equal((await core.books(req())).stock[0].on_hand, '5');
    assert.equal((await query("SELECT cost FROM pos_inventory_movements WHERE kind='ADJUSTMENT_OUT'"))[0].cost, '265000');
  });
  await test('concurrent inventory depletion cannot oversell; one succeeds', async () => {
    const results = await Promise.allSettled([1, 2].map(() => core.adjustment(req({ direction: 'DAMAGE', product_id: product, quantity: 4, reason: 'Synthetic damage', request_id: key() }))));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'INSUFFICIENT_STOCK');
    assert.equal((await core.books(req())).stock[0].on_hand, '1');
  });
  await test('concurrent identical purchase creates one operation/movement', async () => {
    const b = { items: [{ product_id: product, quantity: 2, unit_cost: 3200 }], supplier_id: supplier, paid: 0, due_date: '2026-11-02', request_id: key() };
    const [a, z] = await Promise.all([core.purchase(req(b)), core.purchase(req(b))]);
    assert.equal(a.id, z.id); assert.equal(Number(a.replay) + Number(z.replay), 1);
  });
  await test('forced failure after stock rolls back operation, stock, money, debt', async () => {
    const before = await fingerprint();
    const failing = createPosBusinessService({ db, afterStage: async stage => { if (stage === 'stock') throw Object.assign(new Error('fixture'), { code: 'FORCED_TEST' }); } });
    await rejects(() => failing.purchase(req({ items: [{ product_id: product, quantity: 1, unit_cost: 1234 }], supplier_id: supplier, paid: 0, due_date: '2026-11-01', request_id: key() })), 'FORCED_TEST');
    assert.deepEqual(await fingerprint(), before);
  });
  await test('expense vs withdrawal vs capital classification retained; transfer net zero', async () => {
    await money('EXPENSE', 10000); await money('WITHDRAWAL', 5000); await money('OTHER_INCOME', 7000);
    const rows = await query("SELECT kind,sum(total) amount FROM pos_business_operations WHERE kind IN('CAPITAL','WITHDRAWAL','EXPENSE','OTHER_INCOME') GROUP BY kind");
    assert.equal(rows.find(r => r.kind === 'EXPENSE').amount, '10000');
    assert.equal(rows.find(r => r.kind === 'WITHDRAWAL').amount, '5000');
    assert.equal((await query("SELECT sum(m.amount) amount FROM pos_money_movements m JOIN pos_business_operations o ON o.id=m.operation_id WHERE o.kind='TRANSFER'"))[0].amount, '0');
  });
  await test('posted operation/stock/money cannot UPDATE; DB catches missing ledger leg', async () => {
    await rejects(() => db.query('UPDATE pos_business_operations SET total=total+1 WHERE id=$1', [purchase.id]), '23514');
    await rejects(() => db.query('UPDATE pos_inventory_movements SET quantity=quantity+1'), '23514');
    await rejects(() => db.query('UPDATE pos_money_movements SET amount=amount+1'), '23514');
    await rejects(() => db.query(`INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid)
      VALUES($1,$2,$3,'CAPITAL',$4,$5,1,1)`, [crypto.randomUUID(), business, owner, key(), '0'.repeat(64)]), '23514');
  });
  await test('cross-business composite FK rejects wrong product/party/member ownership', async () => {
    await rejects(() => db.query('INSERT INTO pos_business_units(business_id,tenant_id,unit_id) VALUES($1,1,4)', [business]), '23503');
    await rejects(() => db.query('INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,1,$2,$3)', [foreign, cashier, 'OWNER']), '23503');
    const otherToken = (await core.login({ body: { login: 'other-owner', password } })).token;
    await rejects(() => core.purchase(req({ items: [{ product_id: product, quantity: 1, unit_cost: 1 }], supplier_id: supplier, paid: 0, due_date: '2026-11-01', request_id: key() }, otherToken, external)), 'SUPPLIER_DENIED');
  });
  await test('HTTP real router: no auth 401, cashier private report 403, owner 200, no-store', async () => {
    const app = express(); app.use('/business', createPosBusinessRouter({ db }));
    server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    const url = 'http://127.0.0.1:' + server.address().port + '/business/' + business + '/books';
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { authorization: 'Bearer ' + cashierToken } })).status, 403);
    const response = await fetch(url, { headers: { authorization: 'Bearer ' + ownerToken } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  });
  await test('failed login throttle persists; logout invalidates token', async () => {
    for (let i = 0; i < 10; i++) await rejects(() => core.login({ body: { login: 'missing', password } }), 'INVALID_CREDENTIALS');
    await rejects(() => core.login({ body: { login: 'missing', password } }), 'LOGIN_RATE_LIMITED');
    await core.logout(req({}, supervisorToken)); await rejects(() => core.context(req({}, supervisorToken)), 'MERCHANT_SESSION_INVALID');
  });
  await test('all stock layers/ledger and purchase/debt/money reconcile Rp0', async () => {
    assert.equal((await query(`SELECT count(*) n FROM (SELECT product_id,sum(quantity) qty FROM pos_inventory_movements GROUP BY product_id)s
      JOIN(SELECT l.product_id,sum(l.received_quantity-coalesce(a.used,0)) qty FROM pos_inventory_layers l LEFT JOIN
      (SELECT layer_id,sum(quantity) used FROM pos_inventory_allocations GROUP BY layer_id)a ON a.layer_id=l.id GROUP BY l.product_id)v USING(product_id) WHERE s.qty<>v.qty`))[0].n, '0');
    assert.equal((await query(`SELECT count(*) n FROM pos_business_operations o WHERE o.kind='PURCHASE' AND o.total-o.paid<>(SELECT coalesce(sum(amount),0) FROM pos_debt_movements WHERE operation_id=o.id)`))[0].n, '0');
  });
  await test('own shift locks a business terminal and physical CASH account', async () => {
    const t = await core.terminal(req({ name: 'Synthetic cashier terminal' }));
    shift = await core.openShift(req({ terminal_id: t.id, cash_account_id: account, opening_cash: 100 }));
    await rejects(() => core.openShift(req({ terminal_id: t.id, cash_account_id: account, opening_cash: 100 })), '23505');
    await rejects(() => core.closeShift(req({ shift_id: shift.id, actual_cash: 100 }, cashierToken)), 'SHIFT_DENIED');
  });
  await test('cash sale uses server price/FIFO and persists branded receipt snapshot', async () => {
    const b = { shift_id: shift.id, items: [{ product_id: product, quantity: 2, price: 1 }], total: 2,
      payments: [{ method: 'CASH', account_id: account, amount: 8000, tendered: 10000 }], request_id: key() };
    const sale = await core.sale(req(b)); assert.equal(sale.sale.total, '8000');
    assert.equal(sale.payments[0].change, '2000'); assert.equal((await core.sale(req(b))).replay, true);
    assert.equal((await query('SELECT sum(cogs) cogs FROM pos_business_lines WHERE operation_id=$1', [sale.sale.id]))[0].cogs, '6200');
    await db.query("UPDATE pos_businesses SET display_name='Changed profile, not history' WHERE id=$1", [business]);
    const receipt = await core.receipt({ ...req(), params: { businessId: business, operationId: sale.sale.id } });
    assert.equal(receipt.sale.receipt_snapshot.name, 'Synthetic Merchant');
    assert.ok(!Object.hasOwn(receipt.items[0], 'cogs'));
  });
  await test('restock and registered customer credit; anonymous credit rejected', async () => {
    await core.purchase(req({ items: [{ product_id: product, quantity: 100, unit_cost: 2000 }], supplier_id: supplier,
      paid: 0, due_date: '2026-11-01', request_id: key() }));
    const b = { shift_id: shift.id, items: [{ product_id: product, quantity: 1 }], payments: [{ method: 'CREDIT', amount: 4000 }],
      due_date: '2026-11-01', request_id: key() };
    const before = await fingerprint();
    await rejects(() => core.sale(req(b)), 'REGISTERED_CREDIT_CUSTOMER_REQUIRED');
    assert.deepEqual(await fingerprint(), before);
    creditSale = await core.sale(req({ ...b, customer_id: customer })); assert.equal(creditSale.sale.paid, '0');
  });
  await test('credit limit/inactive/not-credit-enabled customer rejected server-side', async () => {
    const b = { customer_id: customer, shift_id: shift.id, items: [{ product_id: product, quantity: 2 }],
      payments: [{ method: 'CREDIT', amount: 8000 }], due_date: '2026-11-01', request_id: key() };
    await rejects(() => core.sale(req(b)), 'CREDIT_LIMIT_DENIED');
    await db.query('UPDATE pos_business_parties SET active=false WHERE id=$1', [customer]);
    await rejects(() => core.sale(req({ ...b, request_id: key() })), 'CUSTOMER_DENIED');
    await db.query('UPDATE pos_business_parties SET active=true,credit_allowed=false WHERE id=$1', [customer]);
    await rejects(() => core.sale(req({ ...b, request_id: key() })), 'CREDIT_LIMIT_DENIED');
    await db.query('UPDATE pos_business_parties SET credit_allowed=true WHERE id=$1', [customer]);
  });
  await test('AR partial collection retries without a new sale; exact outstanding', async () => {
    const beforeCount = (await query("SELECT count(*) count FROM pos_business_operations WHERE kind='SALE'"))[0].count;
    const b = { kind: 'AR', source_id: creditSale.sale.id, account_id: bank, amount: 1000, request_id: key() };
    assert.equal((await core.payDebt(req(b))).remaining, '3000'); assert.equal((await core.payDebt(req(b))).replay, true);
    assert.equal((await query("SELECT count(*) count FROM pos_business_operations WHERE kind='SALE'"))[0].count, beforeCount);
  });
  await test('split CASH + CREDIT reconciles exact sale and two payment components', async () => {
    const b = { customer_id: customer, shift_id: shift.id, items: [{ product_id: product, quantity: 1 }],
      payments: [{ method: 'CASH', account_id: account, amount: 1000, tendered: 1000 }, { method: 'CREDIT', amount: 3000 }],
      due_date: '2026-11-01', request_id: key() };
    const s = await core.sale(req(b)); assert.equal(s.sale.total, '4000'); assert.equal(s.sale.paid, '1000'); assert.equal(s.payments.length, 2);
    await rejects(() => core.sale(req({ ...b, payments: [{ method: 'CASH', account_id: account, amount: 1001, tendered: 1001 }, { method: 'CREDIT', amount: 3000 }], request_id: key() })), 'PAYMENT_TOTAL_MISMATCH');
  });
  await test('manual bank payment requires evidence; non-CASH does not enter drawer', async () => {
    const b = { shift_id: shift.id, items: [{ product_id: product, quantity: 1 }],
      payments: [{ method: 'BANK', account_id: bank, amount: 4000, reference: 'Synthetic reviewed evidence' }], request_id: key() };
    const s = await core.sale(req(b)); assert.equal(s.payments[0].method, 'BANK');
    await rejects(() => core.sale(req({ ...b, payments: [{ ...b.payments[0], reference: '' }], request_id: key() })), 'INVALID_TEXT');
  });
  await test('failed sale after stock rolls back all financial/stock legs', async () => {
    const before = await fingerprint();
    const failing = createPosBusinessService({ db, afterStage: async stage => { if (stage === 'money') throw Object.assign(new Error('fixture'), { code: 'FORCED_TEST' }); } });
    await rejects(() => failing.sale(req({ shift_id: shift.id, items: [{ product_id: product, quantity: 1 }],
      payments: [{ method: 'CASH', account_id: account, amount: 4000, tendered: 4000 }], request_id: key() })), 'FORCED_TEST');
    assert.deepEqual(await fingerprint(), before);
  });
  await test('concurrent duplicate sale creates one stock/financial operation', async () => {
    const b = { shift_id: shift.id, items: [{ product_id: product, quantity: 1 }],
      payments: [{ method: 'CASH', account_id: account, amount: 4000, tendered: 4000 }], request_id: key() };
    const [one, two] = await Promise.all([core.sale(req(b)), core.sale(req(b))]);
    assert.equal(one.sale.id, two.sale.id); assert.equal(Number(one.replay) + Number(two.replay), 1);
  });
  await test('report uses classified income/expense, excludes capital/prive from operating result', async () => {
    const result = await core.report({ ...req(), query: { from: '2020-01-01', to: '2099-12-31' } });
    assert.equal(result.kpi.sales, '24000');
    assert.equal(result.kpi.operating_result, (BigInt(result.kpi.sales) - BigInt(result.kpi.cogs) + 7000n - 10000n).toString());
    assert.equal(result.kpi.capital, '1000000'); assert.equal(result.kpi.withdrawals, '5000');
    await rejects(() => core.report({ ...req({}, cashierToken), query: { from: '2020-01-01', to: '2099-12-31' } }), 'MERCHANT_PERMISSION_DENIED');
  });
  await test('shift close physical cash excludes bank/AR/credit; immutable and idempotent', async () => {
    const closed = await core.closeShift(req({ shift_id: shift.id, actual_cash: 13100 }));
    assert.equal(closed.expected_cash, '13100'); assert.equal(closed.difference, '0');
    assert.equal((await core.closeShift(req({ shift_id: shift.id, actual_cash: 13100 }))).replay, true);
    await rejects(() => core.closeShift(req({ shift_id: shift.id, actual_cash: 0 })), 'SHIFT_ALREADY_CLOSED');
    await rejects(() => db.query('UPDATE pos_business_shifts SET opening_cash=1 WHERE id=$1', [shift.id]), '23514');
  });
  await test('sale/payment/AR/stock exact reconciliation Rp0', async () => {
    assert.equal((await query(`SELECT count(*) n FROM pos_business_operations o WHERE kind='SALE' AND
      (o.total<>(SELECT sum(amount) FROM pos_business_payments WHERE operation_id=o.id)
      OR o.total<>(SELECT sum(total) FROM pos_business_lines WHERE operation_id=o.id)
      OR o.total-o.paid<>(SELECT coalesce(sum(amount),0) FROM pos_debt_movements WHERE operation_id=o.id))`))[0].n, '0');
  });
  await test('asset URL safety reused: no credential/private/signed-secret URL', async () => {
    for (const image_url of ['https://user:fake@example.org/a.png', 'https://localhost/a.png', 'https://example.org/a.png?token=fake'])
      await rejects(() => core.product(req({ sku: key(), name: 'fixture', selling_price: 1, image_url })), 'INVALID_PRODUCT_IMAGE');
  });
  await test('exact runtime operation grants: real auth/purchase/sale/shift; no history DELETE/UPDATE or DDL', async () => {
    await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pos_business_v2_fixture_runtime') THEN
      CREATE ROLE pos_business_v2_fixture_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;
      GRANT CONNECT ON DATABASE pos_business_v2_test TO pos_business_v2_fixture_runtime;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO pos_business_v2_fixture_runtime;
      GRANT SELECT ON tenants,pos_businesses,pos_business_units,pos_merchant_users,pos_merchant_memberships,pos_merchant_sessions,
       pos_merchant_login_limits,pos_business_products,pos_business_parties,pos_business_accounts,pos_business_operations,
       pos_business_lines,pos_business_payments,pos_inventory_movements,pos_inventory_layers,pos_inventory_allocations,
       pos_money_movements,pos_debt_movements,pos_business_terminals,pos_business_shifts TO pos_business_v2_fixture_runtime;
      GRANT INSERT ON pos_merchant_users,pos_merchant_memberships,pos_merchant_sessions,pos_merchant_login_limits,
       pos_business_products,pos_business_parties,pos_business_accounts,pos_business_operations,pos_business_lines,
       pos_business_payments,pos_inventory_movements,pos_inventory_layers,pos_inventory_allocations,pos_money_movements,
       pos_debt_movements,pos_business_terminals,pos_business_shifts TO pos_business_v2_fixture_runtime;
      GRANT UPDATE(id) ON tenants,pos_businesses,pos_merchant_users,pos_business_products,pos_business_parties,
       pos_business_accounts,pos_business_terminals TO pos_business_v2_fixture_runtime;
      GRANT UPDATE(user_id) ON pos_merchant_memberships TO pos_business_v2_fixture_runtime;
      GRANT UPDATE(token_hash) ON pos_merchant_sessions TO pos_business_v2_fixture_runtime;
      GRANT UPDATE(attempts,started_at) ON pos_merchant_login_limits TO pos_business_v2_fixture_runtime;
      GRANT UPDATE(status,closed_at,actual_cash,expected_cash,difference) ON pos_business_shifts TO pos_business_v2_fixture_runtime;
      GRANT DELETE ON pos_merchant_sessions TO pos_business_v2_fixture_runtime;`);
    const role = (await query("SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='pos_business_v2_fixture_runtime'"))[0];
    assert.ok(Object.values(role).every(v => v === false));
    for (const table of ['pos_business_operations', 'pos_business_lines', 'pos_business_payments', 'pos_inventory_movements',
      'pos_inventory_layers', 'pos_inventory_allocations', 'pos_money_movements', 'pos_debt_movements']) {
      const p = (await query("SELECT has_table_privilege('pos_business_v2_fixture_runtime',$1,'UPDATE') u,has_table_privilege('pos_business_v2_fixture_runtime',$1,'DELETE') d", [table]))[0];
      assert.deepEqual(p, { u: false, d: false });
    }
    const runtime = new Pool({ ...options, user: 'pos_business_v2_fixture_runtime' });
    try {
      const service = createPosBusinessService({ db: runtime });
      const token = (await service.login({ body: { login: 'owner', password } })).token;
      const t = await service.terminal(req({ name: 'Runtime fixture' }, token));
      const s = await service.openShift(req({ terminal_id: t.id, cash_account_id: account, opening_cash: 0 }, token));
      await service.purchase(req({ items: [{ product_id: product, quantity: 1, unit_cost: 3000 }], supplier_id: supplier,
        paid: 0, due_date: '2026-11-01', request_id: key() }, token));
      const posted = await service.sale(req({ shift_id: s.id, items: [{ product_id: product, quantity: 1 }],
        payments: [{ method: 'CASH', account_id: account, amount: 4000, tendered: 4000 }], request_id: key() }, token));
      assert.equal(posted.sale.total, '4000');
      assert.equal((await service.closeShift(req({ shift_id: s.id, actual_cash: 4000 }, token))).difference, '0');
      await service.books(req({}, token)); await service.logout(req({}, token));
      await rejects(() => runtime.query('DELETE FROM pos_business_operations'), '42501');
      await rejects(() => runtime.query('UPDATE pos_money_movements SET amount=amount'), '42501');
      await rejects(() => runtime.query('CREATE TABLE forbidden_v2(id integer)'), '42501');
    } finally { await runtime.end(); }
  });
  await test('097 rollback refuses existing financial history, transaction fully preserved', async () => {
    const before = await fingerprint(); const c = await db.connect();
    try {
      await rejects(() => c.query(fs.readFileSync(path.join(__dirname, '../migrations/097_pos_business_core_v2_rollback.sql'), 'utf8')), '23514');
    } finally { await c.query('ROLLBACK'); c.release(); }
    assert.deepEqual(await fingerprint(), before);
  });
  await test('report TODAY/MONTH/YEAR use merchant timezone; invalid/custom range fails closed', async () => {
    for (const period of ['TODAY', 'MONTH', 'YEAR']) {
      const r = await core.report({ ...req(), query: { period } }); assert.ok(r.from <= r.to); assert.equal(r.timezone, 'Asia/Jakarta');
    }
    await rejects(() => core.report({ ...req(), query: { from: '2026-11-30', to: '2026-01-01' } }), 'INVALID_PERIOD');
    await rejects(() => core.report({ ...req(), query: { from: '2026-02-30', to: '2026-12-01' } }), 'INVALID_DUE_DATE');
  });
  console.log(`POS V2 FOUNDATION: ${passed}/${passed} groups PASS; financial/stock reconciliation Rp0. Full V2 product NOT COMPLETE.`);
}
main().catch(e => { console.error('FAIL POS V2 fixture', { code: e.code || 'ASSERTION', message: e.code ? 'Rejected/test failure' : e.message }); process.exitCode = 1; })
  .finally(async () => { if (server) await new Promise(resolve => server.close(resolve)); await db.end(); });
