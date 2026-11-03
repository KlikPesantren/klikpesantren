// Entire synthetic merchant/wallet fixture is rolled back. Never resets a schema.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),bcrypt=require('bcryptjs'),{Pool}=require('pg');
const pool=new Pool({host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_business_v2_test',max:1});
let client,passed=0,before;
const id=()=>crypto.randomUUID(),key=()=>`pricing-qa-${id()}`;
const tables=['pos_business_operations','pos_business_lines','pos_inventory_movements','pos_inventory_layers','pos_inventory_allocations','pos_business_payments','pos_money_movements','pos_debt_movements','wallet_accounts','wallet_transactions','pos_business_wallet_links'];
async function fingerprint(){const parts=[];for(const table of tables)parts.push((await client.query(`SELECT md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id::text),'')) hash FROM ${table} t`)).rows[0].hash);return parts.join(':');}
const test=async(name,f)=>{await f();passed++;console.log('PASS '+name);};
async function main(){
 client=await pool.connect();
 const identity=(await client.query('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.deepEqual(identity,{db:'pos_business_v2_test',current_user:'pos_test_owner',host:'127.0.0.1',port:55439});
 before=await fingerprint();await client.query('BEGIN');
 let serial=0;const stack=[];
 const connection={release(){},async query(sql,args){const command=typeof sql==='string'?sql.trim().toUpperCase():'';
  if(command.startsWith('BEGIN')){const save='qa_'+(++serial);stack.push(save);return client.query('SAVEPOINT '+save);}
  if(command==='COMMIT')return client.query('RELEASE SAVEPOINT '+stack.pop());
  if(command==='ROLLBACK'){const save=stack.pop();await client.query('ROLLBACK TO SAVEPOINT '+save);return client.query('RELEASE SAVEPOINT '+save);}
  // Nested service calls share the outer rollback transaction's now(). Give
  // synthetic layers real statement times so FIFO tests model separate posts.
  if(command.startsWith('INSERT INTO POS_INVENTORY_LAYERS('))sql=sql.replace('unit_cost)','unit_cost,created_at)').replace('$6)','$6,clock_timestamp())');
  return client.query(sql,args);
 }};
 const db={query:connection.query.bind(connection),connect:async()=>connection};
 const dbPath=require.resolve('../db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
 const core=require('../services/posBusinessService').createPosBusinessService({db,featureEnabled:async()=>true});
 const business=id(),other=id(),foreign=id(),owner=id(),cashier=id(),otherUser=id(),password=crypto.randomBytes(24).toString('hex');
 const hash=await bcrypt.hash(password,4);
 for(const user of [owner,cashier,otherUser])await client.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$3,$4)',[user,'qa-'+user,'Rollback QA',hash]);
 for(const [biz,tenant] of [[business,1],[other,1],[foreign,2]])await client.query("INSERT INTO pos_businesses(id,tenant_id,ownership,display_name,timezone,integration_enabled,wallet_enabled) VALUES($1,$2,'INTERNAL','Rollback pricing QA','Asia/Jakarta',true,true)",[biz,tenant]);
 for(const [biz,tenant,user,role] of [[business,1,owner,'OWNER'],[business,1,cashier,'CASHIER'],[other,1,otherUser,'OWNER'],[foreign,2,otherUser,'OWNER']])await client.query('INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,$2,$3,$4)',[biz,tenant,user,role]);
 const ownerToken=(await core.login({body:{login:'qa-'+owner,password}})).token,cashierToken=(await core.login({body:{login:'qa-'+cashier,password}})).token,otherToken=(await core.login({body:{login:'qa-'+otherUser,password}})).token;
 const req=(body={},token=ownerToken,biz=business,params={})=>({body,headers:{authorization:'Bearer '+token},params:{businessId:biz,...params},query:{}});
 const reject=(f,code)=>assert.rejects(f,e=>e.code===code);
 const product=async(name,price,token=ownerToken,biz=business)=>(await core.product(req({sku:key(),name,selling_price:price,uom:'pcs'},token,biz))).id;
 const air=await product('Air',5000),mie=await product('Mie',8000),foreignProduct=await product('Foreign',1000,otherToken,other);
 const supplier=(await core.party(req({kind:'SUPPLIER',name:'QA Supplier'}))).id;
 const customer=(await core.party(req({kind:'CUSTOMER',name:'QA Member',credit_allowed:true,credit_limit:'1000000',due_days:30}))).id;
 const cash=(await core.account(req({kind:'CASH',name:'QA Cash'}))).id,bank=(await core.account(req({kind:'BANK',name:'QA Bank'}))).id,qris=(await core.account(req({kind:'QRIS',name:'QA QRIS'}))).id;
 const terminal=(await core.terminal(req({name:'QA Terminal'}))).id;
 const shift=(await core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:'0'}))).id;
 const purchase=await core.purchase(req({supplier_id:supplier,items:[{product_id:air,quantity:'5',unit_cost:'1000'},{product_id:mie,quantity:'100',unit_cost:'3000'}],paid:'0',due_date:'2030-01-01',request_id:key()}));
 await core.purchase(req({supplier_id:supplier,items:[{product_id:air,quantity:'100',unit_cost:'2000'}],paid:'0',due_date:'2030-01-01',request_id:key()}));
 const member=await core.savePriceLevel(req({name:'Member'})),grosir=await core.savePriceLevel(req({name:'Grosir'}));
 await core.saveLevelPrice(req({level_id:member.id,product_id:air,price:'4500'}));await core.saveLevelPrice(req({level_id:grosir.id,product_id:air,price:'4000'}));
 const quote=body=>core.pricingQuote(req({items:[],...body}));
 let promo,bundle,bundleSale;
 await test('General/Member/Grosir/fallback/customer assignment retained but never selects transaction price',async()=>{
  assert.equal((await quote({items:[{product_id:air,quantity:'1'}]})).total,'5000');
  assert.equal((await quote({items:[{product_id:air,quantity:'1'}],price_level_id:grosir.id})).total,'4000');
  await core.assignCustomerPriceLevel(req({customer_id:customer,level_id:member.id}));
  assert.equal((await quote({items:[{product_id:air,quantity:'1'},{product_id:mie,quantity:'1'}],customer_id:customer})).total,'13000');
  await core.savePriceLevel(req({...member,active:false}));assert.equal((await quote({items:[{product_id:air,quantity:'1'}],customer_id:customer})).total,'5000');await core.savePriceLevel(req({...member,active:true}));
 });
 await test('merchant/tenant isolation, cashier policy/manual-price denial and currency/negative validation',async()=>{
  await reject(()=>core.pricing(req({},ownerToken,other)),'MERCHANT_ACCESS_DENIED');await reject(()=>core.pricing(req({},ownerToken,foreign)),'MERCHANT_ACCESS_DENIED');
  await reject(()=>core.savePriceLevel(req({name:'Forbidden'},cashierToken)),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.savePromotion(req({name:'Forbidden',kind:'QUANTITY',product_id:air,threshold:'3',group_price:'12500'},cashierToken)),'MERCHANT_PERMISSION_DENIED');
  await client.query("UPDATE pos_merchant_memberships SET permissions=$1 WHERE business_id=$2 AND user_id=$3",[['__EFFECTIVE_V1__','SALE_CREATE','PRODUCT_VIEW'],business,cashier]);
  await reject(()=>core.pricingQuote(req({items:[{product_id:air,quantity:'1',price_level_id:member.id}]},cashierToken)),'MERCHANT_PERMISSION_DENIED');
  await client.query("UPDATE pos_merchant_memberships SET permissions='{}' WHERE business_id=$1 AND user_id=$2",[business,cashier]);
  await reject(()=>core.saveLevelPrice(req({level_id:member.id,product_id:foreignProduct,price:'1'})),'PRODUCT_DENIED');
  const otherLevel=await core.savePriceLevel(req({name:'Other'},otherToken,other));await reject(()=>core.assignCustomerPriceLevel(req({customer_id:customer,level_id:otherLevel.id})),'PRICE_LEVEL_DENIED');
  await reject(()=>core.savePriceLevel(req({name:'USD',currency:'USD'})),'INVALID_CURRENCY');await reject(()=>core.saveLevelPrice(req({level_id:member.id,product_id:air,price:'-1'})),'INVALID_PRICING_INTEGER');
 });
 await test('quantity 1..7 and deterministic bundle preview',async()=>{
  const promoId=id(),promoBody={id:promoId,name:'Ratiban',kind:'QUANTITY',product_id:air,threshold:'3',mode:'EVERY',group_price:'12500',priority:12500,starts_at:'2020-01-01T00:00:00+07:00',ends_at:'2030-01-01T23:59:59+07:00'};
  promo=await core.savePromotion(req(promoBody));const replay=await core.savePromotion(req(promoBody));assert.equal(replay.id,promo.id);
  assert.equal((await client.query('SELECT count(*) n FROM pos_price_promotions WHERE id=$1 AND business_id=$2',[promoId,business])).rows[0].n,'1');
  await reject(()=>core.savePromotion(req(promoBody,otherToken,other)),'PROMOTION_DENIED');
  await reject(()=>core.savePromotion(req({...promoBody,id:id(),starts_at:'28-10-2026'})),'INVALID_PROMOTION_PERIOD');
  await core.savePromotion(req({...promoBody,active:false}));assert.equal((await core.pricing(req())).promotions.find(p=>p.id===promoId).active,false);
  await core.savePromotion(req({...promoBody,active:true}));assert.equal((await core.pricing(req())).promotions.find(p=>p.id===promoId).active,true);
  const expected=['5000','10000','12500','17500','22500','25000','30000'];for(let n=1;n<=7;n++)assert.equal((await quote({items:[{product_id:air,quantity:String(n)}]})).total,expected[n-1]);
  bundle=await core.savePromotion(req({name:'Air + Mie',kind:'BUNDLE',group_price:'11000',components:[{product_id:air,quantity:'1'},{product_id:mie,quantity:'1'}]}));
  assert.equal((await quote({packages:[{promotion_id:bundle.id,quantity:'1'}]})).total,'11000');
 });
 const sell=async(body,payments,token=ownerToken)=>core.sale(req({items:[],request_id:key(),shift_id:shift,...body,payments},token));
 const cashPayment=value=>[{method:'CASH',amount:String(value),account_id:cash,tendered:String(value)}];
 await test('bundle canonical stock, FIFO, exact allocation and immutable historical snapshot',async()=>{
  bundleSale=await sell({packages:[{promotion_id:bundle.id,quantity:'1'}]},cashPayment(11000));
  assert.equal(bundleSale.sale.total,'11000');assert.equal(bundleSale.items.reduce((s,l)=>s+BigInt(l.total),0n),11000n);
  assert.equal((await client.query('SELECT count(*) n FROM pos_inventory_movements WHERE operation_id=$1',[bundleSale.sale.id])).rows[0].n,'2');
  assert.equal((await client.query('SELECT sum(cogs) n FROM pos_business_lines WHERE operation_id=$1',[bundleSale.sale.id])).rows[0].n,'4000');
  const historic=JSON.stringify(bundleSale.items);await core.savePromotion(req({id:bundle.id,name:'Edited',kind:'BUNDLE',group_price:'10000',components:[{product_id:air,quantity:'1'},{product_id:mie,quantity:'1'}]}));
  assert.equal(JSON.stringify((await core.receipt(req({},ownerToken,business,{operationId:bundleSale.sale.id}))).items),historic);
  const fifo=await sell({items:[{product_id:air,quantity:'7'}]},cashPayment(30000));assert.equal((await client.query('SELECT sum(cogs) n FROM pos_business_lines WHERE operation_id=$1',[fifo.sale.id])).rows[0].n,'10000');
  const mixed={items:[{product_id:air,quantity:'3'}],packages:[{promotion_id:bundle.id,quantity:'3'}]};
  const total=(await quote(mixed)).total;assert.equal(total,'42500');const combined=await sell(mixed,cashPayment(total));
  assert.equal(combined.items.find(l=>l.product_id===air).quantity,'6');assert.equal((await client.query('SELECT count(*) n FROM pos_inventory_movements WHERE operation_id=$1',[combined.sale.id])).rows[0].n,'2');
 });
 await test('insufficient component stock, forged totals and unauthorized manual discount leave no partial sale',async()=>{
  const count=async()=>(await client.query('SELECT count(*) n FROM pos_business_operations WHERE business_id=$1',[business])).rows[0].n;
  const before=await count();await reject(()=>sell({packages:[{promotion_id:bundle.id,quantity:'1000'}]},cashPayment(10000000)),'INSUFFICIENT_STOCK');
  await reject(()=>sell({items:[{product_id:air,quantity:'1',unit_price:'1'}]},cashPayment(1)),'PAYMENT_TOTAL_MISMATCH');
  const drawer=(await core.account(req({kind:'CASH',name:'QA Cashier'}))).id,terminal=(await core.terminal(req({name:'QA Cashier'}))).id;
  const cashierShift=(await core.openShift(req({terminal_id:terminal,cash_account_id:drawer,opening_cash:'0'},cashierToken))).id;
  await reject(()=>core.sale(req({items:[{product_id:air,quantity:'1'}],request_id:key(),shift_id:cashierShift,discount:'500',discount_reason:'Unauthorized',payments:[{method:'CASH',amount:'4500',account_id:drawer,tendered:'4500'}]},cashierToken)),'DISCOUNT_DENIED');
  assert.equal(await count(),before);
  const cashierSale=await core.sale(req({items:[{product_id:air,quantity:'1'}],request_id:key(),shift_id:cashierShift,payments:[{method:'CASH',amount:'5000',account_id:drawer,tendered:'5000'}]},cashierToken));assert.equal(cashierSale.sale.total,'5000');
 });
 await test('cash/bank/QRIS/credit/split all use the same canonical quote total',async()=>{
  const body={items:[{product_id:air,quantity:'3'}]},total=(await quote(body)).total;
  for(const method of ['BANK','QRIS']){const r=await sell(body,[{method,amount:total,account_id:method==='BANK'?bank:qris,reference:key(),manual_confirmed:true,confirmation_mode:'MANUAL'}]);assert.equal(r.sale.total,total);}
  const creditBody={items:[{product_id:air,quantity:'1'}],customer_id:customer,due_date:'2030-01-01'};
  const creditTotal=(await quote(creditBody)).total;const creditSale=await sell(creditBody,[{method:'CREDIT',amount:creditTotal}]);assert.equal(creditSale.sale.total,creditTotal);
  await core.saveLevelPrice(req({level_id:member.id,product_id:air,price:'4000'}));assert.equal((await core.receipt(req({},ownerToken,business,{operationId:creditSale.sale.id}))).items[0].unit_price,'5000');await core.saveLevelPrice(req({level_id:member.id,product_id:air,price:'4500'}));
  await reject(()=>sell({...body,discount:'2500',discount_reason:'No stacking'},cashPayment(10000)),'DISCOUNT_STACKING_DENIED');
  const manual=await sell({items:[{product_id:air,quantity:'1'}],discount:'500',discount_reason:'Owner authorized'},cashPayment(4500));assert.equal(manual.sale.total,'4500');assert.equal(manual.items[0].discount,'500');
  const split=await sell(body,[{method:'CASH',amount:'5000',account_id:cash,tendered:'5000'},{method:'BANK',amount:String(BigInt(total)-5000n),account_id:bank,reference:key(),manual_confirmed:true,confirmation_mode:'MANUAL'}]);assert.equal(split.sale.total,total);
 });
 await test('wallet quote total, exact retry, single stock/debit and canonical refund',async()=>{
  await client.query('INSERT INTO pos_business_units(business_id,tenant_id,unit_id) VALUES($1,1,2)',[business]);
  const person=1900000000+crypto.randomInt(1000000),uid=crypto.randomBytes(8).toString('hex');
  await client.query("INSERT INTO santri(id,tenant_id,nama,status,uid_rfid,saldo) VALUES($1,1,'Rollback QA','Aktif',$2,0)",[person,uid]);
  await client.query("INSERT INTO santri_units(id,tenant_id,santri_id,unit_id,status) VALUES($1,1,$1,2,'active')",[person]);
  const wallet=(await client.query("INSERT INTO wallet_accounts(tenant_id,unit_id,santri_id,current_balance) VALUES(1,2,$1,0) RETURNING id",[person])).rows[0].id;
  await client.query("INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,source,idempotency_key,location_unit_id) VALUES($1,1,2,$2,'opening_balance','credit',100000,100000,'pricing_qa',$3,2)",[wallet,person,key()]);
  await client.query('UPDATE wallet_accounts SET current_balance=100000 WHERE id=$1',[wallet]);
  const total=(await quote({items:[{product_id:air,quantity:'3'}]})).total;
  const body={items:[{product_id:air,quantity:'3'}],request_id:key(),shift_id:shift,payments:[{method:'DOMPET_SANTRI',amount:total,credential_method:'RFID',credential:uid,unit_id:2}]};
  const sale=await core.sale(req(body)),replay=await core.sale(req(body));assert.equal(replay.sale.id,sale.sale.id);
  assert.equal((await client.query("SELECT count(*) n FROM pos_business_wallet_links WHERE operation_id=$1 AND direction='debit'",[sale.sale.id])).rows[0].n,'1');
  assert.equal((await client.query('SELECT count(*) n FROM pos_inventory_movements WHERE operation_id=$1',[sale.sale.id])).rows[0].n,'1');
  const returned=await core.saleReturn(req({source_id:sale.sale.id,items:[{product_id:air,quantity:'3'}],reason:'Rollback QA',request_id:key()}));assert.equal(returned.total,total);
  assert.equal((await client.query('SELECT current_balance FROM wallet_accounts WHERE id=$1',[wallet])).rows[0].current_balance,'100000');
 });
 await test('partial bundle returns reconcile original amounts and cannot over-return',async()=>{
  const values=[];for(const line of bundleSale.items){const r=await core.saleReturn(req({source_id:bundleSale.sale.id,items:[{product_id:line.product_id,quantity:'1'}],shift_id:shift,reason:'Rollback QA',request_id:key()}));values.push(BigInt(r.total));}
  assert.equal(values.reduce((s,n)=>s+n,0n),11000n);
  await reject(()=>core.saleReturn(req({source_id:bundleSale.sale.id,items:[{product_id:air,quantity:'1'}],shift_id:shift,reason:'Rollback QA',request_id:key()})),'OVER_RETURN');
 });
 await test('purchase invoice reads historical cost/UOM, enforces scope, and never posts a journal',async()=>{
  const count=(await client.query('SELECT count(*) n FROM pos_business_operations')).rows[0].n;
  const detail=await core.purchaseDetail(req({},ownerToken,business,{operationId:purchase.id}));assert.equal(detail.items.find(i=>i.product_id===air).unit_price,'1000');assert.equal(detail.items[0].uom,'pcs');
  await reject(()=>core.purchaseDetail(req({},otherToken,other,{operationId:purchase.id})),'PURCHASE_NOT_FOUND');
  assert.equal((await client.query('SELECT count(*) n FROM pos_business_operations')).rows[0].n,count);
 });
 await test('retry survives subsequent price edits without recomputing historical sale',async()=>{
  const body={items:[{product_id:air,quantity:'1'}],request_id:key(),shift_id:shift,payments:cashPayment(5000)};
  const first=await core.sale(req(body));await client.query('UPDATE pos_business_products SET selling_price=7000 WHERE id=$1',[air]);
  const repeat=await core.sale(req(body));assert.equal(repeat.sale.id,first.sale.id);assert.equal(repeat.sale.total,'5000');
 });
 await test('final General reference: percent/fixed, item Member/Grosir without customer, no stacking and immutable refunds',async()=>{
  await client.query('UPDATE pos_business_products SET selling_price=5000 WHERE id=$1',[air]);
  const percent=await core.savePromotion(req({name:'Aqua 15 persen',kind:'PERCENT',product_id:air,discount_bps:'1500',priority:100}));
  assert.equal((await quote({items:[{product_id:air,quantity:'1'}]})).total,'4250');
  assert.equal((await quote({items:[{product_id:air,quantity:'1'}],customer_id:customer})).total,'4250');
  for(const [level,total] of [[member,'13500'],[grosir,'12000']]){
   const q=await quote({items:[{product_id:air,quantity:'3',price_level_id:level.id}]});assert.equal(q.total,total);assert.equal(q.offers.length,0);assert.equal(q.lines[0].discount,'0');
  }
  await reject(()=>quote({items:[{product_id:mie,quantity:'1',price_level_id:member.id}]}),'PRICE_LEVEL_PRICE_UNAVAILABLE');
  const selected=await core.pricingQuote(req({items:[{product_id:air,quantity:'1',price_level_id:member.id}]},cashierToken));assert.equal(selected.total,'4500');
  const special={items:[{product_id:air,quantity:'1',price_level_id:member.id}],discount:'100',discount_reason:'forbidden stacking'};
  await reject(()=>sell(special,cashPayment(4400)),'DISCOUNT_STACKING_DENIED');
  await reject(()=>sell({items:[{product_id:air,quantity:'1'}],discount:'100',discount_reason:'forbidden promo stacking'},cashPayment(4150)),'DISCOUNT_STACKING_DENIED');
  await reject(()=>core.savePromotion(req({name:'invalid',kind:'PERCENT',product_id:air,discount_bps:'10001'})),'INVALID_DISCOUNT');
  await reject(()=>core.savePromotion(req({name:'invalid',kind:'FIXED',product_id:air,discount_amount:'5001'})),'INVALID_DISCOUNT');
  const fixed=await core.savePromotion(req({name:'Potong seribu',kind:'FIXED',product_id:air,discount_amount:'1000',priority:200}));
  const q=await quote({items:[{product_id:air,quantity:'1'}]});assert.equal(q.total,'4000');assert.equal(q.offers.length,1);
  const posted=await sell({items:[{product_id:air,quantity:'1'}]},cashPayment(4000)),snapshot=JSON.stringify(posted.items);
  await core.savePromotion(req({id:fixed.id,name:'Potong seribu',kind:'FIXED',product_id:air,discount_amount:'2000',priority:200}));
  assert.equal(JSON.stringify((await core.receipt(req({},ownerToken,business,{operationId:posted.sale.id}))).items),snapshot);
  const returned=await core.saleReturn(req({source_id:posted.sale.id,items:[{product_id:air,quantity:'1'}],shift_id:shift,reason:'Snapshot refund',request_id:key()}));assert.equal(returned.total,'4000');
  await client.query('UPDATE pos_price_promotions SET active=false WHERE id=ANY($1::uuid[])',[[percent.id,fixed.id]]);
 });
 await test('mixed special item plus bundle preserves commercial gross, no fake product discount and full refund',async()=>{
  const day=(await client.query("SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS day")).rows[0].day;
  const before=await core.report({...req(),query:{date:day}}),body={items:[{product_id:air,quantity:'1',price_level_id:member.id}],packages:[{promotion_id:bundle.id,quantity:'1'}]};
  const q=await quote(body);assert.equal(q.total,'14500');assert.equal(q.subtotal,'17500');assert.equal(q.discount,'3000');
  const posted=await sell(body,cashPayment(q.total)),after=await core.report({...req(),query:{date:day}});
  assert.equal(BigInt(after.kpi.gross_before_discount)-BigInt(before.kpi.gross_before_discount),17500n);assert.equal(BigInt(after.kpi.discounts)-BigInt(before.kpi.discounts),3000n);
  const returned=await core.saleReturn(req({source_id:posted.sale.id,items:posted.items.map(p=>({product_id:p.product_id,quantity:p.quantity})),shift_id:shift,reason:'Mixed snapshot refund',request_id:key()}));assert.equal(returned.total,'14500');
 });
 await test('legacy targeted promos paused without rewriting data; conflicting promo priority independent of item order',async()=>{
  const legacy=id();await client.query("INSERT INTO pos_price_promotions(id,business_id,name,kind,product_id,threshold,group_price,level_id,priority) VALUES($1,$2,'Legacy Member','QUANTITY',$3,1,1,$4,999)",[legacy,business,air,member.id]);
  const before=(await client.query('SELECT row_to_json(p)::text body FROM pos_price_promotions p WHERE id=$1',[legacy])).rows[0].body;
  assert.equal((await quote({items:[{product_id:air,quantity:'1',price_level_id:member.id}]})).total,'4500');
  assert.equal((await quote({items:[{product_id:air,quantity:'1'}]})).total,'5000');
  assert.equal((await client.query('SELECT row_to_json(p)::text body FROM pos_price_promotions p WHERE id=$1',[legacy])).rows[0].body,before);
  const one={items:[{product_id:air,quantity:'3'},{product_id:mie,quantity:'1'}]},two={items:[...one.items].reverse()};
  assert.deepEqual(await quote(one),await quote(two));
  await reject(()=>core.savePromotion(req({id:legacy,name:'legacy',kind:'QUANTITY',product_id:air,threshold:'1',group_price:'1',level_id:member.id})),'LEGACY_PROMOTION_REQUIRES_REVIEW');
 });

 if(process.env.POS_PRICING_UI_QA==='1'){
  await client.query('UPDATE pos_price_promotions SET active=false WHERE business_id=$1',[business]);
  await client.query('UPDATE pos_business_products SET selling_price=5000 WHERE id=$1',[air]);
  const fs=require('node:fs'),path=require('node:path'),express=require('express');
  fs.writeFileSync(path.join(__dirname,'../.tmp/pricing-ui-fixture.json'),JSON.stringify({owner:{login:'qa-'+owner,password},cashier:{login:'qa-'+cashier,password},business_id:business,air,mie,member:member.id,grosir:grosir.id,purchase_id:purchase.id}));
  const {app}=await require('./pos-business-local-app').createLocalPosApp(db,{fixture:true});
  const host=express();let queue=Promise.resolve();
  host.use((req,res,next)=>{const previous=queue;let release;queue=new Promise(resolve=>{release=resolve;});res.once('finish',release);res.once('close',release);previous.then(next);});
  await new Promise(resolve=>{const server=host.listen(55441,'127.0.0.1',()=>console.log('ROLLBACK_UI_QA_READY 127.0.0.1:55441'));
   host.post('/__qa_finish',(_req,res)=>{res.json({done:true});server.close(resolve);});host.use(app);
  });
 }
 await test('WS3 shift conflict has operator context and forbids Owner takeover',async()=>{
  const s=(await client.query("SELECT id FROM pos_business_shifts WHERE business_id=$1 AND user_id=$2 AND status='OPEN'",[business,cashier])).rows[0];assert(s);
  await reject(()=>core.closeShift(req({shift_id:s.id,actual_cash:'0'})),'SHIFT_DENIED');
  await reject(()=>core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:'0'},cashierToken)),'SHIFT_ALREADY_OPEN');
  const w=await core.workspace(req());assert(w.active_shifts.some(row=>row.user_id===cashier&&row.operator_name&&row.terminal_name&&row.drawer_name));
 });
 const wsProduct=await product('WS3 Operational',5000);await core.purchase(req({supplier_id:supplier,items:[{product_id:wsProduct,quantity:'30',unit_cost:'2000'}],paid:'0',due_date:'2030-01-01',request_id:key()}));
 const cs=(await client.query("SELECT id,cash_account_id FROM pos_business_shifts WHERE business_id=$1 AND user_id=$2 AND status='OPEN'",[business,cashier])).rows[0];
 await test('WS3 Owner config -> Cashier Member without customer -> payment -> immutable receipt/report',async()=>{
  const level=await core.savePriceLevel(req({name:'WS3 Member'}));await core.saveLevelPrice(req({level_id:level.id,product_id:wsProduct,price:'4500'}));
  assert.equal((await core.pricingQuote(req({items:[{product_id:wsProduct,quantity:'1',price_level_id:level.id}]},cashierToken))).total,'4500');
  const paid=await core.sale(req({request_id:key(),shift_id:cs.id,items:[{product_id:wsProduct,quantity:'1',price_level_id:level.id}],payments:[{method:'CASH',account_id:cs.cash_account_id,amount:'4500',tendered:'10000'}]},cashierToken));assert.equal(paid.sale.total,'4500');
  await core.saveLevelPrice(req({level_id:level.id,product_id:wsProduct,price:'4200'}));const receipt=await core.receipt(req({},ownerToken,business,{operationId:paid.sale.id}));assert.equal(receipt.items[0].total,'4500');assert.equal(receipt.items[0].discount,'0');
  assert((await core.report({...req(),query:{from:'2020-01-01',to:'2099-12-31'}})).financial_position);
 });
 await test('WS3 Bank/QRIS manual evidence and no posting on failed confirmation',async()=>{
  const count=async()=>(await client.query('SELECT count(*) n FROM pos_business_operations WHERE business_id=$1',[business])).rows[0].n;
  for(const [method,account]of [['BANK',bank],['QRIS',qris]]){const before=await count(),body={request_id:key(),shift_id:cs.id,items:[{product_id:wsProduct,quantity:'1'}],payments:[{method,account_id:account,amount:'5000',reference:'TEST ONLY'}]};await reject(()=>core.sale(req(body,cashierToken)),'PAYMENT_CONFIRMATION_REQUIRED');assert.equal(await count(),before);body.payments[0]={...body.payments[0],manual_confirmed:true,confirmation_mode:'MANUAL'};assert.equal((await core.sale(req(body,cashierToken))).sale.total,'5000');}
 });
 const wsPerson=1800000000+crypto.randomInt(1000000),wsUid='00'+crypto.randomBytes(6).toString('hex');
 await client.query("INSERT INTO santri(id,tenant_id,nama,status,uid_rfid,saldo) VALUES($1,1,'TEST ONLY WS3','Aktif',$2,0)",[wsPerson,wsUid]);
 await client.query("INSERT INTO santri_units(id,tenant_id,santri_id,unit_id,status) VALUES($1::bigint,1,$1::integer,2,'active')",[wsPerson]);
 const wsWallet=(await client.query('INSERT INTO wallet_accounts(tenant_id,unit_id,santri_id,current_balance) VALUES(1,2,$1,0) RETURNING id',[wsPerson])).rows[0].id;
 await client.query("INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,source,idempotency_key,location_unit_id) VALUES($1,1,2,$2,'opening_balance','credit',100000,100000,'ws3_qa',$3,2)",[wsWallet,wsPerson,key()]);await client.query('UPDATE wallet_accounts SET current_balance=100000 WHERE id=$1',[wsWallet]);
 const wp=(method='RFID',credential=wsUid)=>({credential_method:method,credential,unit_id:2});
 await test('WS3 revoked token, inactive Wallet, wrong tenant/unit fail closed without debit',async()=>{
  const card=await core.provisionWalletCredential(req({unit_id:2,santri_id:wsPerson}));assert.equal((await core.walletPreview(req(wp('BARCODE',card.token),cashierToken))).eligible,true);
  await reject(()=>core.provisionWalletCredential(req({unit_id:2,santri_id:wsPerson},cashierToken)),'MERCHANT_PERMISSION_DENIED');
  await core.revokeWalletCredential(req({unit_id:2},ownerToken,business,{credentialId:card.id}));await reject(()=>core.walletPreview(req(wp('BARCODE',card.token),cashierToken)),'CREDENTIAL_DISABLED');
  await reject(()=>core.sale(req({request_id:key(),shift_id:cs.id,items:[{product_id:wsProduct,quantity:'1'}],payments:[{method:'DOMPET_SANTRI',amount:'5000',...wp('QR',card.token)}]},cashierToken)),'CREDENTIAL_DISABLED');
  await reject(()=>core.walletPreview(req({...wp(),unit_id:3},cashierToken)),'WALLET_UNIT_DENIED');await reject(()=>core.walletPreview(req(wp(),otherToken,other)),'WALLET_UNIT_DENIED');
  await client.query("UPDATE wallet_accounts SET status='frozen' WHERE id=$1",[wsWallet]);await reject(()=>core.walletPreview(req(wp(),cashierToken)),'WALLET_NOT_ACTIVE');await client.query("UPDATE wallet_accounts SET status='active' WHERE id=$1",[wsWallet]);
  assert.equal((await client.query('SELECT current_balance FROM wallet_accounts WHERE id=$1',[wsWallet])).rows[0].current_balance,'100000');
 });
 const wsSale=()=>({request_id:key(),shift_id:cs.id,items:[{product_id:wsProduct,quantity:'1'}],payments:[{method:'DOMPET_SANTRI',amount:'5000',...wp()}]});
 let wsPaid;await test('WS3 lost response -> persisted-intent retry -> one debit and one FIFO movement',async()=>{
  const {createSaleJournal}=require('../pos-app/src/saleJournal.cjs');let saved=null,lose=true;const vault={read:async()=>saved,write:async(_key,value)=>{saved=structuredClone(value);},remove:async()=>{saved=null;}};
  const journal=createSaleJournal({vault,send:async body=>{const result=await core.sale(req(body,cashierToken));if(lose){lose=false;throw Object.assign(Error('NETWORK_TIMEOUT'),{code:'NETWORK_TIMEOUT'});}return result;}});
  await assert.rejects(journal.submit(wsSale(),{business_id:business,user_id:cashier}),e=>e.code==='NETWORK_TIMEOUT');const frozen=structuredClone(saved.payload);wsPaid=await journal.submit(null,{business_id:business,user_id:cashier});assert.equal(wsPaid.replay,true);assert.equal(saved,null);
  assert.equal((await client.query("SELECT count(*) n FROM pos_business_wallet_links WHERE operation_id=$1 AND direction='debit'",[wsPaid.sale.id])).rows[0].n,'1');assert.equal((await client.query('SELECT count(*) n FROM pos_inventory_movements WHERE operation_id=$1',[wsPaid.sale.id])).rows[0].n,'1');assert.equal((await client.query('SELECT current_balance FROM wallet_accounts WHERE id=$1',[wsWallet])).rows[0].current_balance,'95000');assert.equal(frozen.request_id,(await client.query('SELECT request_id FROM pos_business_operations WHERE id=$1',[wsPaid.sale.id])).rows[0].request_id);
 });
 await test('WS3 refund before payout credits original Wallet once and removes obligation',async()=>{
  const body={request_id:key(),source_id:wsPaid.sale.id,items:[{product_id:wsProduct,quantity:'1'}],reason:'TEST ONLY WS3 refund'},first=await core.saleReturn(req(body)),retry=await core.saleReturn(req(body));assert.equal(first.id,retry.id);assert.equal((await client.query('SELECT current_balance FROM wallet_accounts WHERE id=$1',[wsWallet])).rows[0].current_balance,'100000');
  assert.equal((await client.query("SELECT sum(CASE WHEN direction='debit' THEN amount ELSE -amount END)::text n FROM pos_business_wallet_links WHERE wallet_account_id=$1",[wsWallet])).rows[0].n,'0');
 });
 // Local-only ACL rehearsal, inside the outer rollback transaction.
 await client.query('GRANT UPDATE(id) ON public.cash_accounts TO suq_clone_runtime_7d4e9e147f');
 const adminId=1700000000+crypto.randomInt(1000000),treasury=(await client.query("SELECT id FROM cash_accounts WHERE tenant_id=1 AND account_type='foundation' AND status='active'")).rows[0].id;await client.query("INSERT INTO users(id,tenant_id,nama,username,role,status) VALUES($1,1,'TEST ONLY WS3',$2,'superadmin','Aktif')",[adminId,key()]);await client.query("INSERT INTO cash_account_transactions(tenant_id,cash_account_id,tanggal,jenis,kategori,nominal,source,idempotency_key) VALUES(1,$1,'2030-01-01','Masuk','TEST ONLY',100000,'ws3_qa',$2)",[treasury,key()]);
 const admin=require('../services/posAdminService').createPosAdminService({db,permissionList:async()=>['pos.view','pos.reconcile']});
 const ar=(body={})=>({user:{id:adminId,tenant_id:1,role:'superadmin'},tenantId:1,headers:{},query:{unit_id:2},body:{unit_id:2,...body},params:{}});
 await test('WS3 payout once, no new revenue; post-payout refund creates recovery',async()=>{
  const paid=await core.sale(req(wsSale(),cashierToken)),before=BigInt((await core.books(req())).accounts.find(a=>a.id===bank).balance),sales=(await client.query("SELECT count(*) n FROM pos_business_operations WHERE business_id=$1 AND kind='SALE'",[business])).rows[0].n;
  const link=(await client.query("SELECT id FROM pos_business_wallet_links WHERE operation_id=$1 AND direction='debit'",[paid.sale.id])).rows[0].id;
  const body={business_id:business,cash_account_id:treasury,merchant_account_id:bank,obligations:[{obligation_id:link,expected_outstanding:'5000'}],payout_date:new Date().toISOString().slice(0,10),reference:'TEST ONLY WS3 payout',request_id:key()};
  const payout=await admin.settleWallet(ar(body)),retry=await admin.settleWallet(ar(body));assert.equal(payout.id,retry.id);assert.equal(retry.replay,true); await client.query('SET LOCAL ROLE suq_clone_runtime_7d4e9e147f');await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('RESET ROLE');await client.query('SET CONSTRAINTS ALL DEFERRED');
  assert.equal(BigInt((await core.books(req())).accounts.find(a=>a.id===bank).balance)-before,5000n);assert.equal((await client.query("SELECT count(*) n FROM cash_account_transactions WHERE cash_account_id=$1 AND jenis='Keluar' AND idempotency_key=$2",[treasury,'pos-wallet-settlement:'+body.request_id])).rows[0].n,'1');assert.equal((await client.query("SELECT count(*) n FROM pos_business_operations WHERE business_id=$1 AND kind='SALE'",[business])).rows[0].n,sales);
  const debits=(await client.query("SELECT count(*) n FROM wallet_transactions WHERE wallet_account_id=$1 AND direction='debit'",[wsWallet])).rows[0].n;
  await core.saleReturn(req({request_id:key(),source_id:paid.sale.id,items:[{product_id:wsProduct,quantity:'1'}],reason:'TEST ONLY post payout'}));
  assert.equal((await client.query("SELECT count(*) n FROM wallet_transactions WHERE wallet_account_id=$1 AND direction='debit'",[wsWallet])).rows[0].n,debits);assert.equal((await client.query('SELECT current_balance FROM wallet_accounts WHERE id=$1',[wsWallet])).rows[0].current_balance,'100000');assert.equal((await core.settlementPosition(req())).recovery,'5000');
  assert.equal((await core.report({...req(),query:{from:'2020-01-01',to:'2099-12-31'}})).financial_position.settlement.recovery,'5000');
  const denied=require('../services/posAdminService').createPosAdminService({db,permissionList:async()=>[]});await reject(()=>denied.settleWallet(ar({...body,request_id:key()})),'PERMISSION_DENIED');await reject(()=>admin.settleWallet(ar({...body,request_id:key(),business_id:other})),'MERCHANT_SCOPE_DENIED');
 });
 await test('WS3 legitimate cashier close/retry retains audit; closed shift rejects new sale',async()=>{
  const balance=(await client.query('SELECT coalesce(sum(amount),0)::text n FROM pos_money_movements WHERE business_id=$1 AND account_id=$2',[business,cs.cash_account_id])).rows[0].n;
  const closed=await core.closeShift(req({shift_id:cs.id,actual_cash:balance},cashierToken));assert.equal(closed.status,'CLOSED');assert.equal(closed.difference,'0');assert(closed.closed_at);assert.equal((await core.closeShift(req({shift_id:cs.id,actual_cash:balance},cashierToken))).replay,true);
  await reject(()=>core.sale(req({...wsSale(),payments:[{method:'CASH',amount:'5000',account_id:cs.cash_account_id,tendered:'5000'}]},cashierToken)),'SHIFT_NOT_OPEN');
 });







 await client.query('SET CONSTRAINTS ALL IMMEDIATE');console.log('DEFERRED FINANCIAL RECONCILIATION PASS');
 await client.query('ROLLBACK');assert.equal(await fingerprint(),before);console.log('OPERATIONAL FINANCIAL FINGERPRINT UNCHANGED');console.log(`PASS ${passed} rollback-isolated database scenarios`);
}
main().catch(e=>{console.error('FAIL',e.code||e.name,e.message?.split('\n')[0]);if(e.code==='ERR_ASSERTION')console.error('ASSERT',e.actual,e.expected);process.exitCode=1;}).finally(async()=>{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await pool.end();});
