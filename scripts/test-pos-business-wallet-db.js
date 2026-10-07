// Literal guarded loopback DB ONLY. No .env/connection-string fallback.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Pool}=require('pg');
const {createPosBusinessService}=require('../services/posBusinessService');
const db=new Pool({host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_business_v2_test',max:12});
const q=async(s,v=[])=>(await db.query(s,v)).rows,key=()=>crypto.randomUUID();let passed=0,token,cashier,biz,account,product,supplier,shift,card;
const req=(body={},t=token,target=biz)=>({headers:{authorization:'Bearer '+t},params:{businessId:target},body,query:{}});
const test=async(n,f)=>{await f();passed++;console.log('PASS '+n);},reject=(f,code)=>assert.rejects(f,e=>e.code===code);
const core=createPosBusinessService({db});
const scan=(method='RFID',value='0ab102ff',unit=2)=>({credential_method:method,credential:value,unit_id:unit});
const sale=(payments,quantity=1,id=key(),svc=core)=>svc.sale(req({shift_id:shift.id,due_date:'2030-01-01',items:[{product_id:product,quantity}],payments,request_id:id}));
const wp=(value=2000,s=scan())=>({method:'DOMPET_SANTRI',amount:value,...s});
const ret=(id,quantity=1,request=key(),svc=core)=>svc.saleReturn(req({source_id:id,items:[{product_id:product,quantity}],shift_id:shift.id,
 reason:'Synthetic Wallet return',refund_confirmed:true,reference:'Synthetic refund evidence',request_id:request}));
const balance=async(unit=2)=>(await q('SELECT current_balance FROM wallet_accounts WHERE tenant_id=1 AND santri_id=1 AND unit_id=$1',[unit]))[0].current_balance;
async function fingerprint(){const h=crypto.createHash('sha256');for(const table of ['pos_business_operations','pos_business_lines','pos_business_payments','pos_inventory_movements','pos_inventory_layers','pos_inventory_allocations','pos_money_movements','pos_debt_movements','wallet_accounts','wallet_transactions'])h.update(JSON.stringify(await q(`SELECT * FROM ${table} ORDER BY id`)));return h.digest('hex');}
async function setup(){
 assert.deepEqual((await q('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port'))[0],
  {db:'pos_business_v2_test',current_user:'pos_test_owner',host:'127.0.0.1',port:55439});
 await db.query(`ALTER TABLE unit_pendidikan ADD COLUMN is_active boolean NOT NULL DEFAULT true,ADD COLUMN preset_key text,ADD COLUMN kode text,ADD COLUMN nama text;
 CREATE TABLE users(id integer PRIMARY KEY);
 CREATE TABLE santri(id integer PRIMARY KEY,tenant_id integer REFERENCES tenants(id),nama text,status text,uid_rfid text,saldo bigint DEFAULT 0,created_at timestamptz DEFAULT now(),UNIQUE(id,tenant_id));
 CREATE TABLE santri_units(id serial PRIMARY KEY,tenant_id integer,santri_id integer,unit_id integer,status text,left_at date);
 CREATE TABLE transaksi_rfid(id integer PRIMARY KEY,tenant_id integer,santri_id integer,trx_type text,nominal bigint,saldo_akhir bigint,location_unit_id integer,merchant_id integer,device_id integer,created_at timestamptz);
 CREATE TABLE multi_unit_backfill_review(tenant_id integer,entity_type text,entity_id integer,reason text,detail jsonb,status text,UNIQUE(tenant_id,entity_type,entity_id,reason));
 CREATE TABLE unit_features(tenant_id integer,unit_id integer,feature_key text,enabled boolean);
 CREATE TABLE feature_catalog(key text PRIMARY KEY,label text,description text,is_core boolean,sort_order integer);
 CREATE TABLE tenant_features(tenant_id integer,feature_key text,enabled boolean);
 INSERT INTO feature_catalog VALUES('rfid','RFID','Synthetic',false,0);
 INSERT INTO unit_features VALUES(1,2,'wallet',true),(1,2,'rfid',true),(1,3,'wallet',true),(1,3,'rfid',true);`);
 for(const file of ['078_wallet_ledger_core.sql','079_wallet_per_unit.sql'])await db.query(fs.readFileSync(path.join(__dirname,'../migrations',file),'utf8'));
 await db.query(`INSERT INTO santri VALUES(1,1,'Synthetic Wallet Child','Aktif','0ab102ff',777,now()),(2,2,'Synthetic Foreign','Aktif','1234abcd',888,now());
 INSERT INTO santri_units(tenant_id,santri_id,unit_id,status) VALUES(1,1,2,'active'),(1,1,3,'active'),(2,2,4,'active');
 INSERT INTO wallet_accounts(tenant_id,unit_id,santri_id,current_balance) VALUES(1,2,1,10000),(1,3,1,99000),(2,4,2,8000);
 INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,source,idempotency_key)
 SELECT id,tenant_id,unit_id,santri_id,'opening_balance','credit',current_balance,current_balance,'synthetic','synthetic-opening:'||id FROM wallet_accounts;`);
 await test('099 UP/DOWN/UP preserves existing V2 and canonical Wallet data',async()=>{
  const before=await fingerprint(),up=fs.readFileSync(path.join(__dirname,'../migrations/099_pos_business_wallet.sql'),'utf8');
  await db.query(up);await db.query(fs.readFileSync(path.join(__dirname,'../migrations/099_pos_business_wallet_rollback.sql'),'utf8'));assert.equal(await fingerprint(),before);await db.query(up);
 });
 require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:db};
 token=(await core.login({body:{login:'owner',password:'Synthetic-only-V2-password'}})).token;
 cashier=(await core.login({body:{login:'cashier',password:'Synthetic-only-V2-password'}})).token;
 biz=(await q("SELECT business_id FROM pos_merchant_memberships m JOIN pos_merchant_users u ON u.id=m.user_id WHERE u.login='owner'"))[0].business_id;
 await db.query('UPDATE pos_businesses SET integration_enabled=true,wallet_enabled=true WHERE id=$1',[biz]);
 await db.query('INSERT INTO pos_business_units VALUES($1,1,2),($1,1,3) ON CONFLICT DO NOTHING',[biz]);
 account=(await core.account(req({kind:'CASH',name:'Synthetic Wallet drawer'}))).id;
 product=(await core.product(req({sku:key(),name:'Synthetic Wallet product',selling_price:2000}))).id;
 supplier=(await core.party(req({kind:'SUPPLIER',name:'Synthetic Wallet supplier'}))).id;
 await core.purchase(req({items:[{product_id:product,quantity:100,unit_cost:1000}],supplier_id:supplier,paid:0,due_date:'2030-01-01',request_id:key()}));
 const t=await core.terminal(req({name:'Synthetic Wallet terminal'}));shift=await core.openShift(req({terminal_id:t.id,cash_account_id:account,opening_cash:200000}));
}
async function main(){await setup();
 await test('RFID legacy case compatibility; preview is safe/read-only and canonical balance not santri.saldo',async()=>{
  const before=await fingerprint(),r=await core.walletPreview(req(scan('RFID','0AB102FF')));
  assert.deepEqual(Object.keys(r).sort(),['available_balance','credential_method','eligible','name','unit_id']);assert.equal(r.available_balance,'10000');assert.equal(await fingerprint(),before);
 });
 await test('barcode/QR one opaque 256-bit token, hash-only storage, same eligible Wallet',async()=>{
  card=await core.provisionWalletCredential(req({unit_id:2,santri_id:1}));assert.match(card.token,/^kpw_[A-Za-z0-9_-]{43}$/);
  assert.equal((await q('SELECT token_hash FROM pos_wallet_credentials WHERE id=$1',[card.id]))[0].token_hash,crypto.createHash('sha256').update(card.token).digest('hex'));
  for(const method of ['BARCODE','QR'])assert.equal((await core.walletPreview(req(scan(method,card.token)))).available_balance,'10000');
  await reject(()=>core.provisionWalletCredential(req({unit_id:2,santri_id:1},cashier)),'MERCHANT_PERMISSION_DENIED');
 });
 await test('unknown/foreign/ambiguous credential rejected without writes',async()=>{
  const before=await fingerprint();await reject(()=>core.walletPreview(req(scan('RFID','1234abcd'))),'UNKNOWN_CREDENTIAL');
  await reject(()=>core.walletPreview(req(scan('BARCODE','kpw_'+crypto.randomBytes(32).toString('base64url')))),'UNKNOWN_CREDENTIAL');
  await db.query("INSERT INTO santri VALUES(3,1,'Synthetic collision','Aktif','0AB102FF',0,now())");
  await reject(()=>core.walletPreview(req(scan())),'AMBIGUOUS_CREDENTIAL');await db.query('DELETE FROM santri WHERE id=3');assert.equal(await fingerprint(),before);
 });
 await test('tenant integration + allowed specific unit + membership enforced; no fallback or merged balance',async()=>{
  assert.equal((await core.walletPreview(req(scan('QR',card.token,3)))).available_balance,'99000');
  const other=await sale([wp(2000,scan('QR',card.token,3))]);assert.equal(await balance(3),'97000');assert.equal(await balance(),'10000');await ret(other.sale.id);assert.equal(await balance(3),'99000');
  await reject(()=>core.walletPreview(req(scan('QR',card.token,4))),'WALLET_UNIT_DENIED');await reject(()=>core.walletPreview(req(scan('QR',card.token,'all'))),'UNIT_REQUIRED');
  await db.query('UPDATE pos_businesses SET integration_enabled=false WHERE id=$1',[biz]);await reject(()=>core.walletPreview(req(scan())),'WALLET_INTEGRATION_DENIED');
  await db.query('UPDATE pos_businesses SET integration_enabled=true WHERE id=$1',[biz]);
  await db.query("UPDATE santri_units SET status='inactive' WHERE tenant_id=1 AND unit_id=2");await reject(()=>core.walletPreview(req(scan())),'MEMBERSHIP_INACTIVE');
  await db.query("UPDATE santri_units SET status='active' WHERE tenant_id=1 AND unit_id=2");
 });
 await test('Wallet ON RFID OFF permits barcode/QR but rejects RFID',async()=>{
  await db.query("UPDATE unit_features SET enabled=false WHERE unit_id=2 AND feature_key='rfid'");
  await core.walletPreview(req(scan('QR',card.token)));const s=await sale([wp(2000,scan('QR',card.token))]);await ret(s.sale.id);
  await reject(()=>core.walletPreview(req(scan())),'FEATURE_DISABLED');
  await db.query("UPDATE unit_features SET enabled=true WHERE unit_id=2 AND feature_key='rfid'");
 });
 await test('full Wallet sale/receipt and full canonical refund reconcile without raw credential',async()=>{
  const s=await sale([wp()]);assert.equal(await balance(),'8000');assert.equal(s.payments[0].method,'DOMPET_SANTRI');
  assert.equal(s.payments[0].label,'Dompet Santri');assert.ok(!JSON.stringify(s).includes('0ab102ff'));await ret(s.sale.id);assert.equal(await balance(),'10000');assert.equal(await balance(3),'99000');
 });
 await test('authorized foreign-tenant merchant still cannot resolve tenant A barcode or RFID',async()=>{
  const foreign=(await q('SELECT id FROM pos_businesses WHERE tenant_id=2'))[0].id;
  const auth=(await core.login({body:{login:'other-owner',password:'Synthetic-only-V2-password'}})).token;
  await db.query('UPDATE pos_businesses SET integration_enabled=true,wallet_enabled=true WHERE id=$1',[foreign]);
  await db.query('INSERT INTO pos_business_units VALUES($1,2,4)',[foreign]);await db.query("INSERT INTO unit_features VALUES(2,4,'wallet',true),(2,4,'rfid',true)");
  await reject(()=>core.walletPreview(req(scan('QR',card.token,4),auth,foreign)),'UNKNOWN_CREDENTIAL');
  await reject(()=>core.walletPreview(req(scan('RFID','0ab102ff',4),auth,foreign)),'UNKNOWN_CREDENTIAL');
  await reject(()=>core.walletPreview(req(scan(),auth,biz)),'MERCHANT_ACCESS_DENIED');
 });
 await test('cash + Wallet split; partial/full returns and retry reconcile each component',async()=>{
  const s=await sale([{method:'CASH',amount:1000,tendered:1000,account_id:account},wp(3000,scan('BARCODE',card.token))],2);
  assert.equal(await balance(),'7000');const id=key();await ret(s.sale.id,1,id);assert.equal((await ret(s.sale.id,1,id)).replay,true);
  await ret(s.sale.id,1);assert.equal(await balance(),'10000');await reject(()=>ret(s.sale.id,1),'OVER_RETURN');
 });
 await test('manual BANK + Wallet split and refund use same Wallet path, no fake cash',async()=>{
  const bank=(await core.account(req({kind:'BANK',name:'Synthetic Wallet bank'}))).id;
  const s=await sale([{method:'BANK',amount:1000,account_id:bank,reference:'Synthetic payment'},wp(3000,scan('QR',card.token))],2);
  await ret(s.sale.id,2);assert.equal(await balance(),'10000');
 });
 await test('checkout rejects client wallet authority, underpayment and missing membership without partial state',async()=>{
  const before=await fingerprint();await reject(()=>sale([wp(2000,{...scan(),wallet_account_id:1})]),'CLIENT_WALLET_AUTHORITY_REJECTED');
  await reject(()=>sale([wp(1)]),'PAYMENT_TOTAL_MISMATCH');await reject(()=>sale([wp(2000,scan('QR',card.token,4))]),'WALLET_UNIT_DENIED');assert.equal(await fingerprint(),before);
 });
 await test('same-key concurrent checkout and timeout retry produce one debit',async()=>{
  const id=key(),r=await Promise.all([sale([wp()],1,id),sale([wp()],1,id)]);assert.equal(r[0].sale.id,r[1].sale.id);
  assert.equal((await sale([wp()],1,id)).replay,true);assert.equal(await balance(),'8000');await ret(r[0].sale.id);assert.equal(await balance(),'10000');
 });
 await test('concurrent distinct checkouts cannot overdraw canonical Wallet',async()=>{
  const r=await Promise.allSettled([sale([wp(6000)],3),sale([wp(6000)],3)]);assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(r.find(x=>x.status==='rejected').reason.code,'INSUFFICIENT_BALANCE');assert.equal(await balance(),'4000');await ret(r.find(x=>x.status==='fulfilled').value.sale.id,3);
 });
 await test('forced failure after Wallet ledger/balance/link rolls back entire sale',async()=>{
  const fail=createPosBusinessService({db,afterStage:async stage=>{if(stage==='wallet')throw Object.assign(Error('Synthetic'),{code:'FORCED_WALLET'});}}),before=await fingerprint();
  await reject(()=>sale([wp()],1,key(),fail),'FORCED_WALLET');assert.equal(await fingerprint(),before);
 });
 await test('concurrent partial Wallet refunds cannot double-credit or over-return',async()=>{
  const s=await sale([wp(4000)],2),r=await Promise.all([ret(s.sale.id),ret(s.sale.id)]);assert.equal(r.length,2);assert.equal(await balance(),'10000');
  await reject(()=>ret(s.sale.id),'OVER_RETURN');
 });
 await test('forced refund failure rolls back Wallet credit and inventory restoration',async()=>{
  const s=await sale([wp()]),before=await fingerprint(),fail=createPosBusinessService({db,afterStage:async stage=>{if(stage==='wallet')throw Object.assign(Error('Synthetic'),{code:'FORCED_WALLET'});}});
  await reject(()=>ret(s.sale.id,1,key(),fail),'FORCED_WALLET');assert.equal(await fingerprint(),before);await ret(s.sale.id);
 });
 await test('revoke is idempotent, old token rejected; replacement token resolves same canonical Wallet',async()=>{
  const r={...req({unit_id:2}),params:{businessId:biz,credentialId:card.id}};await core.revokeWalletCredential(r);await core.revokeWalletCredential(r);
  await reject(()=>core.walletPreview(req(scan('QR',card.token))),'CREDENTIAL_DISABLED');card=await core.provisionWalletCredential(req({unit_id:2,santri_id:1}));
  assert.equal((await core.walletPreview(req(scan('QR',card.token)))).available_balance,'10000');
 });
 await test('frozen/closed wallet cannot debit; closed cannot refund; missing account never falls back',async()=>{
  for(const status of ['frozen','closed']){await db.query('UPDATE wallet_accounts SET status=$1 WHERE tenant_id=1 AND unit_id=2',[status]);
   await reject(()=>sale([wp()]),'WALLET_NOT_ACTIVE');}
  await db.query("UPDATE wallet_accounts SET status='active' WHERE tenant_id=1 AND unit_id=2");
  const s=await sale([wp()]);await db.query("UPDATE wallet_accounts SET status='closed' WHERE tenant_id=1 AND unit_id=2");
  const before=await fingerprint();await reject(()=>ret(s.sale.id),'REFUND_WALLET_UNAVAILABLE');assert.equal(await fingerprint(),before);
  await db.query("UPDATE wallet_accounts SET status='active' WHERE tenant_id=1 AND unit_id=2");await ret(s.sale.id);
  await db.query('INSERT INTO santri VALUES(4,1,\'Synthetic no wallet\',\'Aktif\',\'01010101\',123,now())');
  await db.query("INSERT INTO santri_units(tenant_id,santri_id,unit_id,status) VALUES(1,4,2,'active')");await reject(()=>sale([wp(2000,scan('RFID','01010101'))]),'WALLET_ACCOUNT_REQUIRED');
 });
 await test('expired membership, inactive identity/unit and Wallet OFF cannot debit; clearing cannot be spent as cash',async()=>{
  const before=await fingerprint();
  await db.query("UPDATE santri_units SET left_at='2026-01-01' WHERE santri_id=1 AND unit_id=2");await reject(()=>sale([wp()]),'MEMBERSHIP_INACTIVE');await db.query('UPDATE santri_units SET left_at=NULL WHERE santri_id=1 AND unit_id=2');
  await db.query("UPDATE santri SET status='inactive' WHERE id=1");await reject(()=>sale([wp()]),'MEMBERSHIP_INACTIVE');await db.query("UPDATE santri SET status='Aktif' WHERE id=1");
  await db.query('UPDATE unit_pendidikan SET is_active=false WHERE id=2');await reject(()=>sale([wp()]),'WALLET_UNIT_DENIED');await db.query('UPDATE unit_pendidikan SET is_active=true WHERE id=2');
  await db.query("UPDATE unit_features SET enabled=false WHERE unit_id=2 AND feature_key='wallet'");await reject(()=>sale([wp()]),'FEATURE_DISABLED');await db.query("UPDATE unit_features SET enabled=true WHERE unit_id=2 AND feature_key='wallet'");
  const clear=(await q("SELECT id FROM pos_business_accounts WHERE business_id=$1 AND kind='WALLET_CLEARING'",[biz]))[0].id;
  await reject(()=>core.money(req({kind:'WITHDRAWAL',account_id:clear,amount:1,reason:'Synthetic prohibited settlement',request_id:key()})),'ACCOUNT_DENIED');assert.equal(await fingerprint(),before);
 });
 await test('QRIS and eligible customer CREDIT split with Wallet retain canonical rules',async()=>{
  const qr=(await core.account(req({kind:'QRIS',name:'Synthetic QRIS'}))).id;
  const s=await sale([{method:'QRIS',amount:1000,account_id:qr,reference:'Synthetic manual receipt'},wp(3000)],2);await ret(s.sale.id,2);
  const customer=(await core.party(req({kind:'CUSTOMER',name:'Synthetic Wallet credit',credit_allowed:true,credit_limit:10000}))).id;
  const request=req({shift_id:shift.id,customer_id:customer,due_date:'2030-01-01',items:[{product_id:product,quantity:2}],
   payments:[{method:'CREDIT',amount:1000},wp(3000)],request_id:key()});
  const posted=await core.sale(request);await ret(posted.sale.id,2);assert.equal(await balance(),'10000');
  await reject(()=>sale([{method:'CREDIT',amount:1000},wp(3000)],2),'REGISTERED_CREDIT_CUSTOMER_REQUIRED');
 });
 await test('Wallet checkout/refund/provision under calculated least privileges, no history UPDATE/DELETE',async()=>{
  await db.query(`GRANT SELECT ON unit_pendidikan,pos_business_units,unit_features,feature_catalog,tenant_features,santri,santri_units,wallet_accounts,wallet_transactions,
   pos_wallet_credentials,pos_wallet_credential_audits,pos_business_wallet_links TO pos_business_v2_fixture_runtime;
   GRANT INSERT ON wallet_transactions,pos_wallet_credentials,pos_wallet_credential_audits,pos_business_wallet_links TO pos_business_v2_fixture_runtime;
   GRANT UPDATE(id) ON unit_pendidikan,santri,santri_units TO pos_business_v2_fixture_runtime;
   GRANT UPDATE(unit_id) ON pos_business_units TO pos_business_v2_fixture_runtime;
   GRANT UPDATE(active,revoked_at) ON pos_wallet_credentials TO pos_business_v2_fixture_runtime;
   GRANT UPDATE(current_balance,updated_at) ON wallet_accounts TO pos_business_v2_fixture_runtime;
   GRANT USAGE,SELECT ON SEQUENCE wallet_transactions_id_seq TO pos_business_v2_fixture_runtime;`);
  const runtime=new Pool({host:'127.0.0.1',port:55439,user:'pos_business_v2_fixture_runtime',database:'pos_business_v2_test'});
  try{const svc=createPosBusinessService({db:runtime});await svc.walletPreview(req(scan()));
   const s=await sale([wp()],1,key(),svc);await ret(s.sale.id,1,key(),svc);
   const c=await svc.provisionWalletCredential(req({unit_id:2,santri_id:1}));await svc.revokeWalletCredential({...req({unit_id:2}),params:{businessId:biz,credentialId:c.id}});
   await reject(()=>runtime.query('DELETE FROM pos_business_wallet_links'),'42501');await reject(()=>runtime.query('UPDATE wallet_transactions SET amount=amount'),'42501');
  }finally{await runtime.end();}
 });
 await test('real HTTP auth and safe preview/provision responses, cashier refund denied, no credential logs',async()=>{
  const express=require('express'),{createPosBusinessRouter}=require('../routes/posBusinessRoutes');const app=express();app.use('/pos-business',createPosBusinessRouter({db}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const logs=[],old=console.error;console.error=(...args)=>logs.push(args);
  try{const base=`http://127.0.0.1:${server.address().port}/pos-business/${biz}`,send=(route,body,auth=token)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify(body)});
   assert.equal((await send('/wallet/preview',scan(),null)).status,401);
   const p=await send('/wallet/preview',scan(),cashier);assert.equal(p.status,200);assert.equal(p.headers.get('cache-control'),'no-store');assert.ok(!JSON.stringify(await p.json()).includes('0ab102ff'));
   assert.equal((await send('/wallet/credentials',{unit_id:2,santri_id:1},cashier)).status,403);
   const r=await send('/wallet/credentials',{unit_id:2,santri_id:1});assert.equal(r.status,200);assert.equal(r.headers.get('pragma'),'no-cache');
   const c=(await r.json()).data;assert.equal((await core.walletPreview(req(scan('QR',c.token)))).available_balance,'10000');
   const s=await sale([wp()]);assert.equal((await send('/sale-returns',{source_id:s.sale.id,items:[{product_id:product,quantity:1}],reason:'Synthetic',request_id:key()},cashier)).status,403);await ret(s.sale.id);
   assert.deepEqual(logs,[]);
  }finally{console.error=old;await new Promise(resolve=>server.close(resolve));}
 });
 await test('all Wallet links/payments/ledger balances/clearing reconcile Rp0; santri.saldo unchanged',async()=>{
  await sale([wp()]);await sale([{method:'CASH',amount:2000,tendered:2000,account_id:account}]);
  assert.equal((await q(`SELECT count(*) n FROM wallet_accounts w WHERE current_balance<>(SELECT sum(CASE WHEN direction='credit' THEN amount ELSE -amount END) FROM wallet_transactions WHERE wallet_account_id=w.id)`))[0].n,'0');
  assert.equal((await q(`SELECT count(*) n FROM pos_business_wallet_links l JOIN wallet_transactions w ON w.id=l.wallet_transaction_id WHERE l.amount<>w.amount OR l.direction<>w.direction OR l.wallet_account_id<>w.wallet_account_id`))[0].n,'0');
  assert.equal((await q("SELECT current_balance FROM wallet_accounts WHERE tenant_id=2"))[0].current_balance,'8000');
  assert.equal((await q('SELECT saldo FROM santri WHERE id=1'))[0].saldo,'777');
  assert.equal((await q("SELECT coalesce(sum(m.amount),0) n FROM pos_money_movements m JOIN pos_business_accounts a ON a.id=m.account_id WHERE a.business_id=$1 AND a.kind='WALLET_CLEARING'",[biz]))[0].n,'2000');
  assert.equal(await balance(),'8000');
  // Opening 200000 + actual CASH 2000; outstanding Wallet 2000 is NOT drawer cash.
  assert.equal((await core.closeShift(req({shift_id:shift.id,actual_cash:202000}))).difference,'0');
 });
 await test('099 DOWN rejects persisted Wallet history; original ledger remains byte-fingerprinted',async()=>{
  const before=await fingerprint(),c=await db.connect();try{await reject(()=>c.query(fs.readFileSync(path.join(__dirname,'../migrations/099_pos_business_wallet_rollback.sql'),'utf8')),'23514');}
  finally{await c.query('ROLLBACK');c.release();}assert.equal(await fingerprint(),before);
 });
 await test('deferred DB constraint rejects Rp1 clearing without a canonical Wallet debit',async()=>{
  const before=await fingerprint(),c=await db.connect();try{
   const actor=(await q("SELECT u.id FROM pos_merchant_users u WHERE login='owner'"))[0].id;
   const clear=(await q("SELECT id FROM pos_business_accounts WHERE business_id=$1 AND kind='WALLET_CLEARING'",[biz]))[0].id,op=key();
   await c.query('BEGIN');await c.query(`INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid)
    VALUES($1,$2,$3,'OPENING',$4,$5,1,1)`,[op,biz,actor,key(),'0'.repeat(64)]);
   await c.query('INSERT INTO pos_money_movements(id,business_id,account_id,operation_id,amount,actor_id) VALUES($1,$2,$3,$4,1,$5)',[key(),biz,clear,op,actor]);
   await reject(()=>c.query('COMMIT'),'23514');
  }finally{await c.query('ROLLBACK');c.release();}assert.equal(await fingerprint(),before);
 });
 console.log(`V2 Wallet: ${passed}/${passed} groups PASS; Rp0 mismatch; physical readers NOT VERIFIED.`);
}
main().catch(e=>{console.error('FAIL V2 Wallet fixture',{code:e.code||'ASSERTION',message:e.code?'Rejected/test failure':e.message});process.exitCode=1;}).finally(()=>db.end());
