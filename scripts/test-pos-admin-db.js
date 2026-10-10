/* Generated/destructive fixtures confined to the exact loopback PostgreSQL
 * database used by Phase 1. Never reads DATABASE_URL or production secrets. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{performance}=require('node:perf_hooks'),{Pool}=require('pg');
const {readMigration}=require('../utils/migrationLedger');
const options={host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_phase1_test',max:12};
process.env.JWT_SECRET='pos-local-test-only-not-a-deployment-secret';process.env.WALI_JWT_SECRET='pos-local-wali-test-only-not-a-deployment-secret';process.env.DOTENV_CONFIG_QUIET='true';
let db,server,runtime;let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const req=(query={unit_id:2},id=1,body={},params={})=>({query,body,params,headers:{},tenantId:id===4?2:1,user:{id,tenant_id:id===4?2:1,role:id===1?'superadmin':id===5?'denied':'cashier'}});
const rejects=(fn,code)=>assert.rejects(fn,e=>e.code===code);
async function fingerprint(){return (await db.query(`SELECT (SELECT md5(string_agg(row_to_json(s)::text,'|' ORDER BY id)) FROM pos_sales s) sales,
 (SELECT md5(string_agg(row_to_json(p)::text,'|' ORDER BY id)) FROM pos_payments p) payments,
 (SELECT md5(string_agg(row_to_json(w)::text,'|' ORDER BY id)) FROM wallet_accounts w) wallets,
 (SELECT md5(string_agg(row_to_json(w)::text,'|' ORDER BY id)) FROM wallet_transactions w) ledger,
 (SELECT md5(string_agg(row_to_json(i)::text,'|' ORDER BY id)) FROM pos_sale_items i) items`)).rows[0];}
async function seedScale(){
 await db.query(`UPDATE merchant_rfid SET pos_enabled=true WHERE id IN(2,3);UPDATE devices SET pos_enabled=true WHERE id IN(3,4);
 INSERT INTO users(id,tenant_id,nama,username,role,status)VALUES(7,1,'Synthetic Unit B Cashier','scale-cashier','cashier','active');INSERT INTO user_unit_scope VALUES(7,1,3,'active');
 INSERT INTO pos_cashier_assignments(tenant_id,unit_id,merchant_id,user_id) VALUES(1,3,2,7),(2,4,3,4);
 INSERT INTO pos_shifts(id,tenant_id,unit_id,merchant_id,terminal_id,cashier_id,status,opening_cash)VALUES(gen_random_uuid(),1,3,2,3,7,'OPEN',1000),(gen_random_uuid(),2,4,3,4,4,'OPEN',1000);
 INSERT INTO wallet_accounts(tenant_id,unit_id,santri_id,current_balance)VALUES(2,4,2,0);
 INSERT INTO pos_products(id,tenant_id,unit_id,merchant_id,sku,name,price)VALUES(gen_random_uuid(),1,2,1,'SCALE-1','Synthetic Scale A',100),(gen_random_uuid(),1,3,2,'SCALE-2','Synthetic Scale B',100),(gen_random_uuid(),2,4,3,'SCALE-3','Synthetic Foreign',100);`);
 const c=await db.connect();try{await c.query('BEGIN');
 await c.query(`INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,source,idempotency_key)
 SELECT id,tenant_id,unit_id,santri_id,'topup','credit',1000000,current_balance+1000000,'test','scale-opening:'||id FROM wallet_accounts;
 UPDATE wallet_accounts SET current_balance=current_balance+1000000;
 CREATE TEMP TABLE pos_admin_scale ON COMMIT DROP AS
 SELECT gen_random_uuid() sale,gen_random_uuid() payment,s.id shift,s.tenant_id,s.unit_id,s.merchant_id,s.terminal_id,s.cashier_id,p.id product,p.sku,p.name,w.id account,w.santri_id,w.current_balance,
 i,CASE i%3 WHEN 0 THEN 'RFID' WHEN 1 THEN 'CASH' ELSE 'TRANSFER_QRIS' END method
 FROM pos_shifts s JOIN pos_products p ON p.merchant_id=s.merchant_id AND p.sku LIKE 'SCALE-%'
 JOIN wallet_accounts w ON w.tenant_id=s.tenant_id AND w.unit_id=s.unit_id CROSS JOIN generate_series(1,1000)i WHERE s.status='OPEN';
 INSERT INTO pos_sales(id,receipt,tenant_id,unit_id,merchant_id,terminal_id,cashier_id,shift_id,merchant_name,cashier_name,terminal_name,business_date,timezone,subtotal,discount,grand_total,status,request_id,request_hash,created_at)
 SELECT sale,'SCALE-'||sale,tenant_id,unit_id,merchant_id,terminal_id,cashier_id,shift,'Synthetic Merchant','Synthetic Cashier','Synthetic Terminal','2026-10-01','Asia/Jakarta',100,0,100,'PAID','SCALE-'||sale,repeat('a',64),'2026-10-01 01:00:00+00'::timestamptz+i*interval '1 second' FROM pos_admin_scale;
 INSERT INTO pos_sale_items(id,sale_id,tenant_id,unit_id,merchant_id,product_id,sku,name,quantity,unit_price,gross,discount,total)
 SELECT gen_random_uuid(),sale,tenant_id,unit_id,merchant_id,product,sku,name,1,100,100,0,100 FROM pos_admin_scale;
 INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,source,reference_type,reference_id,actor_user_id,merchant_id,device_id,idempotency_key)
 SELECT account,tenant_id,unit_id,santri_id,'payment','debit',100,current_balance-100*row_number() OVER(PARTITION BY account ORDER BY i), 'pos','pos_payment',payment::text,cashier_id,merchant_id,terminal_id,'scale:'||payment FROM pos_admin_scale WHERE method='RFID';
 INSERT INTO pos_payments(id,sale_id,tenant_id,unit_id,merchant_id,method,status,amount,wallet_account_id,wallet_transaction_id,tendered,change,external_reference,verified_by,verified_at)
 SELECT x.payment,x.sale,x.tenant_id,x.unit_id,x.merchant_id,x.method,'CONFIRMED',100,CASE WHEN x.method='RFID' THEN x.account END,w.id,CASE WHEN x.method='CASH' THEN 100 END,CASE WHEN x.method='CASH' THEN 0 END,CASE WHEN x.method='TRANSFER_QRIS' THEN 'SYNTHETIC-'||x.payment END,x.cashier_id,now()
 FROM pos_admin_scale x LEFT JOIN wallet_transactions w ON w.reference_type='pos_payment' AND w.reference_id=x.payment::text;
 UPDATE wallet_accounts a SET current_balance=a.current_balance-x.debit FROM(SELECT account,count(*)*100 debit FROM pos_admin_scale WHERE method='RFID' GROUP BY account)x WHERE a.id=x.account;
 `);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 await db.query('ANALYZE');
}
async function main(){
 const result=spawnSync(process.execPath,[path.join(__dirname,'test-pos-v1-db.js')],{stdio:'inherit'});assert.equal(result.status,0,'Phase 1 fixture/test must pass');
 db=new Pool(options);assert.deepEqual((await db.query('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0],{db:options.database,current_user:options.user,host:options.host,port:options.port});
 require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:db};
 await db.query(`ALTER TABLE devices ADD COLUMN device_id text,ADD COLUMN status text DEFAULT 'offline',ADD COLUMN last_ping timestamptz,ADD COLUMN last_sync timestamptz,ADD COLUMN firmware_version text;`);
 await test('095 UP/DOWN/UP preserves Phase 1 sales/items/payments/Wallet',async()=>{
  const before=await fingerprint();await db.query(readMigration('095_pos_admin_control_center.sql').sql);assert.equal((await db.query("SELECT count(*)::integer n FROM permissions WHERE key='pos.reconcile'")).rows[0].n,1);
  await db.query(fs.readFileSync(path.join(__dirname,'../migrations/095_pos_admin_control_center_rollback.sql'),'utf8'));assert.equal((await db.query("SELECT to_regclass('pos_sales_admin_date') i")).rows[0].i,null);
  assert.deepEqual(await fingerprint(),before);await db.query(readMigration('095_pos_admin_control_center.sql').sql);assert.deepEqual(await fingerprint(),before);
 });
 require('../middleware/requirePermission').invalidateCache();
 const {createPosAdminService}=require('../services/posAdminService'),admin=createPosAdminService({db}),{createPosService}=require('../services/posService'),pos=createPosService({db,featureEnabled:async()=>true});
 await test('authenticated tenant authority, own units, ALL reads and fail-closed writes',async()=>{
  await rejects(()=>admin.dashboard({query:{unit_id:2}}),'UNAUTHENTICATED');await rejects(()=>admin.dashboard(req({unit_id:2},5)),'PERMISSION_DENIED');
  await rejects(()=>admin.dashboard(req({unit_id:3},2)),'UNIT_ACCESS_DENIED');await rejects(()=>admin.dashboard(req({unit_id:4},1)),'UNIT_NOT_FOUND');
  await rejects(()=>admin.dashboard({...req(),tenantId:2}),'TENANT_ACCESS_DENIED');await rejects(()=>admin.dashboard(req({})),'UNIT_REQUIRED');
  await rejects(()=>admin.dashboard(req({scope:'all'},2)),'UNIT_ACCESS_DENIED');
  await rejects(()=>admin.editCategory(req({scope:'all'},1,{name:'No',active:true},{id:'00000000-0000-0000-0000-000000000001'})),'UNIT_REQUIRED');
  await rejects(()=>admin.reconciliation(req({unit_id:2},2)),'PERMISSION_DENIED');
 });
 await test('management safe projections and Attendance terminal cannot acquire POS',async()=>{
  for(const kind of ['products','categories','merchants','cashiers','users','terminals']){const r=await admin.management(req({unit_id:2},1,{}, {kind}));assert(r.rows.length<=25);assert(!/device_secret|uid_rfid|password|request_hash/.test(JSON.stringify(r)));}
  await rejects(()=>admin.configureTerminal(req({unit_id:2},1,{unit_id:2,merchant_id:1,pos_enabled:true},{id:5})),'ATTENDANCE_TERMINAL_FROZEN');
  await rejects(()=>admin.configureTerminal(req({unit_id:2},1,{unit_id:2,merchant_id:3,pos_enabled:true},{id:1})),'MERCHANT_SCOPE_DENIED');
  await rejects(()=>admin.configureTerminal(req({unit_id:2},1,{unit_id:2,merchant_id:1,pos_enabled:true},{id:3})),'TERMINAL_SCOPE_DENIED');
  await rejects(()=>pos.assignCashier(req({unit_id:2},1,{unit_id:2,user_id:4},{id:1})),'UNIT_ACCESS_DENIED');
 });
 await test('category edit/product archive keeps immutable transaction snapshots',async()=>{
  const before=await fingerprint(),category=await pos.category(req({},1,{unit_id:2,merchant_id:1,name:'Synthetic Phase 2'}));
  await admin.editCategory(req({},1,{unit_id:2,name:'Renamed category',active:false},{id:category.id}));
  const p=(await db.query("SELECT * FROM pos_products WHERE sku='TEST-1'")).rows[0];
  await pos.product(req({},1,{...p,unit_id:2,merchant_id:1,price:'9007199254740993',active:false,available:false},{id:p.id}));
  assert.deepEqual(await fingerprint(),before);
 });
 await test('legacy merchant only explicit authorized assignment; historical unit cannot move',async()=>{
  const list=await admin.management(req({unit_id:2},1,{}, {kind:'merchants'}));assert(list.rows.some(m=>m.id===4&&m.unit_id===null));
  const m=await admin.editMerchant(req({},1,{unit_id:2,name:'Explicit synthetic owner',active:true,pos_enabled:true},{id:4}));assert.equal(m.unit_id,2);
  await rejects(()=>admin.editMerchant(req({},1,{unit_id:3,name:'Illegal move',active:true,pos_enabled:true},{id:1})),'MERCHANT_UNIT_CHANGE_FORBIDDEN');
 });
 await test('generated 3000 sales / 3 merchants / 3 units / 3 cashiers / 3 methods',seedScale);
 const scoped=req({unit_id:2,from:'2026-10-01',to:'2026-10-01'}),all=req({scope:'all',from:'2026-10-01',to:'2026-10-01'});
 await test('exact server KPIs, ALL unit set, pending/void exclusions, merchant/date filters',async()=>{
  const d=await admin.dashboard(scoped),a=await admin.dashboard(all);assert.equal(d.kpi.paid_transactions,'1000');assert.equal(d.kpi.gross_sales,'100000');assert.equal(d.kpi.net_sales,'100000');assert.equal(d.kpi.gross_items,'1000');assert.equal(d.kpi.average_paid,'100');
  assert.equal(a.kpi.paid_transactions,'2000');assert.equal(a.kpi.gross_sales,'200000');assert.equal(a.methods.length,3);
  assert.equal((await admin.dashboard(req({...all.query,merchant_id:2}))).kpi.gross_sales,'100000');
  assert.equal((await admin.dashboard(req({unit_id:2,from:'2020-01-01',to:'2020-01-01'}))).kpi.gross_sales,'0');
  const actual=(await db.query("SELECT sum(grand_total)::text gross,count(*)::text n FROM pos_sales WHERE tenant_id=1 AND unit_id=2 AND status='PAID'")).rows[0];
  const historical=await admin.dashboard(req());assert.equal(historical.kpi.gross_sales,actual.gross);assert.equal(historical.kpi.paid_transactions,actual.n);
  assert.equal(BigInt(historical.kpi.net_sales)+BigInt(historical.kpi.refunds),BigInt(actual.gross));
 });
 await test('stable bounded pagination/search/detail and non-overlapping pages',async()=>{
  const a=await admin.transactions(req({...all.query,page:1,page_size:25})),b=await admin.transactions(req({...all.query,page:2,page_size:25}));assert.equal(a.total,'2000');assert.equal(a.rows.length,25);assert(!a.rows.some(x=>b.rows.some(y=>x.id===y.id)));assert(a.rows.every(x=>x.tenant_id===1));
  const detail=await admin.detail(req(all.query,1,{}, {id:a.rows[0].id}));assert.equal(detail.items.length,1);assert.equal(detail.sale.grand_total,'100');
  assert.equal((await admin.transactions(req({...all.query,search:a.rows[0].receipt}))).rows.length,1);
  await rejects(()=>admin.transactions(req({unit_id:2,page_size:101})),'INVALID_PAGINATION');await rejects(()=>admin.transactions(req({unit_id:2,from:'2026-02-31'})),'INVALID_DATE');await rejects(()=>admin.shifts(req({unit_id:2,from:'2026-02-31'})),'INVALID_DATE');
  const foreign=(await db.query('SELECT id FROM pos_sales WHERE tenant_id=2 LIMIT 1')).rows[0];await rejects(()=>admin.detail(req(all.query,1,{},foreign)),'SALE_NOT_FOUND');
 });
 await test('RFID debit/credit reconciliation Rp0 and cash drawer math',async()=>{
  const r=await admin.reconciliation(all);assert.equal(r.wallet.pos_debit,'66600');assert.equal(r.wallet.wallet_debit,'66600');assert.equal(r.wallet.debit_difference,'0');assert.equal(r.wallet.credit_difference,'0');
  const shifts=await admin.shifts(req({scope:'all'}));for(const s of shifts.rows)assert.equal(BigInt(s.calculated_expected),BigInt(s.opening_cash)+BigInt(s.cash_sales)-BigInt(s.cash_refunds));
  const refunds=await admin.refunds(req({scope:'all'}));assert(refunds.rows.every(r=>r.merchant_id));
  console.log('RECONCILIATION selected scale cohort: RFID POS 66600 / Wallet debit 66600 / delta 0; refund/credit delta 0');
 });
 await test('read-only reports never mutate financial fingerprints; bounded query count independent of row count',async()=>{
  const before=await fingerprint();let queries=0;const wrapped={connect:async()=>{const c=await db.connect();return {query:(...args)=>{queries++;return c.query(...args);},release:()=>c.release()};}};
  const report=createPosAdminService({db:wrapped});await report.dashboard(all);assert(queries<20);queries=0;await report.transactions(all);assert(queries<12);assert.deepEqual(await fingerprint(),before);
 });
 await test('per-entry Rp1 mismatches cannot hide by offsetting aggregate differences (synthetic only)',async()=>{
  const before=await fingerprint();const ids=(await db.query("SELECT id FROM wallet_transactions WHERE source='pos' AND reference_type='pos_payment' AND amount=100 AND tenant_id=1 ORDER BY id LIMIT 2")).rows.map(r=>r.id);
  try{await db.query('UPDATE wallet_transactions SET amount=CASE WHEN id=$1 THEN 101 ELSE 99 END WHERE id=ANY($2::bigint[])',[ids[0],ids]);
   const r=await admin.reconciliation(all);assert.equal(r.wallet.debit_difference,'0');assert.equal(r.wallet.invalid_debit_links,'2');
  }finally{await db.query('UPDATE wallet_transactions SET amount=100 WHERE id=ANY($1::bigint[])',[ids]);}
  assert.deepEqual(await fingerprint(),before);
 });
 await test('least-privilege runtime reports/configuration; no DELETE/history UPDATE/DDL grants',async()=>{
  await db.query(`GRANT UPDATE(name,active) ON pos_categories TO pos_fixture_runtime;GRANT UPDATE(nama_merchant,status,unit_id,location_resolution_status) ON merchant_rfid TO pos_fixture_runtime;GRANT UPDATE(unit_id,merchant_id,location_resolution_status) ON devices TO pos_fixture_runtime;`);
  runtime=new Pool({...options,user:'pos_fixture_runtime'});const r=createPosAdminService({db:runtime});await r.dashboard(all);await r.reconciliation(all);await r.management(req({unit_id:2},1,{}, {kind:'terminals'}));
  await r.editMerchant(req({},1,{unit_id:2,name:'Runtime scoped config',active:true,pos_enabled:true},{id:4}));await r.configureTerminal(req({},1,{unit_id:2,merchant_id:1,pos_enabled:true},{id:1}));
  await rejects(()=>runtime.query('DELETE FROM pos_sales'),'42501');await rejects(()=>runtime.query('UPDATE pos_sale_items SET name=name'),'42501');await rejects(()=>runtime.query('CREATE TABLE forbidden_admin_fixture(id integer)'),'42501');
 });
 await test('real JWT HTTP route contract: 401/403/400 and successful Admin reads',async()=>{
  const express=require('express'),jwt=require('jsonwebtoken'),{createPosRouter}=require('../routes/posRoutes');const app=express();app.use(express.json());app.use('/pos',createPosRouter({pos,tenantContext:(req,res,next)=>{req.tenantId=req.user.tenant_id;next();}}));
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const origin=`http://127.0.0.1:${server.address().port}`;
  const token=id=>jwt.sign({id,tenant_id:1,role:id===1?'superadmin':'cashier',token_version:0},process.env.JWT_SECRET,{expiresIn:'5m'});
  assert.equal((await fetch(origin+'/pos/admin/dashboard?unit_id=2')).status,401);
  assert.equal((await fetch(origin+'/pos/admin/dashboard?unit_id=3',{headers:{Authorization:'Bearer '+token(2)}})).status,403);
  assert.equal((await fetch(origin+'/pos/admin/dashboard',{headers:{Authorization:'Bearer '+token(1)}})).status,400);
  for(const route of ['dashboard','transactions','shifts','refunds','reconciliation','management/terminals']){const r=await fetch(origin+'/pos/admin/'+route+'?unit_id=2',{headers:{Authorization:'Bearer '+token(1)}});assert.equal(r.status,200,route);const body=await r.json();assert(!/device_secret|uid_rfid|request_hash/.test(JSON.stringify(body)));if(body.data.rows)assert(body.data.rows.every(row=>row.unit_id==null||row.unit_id===2));}
  for(const unit of [2,3,2]){const r=await fetch(origin+'/pos/admin/transactions?unit_id='+unit+'&from=2026-10-01&to=2026-10-01',{headers:{Authorization:'Bearer '+token(1)}});assert.equal(r.status,200);const body=await r.json();assert.equal(body.data.total,'1000');assert(body.data.rows.every(row=>row.unit_id===unit));}
  const allResponse=await fetch(origin+'/pos/admin/transactions?scope=all&from=2026-10-01&to=2026-10-01',{headers:{Authorization:'Bearer '+token(1)}});assert.equal(allResponse.status,200);assert.equal((await allResponse.json()).data.total,'2000');
  assert.equal((await fetch(origin+'/pos/admin/categories/00000000-0000-0000-0000-000000000001?scope=all',{method:'PATCH',headers:{Authorization:'Bearer '+token(1),'Content-Type':'application/json'},body:JSON.stringify({name:'No',active:true})})).status,400);
 });
 await test('observed reporting latency at generated scale (no fabricated benchmark)',async()=>{
  for(const [name,fn]of [['dashboard',()=>admin.dashboard(all)],['transactions',()=>admin.transactions(all)],['reconciliation',()=>admin.reconciliation(all)]]){const samples=[];for(let i=0;i<5;i++){const start=performance.now();await fn();samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);console.log(`PERF ${name}: n=5 median=${samples[2].toFixed(1)}ms max=${samples[4].toFixed(1)}ms; isolated localhost only`);}
 });
 console.log(`POS Admin PostgreSQL: ${passed} test groups PASS`);
}
main().catch(e=>{console.error('POS Admin test FAIL',{code:e.code,message:e.message,stack:e.stack});process.exitCode=1;}).finally(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(runtime)await runtime.end();if(db)await db.end();});
