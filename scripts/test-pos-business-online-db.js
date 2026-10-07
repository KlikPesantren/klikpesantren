// Literal guarded localhost only; never imports .env or production credentials.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Pool}=require('pg');
const {createPosBusinessService}=require('../services/posBusinessService');
const {createLocalPosApp}=require('./pos-business-local-app');
const db=new Pool({host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_business_v2_test',max:16});
const q=async(s,v=[])=>(await db.query(s,v)).rows,id=()=>crypto.randomUUID(),access=()=>crypto.randomBytes(32).toString('hex');
let passed=0,biz,other,token,cashier,product,hidden,cash,bank,qris,shift,customer,customerToken,order,server;
require.cache[require.resolve('../db')]={id:require.resolve('../db'),filename:require.resolve('../db'),loaded:true,exports:db};
const core=createPosBusinessService({db}),test=async(n,f)=>{await f();passed++;console.log('PASS '+n);};
const reject=(f,code)=>assert.rejects(f,e=>e.code===code);
const req=(body={},auth=token,target=biz)=>({body,headers:{authorization:'Bearer '+auth},params:{businessId:target},query:{}});
const pub=(body={},extra={})=>({body,headers:{},params:{slug:'synthetic-store'},query:{},ip:'127.0.0.1',...extra});
const body=(p=product,quantity=1,extra={})=>({request_id:id(),order_access:access(),items:[{product_id:p,quantity}],recipient:'Synthetic Customer',phone:'000000000000',fulfillment:'PICKUP',payment_method:'BANK',...extra});
const transition=(o,status,extra={},svc=core,auth=token)=>svc.transition({...req({status,...extra},auth),params:{businessId:biz,orderId:o.id}});
const confirm=o=>transition(o,'CONFIRMED',{payment_confirmed:true,account_id:o.payment_method==='QRIS'?qris:bank,reference:'Synthetic manual receipt'});
const refund=o=>transition(o,'REFUNDED',{refund_confirmed:true,reference:'Synthetic refund',reason:'Synthetic return',shift_id:shift.id});
const profile=(extra={})=>({display_name:'Synthetic Branded Store',storefront_slug:'synthetic-store',storefront_enabled:true,
 logo_url:'https://example.com/logo.png',banner_url:'https://example.com/banner.png',brand_color:'#166534',description:'Synthetic public store',
 address:'Synthetic public address',phone:'000000000000',public_phone:true,hours_text:'Fixture hours',storefront_footer:'Synthetic footer',
 shipping_charge:5000,reservation_minutes:30,payment_instructions:'Manual test transfer; no gateway',...extra});
async function history(){const hash=crypto.createHash('sha256');for(const t of ['pos_business_operations','pos_business_lines','pos_business_payments','pos_inventory_movements','pos_inventory_layers','pos_inventory_allocations','pos_money_movements','pos_debt_movements','wallet_accounts','wallet_transactions'])hash.update(JSON.stringify(await q(`SELECT * FROM ${t} ORDER BY id`)));return hash.digest('hex');}
async function all(){const hash=crypto.createHash('sha256');for(const t of ['pos_online_orders','pos_online_order_lines','pos_online_reservations','pos_online_order_events'])hash.update(JSON.stringify(await q(`SELECT * FROM ${t} ORDER BY 1,2`)));hash.update(await history());return hash.digest('hex');}
async function newProduct(stock=20){const p=(await core.product(req({name:'Synthetic item',sku:id(),selling_price:2000,online_visible:true,category:'Synthetic category'}))).id;
 await core.adjustment(req({product_id:p,direction:'IN',quantity:stock,unit_cost:500,reason:'Synthetic opening',request_id:id()}));return p;}
async function setup(){
 assert.deepEqual((await q('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port'))[0],{db:'pos_business_v2_test',current_user:'pos_test_owner',host:'127.0.0.1',port:55439});
 await test('100 UP/DOWN/UP preserves nonempty canonical Wallet and V2 financial history',async()=>{
  const before=await history();await db.query(fs.readFileSync(path.join(__dirname,'../migrations/100_pos_business_online.sql'),'utf8'));
  await db.query(fs.readFileSync(path.join(__dirname,'../migrations/100_pos_business_online_rollback.sql'),'utf8'));assert.equal(await history(),before);
  await db.query(fs.readFileSync(path.join(__dirname,'../migrations/100_pos_business_online.sql'),'utf8'));assert.equal(await history(),before);
 });
 const owner=(await q("SELECT id FROM pos_merchant_users WHERE login='owner'"))[0].id,cu=(await q("SELECT id FROM pos_merchant_users WHERE login='cashier'"))[0].id;
 biz=id();other=id();for(const [b,t] of [[biz,1],[other,2]]){await db.query("INSERT INTO pos_businesses(id,tenant_id,ownership,display_name,timezone) VALUES($1,$2,'EXTERNAL','Synthetic online','Asia/Jakarta')",[b,t]);
 await db.query("INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,$2,$3,'OWNER')",[b,t,owner]);}
 await db.query("INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,1,$2,'CASHIER')",[biz,cu]);
 token=(await core.login({body:{login:'owner',password:'Synthetic-only-V2-password'}})).token;
 cashier=(await core.login({body:{login:'cashier',password:'Synthetic-only-V2-password'}})).token;
 await core.storeProfile(req(profile()));
 cash=(await core.account(req({name:'Synthetic cash',kind:'CASH'}))).id;bank=(await core.account(req({name:'Synthetic bank',kind:'BANK'}))).id;qris=(await core.account(req({name:'Synthetic QRIS',kind:'QRIS'}))).id;
 for(const account of [cash,bank,qris])await core.money(req({kind:'CAPITAL',amount:100000,account_id:account,reason:'Synthetic capital',request_id:id()}));
 const terminal=(await core.terminal(req({name:'Synthetic online pickup'}))).id;shift=await core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:100000}));
 product=await newProduct(100);hidden=await newProduct();await db.query('UPDATE pos_business_products SET online_visible=false WHERE id=$1',[hidden]);
 customer=(await core.party(req({kind:'CUSTOMER',name:'Synthetic registered customer',credit_allowed:true,credit_limit:10000}))).id;
}
async function main(){await setup();
 const walletBefore=JSON.stringify(await q('SELECT * FROM wallet_accounts ORDER BY id'));
 await test('branded public projection, categories/search/featured, no private fields',async()=>{
  await core.onlineProduct({...req({online_visible:true,online_featured:true,online_sort:1,category:'Synthetic category',online_description:'Searchable safe description',online_long_description:'Synthetic detail',image_url:'https://example.com/product.png'}),params:{businessId:biz,productId:product}});
  const r=await core.storefront(pub({}, {query:{search:'searchable',category:'Synthetic category',featured:'true'}}));assert.equal(r.store.name,'Synthetic Branded Store');assert.equal(r.products.length,1);assert.equal(r.products[0].id,product);
  const s=JSON.stringify(r);for(const k of ['tenant_id','unit_cost','cogs','supplier','password_hash','token_hash','wallet_account','permissions','user_id','on_hand','reserved'])assert.ok(!s.includes(k));
  assert.ok(r.categories.includes('Synthetic category'));assert.equal(r.store.phone,'000000000000');
 });
 await test('disabled store, hidden/inactive/foreign product fail closed',async()=>{
  await reject(()=>core.publicProduct(pub({}, {params:{slug:'synthetic-store',productId:hidden}})),'PRODUCT_NOT_FOUND');
  await db.query('UPDATE pos_business_products SET active=false WHERE id=$1',[product]);await reject(()=>core.publicProduct(pub({}, {params:{slug:'synthetic-store',productId:product}})),'PRODUCT_NOT_FOUND');await db.query('UPDATE pos_business_products SET active=true WHERE id=$1',[product]);
  await core.storeProfile(req(profile({storefront_enabled:false})));await reject(()=>core.storefront(pub()),'STORE_NOT_FOUND');await core.storeProfile(req(profile()));
  await reject(()=>core.storefront(pub({}, {params:{slug:'missing-store'}})),'STORE_NOT_FOUND');
 });
 await test('guest order reserves canonical stock, pending excluded from realized sale',async()=>{
  const before=await history();order=await core.checkout(pub(body()));assert.equal(order.status,'ORDERED');assert.equal(order.payment_state,'PENDING');assert.equal(order.merchandise_total,'2000');assert.equal(await history(),before);
  assert.equal((await q("SELECT quantity FROM pos_online_reservations WHERE order_id=$1 AND state='RESERVED'",[order.id]))[0].quantity,'1');
 });
 await test('server price/total/shipping authority, malformed quantities, guest credit and Wallet rejected',async()=>{
  for(const field of ['total','shipping_total','shipping_charge','customer_id','tenant_id'])await reject(()=>core.checkout(pub(body(product,1,{[field]:field==='customer_id'?customer:1}))),'CLIENT_AUTHORITY_REJECTED');
  await reject(()=>core.checkout(pub(body(product,1,{items:[{product_id:product,quantity:1,price:1}]}))),'CLIENT_PRICE_REJECTED');
  for(const qty of [0,-1,0.5,'01'])await reject(()=>core.checkout(pub(body(product,qty))),'INVALID_INTEGER');
  await reject(()=>core.checkout(pub(body(product,1,{payment_method:'CREDIT'}))),'REGISTERED_CREDIT_CUSTOMER_REQUIRED');
  await reject(()=>core.checkout(pub(body(product,1,{payment_method:'DOMPET_SANTRI'}))),'ONLINE_PAYMENT_DENIED');
 });
 await test('DELIVERY requires address; manual server shipping separate; CASH pickup only',async()=>{
  await reject(()=>core.checkout(pub(body(product,1,{fulfillment:'DELIVERY'}))),'INVALID_TEXT');
  await reject(()=>core.checkout(pub(body(product,1,{fulfillment:'DELIVERY',address:'tiny'}))),'ADDRESS_REQUIRED');
  await reject(()=>core.checkout(pub(body(product,1,{fulfillment:'DELIVERY',address:'Synthetic valid address',payment_method:'CASH'}))),'CASH_PICKUP_ONLY');
  const o=await core.checkout(pub(body(product,1,{fulfillment:'DELIVERY',address:'Synthetic valid address'})));assert.equal(o.total,'7000');assert.equal(o.shipping_total,'5000');await confirm(o);
  const saved=(await q('SELECT * FROM pos_online_orders WHERE id=$1',[o.id]))[0];assert.equal((await q('SELECT total FROM pos_business_operations WHERE id=$1',[saved.sale_id]))[0].total,'2000');
  assert.equal((await q('SELECT total FROM pos_business_operations WHERE id=$1',[saved.shipping_operation_id]))[0].total,'5000');await refund(o);
 });
 await test('duplicate concurrent checkout + timeout retry creates exactly one order/reservation',async()=>{
  const b=body(),rs=await Promise.all([core.checkout(pub(b)),core.checkout(pub(b)),core.checkout(pub(b))]);assert.equal(new Set(rs.map(x=>x.id)).size,1);
  assert.equal((await q('SELECT count(*) n FROM pos_online_reservations WHERE order_id=$1',[rs[0].id]))[0].n,'1');await core.cancelOrder(pub({}, {params:{slug:'synthetic-store',orderId:rs[0].id},headers:{'x-order-access':b.order_access}}));
  await reject(()=>core.checkout(pub({...b,recipient:'Changed recipient'})),'IDEMPOTENCY_CONFLICT');
 });
 await test('public order capability required, unrelated token/store cannot read/cancel order',async()=>{
  const b=body(),o=await core.checkout(pub(b));await reject(()=>core.publicOrder(pub({}, {params:{slug:'synthetic-store',orderId:o.id}})),'ORDER_ACCESS_REQUIRED');
  await reject(()=>core.publicOrder(pub({}, {params:{slug:'synthetic-store',orderId:o.id},headers:{'x-order-access':access()}})),'ORDER_NOT_FOUND');
  assert.equal((await core.publicOrder(pub({}, {params:{slug:'synthetic-store',orderId:o.id},headers:{'x-order-access':b.order_access}}))).id,o.id);
  await core.cancelOrder(pub({}, {params:{slug:'synthetic-store',orderId:o.id},headers:{'x-order-access':b.order_access}}));
 });
 await test('cancellation idempotently releases reservation without refund/ledger mutation',async()=>{
  const before=await history();await transition(order,'CANCELLED',{reason:'Synthetic cancel'});await transition(order,'CANCELLED',{reason:'Synthetic retry'});assert.equal(await history(),before);
  assert.equal((await q('SELECT state FROM pos_online_reservations WHERE order_id=$1',[order.id]))[0].state,'RELEASED');await reject(()=>confirm(order),'INVALID_ORDER_TRANSITION');
 });
 await test('expiry callable during reads: deterministic release once, expired cannot confirm',async()=>{
  const o=await core.checkout(pub(body()));await db.query("UPDATE pos_online_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[o.id]);
  await core.storefront(pub());assert.equal((await q('SELECT status FROM pos_online_orders WHERE id=$1',[o.id]))[0].status,'CANCELLED');await core.expireOnline();
  assert.equal((await q("SELECT count(*) n FROM pos_online_order_events WHERE order_id=$1 AND status='CANCELLED'",[o.id]))[0].n,'1');await reject(()=>confirm(o),'INVALID_ORDER_TRANSITION');
 });
 await test('forced failure after reservation rolls back order/items/reservations/history',async()=>{
  const before=await all(),svc=createPosBusinessService({db,afterStage:async(stage)=>{if(stage==='online-reserve')throw Object.assign(Error('Synthetic forced'),{code:'FORCED'});}});
  await reject(()=>svc.checkout(pub(body())),'FORCED');assert.equal(await all(),before);
 });
 await test('online vs online last-item race: exactly one reserved, nonnegative availability',async()=>{
  const p=await newProduct(1),rs=await Promise.allSettled([core.checkout(pub(body(p))),core.checkout(pub(body(p)))]);assert.equal(rs.filter(x=>x.status==='fulfilled').length,1);
  await transition(rs.find(x=>x.status==='fulfilled').value,'CANCELLED',{reason:'Synthetic race cleanup'});
 });
 await test('POS vs online last-item race: one legitimate consumption/reservation only',async()=>{
  const p=await newProduct(1),rs=await Promise.allSettled([core.checkout(pub(body(p))),core.sale(req({items:[{product_id:p,quantity:1}],payments:[{method:'CASH',amount:2000,tendered:2000,account_id:cash}],shift_id:shift.id,request_id:id()}))]);
  assert.equal(rs.filter(x=>x.status==='fulfilled').length,1);const win=rs.find(x=>x.status==='fulfilled').value;
  if(win.status)await transition(win,'CANCELLED',{reason:'Synthetic cleanup'});else await core.saleReturn(req({source_id:win.sale.id,items:[{product_id:p,quantity:1}],reason:'Synthetic cleanup',shift_id:shift.id,request_id:id()}));
 });
 await test('POS cannot consume online-reserved stock; failed confirmation rolls back release and sale',async()=>{
  const p=await newProduct(1),o=await core.checkout(pub(body(p)));await reject(()=>core.sale(req({items:[{product_id:p,quantity:1}],payments:[{method:'CASH',amount:2000,tendered:2000,account_id:cash}],shift_id:shift.id,request_id:id()})),'INSUFFICIENT_STOCK');
  const before=await all(),svc=createPosBusinessService({db,afterStage:async(stage)=>{if(stage==='money')throw Object.assign(Error('Synthetic forced'),{code:'FORCED'});}});
  await reject(()=>transition(o,'CONFIRMED',{payment_confirmed:true,account_id:bank,reference:'Synthetic'},svc),'FORCED');assert.equal(await all(),before);await confirm(o);await refund(o);
 });
 await test('manual confirmation required, canonical sale committed once, price snapshot preserved',async()=>{
  const o=await core.checkout(pub(body()));await reject(()=>transition(o,'CONFIRMED',{account_id:bank}),'MANUAL_PAYMENT_CONFIRMATION_REQUIRED');
  await db.query('UPDATE pos_business_products SET selling_price=3000 WHERE id=$1',[product]);const a=await confirm(o);const b=await confirm(o);assert.equal(a.sale_id,b.sale_id);
  assert.equal((await q('SELECT total,channel FROM pos_business_operations WHERE id=$1',[a.sale_id]))[0].total,'2000');
  assert.equal((await q('SELECT count(*) n FROM pos_business_operations WHERE id=$1',[a.sale_id]))[0].n,'1');await db.query('UPDATE pos_business_products SET selling_price=2000 WHERE id=$1',[product]);await refund(o);
 });
 await test('delivery state machine, courier/resi, completion; reverse/terminal transitions rejected',async()=>{
  const o=await core.checkout(pub(body(product,1,{fulfillment:'DELIVERY',address:'Synthetic delivery address',payment_method:'QRIS'})));await confirm(o);
  for(const s of ['PROCESSING','READY_TO_SHIP'])await transition(o,s);await reject(()=>transition(o,'COMPLETED'),'INVALID_FULFILLMENT_TRANSITION');
  const shipped=await transition(o,'SHIPPED',{courier:'Synthetic courier',tracking:'Synthetic tracking'});assert.ok(shipped.shipped_at);assert.equal(shipped.courier,'Synthetic courier');assert.equal(shipped.tracking,'Synthetic tracking');await transition(o,'COMPLETED');await reject(()=>transition(o,'PROCESSING'),'INVALID_ORDER_TRANSITION');await refund(o);await reject(()=>transition(o,'SHIPPED'),'INVALID_ORDER_TRANSITION');
 });
 await test('pickup CASH commit/current shift, no shipping, canonical refund and drawer',async()=>{
  const o=await core.checkout(pub(body(product,1,{payment_method:'CASH'})));assert.equal(o.shipping_total,'0');
  await transition(o,'CONFIRMED',{payment_confirmed:true,account_id:cash,reference:'Synthetic pickup cash',shift_id:shift.id});
  for(const s of ['PROCESSING','READY_TO_SHIP','COMPLETED'])await transition(o,s);await refund(o);
 });
 await test('refund uses canonical return, original FIFO cost, idempotent and concurrent-safe',async()=>{
  const o=await core.checkout(pub(body(product,2)));const committed=await confirm(o);await reject(()=>core.saleReturn(req({source_id:committed.sale_id,items:[{product_id:product,quantity:1}],reason:'Bypass',request_id:id()})),'ONLINE_ORDER_RETURN_REQUIRED');
  await Promise.all([refund(o),refund(o)]);assert.equal((await q("SELECT count(*) n,sum(total) total FROM pos_business_operations WHERE source_id=$1 AND kind='SALE_RETURN'",[committed.sale_id]))[0].n,'1');
  assert.equal((await q("SELECT cogs FROM pos_business_lines l JOIN pos_business_operations o ON o.id=l.operation_id WHERE o.source_id=$1 AND o.kind='SALE_RETURN'",[committed.sale_id]))[0].cogs,'1000');
 });
 await test('forced canonical refund failure fully rolls back money/stock/order state',async()=>{
  const o=await core.checkout(pub(body()));await confirm(o);const before=await all(),svc=createPosBusinessService({db,afterStage:async(s)=>{if(s==='return-money')throw Object.assign(Error('Synthetic forced'),{code:'FORCED'});}});
  await reject(()=>transition(o,'REFUNDED',{refund_confirmed:true,reference:'Synthetic',reason:'Synthetic'},svc),'FORCED');assert.equal(await all(),before);await refund(o);
 });
 await test('registered customer explicit verified access; no weak merge; rotation revokes old access',async()=>{
  await reject(()=>core.customerAccess(req({customer_id:customer})),'IDENTITY_VERIFICATION_REQUIRED');
  customerToken=(await core.customerAccess(req({customer_id:customer,identity_verified:true}))).token;
  const old=customerToken;customerToken=(await core.customerAccess(req({customer_id:customer,identity_verified:true}))).token;
  await reject(()=>core.checkout(pub(body(),{headers:{'x-customer-access':old}})),'CUSTOMER_ACCESS_DENIED');
  assert.ok(!(await q('SELECT token_hash FROM pos_online_customer_access')).some(x=>x.token_hash===customerToken));
 });
 await test('registered eligible credit posts canonical AR; limit/disabled denial; refund reduces AR',async()=>{
  const o=await core.checkout(pub(body(product,1,{payment_method:'CREDIT'}),{headers:{'x-customer-access':customerToken}}));const a=await transition(o,'CONFIRMED',{due_date:'2030-01-01'});
  assert.equal((await q('SELECT customer_id FROM pos_online_orders WHERE id=$1',[o.id]))[0].customer_id,customer);assert.equal((await q('SELECT paid FROM pos_business_operations WHERE id=$1',[a.sale_id]))[0].paid,'0');
  await refund(o);await db.query('UPDATE pos_business_parties SET credit_limit=1 WHERE id=$1',[customer]);await reject(()=>core.checkout(pub(body(product,1,{payment_method:'CREDIT'}),{headers:{'x-customer-access':customerToken}})),'CREDIT_LIMIT_DENIED');await db.query('UPDATE pos_business_parties SET credit_limit=10000 WHERE id=$1',[customer]);
 });
 await test('customer metrics aggregate canonical POS and ONLINE without duplicate orders',async()=>{
  const o=await core.checkout(pub(body(),{headers:{'x-customer-access':customerToken}}));await confirm(o);
  await core.sale(req({customer_id:customer,items:[{product_id:product,quantity:1}],payments:[{method:'CASH',amount:2000,tendered:2000,account_id:cash}],shift_id:shift.id,request_id:id()}));
  const metrics=(await core.customers(req())).customers.find(x=>x.id===customer);assert.equal(metrics.pos_spend,'2000');assert.equal(metrics.online_spend,'2000');assert.equal(metrics.net_spend,'4000');assert.equal(metrics.transaction_count,'3');
 });
 await test('merchant permissions and cross-business/order/privacy boundaries',async()=>{
  await reject(()=>core.orders(req({},cashier)),'MERCHANT_PERMISSION_DENIED');await reject(()=>core.storeProfile(req(profile(),cashier)),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.customerAccess(req({customer_id:customer,identity_verified:true},cashier)),'MERCHANT_PERMISSION_DENIED');
  const o=await core.checkout(pub(body()));await reject(()=>core.orderDetail({...req({},token,other),params:{businessId:other,orderId:o.id}}),'ORDER_NOT_FOUND');
  await reject(()=>core.orders(req({},'tenant-admin-jwt')),'MERCHANT_AUTH_REQUIRED');await reject(()=>core.transition({...req({status:'CONFIRMED'},cashier),params:{businessId:biz,orderId:o.id}}),'MERCHANT_PERMISSION_DENIED');await transition(o,'CANCELLED',{reason:'Synthetic cleanup'});
 });
 await test('public HTTP/local application: actual safe routes, auth/no-store, no credential logs',async()=>{
  const {app}=await createLocalPosApp(db);server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base=`http://127.0.0.1:${server.address().port}`,logs=[],old=console.error;console.error=(...x)=>logs.push(x);
  try{assert.equal((await fetch(base+'/store-api/synthetic-store')).status,200);assert.equal((await fetch(base+'/pos-business/'+biz+'/orders')).status,401);
   const response=await fetch(base+'/store-api/synthetic-store/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body())});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');const o=(await response.json()).data;
   assert.ok(!JSON.stringify(o).includes('access_hash'));assert.ok(!JSON.stringify(o).includes('token_hash'));assert.equal((await fetch(base+'/store-api/synthetic-store/orders/'+o.id)).status,401);assert.deepEqual(logs,[]);
   await transition(o,'CANCELLED',{reason:'Synthetic cleanup'});
  }finally{console.error=old;await new Promise(resolve=>server.close(resolve));server=null;}
 });
 await test('online reports only realized canonical merchandise, pending not revenue, separate shipping',async()=>{
  const report=await core.onlineReport(req());assert.ok(report.order_count>0);const online=report.channels.find(x=>x.channel==='ONLINE');assert.ok(BigInt(online.gross)>=2000n);
  assert.equal(online.net,'2000');assert.equal(report.top_customers[0].id,customer);assert.equal(report.top_products[0].net,'2000');
  const canonical=(await q("SELECT sum(total) total FROM pos_business_operations WHERE business_id=$1 AND channel='ONLINE' AND kind='SALE'",[biz]))[0].total;assert.equal(online.gross,canonical);
 });
 await test('final financial/stock Rp0 reconciliation, frozen canonical Wallet unchanged',async()=>{
  assert.equal(JSON.stringify(await q('SELECT * FROM wallet_accounts ORDER BY id')),walletBefore);
  assert.equal((await q(`SELECT count(*) n FROM pos_online_orders o WHERE sale_id IS NOT NULL AND merchandise_total<>(SELECT total FROM pos_business_operations WHERE id=o.sale_id)`))[0].n,'0');
  assert.equal((await q(`SELECT count(*) n FROM pos_business_products p WHERE
   (SELECT coalesce(sum(quantity),0) FROM pos_inventory_movements WHERE product_id=p.id)<(SELECT coalesce(sum(quantity),0) FROM pos_online_reservations WHERE product_id=p.id AND state='RESERVED')`))[0].n,'0');
  assert.equal((await core.closeShift(req({shift_id:shift.id,actual_cash:102000}))).difference,'0');
 });
 await test('100 DOWN refuses order history and leaves all financial/order rows untouched',async()=>{
  const before=await all(),c=await db.connect();try{await reject(()=>c.query(fs.readFileSync(path.join(__dirname,'../migrations/100_pos_business_online_rollback.sql'),'utf8')),'23514');}finally{await c.query('ROLLBACK');c.release();}assert.equal(await all(),before);
 });
 await test('foreign storefront/product/order/customer capability cannot cross merchant/tenant',async()=>{
  await core.storeProfile(req(profile({storefront_slug:'foreign-synthetic',public_phone:false}),token,other));
  const otherReq=pub({}, {params:{slug:'foreign-synthetic',productId:product}});await reject(()=>core.publicProduct(otherReq),'PRODUCT_NOT_FOUND');
  const b=body(),o=await core.checkout(pub(b));await reject(()=>core.publicOrder(pub({}, {params:{slug:'foreign-synthetic',orderId:o.id},headers:{'x-order-access':b.order_access}})),'ORDER_NOT_FOUND');
  const foreignP=(await core.product(req({name:'Foreign synthetic',sku:id(),selling_price:2000,online_visible:true},token,other))).id;
  await reject(()=>core.publicProduct(pub({}, {params:{slug:'synthetic-store',productId:foreignP}})),'PRODUCT_NOT_FOUND');
  await reject(()=>core.checkout(pub(body(foreignP),{params:{slug:'foreign-synthetic'},headers:{'x-customer-access':customerToken}})),'CUSTOMER_ACCESS_DENIED');
  assert.equal((await core.storefront(pub({}, {params:{slug:'foreign-synthetic'}}))).store.phone,null);await transition(o,'CANCELLED',{reason:'Synthetic cleanup'});
 });
 await test('deferred SQL guard + immutable history reject reservation oversell and order rewrites',async()=>{
  const p=await newProduct(1),o=await core.checkout(pub(body(p)));const before=await all();
  await reject(()=>db.query("UPDATE pos_online_orders SET status='SHIPPED' WHERE id=$1",[o.id]),'23514');
  await reject(()=>db.query("UPDATE pos_online_orders SET merchandise_total=1 WHERE id=$1",[o.id]),'23514');
  await reject(()=>db.query("UPDATE pos_online_order_lines SET unit_price=1 WHERE order_id=$1",[o.id]),'23514');assert.equal(await all(),before);
  await reject(()=>core.adjustment(req({product_id:p,direction:'OUT',quantity:1,reason:'Synthetic reserved depletion',request_id:id()})),'INSUFFICIENT_STOCK');
  await transition(o,'CANCELLED',{reason:'Synthetic cleanup'});
 });
 await test('exact runtime grants: storefront/config/checkout/confirm/refund/read; no history delete or DDL',async()=>{
  const role='pos_business_v2_fixture_runtime';await db.query(`GRANT SELECT ON pos_online_customer_access,pos_online_orders,pos_online_order_lines,pos_online_reservations,pos_online_order_events,pos_online_request_limits TO ${role};
   GRANT INSERT ON pos_online_customer_access,pos_online_orders,pos_online_order_lines,pos_online_reservations,pos_online_order_events,pos_online_request_limits TO ${role};
   GRANT UPDATE(active) ON pos_online_customer_access TO ${role};GRANT UPDATE(state) ON pos_online_reservations TO ${role};
   GRANT UPDATE(attempts,started_at) ON pos_online_request_limits TO ${role};
   GRANT UPDATE(status,payment_state,sale_id,shipping_operation_id,shipping_refund_id,courier,tracking,updated_at,shipped_at) ON pos_online_orders TO ${role};
   GRANT UPDATE(display_name,storefront_slug,storefront_enabled,logo_url,banner_url,brand_color,description,address,phone,public_phone,hours_text,storefront_footer,shipping_charge,reservation_minutes,payment_instructions) ON pos_businesses TO ${role};
   GRANT UPDATE(online_visible,online_description,online_long_description,online_featured,online_sort,image_url,category) ON pos_business_products TO ${role};`);
  const runtime=new Pool({host:'127.0.0.1',port:55439,user:role,database:'pos_business_v2_test'});
  try{const svc=createPosBusinessService({db:runtime});await svc.storeSettings(req());await svc.storeProfile(req(profile()));
   await svc.onlineProduct({...req({online_visible:true,online_description:'Runtime verified'}),params:{businessId:biz,productId:product}});
   const o=await svc.checkout(pub(body()));await transition(o,'CONFIRMED',{payment_confirmed:true,account_id:bank,reference:'Synthetic runtime'},svc);
   await transition(o,'REFUNDED',{refund_confirmed:true,reference:'Synthetic runtime',reason:'Synthetic runtime'},svc);await svc.onlineReport(req());
   await reject(()=>runtime.query('DELETE FROM pos_online_orders'),'42501');await reject(()=>runtime.query('UPDATE pos_online_order_events SET reason=reason'),'42501');
   await reject(()=>runtime.query('UPDATE pos_online_orders SET expires_at=now()'),'42501');await reject(()=>runtime.query('CREATE TABLE forbidden_online(id int)'),'42501');
  }finally{await runtime.end();}
 });
 await test('checkout throttle persists independently, no raw capabilities in logs',async()=>{
  const r=pub(body());const k=crypto.createHash('sha256').update('store:127.0.0.1:synthetic-store').digest('hex');
  await db.query('UPDATE pos_online_request_limits SET attempts=100 WHERE key=$1',[k]);await reject(()=>core.checkout(r),'CHECKOUT_RATE_LIMITED');
  await db.query('UPDATE pos_online_request_limits SET attempts=0 WHERE key=$1',[k]);
 });
 await test('POS reads/writes actually expire stale reservations without a browser/imaginary scheduler',async()=>{
  const p=await newProduct(1),o=await core.checkout(pub(body(p)));let catalog=await core.catalog(req());assert.equal(catalog.find(x=>x.id===p).available,'0');
  await db.query("UPDATE pos_online_orders SET expires_at=now()-interval '1 second' WHERE id=$1",[o.id]);
  const terminal=(await core.terminal(req({name:'Synthetic post-expiry'}))).id,s=await core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:0}));
  const sold=await core.sale(req({request_id:id(),shift_id:s.id,items:[{product_id:p,quantity:1}],payments:[{method:'CASH',amount:2000,tendered:2000,account_id:cash}]}));
  assert.equal((await q('SELECT status FROM pos_online_orders WHERE id=$1',[o.id]))[0].status,'CANCELLED');
  await core.saleReturn(req({source_id:sold.sale.id,request_id:id(),shift_id:s.id,items:[{product_id:p,quantity:1}],reason:'Synthetic expiry cleanup'}));
  await core.closeShift(req({shift_id:s.id,actual_cash:0}));
 });
 await test('canonical Wallet checkout/refund remains valid AFTER 100, same ledger/balance, reserved stock protected',async()=>{
  await db.query('UPDATE pos_businesses SET integration_enabled=true,wallet_enabled=true WHERE id=$1',[biz]);await db.query('INSERT INTO pos_business_units VALUES($1,1,2)',[biz]);
  const terminal=(await core.terminal(req({name:'Synthetic Wallet regression'}))).id,s=await core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:0}));
  const before=JSON.stringify(await q('SELECT * FROM wallet_accounts ORDER BY id'));
  const sold=await core.sale(req({request_id:id(),shift_id:s.id,items:[{product_id:product,quantity:1}],payments:[{method:'DOMPET_SANTRI',amount:2000,unit_id:2,credential_method:'RFID',credential:'0ab102ff'}]}));
  await core.saleReturn(req({source_id:sold.sale.id,request_id:id(),shift_id:s.id,items:[{product_id:product,quantity:1}],reason:'Synthetic Wallet regression'}));
  assert.deepEqual((await q('SELECT id,current_balance,status FROM wallet_accounts ORDER BY id')),(JSON.parse(before)).map(w=>({id:w.id,current_balance:w.current_balance,status:w.status})));
  assert.equal((await core.closeShift(req({shift_id:s.id,actual_cash:0}))).difference,'0');
 });
 await test('composite order/line ownership rejects cross-merchant rows; product/master not duplicated',async()=>{
  const b=body(),o=await core.checkout(pub(b)),foreignProduct=(await q('SELECT id FROM pos_business_products WHERE business_id=$1 LIMIT 1',[other]))[0].id;
  await reject(()=>db.query('INSERT INTO pos_online_order_lines VALUES($1,$2,$3,$4,$5,1,2000)',[o.id,other,foreignProduct,'Synthetic','Synthetic']),'23503');
  assert.equal((await q("SELECT to_regclass('pos_online_products') value"))[0].value,null);await transition(o,'CANCELLED',{reason:'Synthetic FK cleanup'});
 });
 console.log(`V2 ONLINE: ${passed}/${passed} groups PASS, financial/stock reconciliation Rp0; production untouched.`);
}
main().catch(e=>{console.error('FAIL online fixture',{code:e.code||'ASSERTION',message:'Rejected/test failure',constraint:e.constraint,stack:e.stack?.split('\n').slice(1,4).join('\n')});process.exitCode=1;}).finally(async()=>{if(server)await new Promise(r=>server.close(r));await db.end();});
