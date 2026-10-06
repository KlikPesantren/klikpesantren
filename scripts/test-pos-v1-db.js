/* Destructive fixtures ONLY in the explicitly isolated localhost test database.
 * No DATABASE_URL/.env connection fallback, no production secrets or data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');
const { readMigration } = require('../utils/migrationLedger');
const options = {host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_phase1_test',max:12};
process.env.JWT_SECRET='pos-local-test-only-not-a-deployment-secret';
process.env.WALI_JWT_SECRET='pos-local-wali-test-only-not-a-deployment-secret';
process.env.DOTENV_CONFIG_QUIET='true';
let db, server; let passed=0;
async function test(name,work) { await work(); passed++; console.log(`PASS ${name}`); }
async function rejects(work,code) { await assert.rejects(work,e=>e.code===code); }
const baseSql=`
CREATE TABLE tenants(id integer PRIMARY KEY,status text NOT NULL,attendance_timezone text NOT NULL DEFAULT 'Asia/Jakarta');
CREATE TABLE unit_pendidikan(id integer PRIMARY KEY,tenant_id integer REFERENCES tenants(id),is_active boolean DEFAULT true,sort_order integer DEFAULT 0,kode text,nama text,unit_type text,preset_key text,UNIQUE(id,tenant_id));
CREATE TABLE users(id integer PRIMARY KEY,tenant_id integer REFERENCES tenants(id),nama text,username text,role text,status text,token_version integer DEFAULT 0,UNIQUE(id,tenant_id));
CREATE TABLE user_unit_scope(user_id integer,tenant_id integer,unit_id integer,status text);
CREATE TABLE roles(id serial PRIMARY KEY,name text UNIQUE,label text,is_system boolean DEFAULT true);
CREATE TABLE permissions(id serial PRIMARY KEY,key text UNIQUE,label text,grup text);
CREATE TABLE role_permissions(role_id integer REFERENCES roles(id),permission_id integer REFERENCES permissions(id),PRIMARY KEY(role_id,permission_id));
CREATE TABLE tenant_role_overrides(tenant_id integer,role_id integer,has_permission_override boolean);
CREATE TABLE tenant_role_permissions(tenant_id integer,role_id integer,permission_id integer);
CREATE TABLE unit_features(tenant_id integer,unit_id integer,feature_key text,enabled boolean);
CREATE TABLE merchant_rfid(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),unit_id integer,nama_merchant text,status boolean DEFAULT true,location_resolution_status text DEFAULT 'resolved');
CREATE TABLE devices(id serial PRIMARY KEY,tenant_id integer NOT NULL REFERENCES tenants(id),unit_id integer,merchant_id integer,nama_device text,enabled boolean DEFAULT true,attendance_mode text,device_secret_hash text,location_resolution_status text DEFAULT 'resolved');
CREATE TABLE santri(id integer PRIMARY KEY,tenant_id integer REFERENCES tenants(id),nama text,status text,uid_rfid text,saldo bigint DEFAULT 0,created_at timestamptz DEFAULT now(),UNIQUE(id,tenant_id));
CREATE TABLE santri_units(id serial PRIMARY KEY,tenant_id integer,santri_id integer,unit_id integer,status text,left_at date);
CREATE TABLE transaksi_rfid(id integer PRIMARY KEY,tenant_id integer,santri_id integer,trx_type text,nominal bigint,saldo_akhir bigint,location_unit_id integer,merchant_id integer,device_id integer,created_at timestamptz);
CREATE TABLE multi_unit_backfill_review(tenant_id integer,entity_type text,entity_id integer,reason text,detail jsonb,status text,UNIQUE(tenant_id,entity_type,entity_id,reason));
INSERT INTO tenants(id,status) VALUES(1,'active'),(2,'active');
INSERT INTO unit_pendidikan(id,tenant_id,preset_key) VALUES(2,1,'PESANTREN'),(3,1,'SMP'),(4,2,'PESANTREN');
INSERT INTO roles(name) VALUES('superadmin'),('cashier'),('denied');
`;

async function setup() {
  const admin=new Pool({...options,database:'postgres'});
  try {
    const identity=(await admin.query('SELECT current_user,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
    assert.equal(identity.current_user,'pos_test_owner'); assert.equal(identity.host,'127.0.0.1'); assert.equal(identity.port,55439);
    if (!(await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[options.database])).rowCount) await admin.query('CREATE DATABASE pos_phase1_test');
  } finally { await admin.end(); }
  db=new Pool(options);
  const identity=(await db.query('SELECT current_database() AS db,current_user,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
  assert.deepEqual(identity,{db:options.database,current_user:options.user,host:options.host,port:options.port});
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.query(baseSql);
  // Existing Wallet DDL is exercised from source with empty legacy fixtures.
  for (const file of ['078_wallet_ledger_core.sql','079_wallet_per_unit.sql','094_pos_v1_foundation.sql']) await db.query(readMigration(file).sql);
  // UP -> DOWN -> UP before any POS history; assert legacy schema/data intact.
  const before=(await db.query(`SELECT (SELECT count(*) FROM wallet_accounts)::text AS accounts,(SELECT count(*) FROM tenants)::text AS tenants`)).rows[0];
  await db.query(fs.readFileSync(path.join(__dirname,'../migrations/094_pos_v1_foundation_rollback.sql'),'utf8'));
  assert.equal((await db.query(`SELECT to_regclass('public.pos_sales') AS pos`)).rows[0].pos,null);
  assert.deepEqual((await db.query(`SELECT (SELECT count(*) FROM wallet_accounts)::text AS accounts,(SELECT count(*) FROM tenants)::text AS tenants`)).rows[0],before);
  await db.query(readMigration('094_pos_v1_foundation.sql').sql);
  await db.query(readMigration('096_pos_product_image_url.sql').sql);
  console.log('PASS isolated migration UP/DOWN/second UP, legacy baseline preserved');
  require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:db};
  const rbac=require('../middleware/requirePermission');
  await db.query(`INSERT INTO role_permissions SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.name='cashier' AND p.key IN('pos.view','pos.sell','pos.shifts.manage','pos.refund','pos.discount') ON CONFLICT DO NOTHING`);
  rbac.invalidateCache();
  await db.query(`INSERT INTO users(id,tenant_id,nama,username,role,status) VALUES
    (1,1,'Synthetic Admin','admin','superadmin','active'),(2,1,'Synthetic Cashier A','cashier-a','cashier','active'),
    (3,1,'Synthetic Cashier B','cashier-b','cashier','active'),(4,2,'Synthetic Other Tenant','other','cashier','active'),
    (5,1,'Synthetic Denied','denied','denied','active'),(6,1,'Synthetic Unassigned','unassigned','cashier','active');
    INSERT INTO user_unit_scope VALUES(2,1,2,'active'),(3,1,2,'active'),(4,2,4,'active'),(5,1,2,'active'),(6,1,2,'active');
    INSERT INTO merchant_rfid(id,tenant_id,unit_id,nama_merchant) VALUES(1,1,2,'Synthetic Canteen'),(2,1,3,'Synthetic Unit B'),(3,2,4,'Other Tenant'),(4,1,NULL,'Legacy Ambiguous');
    SELECT setval('merchant_rfid_id_seq',(SELECT max(id) FROM merchant_rfid));
    INSERT INTO devices(id,tenant_id,unit_id,merchant_id,nama_device,attendance_mode) VALUES
    (1,1,2,1,'Synthetic POS A',NULL),(2,1,2,1,'Synthetic POS B',NULL),(3,1,3,2,'Unit B',NULL),(4,2,4,3,'Other',NULL),(5,1,2,1,'Frozen Attendance','ATTENDANCE');
    INSERT INTO unit_features VALUES(1,2,'wallet',true),(1,2,'rfid',true),(1,3,'wallet',true),(1,3,'rfid',true);
    INSERT INTO santri(id,tenant_id,nama,status,uid_rfid,saldo) VALUES(1,1,'Synthetic Child','Aktif','0ab102ff',777),(2,2,'Other Child','Aktif','0ab102ff',888);
    INSERT INTO santri_units(tenant_id,santri_id,unit_id,status) VALUES(1,1,2,'active'),(1,1,3,'active'),(2,2,4,'active');
    INSERT INTO wallet_accounts(tenant_id,unit_id,santri_id,current_balance) VALUES(1,2,1,20000),(1,3,1,99000);
    INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,source,idempotency_key)
      SELECT id,tenant_id,unit_id,santri_id,'opening_balance','credit',current_balance,current_balance,'test','synthetic-opening:'||id FROM wallet_accounts;
    `);
}
const req=(body={},userId=2,params={})=>({user:{id:userId,tenant_id:userId===4?2:1,role:userId===1?'superadmin':userId===5?'denied':'cashier'},tenantId:userId===4?2:1,
  body:{unit_id:2,merchant_id:1,terminal_id:userId===3?2:1,...body},params,query:{},headers:{}});
const scalar=async sql=>(await db.query(sql)).rows[0];
async function fingerprints() {
  const counts=await scalar(`SELECT (SELECT count(*) FROM pos_sales)::text AS sales,(SELECT count(*) FROM pos_sale_items)::text AS items,
    (SELECT count(*) FROM pos_payments)::text AS payments,(SELECT count(*) FROM wallet_transactions)::text AS ledger,
    (SELECT coalesce(sum(current_balance),0) FROM wallet_accounts)::text AS balance,(SELECT count(*) FROM pos_refunds)::text AS refunds`);
  return counts;
}

async function main() {
  await setup();
  const {createPosService,credential,integer}=require('../services/posService');
  const {isUnitFeatureEnabled}=require('../services/unitFeatureService');
  const featureEnabled=(tenant,unit,key,c)=>isUnitFeatureEnabled(tenant,unit,key,c,async()=>true);
  const pos=createPosService({db,featureEnabled});
  let shiftA,shiftB,product,category,rfid,cash,qris;
  const cart=(key,extra={})=>req({request_id:key,shift_id:shiftA.id,items:[{product_id:product.id,quantity:1,price:1}],payment:{method:'RFID',credential:'0AB102FF'},...extra});
  await test('integer money/isolated POS credential normalization',async()=>{
    assert.equal(credential(' 0AB102FF '),'0ab102ff'); assert.equal(integer('9223372036854775807','MONEY'),9223372036854775807n);
    assert.throws(()=>integer(1.1,'MONEY')); assert.throws(()=>integer('-1','MONEY')); assert.throws(()=>integer('9223372036854775808','MONEY'));
  });
  await test('additive defaults preserve legacy/Attendance devices',async()=>{
    assert.equal((await scalar('SELECT count(*)::integer AS n FROM devices WHERE pos_enabled')).n,0);
    await rejects(()=>pos.configureMerchant(req({},1,{id:4})),'MERCHANT_SCOPE_DENIED');
    await rejects(()=>pos.configureTerminal(req({},1,{id:5})),'MERCHANT_UNAVAILABLE');
    await pos.configureMerchant(req({},1,{id:1}));
    await rejects(()=>pos.configureTerminal(req({},1,{id:5})),'TERMINAL_SCOPE_DENIED');
    await pos.configureTerminal(req({},1,{id:1})); await pos.configureTerminal(req({},1,{id:2}));
    await pos.assignCashier(req({user_id:2},1,{id:1})); await pos.assignCashier(req({user_id:3},1,{id:1}));
  });
  await test('catalog scope, integer price, category/product composite ownership',async()=>{
    category=await pos.category(req({name:'Synthetic Food'},1));
    product=await pos.product(req({sku:'TEST-1',name:'Synthetic Lunch',price:'15000',category_id:category.id},1));
    await rejects(()=>pos.product(req({unit_id:3,merchant_id:1,sku:'WRONG',name:'No',price:1},1)),'MERCHANT_SCOPE_DENIED');
    await pos.configureMerchant(req({unit_id:3},1,{id:2}));
    await rejects(()=>pos.product(req({unit_id:3,merchant_id:2,sku:'WRONG',name:'No',price:1,category_id:category.id},1)),'23503');
    const list=await pos.catalog({...req({},1),query:{unit_id:2,merchant_id:1}}); assert.equal(list.products.length,1);
  });
  await test('shift open/duplicate and cashier assignment',async()=>{
    shiftA=await pos.openShift(req({opening_cash:'10000'})); shiftB=await pos.openShift(req({opening_cash:0},3));
    await rejects(()=>pos.openShift(req({opening_cash:0})),'SHIFT_ALREADY_OPEN');
    await rejects(()=>pos.openShift(req({},6)),'CASHIER_NOT_ASSIGNED');
  });
  await test('security: no auth/permission, cross tenant/unit, ALL, assignment/terminal',async()=>{
    await rejects(()=>pos.checkout({...cart('auth-none-0001'),user:null}),'UNAUTHENTICATED');
    await rejects(()=>pos.checkout({...cart('auth-denied-01'),user:req({},5).user}),'PERMISSION_DENIED');
    await rejects(()=>pos.checkout({...cart('other-tenant-01'),user:req({},4).user,tenantId:2,body:{...cart('other-tenant-01').body,unit_id:4}}),'MERCHANT_SCOPE_DENIED');
    await rejects(()=>pos.checkout(cart('wrong-unit-001',{unit_id:3})),'UNIT_ACCESS_DENIED');
    await rejects(()=>pos.checkout({...cart('all-unit-00001'),query:{scope:'all'}}),'UNIT_REQUIRED');
    const noUnit=cart('no-unit-00001');delete noUnit.body.unit_id;await rejects(()=>pos.checkout(noUnit),'UNIT_REQUIRED');
    await rejects(()=>pos.checkout({...cart('unassigned-001'),user:req({},6).user}),'CASHIER_NOT_ASSIGNED');
    await rejects(()=>pos.checkout(cart('foreign-terminal',{terminal_id:3})),'TERMINAL_DENIED');
    await db.query('UPDATE devices SET enabled=false WHERE id=1');
    await rejects(()=>pos.checkout(cart('disabled-device')),'TERMINAL_DENIED');
    await db.query('UPDATE devices SET enabled=true WHERE id=1');
    const allowed=await require('../middleware/requirePermission').getPermissionList('cashier',{tenantScoped:true,tenantId:1});
    assert(!allowed.includes('wallet.manage'));assert(!allowed.includes('wallet.topup'));
  });
  await test('RFID feature, unknown/ambiguous, inactive membership, missing/frozen/closed wallet',async()=>{
    const original=await fingerprints();
    await rejects(()=>pos.checkout(cart('unknown-rfid-01',{payment:{method:'RFID',credential:'f00d00'}})),'UNKNOWN_CREDENTIAL');
    await db.query(`INSERT INTO santri(id,tenant_id,nama,status,uid_rfid) VALUES(3,1,'Synthetic Ambiguous','Aktif','0AB102FF')`);
    await rejects(()=>pos.checkout(cart('ambiguous-0001')),'AMBIGUOUS_CREDENTIAL');
    await db.query('DELETE FROM santri WHERE id=3');
    await db.query(`UPDATE santri_units SET status='inactive' WHERE unit_id=2`);
    await rejects(()=>pos.checkout(cart('inactive-00001')),'MEMBERSHIP_INACTIVE');
    await db.query(`UPDATE santri_units SET status='active',left_at=current_date WHERE unit_id=2`);
    await rejects(()=>pos.checkout(cart('exited-0000001')),'MEMBERSHIP_INACTIVE');
    await db.query('UPDATE santri_units SET left_at=NULL WHERE unit_id=2');
    await db.query(`INSERT INTO santri(id,tenant_id,nama,status,uid_rfid) VALUES(3,1,'Synthetic No Account','Aktif','000001'); INSERT INTO santri_units(tenant_id,santri_id,unit_id,status) VALUES(1,3,2,'active')`);
    await rejects(()=>pos.checkout(cart('no-wallet-0001',{payment:{method:'RFID',credential:'000001'}})),'WALLET_ACCOUNT_REQUIRED');
    for(const state of ['frozen','closed']) {
      await db.query('UPDATE wallet_accounts SET status=$1 WHERE unit_id=2',[state]);
      await rejects(()=>pos.checkout(cart(`wallet-${state}-001`)),'WALLET_NOT_ACTIVE');
    }
    await db.query(`UPDATE wallet_accounts SET status='active' WHERE unit_id=2; UPDATE unit_features SET enabled=false WHERE unit_id=2 AND feature_key='rfid'`);
    await rejects(()=>pos.checkout(cart('feature-off-001')),'FEATURE_DISABLED');
    await db.query(`UPDATE unit_features SET enabled=true WHERE unit_id=2 AND feature_key='rfid'`);
    assert.deepEqual(await fingerprints(),original);
  });
  await test('REAL PostgreSQL concurrency: 20000 / two independent 15000 / one debit',async()=>{
    const second=cart('concurrent-B-001',{shift_id:shiftB.id,terminal_id:2});second.user=req({},3).user;
    const results=await Promise.allSettled([pos.checkout(cart('concurrent-A-001')),pos.checkout(second)]);
    if (!results.some(r=>r.status==='fulfilled')) throw results[0].reason;
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected.reason.code,'INSUFFICIENT_BALANCE');
    rfid=results.find(r=>r.status==='fulfilled').value;
    assert.equal((await scalar('SELECT current_balance FROM wallet_accounts WHERE unit_id=2')).current_balance,'5000');
    assert.equal((await scalar(`SELECT count(*)::integer AS n FROM wallet_transactions WHERE source='pos' AND direction='debit'`)).n,1);
    assert.equal((await scalar('SELECT count(*)::integer AS n FROM pos_payments')).n,1);
    assert.equal((await scalar('SELECT count(*)::integer AS n FROM pos_sales')).n,1);
    assert.equal(rfid.sale.grand_total,rfid.payment.amount);assert.equal(rfid.sale.grand_total,'15000');
    assert.equal((await scalar('SELECT current_balance FROM wallet_accounts WHERE unit_id=3')).current_balance,'99000');
    console.log('CONCURRENCY: 1 success / 1 insufficient / final 5000 / 1 debit / 1 payment');
  });
  await test('same key/payload replay and conflict, even after product price changes',async()=>{
    const winner=rfid.sale.cashier_id===2?cart('concurrent-A-001'):cart('concurrent-B-001',{shift_id:shiftB.id,terminal_id:2});
    if(rfid.sale.cashier_id===3)winner.user=req({},3).user;
    const before=await fingerprints();const result=await pos.checkout(winner);assert(result.replay);assert.equal(result.sale.id,rfid.sale.id);
    await rejects(()=>pos.checkout({...winner,body:{...winner.body,items:[{product_id:product.id,quantity:2}]}}),'IDEMPOTENCY_CONFLICT');
    await pos.product(req({sku:'TEST-1',name:'Renamed Synthetic',price:16000,category_id:category.id},1,{id:product.id}));
    assert.equal((await pos.checkout(winner)).items[0].name,'Synthetic Lunch');
    assert.equal((await pos.checkout(winner)).items[0].unit_price,'15000');
    await pos.product(req({sku:'TEST-1',name:'Synthetic Lunch',price:15000,category_id:category.id},1,{id:product.id}));
    assert.deepEqual(await fingerprints(),before);
  });
  await test('RFID partial refund/retry/over-refund and original history preserved',async()=>{
    const input=req({payment_id:rfid.payment.id,amount:5000,reason:'Synthetic partial refund',request_id:'refund-rfid-001'});
    const r=await pos.refund(input);assert.equal(r.status,'CONFIRMED');assert.equal(r.amount,'5000');
    assert.equal((await pos.refund(input)).id,r.id);
    await rejects(()=>pos.refund({...input,body:{...input.body,amount:5001}}),'IDEMPOTENCY_CONFLICT');
    await rejects(()=>pos.refund(req({...input.body,request_id:'refund-excess-01',amount:10001})),'OVER_REFUND');
    assert.equal((await scalar('SELECT current_balance FROM wallet_accounts WHERE unit_id=2')).current_balance,'10000');
    assert.equal((await scalar(`SELECT amount FROM wallet_transactions WHERE id='${r.wallet_transaction_id}'`)).amount,r.amount);
    assert.equal((await pos.sale(req({},2,{id:rfid.sale.id}))).sale.status,'PAID');
    await pos.refund(req({...input.body,request_id:'refund-remainder-01',amount:10000}));
  });
  await test('atomic failures after sale/items/ledger/balance/payment leave no residue',async()=>{
    for(const stage of ['sale','items','ledger','balance','payment']) {
      const before=await fingerprints();const broken=createPosService({db,featureEnabled,afterStage:async s=>{if(s===stage)throw Object.assign(new Error('INJECTED'),{code:'INJECTED'});}});
      await rejects(()=>broken.checkout(cart(`atomic-${stage}-0001`)),'INJECTED');assert.deepEqual(await fingerprints(),before);
    }
    const before=await fingerprints();const broken=createPosService({db,featureEnabled,afterStage:async s=>{if(s==='refund')throw Object.assign(new Error('INJECTED'),{code:'INJECTED'});}});
    const paid=await pos.checkout(cart('atomic-refund-sale'));const afterPaid=await fingerprints();
    await rejects(()=>broken.refund(req({payment_id:paid.payment.id,amount:1000,reason:'Rollback synthetic',request_id:'atomic-refund-001'})),'INJECTED');
    assert.deepEqual(await fingerprints(),afterPaid);
    await pos.refund(req({payment_id:paid.payment.id,amount:15000,reason:'Synthetic full return',request_id:'atomic-refund-reset'}));
    assert.equal((await fingerprints()).balance,before.balance);
  });
  await test('cash server prices / 37000 + tender 50000 = change 13000 / no wallet',async()=>{
    const p2=await pos.product(req({sku:'TEST-CASH',name:'Synthetic Cash',price:37000},1));
    const before=await scalar('SELECT count(*)::integer AS n FROM wallet_transactions');
    await rejects(()=>pos.checkout(cart('cash-short-001',{items:[{product_id:p2.id,quantity:1}],payment:{method:'CASH',tendered:36999}})),'INSUFFICIENT_TENDER');
    cash=await pos.checkout(cart('cash-valid-001',{items:[{product_id:p2.id,quantity:1,unit_price:1}],grand_total:1,payment:{method:'CASH',tendered:50000}}));
    assert.equal(cash.sale.grand_total,'37000');assert.equal(cash.payment.change,'13000');assert.equal(cash.payment.amount,'37000');
    assert.equal((await scalar('SELECT count(*)::integer AS n FROM wallet_transactions')).n,before.n);
    await pos.refund(req({payment_id:cash.payment.id,shift_id:shiftA.id,amount:7000,reason:'Cash synthetic refund',request_id:'cash-refund-001'}));
  });
  await test('manual QRIS explicit pending/confirm + external refund not falsely confirmed',async()=>{
    qris=await pos.checkout(cart('qris-pending-001',{payment:{method:'TRANSFER_QRIS',provider:'Synthetic Provider'}}));
    assert.equal(qris.sale.status,'DRAFT');assert.equal(qris.payment.status,'PENDING');
    await rejects(()=>pos.refund(req({payment_id:qris.payment.id,amount:1,reason:'Not paid yet',request_id:'pending-refund-01'})),'PAYMENT_NOT_PAID');
    const confirmed=await pos.confirmPayment(req({shift_id:shiftA.id,confirmed:true,reference:'SYNTHETIC-EXTERNAL-1'},2,{id:qris.sale.id}));
    assert.equal(confirmed.sale.status,'PAID');assert.equal(confirmed.payment.status,'CONFIRMED');
    const r=await pos.refund(req({payment_id:qris.payment.id,amount:3000,reason:'External synthetic refund',request_id:'qris-refund-001'}));
    assert.equal(r.status,'PENDING');assert.equal(r.confirmed_at,null);
    await rejects(()=>pos.confirmRefund(req({confirmed:false,reference:'SYNTHETIC-RETURN'},2,{id:r.id})),'CONFIRMATION_REQUIRED');
    assert.equal((await pos.confirmRefund(req({confirmed:true,reference:'SYNTHETIC-RETURN'},2,{id:r.id}))).status,'CONFIRMED');
    assert.equal((await pos.confirmRefund(req({confirmed:true,reference:'SYNTHETIC-RETURN'},2,{id:r.id}))).id,r.id);
    const paid=await pos.checkout(cart('qris-direct-001',{payment:{method:'TRANSFER_QRIS',confirmed:true,reference:'MANUAL-TEST'}}));
    assert.equal(paid.payment.verified_by,2);assert.equal(paid.payment.status,'CONFIRMED');
  });
  await test('void unpaid only, no financial history deletion',async()=>{
    const draft=await pos.checkout(cart('void-draft-001',{payment:{method:'TRANSFER_QRIS'}}));
    const before=await scalar('SELECT count(*)::integer AS n FROM wallet_transactions');
    const result=await pos.voidSale(req({shift_id:shiftA.id,reason:'Synthetic cancellation'},2,{id:draft.sale.id}));assert.equal(result.sale.status,'VOID');
    await rejects(()=>pos.voidSale(req({shift_id:shiftA.id,reason:'Not permitted'},2,{id:cash.sale.id})),'VOID_UNPAID_ONLY');
    assert.equal((await scalar('SELECT count(*)::integer AS n FROM wallet_transactions')).n,before.n);
  });
  await test('discount exact integer allocation and permission/invalid totals',async()=>{
    const p=await pos.product(req({sku:'TEST-SMALL',name:'Synthetic Small',price:3},1));
    const result=await pos.checkout(cart('discount-exact-01',{items:[{product_id:p.id,quantity:2},{product_id:product.id,quantity:1}],
      discount:14999,discount_reason:'Synthetic approved discount',payment:{method:'CASH',tendered:7}}));
    assert.equal(result.sale.subtotal,'15006');assert.equal(result.sale.grand_total,'7');
    assert.equal(result.items.reduce((sum,i)=>sum+BigInt(i.discount),0n),14999n);
    assert(result.items.every(i=>BigInt(i.total)>=0n));
    await rejects(()=>pos.checkout(cart('discount-invalid',{discount:15000,discount_reason:'Synthetic invalid',payment:{method:'CASH',tendered:15000}})),'INVALID_TOTAL');
    const denied=createPosService({db,featureEnabled,permissionList:async()=>['pos.sell']});
    await rejects(()=>denied.checkout(cart('discount-denied',{discount:1,discount_reason:'Synthetic denied'})),'DISCOUNT_DENIED');
  });
  await test('concurrent identical request has one sale/payment/debit',async()=>{
    const p=await pos.product(req({sku:'TEST-RETRY',name:'Synthetic Retry',price:1000},1));
    const input=cart('concurrent-retry',{items:[{product_id:p.id,quantity:1}]});
    const before=await fingerprints();const results=await Promise.all([pos.checkout(input),pos.checkout(input)]);
    assert.equal(results[0].sale.id,results[1].sale.id);assert.equal(results.filter(x=>x.replay).length,1);
    const after=await fingerprints();assert.equal(BigInt(after.sales)-BigInt(before.sales),1n);assert.equal(BigInt(after.ledger)-BigInt(before.ledger),1n);
    const refundInput=req({payment_id:results[0].payment.id,amount:1000,reason:'Synthetic concurrent refund',request_id:'concurrent-refund'});
    const refunds=await Promise.all([pos.refund(refundInput),pos.refund(refundInput)]);assert.equal(refunds[0].id,refunds[1].id);
  });
  await test('concurrent distinct refunds cannot exceed original payment',async()=>{
    const paid=await pos.checkout(cart('refund-race-sale',{payment:{method:'CASH',tendered:15000}}));
    const body={payment_id:paid.payment.id,shift_id:shiftA.id,amount:10000,reason:'Synthetic refund race'};
    const results=await Promise.allSettled([pos.refund(req({...body,request_id:'refund-race-A-01'})),pos.refund(req({...body,request_id:'refund-race-B-01'}))]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'OVER_REFUND');
    assert.equal((await db.query('SELECT sum(amount)::text AS total FROM pos_refunds WHERE payment_id=$1',[paid.payment.id])).rows[0].total,'10000');
  });
  await test('inactive identity/product and ambiguous location fail without financial writes',async()=>{
    const before=await fingerprints();
    await db.query(`UPDATE santri SET status='inactive' WHERE id=1`);await rejects(()=>pos.checkout(cart('inactive-identity')),'MEMBERSHIP_INACTIVE');
    await db.query(`UPDATE santri SET status='Aktif' WHERE id=1; UPDATE pos_products SET available=false WHERE id='${product.id}'`);
    await rejects(()=>pos.checkout(cart('unavailable-product')),'PRODUCT_UNAVAILABLE');
    await db.query(`UPDATE pos_products SET available=true WHERE id='${product.id}'; UPDATE merchant_rfid SET location_resolution_status='REVIEW_REQUIRED' WHERE id=1`);
    await rejects(()=>pos.checkout(cart('ambiguous-merchant')),'MERCHANT_SCOPE_DENIED');
    await db.query(`UPDATE merchant_rfid SET location_resolution_status='resolved' WHERE id=1; UPDATE devices SET location_resolution_status='REVIEW_REQUIRED' WHERE id=1`);
    await rejects(()=>pos.checkout(cart('ambiguous-terminal')),'TERMINAL_DENIED');
    await db.query(`UPDATE devices SET location_resolution_status='resolved' WHERE id=1`);
    assert.deepEqual(await fingerprints(),before);
  });
  await test('database immutable snapshots and deferred Rp1 mismatch rejection',async()=>{
    await rejects(()=>db.query(`UPDATE pos_sales SET grand_total=grand_total+1 WHERE id=$1`,[cash.sale.id]),'23514');
    await rejects(()=>db.query(`UPDATE pos_sale_items SET name='Changed' WHERE sale_id=$1`,[cash.sale.id]),'23514');
    await rejects(()=>db.query(`UPDATE pos_payments SET amount=amount+1 WHERE id=$1`,[cash.payment.id]),'23514');
    // A malformed cloned paid sale with no items/payment fails at COMMIT.
    const c=await db.connect();try{
      await c.query('BEGIN');
      await c.query(`INSERT INTO pos_sales SELECT gen_random_uuid(),'BAD-'||gen_random_uuid(),tenant_id,unit_id,merchant_id,terminal_id,cashier_id,shift_id,
        merchant_name,cashier_name,terminal_name,business_date,timezone,subtotal,discount,discount_reason,grand_total,status,
        'BAD-'||gen_random_uuid(),request_hash,created_at,void_reason,void_by,void_at FROM pos_sales WHERE id=$1`,[cash.sale.id]);
      await rejects(()=>c.query('COMMIT'),'23514');
    }finally{await c.query('ROLLBACK');c.release();}
    await rejects(()=>pos.sale(req({unit_id:3},1,{id:cash.sale.id})),'SALE_NOT_FOUND');
    await rejects(()=>pos.refund(req({unit_id:3,payment_id:cash.payment.id,amount:1,reason:'Foreign scope',request_id:'cross-unit-refund'},1)),'MERCHANT_SCOPE_DENIED');
  });
  await test('all sale/payment/debit and refund/credit + ledger balance invariants Rp0',async()=>{
    const mismatch=await scalar(`SELECT count(*)::integer AS n FROM pos_sales s JOIN pos_payments p ON p.sale_id=s.id
      LEFT JOIN wallet_transactions w ON w.id=p.wallet_transaction_id WHERE s.grand_total<>p.amount
      OR (p.method='RFID' AND (w.amount IS DISTINCT FROM p.amount OR w.direction<>'debit'))`);assert.equal(mismatch.n,0);
    assert.equal((await scalar(`SELECT count(*)::integer AS n FROM pos_refunds r JOIN pos_payments p ON p.id=r.payment_id
      LEFT JOIN wallet_transactions w ON w.id=r.wallet_transaction_id WHERE p.method='RFID' AND (w.amount IS DISTINCT FROM r.amount OR w.direction<>'credit')`)).n,0);
    assert.equal((await scalar(`SELECT count(*)::integer AS n FROM wallet_accounts a LEFT JOIN
      (SELECT wallet_account_id,sum(CASE WHEN direction='credit' THEN amount ELSE -amount END) net FROM wallet_transactions GROUP BY wallet_account_id) w
      ON w.wallet_account_id=a.id WHERE a.current_balance<>coalesce(w.net,0)`)).n,0);
    assert.deepEqual((await db.query('SELECT saldo FROM santri WHERE id IN(1,2) ORDER BY id')).rows,[{saldo:'777'},{saldo:'888'}]);
    assert.equal((await scalar('SELECT count(*)::integer AS n FROM transaksi_rfid')).n,0);
  });
  await test('shift cash math excludes RFID/QRIS; close/double close and post-close rejection',async()=>{
    const pending=await pos.checkout(cart('shift-pending-01',{payment:{method:'TRANSFER_QRIS'}}));
    await rejects(()=>pos.closeShift(req({actual_cash:0},2,{id:shiftA.id})),'SHIFT_UNPAID_SALES');
    await pos.voidSale(req({shift_id:shiftA.id,reason:'Resolve pending before close'},2,{id:pending.sale.id}));
    const cashSales=BigInt((await scalar(`SELECT sum(p.amount) AS n FROM pos_payments p JOIN pos_sales s ON s.id=p.sale_id WHERE p.method='CASH' AND s.shift_id='${shiftA.id}'`)).n);
    const cashRefunds=BigInt((await scalar(`SELECT sum(r.amount) AS n FROM pos_refunds r JOIN pos_payments p ON p.id=r.payment_id WHERE p.method='CASH' AND r.shift_id='${shiftA.id}'`)).n);
    const expected=10000n+cashSales-cashRefunds;
    const s=await pos.closeShift(req({actual_cash:(expected-2n).toString()},2,{id:shiftA.id}));
    assert.equal(s.expected_cash,expected.toString());assert.equal(s.difference,'-2');assert.equal(s.status,'CLOSED');
    await rejects(()=>pos.closeShift(req({actual_cash:0},2,{id:shiftA.id})),'SHIFT_NOT_OPEN');
    await rejects(()=>pos.checkout(cart('closed-shift-01',{payment:{method:'CASH',tendered:15000}})),'SHIFT_NOT_OPEN');
    await rejects(()=>db.query('UPDATE pos_shifts SET opening_cash=0 WHERE id=$1',[shiftA.id]),'23514');
    console.log(`CASH SHIFT: opening 10000 + sales ${cashSales} - refunds ${cashRefunds} = expected ${expected}; actual ${expected-2n}; difference -2`);
  });
  await test('HTTP contract with real JWT/session validation and isolated DB',async()=>{
    const express=require('express'), jwt=require('jsonwebtoken');
    const {createPosRouter}=require('../routes/posRoutes');
    const app=express();app.use(express.json());
    // Only tenant enrichment is injected; production auth/session + POS handlers run unchanged.
    app.use('/pos',createPosRouter({pos,tenantContext:async(req,res,next)=>{
      const t=(await db.query('SELECT status FROM tenants WHERE id=$1',[req.user.tenant_id])).rows[0];
      if(t?.status!=='active')return res.status(403).json({code:'TENANT_INACTIVE'});req.tenantId=req.user.tenant_id;next();
    }}));
    server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    const url=`http://127.0.0.1:${server.address().port}/pos/catalog?unit_id=2&merchant_id=1`;
    const token=id=>jwt.sign({id,tenant_id:1,role:id===5?'denied':'cashier',token_version:0},process.env.JWT_SECRET,{expiresIn:'5m'});
    assert.equal((await fetch(url)).status,401);
    assert.equal((await fetch(url,{headers:{authorization:'Bearer invalid-test-token'}})).status,401);
    assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token(5)}`}})).status,403);
    const response=await fetch(url,{headers:{authorization:`Bearer ${token(2)}`}});assert.equal(response.status,200);
    const body=await response.json();assert(!JSON.stringify(body).includes('uid_rfid'));assert(!JSON.stringify(body).includes('device_secret'));
    const api=`http://127.0.0.1:${server.address().port}/pos`;
    const post=(endpoint,data)=>fetch(api+endpoint,{method:'POST',headers:{authorization:`Bearer ${token(2)}`,'content-type':'application/json'},body:JSON.stringify(data)});
    const opened=await post('/shifts/open',req({opening_cash:0}).body);assert.equal(opened.status,200);const httpShift=(await opened.json()).data;
    const input=cart('http-checkout-001',{shift_id:httpShift.id,payment:{method:'CASH',tendered:15000}}).body;
    const paid=await post('/checkout',input);assert.equal(paid.status,200);const paidBody=(await paid.json()).data;assert.equal(paidBody.payment.amount,'15000');
    const retry=await post('/checkout',input);assert.equal(retry.status,200);assert.equal((await retry.json()).data.sale.id,paidBody.sale.id);
    assert.equal((await post('/checkout',{...input,request_id:'http-short-tender',payment:{method:'CASH',tendered:1}})).status,400);
    assert.equal((await post('/checkout',{...input,unit_id:3,request_id:'http-cross-unit'})).status,403);
    const closed=await post(`/shifts/${httpShift.id}/close`,req({actual_cash:15000}).body);assert.equal(closed.status,200);assert.equal((await closed.json()).data.difference,'0');
    await db.query('UPDATE users SET token_version=1 WHERE id=2');
    assert.equal((await fetch(url,{headers:{authorization:`Bearer ${token(2)}`}})).status,401);
    await db.query('UPDATE users SET token_version=0 WHERE id=2');
  });
  await test('migration rollback refuses persisted financial/shift history',async()=>{
    const c=await db.connect();try{await rejects(()=>c.query(fs.readFileSync(path.join(__dirname,'../migrations/094_pos_v1_foundation_rollback.sql'),'utf8')),'P0001');}
    finally{await c.query('ROLLBACK');c.release();}
    assert((await scalar('SELECT count(*)::integer AS n FROM pos_sales')).n>0);
  });
  await test('runtime least-privilege role: actual checkout/refund/shift under scoped grants',async()=>{
    await db.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='pos_fixture_runtime') THEN
      CREATE ROLE pos_fixture_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;
      GRANT CONNECT ON DATABASE pos_phase1_test TO pos_fixture_runtime;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      GRANT USAGE ON SCHEMA public TO pos_fixture_runtime;
      GRANT SELECT ON tenants,users,unit_pendidikan,user_unit_scope,roles,permissions,role_permissions,tenant_role_overrides,tenant_role_permissions,unit_features,
        merchant_rfid,devices,santri,santri_units,wallet_accounts,wallet_transactions TO pos_fixture_runtime;
      GRANT UPDATE(pos_enabled) ON merchant_rfid,devices TO pos_fixture_runtime;
      GRANT INSERT ON merchant_rfid TO pos_fixture_runtime;
      -- PostgreSQL row-lock reads need UPDATE on at least one column. Existing
      -- canonical membership lifecycle permissions are represented explicitly.
      GRANT UPDATE(status) ON santri,santri_units TO pos_fixture_runtime;
      GRANT UPDATE(current_balance,updated_at) ON wallet_accounts TO pos_fixture_runtime;
      GRANT INSERT ON wallet_transactions TO pos_fixture_runtime;
      GRANT USAGE ON SEQUENCE wallet_transactions_id_seq TO pos_fixture_runtime;
      GRANT USAGE ON SEQUENCE merchant_rfid_id_seq TO pos_fixture_runtime;
      GRANT SELECT,INSERT,UPDATE ON pos_cashier_assignments,pos_products,pos_shifts,pos_sales,pos_payments,pos_refunds TO pos_fixture_runtime;
      GRANT SELECT,INSERT ON pos_categories,pos_sale_items TO pos_fixture_runtime;`);
    const role=(await db.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls FROM pg_roles WHERE rolname='pos_fixture_runtime'`)).rows[0];
    assert(Object.values(role).every(x=>x===false));
    const tables=(await db.query(`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'pos_%'`)).rows;
    for(const {tablename} of tables)assert.equal((await db.query(`SELECT has_table_privilege('pos_fixture_runtime',$1,'DELETE') AS allowed`,[tablename])).rows[0].allowed,false);
    assert.equal((await db.query(`SELECT has_table_privilege('pos_fixture_runtime','pos_sale_items','UPDATE') AS allowed`)).rows[0].allowed,false);
    const runtime=new Pool({...options,user:'pos_fixture_runtime'});
    try {
      const runtimePos=createPosService({db:runtime,featureEnabled});
      const newMerchant=await runtimePos.createMerchant(req({name:'Synthetic New Scoped Merchant'},1));
      assert.equal(newMerchant.unit_id,2);assert.equal(newMerchant.tenant_id,1);assert.equal(newMerchant.pos_enabled,true);
      const catalogProduct=await runtimePos.product(req({sku:'RUNTIME-PRODUCT',name:'Runtime Scoped Product',price:1000},1));
      assert.equal(catalogProduct.unit_id,2);
      const shift=await runtimePos.openShift(req({opening_cash:10000}));
      const paid=await runtimePos.checkout(cart('privilege-rfid-01',{shift_id:shift.id}));assert.equal(paid.sale.status,'PAID');
      const refunded=await runtimePos.refund(req({payment_id:paid.payment.id,amount:15000,reason:'Privilege fixture return',request_id:'privilege-refund-01'}));assert.equal(refunded.status,'CONFIRMED');
      assert.equal((await runtimePos.closeShift(req({actual_cash:10000},2,{id:shift.id}))).difference,'0');
      await rejects(()=>runtime.query('DELETE FROM pos_sales'),'42501');
      await rejects(()=>runtime.query('UPDATE pos_sale_items SET name=name'),'42501');
      await rejects(()=>runtime.query('CREATE TABLE forbidden_fixture(id integer)'),'42501');
    }finally{await runtime.end();}
  });
  console.log(`POS V1 PostgreSQL: ${passed} test groups PASS`);
}
main().catch(e=>{console.error('POS test FAIL',{code:e.code,message:e.message,stack:e.stack});process.exitCode=1;})
  .finally(async()=>{if(server) await new Promise(resolve=>server.close(resolve));if(db) await db.end();});
