// Runs on the literal isolated V2 fixture database; no .env or production pool.
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const crypto=require('node:crypto'); const {Pool}=require('pg');
const {createPosBusinessService}=require('../services/posBusinessService');
const db=new Pool({host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_business_v2_test',max:12});
let passed=0,token,business,account,bank,product,supplier,customer,shift;
const q=async(sql,p=[])=>(await db.query(sql,p)).rows;
const core=createPosBusinessService({db}); const key=()=>crypto.randomUUID();
const req=(body={},t=token,target=business)=>({headers:{authorization:'Bearer '+t},params:{businessId:target},body,query:{}});
const test=async(name,fn)=>{await fn();passed++;console.log('PASS '+name);};
const reject=(fn,code)=>assert.rejects(fn,e=>e.code===code);
const finger=async()=>{
 const h=crypto.createHash('sha256');
 for(const table of ['pos_business_operations','pos_business_lines','pos_business_payments','pos_inventory_movements',
  'pos_inventory_layers','pos_inventory_allocations','pos_money_movements','pos_debt_movements']) {
  h.update(table);h.update(JSON.stringify(await q(`SELECT * FROM ${table} ORDER BY id`)));
 }
 return h.digest('hex');
};
const purchase=async(qty=10,cost=1000,paid=0)=>core.purchase(req({items:[{product_id:product,quantity:qty,unit_cost:cost}],supplier_id:supplier,
 paid,account_id:account,due_date:'2026-11-01',request_id:key()}));
const sale=async(qty,method='CASH')=>core.sale(req({shift_id:shift.id,customer_id:method==='CREDIT'?customer:null,
 items:[{product_id:product,quantity:qty}],due_date:'2026-11-01',
 payments:[{method,account_id:method==='BANK'?bank:account,amount:qty*2000,tendered:qty*2000,reference:'Synthetic evidence'}],request_id:key()}));
const ret=(source,qty,extras={})=>req({source_id:source,items:[{product_id:product,quantity:qty}],shift_id:shift.id,reason:'Synthetic return evidence',request_id:key(),...extras});
async function main(){
 const i=(await q('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port'))[0];
 assert.deepEqual(i,{db:'pos_business_v2_test',current_user:'pos_test_owner',host:'127.0.0.1',port:55439});
 await test('098 UP/DOWN/second UP preserves full 097 posted history',async()=>{
  const before=await finger(),up=fs.readFileSync(path.join(__dirname,'../migrations/098_pos_business_returns.sql'),'utf8');
  await db.query(up);await db.query(fs.readFileSync(path.join(__dirname,'../migrations/098_pos_business_returns_rollback.sql'),'utf8'));
  assert.equal(await finger(),before);await db.query(up);
 });
 token=(await core.login({body:{login:'owner',password:'Synthetic-only-V2-password'}})).token;
 business=(await q("SELECT business_id FROM pos_merchant_memberships m JOIN pos_merchant_users u ON u.id=m.user_id WHERE u.login='owner'"))[0].business_id;
 account=(await core.account(req({name:'Return fixture drawer',kind:'CASH'}))).id;
 bank=(await core.account(req({name:'Return fixture bank',kind:'BANK'}))).id;
 product=(await core.product(req({sku:key(),name:'Return fixture',selling_price:2000}))).id;
 supplier=(await core.party(req({kind:'SUPPLIER',name:'Return fixture supplier'}))).id;
 customer=(await core.party(req({kind:'CUSTOMER',name:'Return fixture customer',credit_allowed:true,credit_limit:100000}))).id;
 await core.money(req({kind:'CAPITAL',account_id:account,amount:100000,reason:'Synthetic funding',request_id:key()}));
 const t=await core.terminal(req({name:'Returns terminal'}));
 shift=await core.openShift(req({terminal_id:t.id,cash_account_id:account,opening_cash:0}));
 await purchase(100);
 await test('partial/full cash return restores exact original COGS, quantity, cash; history unchanged',async()=>{
  const s=await sale(3),before=await q('SELECT * FROM pos_business_operations WHERE id=$1',[s.sale.id]);
  const b=ret(s.sale.id,1);const r=await core.saleReturn(b);assert.equal(r.refund,'2000');assert.equal((await core.saleReturn(b)).replay,true);
  assert.equal((await core.saleReturn(ret(s.sale.id,2))).refund,'4000');
  await reject(()=>core.saleReturn(ret(s.sale.id,1)),'OVER_RETURN');
  assert.deepEqual(await q('SELECT * FROM pos_business_operations WHERE id=$1',[s.sale.id]),before);
  assert.equal((await q("SELECT sum(l.cogs) n FROM pos_business_lines l JOIN pos_business_operations o ON o.id=l.operation_id WHERE o.source_id=$1",[s.sale.id]))[0].n,'3000');
 });
 await test('concurrent distinct/identical returns cannot duplicate refund or over-return',async()=>{
  const s=await sale(1),b=ret(s.sale.id,1);const [a,z]=await Promise.all([core.saleReturn(b),core.saleReturn(b)]);assert.equal(a.id,z.id);
  const s2=await sale(1),results=await Promise.allSettled([core.saleReturn(ret(s2.sale.id,1)),core.saleReturn(ret(s2.sale.id,1))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'OVER_RETURN');
 });
 await test('credit return reduces AR first; collected AR refunds original receiving account only',async()=>{
  const s=await sale(2,'CREDIT');await core.payDebt(req({kind:'AR',source_id:s.sale.id,account_id:bank,amount:1000,request_id:key()}));
  const r=await core.saleReturn(ret(s.sale.id,1));assert.equal(r.debt_reduction,'2000');assert.equal(r.refund,'0');
  await reject(()=>core.saleReturn(ret(s.sale.id,1)),'REFUND_CONFIRMATION_REQUIRED');
  const r2=await core.saleReturn(ret(s.sale.id,1,{refund_confirmed:true,reference:'Synthetic bank refund evidence'}));
  assert.equal(r2.debt_reduction,'1000');assert.equal(r2.refund,'1000');
 });
 await test('split refund reverses unpaid credit before cash without arbitrary payout',async()=>{
  const s=await core.sale(req({shift_id:shift.id,customer_id:customer,items:[{product_id:product,quantity:2}],
   payments:[{method:'CASH',account_id:account,amount:1000,tendered:1000},{method:'CREDIT',amount:3000}],due_date:'2026-11-01',request_id:key()}));
  const r=await core.saleReturn(ret(s.sale.id,1));assert.equal(r.debt_reduction,'2000');assert.equal(r.refund,'0');
  const r2=await core.saleReturn(ret(s.sale.id,1));assert.equal(r2.debt_reduction,'1000');assert.equal(r2.refund,'1000');
 });
 await test('manual BANK refund requires evidence and never alters physical drawer',async()=>{
  const s=await sale(1,'BANK'),before=(await q('SELECT coalesce(sum(amount),0) n FROM pos_money_movements WHERE account_id=$1',[account]))[0].n;
  await reject(()=>core.saleReturn(ret(s.sale.id,1)),'REFUND_CONFIRMATION_REQUIRED');
  await core.saleReturn(ret(s.sale.id,1,{refund_confirmed:true,reference:'Synthetic confirmation'}));
  assert.equal((await q('SELECT coalesce(sum(amount),0) n FROM pos_money_movements WHERE account_id=$1',[account]))[0].n,before);
 });
 await test('credit purchase return reduces AP; partial/retry/over-return guarded',async()=>{
  const p=await purchase(4),b=ret(p.id,2);const r=await core.purchaseReturn(b);assert.equal(r.debt_reduction,'2000');assert.equal(r.refund,'0');
  assert.equal((await core.purchaseReturn(b)).replay,true);
  await core.purchaseReturn(ret(p.id,2));await reject(()=>core.purchaseReturn(ret(p.id,1)),'OVER_RETURN');
 });
 await test('paid supplier return requires confirmed receipt; credits money, no new purchase',async()=>{
  const p=await purchase(2,1000,2000);await reject(()=>core.purchaseReturn(ret(p.id,1)),'REFUND_CONFIRMATION_REQUIRED');
  const count=(await q("SELECT count(*) n FROM pos_business_operations WHERE kind='PURCHASE'"))[0].n;
  const r=await core.purchaseReturn(ret(p.id,1,{refund_confirmed:true}));assert.equal(r.refund,'1000');
  assert.equal((await q("SELECT count(*) n FROM pos_business_operations WHERE kind='PURCHASE'"))[0].n,count);
 });
 await test('consumed original purchase layers cannot be replaced with unrelated stock',async()=>{
  const isolated=(await core.product(req({sku:key(),name:'Consumed',selling_price:2000}))).id;
  const p=await core.purchase(req({items:[{product_id:isolated,quantity:1,unit_cost:1000}],supplier_id:supplier,paid:0,due_date:'2026-11-01',request_id:key()}));
  await core.sale(req({shift_id:shift.id,items:[{product_id:isolated,quantity:1}],payments:[{method:'CASH',account_id:account,amount:2000,tendered:2000}],request_id:key()}));
  await reject(()=>core.purchaseReturn(req({source_id:p.id,items:[{product_id:isolated,quantity:1}],reason:'Synthetic return',request_id:key()})),'PURCHASE_STOCK_CONSUMED');
 });
 await test('unauthorized cashier/cross-business return rejected before mutation',async()=>{
  const s=await sale(1),before=await finger();const c=(await core.login({body:{login:'cashier',password:'Synthetic-only-V2-password'}})).token;
  await reject(()=>core.saleReturn({...ret(s.sale.id,1),headers:{authorization:'Bearer '+c}}),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.saleReturn({...ret(s.sale.id,1),params:{businessId:crypto.randomUUID()}}),'MERCHANT_ACCESS_DENIED');assert.equal(await finger(),before);
 });
 await test('forced refund failure rolls back restored inventory, debt and money',async()=>{
  const s=await sale(1),before=await finger();const fail=createPosBusinessService({db,afterStage:async stage=>{if(stage==='return-money')throw Object.assign(Error('fixture'),{code:'FORCED_TEST'});}});
  await reject(()=>fail.saleReturn(ret(s.sale.id,1)),'FORCED_TEST');assert.equal(await finger(),before);
 });
 await test('discounted partial returns sum exactly to original net sale, preserving Rupiah rounding',async()=>{
  const s=await core.sale(req({shift_id:shift.id,items:[{product_id:product,quantity:3}],discount:1,discount_reason:'Synthetic rounding',
   payments:[{method:'CASH',account_id:account,amount:5999,tendered:5999}],request_id:key()}));
  const values=[];for(let n=0;n<3;n++)values.push((await core.saleReturn(ret(s.sale.id,1))).total);
  assert.deepEqual(values,['1999','2000','2000']);assert.equal(values.reduce((n,v)=>n+BigInt(v),0n),5999n);
 });
 await test('return idempotency key cannot be reused for different quantity/reason',async()=>{
  const s=await sale(2),b=ret(s.sale.id,1);await core.saleReturn(b);const before=await finger();
  await reject(()=>core.saleReturn({...b,body:{...b.body,reason:'Changed'}}),'IDEMPOTENCY_CONFLICT');
  await reject(()=>core.saleReturn({...b,body:{...b.body,items:[{product_id:product,quantity:2}]}}),'IDEMPOTENCY_CONFLICT');
  assert.equal(await finger(),before);
 });
 await test('partial returns restore original multi-layer FIFO cost, not current purchase cost',async()=>{
  const item=(await core.product(req({sku:key(),name:'Synthetic mixed FIFO',selling_price:4000}))).id;
  for(const cost of [1000,3000])await core.purchase(req({items:[{product_id:item,quantity:1,unit_cost:cost}],supplier_id:supplier,
   paid:0,due_date:'2026-11-01',request_id:key()}));
  const s=await core.sale(req({shift_id:shift.id,items:[{product_id:item,quantity:2}],payments:[{method:'CASH',account_id:account,amount:8000,tendered:8000}],request_id:key()}));
  const costs=[];for(let n=0;n<2;n++){
   const r=await core.saleReturn(req({source_id:s.sale.id,items:[{product_id:item,quantity:1}],shift_id:shift.id,reason:'Synthetic original FIFO',request_id:key()}));
   costs.push((await q('SELECT cogs FROM pos_business_lines WHERE operation_id=$1',[r.id]))[0].cogs);
  }
  assert.deepEqual(costs,['1000','3000']);assert.equal((await q('SELECT sum(quantity) n FROM pos_inventory_movements WHERE product_id=$1',[item]))[0].n,'2');
 });
 await test('concurrent purchase returns cannot exceed original quantity or duplicate supplier credit',async()=>{
  const p=await purchase(1),results=await Promise.allSettled([core.purchaseReturn(ret(p.id,1)),core.purchaseReturn(ret(p.id,1))]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'OVER_RETURN');
  assert.equal((await q('SELECT sum(amount) n FROM pos_debt_movements WHERE source_id=$1',[p.id]))[0].n,'0');
 });
 await test('AP payment and purchase return serialize on original source; no overpayment/refund duplication',async()=>{
  const p=await purchase(2),results=await Promise.allSettled([
   core.payDebt(req({source_id:p.id,kind:'AP',account_id:account,amount:2000,request_id:key()})),
   core.purchaseReturn(ret(p.id,2,{refund_confirmed:true}))]);
  assert.equal(results[1].status,'fulfilled');
  if(results[0].status==='rejected')assert.equal(results[0].reason.code,'DEBT_OVERPAYMENT');
  assert.equal((await q('SELECT sum(amount) n FROM pos_debt_movements WHERE source_id=$1',[p.id]))[0].n,'0');
  assert.equal((await q(`SELECT coalesce(sum(m.amount),0) n FROM pos_money_movements m JOIN pos_business_operations o ON o.id=m.operation_id
   WHERE o.id=$1 OR o.source_id=$1`,[p.id]))[0].n,'0');
 });
 await test('returns and debt collection work with existing exact runtime privileges; histories remain immutable',async()=>{
  const runtime=new Pool({host:'127.0.0.1',port:55439,user:'pos_business_v2_fixture_runtime',database:'pos_business_v2_test'});
  try {
   const svc=createPosBusinessService({db:runtime}),s=await sale(1,'CREDIT');
   await svc.payDebt(req({source_id:s.sale.id,kind:'AR',account_id:bank,amount:2000,request_id:key()}));
   assert.equal((await svc.saleReturn(ret(s.sale.id,1,{refund_confirmed:true,reference:'Synthetic refund'}))).refund,'2000');
   const p=await purchase(1);assert.equal((await svc.purchaseReturn(ret(p.id,1))).debt_reduction,'1000');
   await reject(()=>runtime.query('UPDATE pos_business_operations SET total=total'),'42501');
   await reject(()=>runtime.query('DELETE FROM pos_money_movements'),'42501');
  } finally {await runtime.end();}
 });
 await test('real HTTP return router authenticates/authorizes and returns no-store success/replay',async()=>{
  const express=require('express'),{createPosBusinessRouter}=require('../routes/posBusinessRoutes');
  const app=express();app.use('/v2',createPosBusinessRouter({db}));const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try {
   const s=await sale(1),b=ret(s.sale.id,1).body,url=`http://127.0.0.1:${server.address().port}/v2/${business}/sale-returns`;
   const send=auth=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...(auth?{authorization:'Bearer '+auth}:{})},body:JSON.stringify(b)});
   assert.equal((await send()).status,401);
   const cashier=(await core.login({body:{login:'cashier',password:'Synthetic-only-V2-password'}})).token;assert.equal((await send(cashier)).status,403);
   const r=await send(token);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.equal((await r.json()).data.refund,'2000');assert.equal((await (await send(token)).json()).data.replay,true);
  } finally {await new Promise(resolve=>server.close(resolve));}
 });
 await test('deferred DB guard rejects incomplete return and DOWN refuses posted returns without history changes',async()=>{
  const before=await finger(),c=await db.connect();
  try {
   await c.query('BEGIN');await c.query(`INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid,source_id,reason)
    SELECT $1,business_id,actor_id,'SALE_RETURN',$2,request_hash,1,1,id,'Synthetic invalid return' FROM pos_business_operations WHERE kind='SALE' LIMIT 1`,[key(),key()]);
   await reject(()=>c.query('COMMIT'),'23514');await c.query('ROLLBACK');assert.equal(await finger(),before);
   await reject(()=>c.query(fs.readFileSync(path.join(__dirname,'../migrations/098_pos_business_returns_rollback.sql'),'utf8')),'23514');
  } finally {await c.query('ROLLBACK');c.release();}
  assert.equal(await finger(),before);
 });
 await test('report net revenue/net COGS, shift cash and all return legs reconcile Rp0',async()=>{
  const report=await core.report({...req(),query:{from:'2020-01-01',to:'2099-12-31'}});assert.equal(report.kpi.net_sales,(BigInt(report.kpi.sales)-BigInt(report.kpi.returns)).toString());
  // Supplier refunds affect the merchant account, not the checkout drawer.
  const expected=(await q(`SELECT coalesce(sum(m.amount),0) n FROM pos_money_movements m JOIN pos_business_operations o ON o.id=m.operation_id WHERE o.shift_id=$1 AND m.account_id=$2 AND o.kind IN('SALE','SALE_RETURN')`,[shift.id,account]))[0].n;
  assert.equal((await core.closeShift(req({shift_id:shift.id,actual_cash:expected}))).difference,'0');
  assert.equal((await q(`SELECT count(*) n FROM pos_business_operations o WHERE o.kind IN('SALE_RETURN','PURCHASE_RETURN') AND
   o.total-o.paid<>-(SELECT coalesce(sum(amount),0) FROM pos_debt_movements WHERE operation_id=o.id)`))[0].n,'0');
  assert.equal(report.payment_methods.reduce((n,r)=>n+BigInt(r.sale_amount),0n),BigInt(report.kpi.sales));
  assert.equal(report.refunds_by_account_kind.reduce((n,r)=>n+BigInt(r.refunded_amount),0n)+BigInt(report.kpi.returned_receivable),BigInt(report.kpi.returns));
  assert.equal(BigInt(report.kpi.pos_net_sales)+BigInt(report.kpi.online_net_sales),BigInt(report.kpi.net_sales));
  assert.equal(BigInt(report.kpi.gross_profit),BigInt(report.kpi.net_sales)-BigInt(report.kpi.cogs));
 });
 await test('CRM customer spend/returns/AR aggregate independently without join multiplication',async()=>{
  const data=await core.customers(req());const metric=data.customers.find(r=>r.id===customer);assert.ok(metric);
  const s=(await q(`SELECT sum(total) total,count(*) n FROM pos_business_operations WHERE business_id=$1 AND party_id=$2 AND kind='SALE'`,[business,customer]))[0];
  const returned=(await q(`SELECT coalesce(sum(total),0) total FROM pos_business_operations WHERE business_id=$1 AND party_id=$2 AND kind='SALE_RETURN'`,[business,customer]))[0].total;
  const ar=(await q(`SELECT coalesce(sum(amount),0) n FROM pos_debt_movements WHERE business_id=$1 AND party_id=$2 AND kind='AR'`,[business,customer]))[0].n;
  assert.equal(metric.gross_spend,s.total);assert.equal(metric.transaction_count,s.n);assert.equal(metric.net_spend,(BigInt(s.total)-BigInt(returned)).toString());
  assert.equal(metric.returned_value,returned);assert.equal(metric.outstanding_receivable,ar);
  assert.equal(BigInt(metric.pos_spend)+BigInt(metric.online_spend),BigInt(metric.net_spend));
  assert.equal(BigInt(metric.average_transaction),BigInt(s.total)/BigInt(s.n));
  assert.ok(data.customers.every(r=>r.id && r.name));
 });
 await test('CRM rankings deterministic; private metrics reject cashier/cross-business and invalid sort',async()=>{
  for(const ranking of ['SPEND','FREQUENCY','RECENT'])assert.equal((await core.customers({...req(),query:{ranking}})).ranking,ranking);
  const cashier=(await core.login({body:{login:'cashier',password:'Synthetic-only-V2-password'}})).token;
  await reject(()=>core.customers(req({},cashier)),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.aging(req({},cashier)),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.customers(req({},token,key())),'MERCHANT_ACCESS_DENIED');
  await reject(()=>core.customers({...req(),query:{ranking:'SPEND; DROP TABLE'}}),'INVALID_RANKING');
 });
 await test('AP/AR aging nets partial payments and returns per source exactly once; buckets reconcile',async()=>{
  for(const kind of ['AR','AP']){
   const a=await core.aging({...req(),query:{kind,as_of:'2030-01-01'}});
   const direct=(await q('SELECT coalesce(sum(amount),0) n FROM pos_debt_movements WHERE business_id=$1 AND kind=$2',[business,kind]))[0].n;
   assert.equal(a.outstanding,direct);assert.equal(Object.values(a.buckets).reduce((n,v)=>n+BigInt(v),0n),BigInt(direct));
   assert.equal(new Set(a.items.map(r=>r.source_id)).size,a.items.length);assert.ok(a.items.every(r=>BigInt(r.outstanding)>0n));
   assert.ok(a.items.every(r=>r.bucket==='91_PLUS'));assert.equal(a.buckets.CURRENT,'0');
  }
  await reject(()=>core.aging({...req(),query:{kind:'INVALID'}}),'INVALID_DEBT_KIND');
  await reject(()=>core.aging({...req(),query:{as_of:'2026-02-30'}}),'INVALID_DUE_DATE');
 });
 await test('read projections run with runtime SELECT grants and cannot mutate history',async()=>{
  const before=await finger(),runtime=new Pool({host:'127.0.0.1',port:55439,user:'pos_business_v2_fixture_runtime',database:'pos_business_v2_test'});
  try{const svc=createPosBusinessService({db:runtime});await svc.customers(req());await svc.aging(req());}
  finally{await runtime.end();}assert.equal(await finger(),before);
 });
 console.log(`V2 RETURNS: ${passed}/${passed} groups PASS, Rp0 mismatch; Wallet/online NOT implemented.`);
}
main().catch(e=>{console.error('FAIL returns fixture',{code:e.code||'ASSERTION',message:e.code?'rejected/test failure':e.message});process.exitCode=1;}).finally(()=>db.end());
