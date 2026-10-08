const crypto=require('node:crypto');
const {productImageUrl}=require('../utils/posProductImage');
function createBusinessOnline(h){
 const {transaction,run,bad,uuid,amount,text,makeId,hash,serialize,lock,getProduct,getAccount,saleWork,returns,
  beginOperation,insertOperation,moneyRow,afterStage,permitted}=h;
 const optional=(v,n)=>v==null||v===''?null:text(v,n);
 const capability=v=>{if(!/^[a-f0-9]{64}$/.test(v||''))bad('ORDER_ACCESS_REQUIRED',401);return hash(v);};
 const slug=v=>{if(!/^[a-z0-9][a-z0-9-]{2,79}$/.test(v||''))bad('STORE_NOT_FOUND',404);return v;};
 async function store(c,s){
  const row=(await c.query(`SELECT b.* FROM pos_businesses b JOIN tenants t ON t.id=b.tenant_id
   WHERE b.storefront_slug=$1 AND b.storefront_enabled AND b.active AND t.status='active' FOR SHARE OF b,t`,[slug(s)])).rows[0];
  if(!row)bad('STORE_NOT_FOUND',404);return row;
 }
 const branding=b=>({name:b.display_name,logo_url:b.logo_url,banner_url:b.banner_url,color:b.brand_color,
  description:b.description,address:b.address,phone:b.public_phone?b.phone:null,hours:b.hours_text,footer:b.storefront_footer,
  shipping_charge:b.shipping_charge,payment_instructions:b.payment_instructions,powered_by:'KlikPesantren'});
 async function event(c,o,status,actor=null,reason=null){await c.query('INSERT INTO pos_online_order_events(id,order_id,business_id,actor_id,status,reason) VALUES($1,$2,$3,$4,$5,$6)',[makeId(),o.id,o.business_id,actor,status,reason]);}
 async function release(c,o,reason,actor=null){
  const items=(await c.query('SELECT product_id FROM pos_online_order_lines WHERE order_id=$1 ORDER BY product_id',[o.id])).rows;
  for(const i of items)await c.query('SELECT id FROM pos_business_products WHERE id=$1 AND business_id=$2 FOR UPDATE',[i.product_id,o.business_id]);
  await c.query("UPDATE pos_online_reservations SET state='RELEASED' WHERE order_id=$1 AND state='RESERVED'",[o.id]);
  await c.query("UPDATE pos_online_orders SET status='CANCELLED',payment_state='CANCELLED',updated_at=now() WHERE id=$1",[o.id]);
  await event(c,o,'CANCELLED',actor,reason);
 }
 // Callable worker/read/write hook. SKIP LOCKED avoids blocking a confirmation in progress.
 async function expire(business=null){return transaction(async c=>{
  const rows=(await c.query(`SELECT * FROM pos_online_orders WHERE status='ORDERED' AND expires_at<=now()
   AND ($1::uuid IS NULL OR business_id=$1) ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`,[business])).rows;
  for(const o of rows)await release(c,o,'RESERVATION_EXPIRED');return {expired:rows.length};
 });}
 async function rate(req){
  const key=hash('store:'+String(req.ip||'local')+':'+slug(req.params.slug));
  const limited=await transaction(async c=>{
   await lock(c,'online-limit:'+key);await c.query('INSERT INTO pos_online_request_limits VALUES($1,0,now()) ON CONFLICT DO NOTHING',[key]);
   await c.query("UPDATE pos_online_request_limits SET attempts=0,started_at=now() WHERE key=$1 AND started_at<now()-interval '15 minutes'",[key]);
   const n=(await c.query('UPDATE pos_online_request_limits SET attempts=attempts+1 WHERE key=$1 RETURNING attempts',[key])).rows[0].attempts;
   return n>100;
  });if(limited)bad('CHECKOUT_RATE_LIMITED',429);
 }
 async function publicWork(req,work){const business=await transaction(async c=>(await store(c,req.params.slug)).id);await expire(business);return transaction(async c=>work(c,await store(c,req.params.slug)));}
 async function listing(c,b,q={}){
  const search=optional(q.search,120),category=optional(q.category,120);
  const page=Number(q.page||1);if(!Number.isSafeInteger(page)||page<1||page>1000)bad('INVALID_PAGE');
  return (await c.query(`SELECT p.id,p.name,p.category,p.uom,p.image_url,p.selling_price,p.online_description,p.online_long_description,p.online_featured,
   ((SELECT coalesce(sum(quantity),0) FROM pos_inventory_movements WHERE product_id=p.id AND business_id=p.business_id)
    -(SELECT coalesce(sum(quantity),0) FROM pos_online_reservations WHERE product_id=p.id AND state='RESERVED'))>0 available
   FROM pos_business_products p WHERE p.business_id=$1 AND p.active AND p.sellable AND p.online_visible
   AND ($2::text IS NULL OR strpos(lower(p.name||' '||coalesce(p.online_description,'')),lower($2))>0)
   AND ($3::text IS NULL OR p.category=$3) AND ($4::boolean=false OR p.online_featured)
   ORDER BY p.online_featured DESC,p.online_sort,p.name,p.id LIMIT 40 OFFSET $5`,[b.id,search,category,q.featured==='true',(page-1)*40])).rows;
 }
 const storefront=req=>publicWork(req,async(c,b)=>({store:branding(b),products:await listing(c,b,req.query),
  categories:(await c.query('SELECT DISTINCT category FROM pos_business_products WHERE business_id=$1 AND active AND sellable AND online_visible AND category IS NOT NULL ORDER BY category LIMIT 200',[b.id])).rows.map(r=>r.category),page:Number(req.query?.page||1),page_size:40}));
 const publicProduct=req=>publicWork(req,async(c,b)=>{
  const id=uuid(req.params.productId);const p=(await c.query(`SELECT id,name,category,uom,image_url,selling_price,online_description,online_long_description,online_featured FROM pos_business_products
   WHERE id=$1 AND business_id=$2 AND active AND sellable AND online_visible`,[id,b.id])).rows[0];
  if(!p)bad('PRODUCT_NOT_FOUND',404);
  p.available=BigInt((await stock(c,b.id,id)).available)>0n;return p;
 });
 async function stock(c,business,product){return (await c.query(`SELECT
  (SELECT coalesce(sum(quantity),0) FROM pos_inventory_movements WHERE business_id=$1 AND product_id=$2) on_hand,
  (SELECT coalesce(sum(quantity),0) FROM pos_online_reservations WHERE business_id=$1 AND product_id=$2 AND state='RESERVED') reserved,
  (SELECT coalesce(sum(quantity),0) FROM pos_inventory_movements WHERE business_id=$1 AND product_id=$2)
  -(SELECT coalesce(sum(quantity),0) FROM pos_online_reservations WHERE business_id=$1 AND product_id=$2 AND state='RESERVED') available`,[business,product])).rows[0];}
 async function project(c,o,privateBook=false){
  const output={id:o.id,order_number:o.order_number,status:o.status,payment_state:o.payment_state,payment_method:o.payment_method,
   fulfillment:o.fulfillment,recipient:o.recipient,phone:o.phone,address:o.address,notes:o.notes,merchandise_total:o.merchandise_total,
   shipping_total:o.shipping_total,total:(BigInt(o.merchandise_total)+BigInt(o.shipping_total)).toString(),
   courier:o.courier,tracking:o.tracking,created_at:o.created_at,expires_at:o.expires_at,shipped_at:o.shipped_at,brand:o.brand_snapshot,
   items:(await c.query('SELECT product_id,name,quantity,unit_price FROM pos_online_order_lines WHERE order_id=$1 ORDER BY product_id',[o.id])).rows,
   timeline:(await c.query('SELECT status,reason,created_at FROM pos_online_order_events WHERE order_id=$1 ORDER BY created_at,id',[o.id])).rows};
  if(privateBook){output.sale_id=o.sale_id;output.customer_id=o.customer_id;}return output;
 }
 async function checkout(req){
  await rate(req);const business=await transaction(async c=>(await store(c,req.params.slug)).id);await expire(business);return transaction(async c=>{
   const b=await store(c,req.params.slug),body=req.body||{};
   if(['tenant_id','business_id','customer_id','wallet_account_id','shipping_total','shipping_charge','total','price'].some(k=>body[k]!=null))bad('CLIENT_AUTHORITY_REJECTED',403);
   const access=capability(body.order_access),request=text(body.request_id);if(request.length<8)bad('INVALID_REQUEST_ID');
   if(!Array.isArray(body.items)||!body.items.length||body.items.length>50)bad('INVALID_ITEMS');
   const items=body.items.map(i=>{if(i.price!=null||i.unit_price!=null)bad('CLIENT_PRICE_REJECTED',403);const quantity=amount(i.quantity,true);if(quantity>1000n)bad('INVALID_QUANTITY');return {product:uuid(i.product_id),quantity};}).sort((x,y)=>x.product.localeCompare(y.product));
   if(new Set(items.map(i=>i.product)).size!==items.length)bad('DUPLICATE_PRODUCT');
   const fulfillment=body.fulfillment,method=body.payment_method;
   if(!['DELIVERY','PICKUP'].includes(fulfillment))bad('INVALID_FULFILLMENT');
   if(!['BANK','QRIS','CASH','CREDIT'].includes(method))bad('ONLINE_PAYMENT_DENIED',403);
   if(method==='CASH'&&fulfillment!=='PICKUP')bad('CASH_PICKUP_ONLY');
   const recipient=text(body.recipient),phone=text(body.phone,40),address=fulfillment==='DELIVERY'?text(body.address,1000):null,notes=optional(body.notes,500);
   if(!/^[+0-9 ()-]{6,40}$/.test(phone))bad('INVALID_PHONE');if(fulfillment==='DELIVERY'&&address.length<10)bad('ADDRESS_REQUIRED');
   let customer=null;const customerToken=req.headers?.['x-customer-access'];
   if(customerToken){const row=(await c.query(`SELECT p.id FROM pos_online_customer_access x JOIN pos_business_parties p ON p.id=x.customer_id AND p.business_id=x.business_id
     WHERE x.token_hash=$1 AND x.business_id=$2 AND x.active AND p.active AND p.kind='CUSTOMER' FOR SHARE OF x,p`,[capability(customerToken),b.id])).rows[0];
     if(!row)bad('CUSTOMER_ACCESS_DENIED',403);customer=row.id;}
   if(method==='CREDIT'&&!customer)bad('REGISTERED_CREDIT_CUSTOMER_REQUIRED',403);
   const shipping=fulfillment==='DELIVERY'?BigInt(b.shipping_charge):0n;if(method==='CREDIT'&&shipping)bad('CREDIT_SHIPPING_NOT_SUPPORTED');
   const fields={items,fulfillment,method,recipient,phone,address,notes,customer,access};const digest=hash(serialize(fields));
   await lock(c,'online-request:'+b.id+':'+request);
   const old=(await c.query('SELECT * FROM pos_online_orders WHERE business_id=$1 AND request_id=$2',[b.id,request])).rows[0];
   if(old){if(old.request_hash!==digest)bad('IDEMPOTENCY_CONFLICT',409);return {...await project(c,old),replay:true};}
   let total=0n;for(const i of items){i.p=await getProduct(c,{business:b.id},i.product);if(!i.p.sellable||!i.p.online_visible)bad('PRODUCT_NOT_FOUND',404);
    if(BigInt((await stock(c,b.id,i.product)).available)<i.quantity)bad('INSUFFICIENT_STOCK',409);total+=i.quantity*BigInt(i.p.selling_price);}
   if(method==='CREDIT'){const p=(await c.query('SELECT * FROM pos_business_parties WHERE id=$1 AND business_id=$2 FOR UPDATE',[customer,b.id])).rows[0];
    const debt=BigInt((await c.query("SELECT coalesce(sum(amount),0) n FROM pos_debt_movements WHERE business_id=$1 AND party_id=$2 AND kind='AR'",[b.id,customer])).rows[0].n);
    if(!p.credit_allowed||total+debt>BigInt(p.credit_limit))bad('CREDIT_LIMIT_DENIED',403);}
   const id=makeId(),number=b.receipt_prefix+'-WEB-'+id;
   const o=(await c.query(`INSERT INTO pos_online_orders(id,business_id,order_number,request_id,request_hash,access_hash,payment_method,fulfillment,
    customer_id,recipient,phone,address,notes,merchandise_total,shipping_total,expires_at,brand_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()+$16*interval '1 minute',$17) RETURNING *`,
    [id,b.id,number,request,digest,access,method,fulfillment,customer,recipient,phone,address,notes,total.toString(),shipping.toString(),b.reservation_minutes,branding(b)])).rows[0];
   for(const i of items){await c.query('INSERT INTO pos_online_order_lines VALUES($1,$2,$3,$4,$5,$6,$7)',[id,b.id,i.product,i.p.name,i.p.sku,i.quantity.toString(),i.p.selling_price]);
    await c.query('INSERT INTO pos_online_reservations(order_id,business_id,product_id,quantity) VALUES($1,$2,$3,$4)',[id,b.id,i.product,i.quantity.toString()]);}
   await event(c,o,'ORDERED');await afterStage('online-reserve');return project(c,o);
  });
 }
 const publicOrder=req=>publicWork(req,async(c,b)=>{
  const o=(await c.query('SELECT * FROM pos_online_orders WHERE id=$1 AND business_id=$2 AND access_hash=$3',[uuid(req.params.orderId),b.id,capability(req.headers?.['x-order-access'])])).rows[0];
  if(!o)bad('ORDER_NOT_FOUND',404);return project(c,o);
 });
 const cancelOrder=req=>publicWork(req,async(c,b)=>{
  const o=(await c.query('SELECT * FROM pos_online_orders WHERE id=$1 AND business_id=$2 AND access_hash=$3 FOR UPDATE',[uuid(req.params.orderId),b.id,capability(req.headers?.['x-order-access'])])).rows[0];
  if(!o)bad('ORDER_NOT_FOUND',404);if(o.status==='CANCELLED')return project(c,o);if(o.status!=='ORDERED')bad('MERCHANT_REFUND_REQUIRED',409);
  await release(c,o,'CUSTOMER_CANCELLED');return project(c,{...o,status:'CANCELLED',payment_state:'CANCELLED'});
 });
 const storeProfile=req=>run(req,'store.manage',async(c,a)=>{
  const b=req.body;if(b.integration_enabled!=null||b.tenant_id!=null)bad('CLIENT_AUTHORITY_REJECTED',403);
  const name=text(b.display_name),s=slug(b.storefront_slug),color=b.brand_color||null;if(color&&!/^#[0-9a-f]{6}$/i.test(color))bad('INVALID_BRAND_COLOR');
  const minutes=Number(amount(b.reservation_minutes,true));if(minutes>1440)bad('INVALID_EXPIRY');
  const row=(await c.query(`UPDATE pos_businesses SET display_name=$1,storefront_slug=$2,storefront_enabled=$3,logo_url=$4,banner_url=$5,brand_color=$6,
   description=$7,address=$8,phone=$9,public_phone=$10,hours_text=$11,storefront_footer=$12,shipping_charge=$13,reservation_minutes=$14,payment_instructions=$15 WHERE id=$16 RETURNING id,storefront_slug`,
   [name,s,b.storefront_enabled===true,productImageUrl(b.logo_url),productImageUrl(b.banner_url),color,optional(b.description,500),optional(b.address,1000),optional(b.phone,40),
    b.public_phone===true,optional(b.hours_text,300),optional(b.storefront_footer,300),amount(b.shipping_charge).toString(),minutes,optional(b.payment_instructions,500),a.business])).rows[0];return row;
 });
 const storeSettings=req=>run(req,'store.manage',async(c,a)=>({store:{...branding(a.member),display_name:a.member.display_name,brand_color:a.member.brand_color,storefront_slug:a.member.storefront_slug,
  storefront_enabled:a.member.storefront_enabled,public_phone:a.member.public_phone,phone:a.member.phone,reservation_minutes:a.member.reservation_minutes},
  products:(await c.query('SELECT id,name,category,image_url,selling_price,online_visible,online_description,online_long_description,online_featured,online_sort FROM pos_business_products WHERE business_id=$1 ORDER BY name LIMIT 200',[a.business])).rows}));
 const orderPaymentContext=req=>run(req,'orders.manage',async(c,a)=>({
  accounts:(await c.query("SELECT id,name,kind FROM pos_business_accounts WHERE business_id=$1 AND active AND kind IN('CASH','BANK','QRIS') ORDER BY name",[a.business])).rows,
  shifts:(await c.query("SELECT id,cash_account_id FROM pos_business_shifts WHERE business_id=$1 AND user_id=$2 AND status='OPEN'",[a.business,a.user])).rows,
 }));
 const onlineProduct=req=>run(req,'products.manage',async(c,a)=>{
  const b=req.body;await getProduct(c,a,uuid(req.params.productId));const order=Number(amount(b.online_sort||0));if(order>100000)bad('INVALID_SORT');
  return (await c.query(`UPDATE pos_business_products SET online_visible=$1,online_description=$2,online_long_description=$3,online_featured=$4,online_sort=$5,
   image_url=$6,category=$7 WHERE id=$8 AND business_id=$9 RETURNING id,online_visible`,[b.online_visible===true,optional(b.online_description,500),optional(b.online_long_description,5000),b.online_featured===true,order,productImageUrl(b.image_url),optional(b.category,120),req.params.productId,a.business])).rows[0];
 });
 const customerAccess=req=>run(req,'parties.manage',async(c,a)=>{
  const id=uuid(req.body.customer_id);const p=(await c.query("SELECT id FROM pos_business_parties WHERE id=$1 AND business_id=$2 AND active AND kind='CUSTOMER' FOR UPDATE",[id,a.business])).rows[0];
  if(!p)bad('CUSTOMER_DENIED',403);
  // Explicit operator identity verification is mandatory; no name/phone auto-merge.
  if(req.body.identity_verified!==true)bad('IDENTITY_VERIFICATION_REQUIRED');
  await c.query('UPDATE pos_online_customer_access SET active=false WHERE business_id=$1 AND customer_id=$2',[a.business,id]);
  const token=crypto.randomBytes(32).toString('hex');await c.query('INSERT INTO pos_online_customer_access(token_hash,business_id,customer_id,created_by) VALUES($1,$2,$3,$4)',[hash(token),a.business,id,a.user]);
  return {token,one_time:true};
 });
 const orders=req=>run(req,'orders.read',async(c,a)=>{
  await expire(a.business);
  const status=optional(req.query.status,30),page=Number(req.query.page||1);if(page<1||page>1000||!Number.isInteger(page))bad('INVALID_PAGE');
  const rows=(await c.query('SELECT * FROM pos_online_orders WHERE business_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC,id LIMIT 50 OFFSET $3',[a.business,status,(page-1)*50])).rows;
  return Promise.all(rows.map(o=>project(c,o,true)));
 });
 const orderDetail=req=>run(req,'orders.read',async(c,a)=>{
  await expire(a.business);
  const o=(await c.query('SELECT * FROM pos_online_orders WHERE id=$1 AND business_id=$2',[uuid(req.params.orderId),a.business])).rows[0];if(!o)bad('ORDER_NOT_FOUND',404);return project(c,o,true);
 });
 async function shipping(c,a,o,account,refund=false,shift=null){
  const value=BigInt(o.shipping_total);if(!value)return null;
  const f={total:value,paid:value,reason:refund?'ONLINE_SHIPPING_REFUND':'ONLINE_SHIPPING',reference:o.order_number,source:o.sale_id,shift};
  const op=await beginOperation(c,a,{request_id:'online-shipping'+(refund?'-refund:':':')+o.id},refund?'EXPENSE':'OTHER_INCOME',f);
  if(!op.replay){await getAccount(c,a,account,refund?value:0n);await insertOperation(c,a,op,refund?'EXPENSE':'OTHER_INCOME',f);await moneyRow(c,a,op.id,account,refund?-value:value);}return op.id;
 }
 async function transition(req){
  // Separate committed expiry hook prevents expired orders from being revived by a failed confirmation.
  return run(req,'orders.manage',async(c,a)=>{
   await expire(a.business);
   const o=(await c.query('SELECT * FROM pos_online_orders WHERE id=$1 AND business_id=$2 FOR UPDATE',[uuid(req.params.orderId),a.business])).rows[0];if(!o)bad('ORDER_NOT_FOUND',404);
   const b=req.body,target=b.status;if(target===o.status)return {...await project(c,o,true),replay:true};
   const next={ORDERED:['CONFIRMED','CANCELLED'],CONFIRMED:['PROCESSING','REFUNDED'],PROCESSING:['READY_TO_SHIP','REFUNDED'],READY_TO_SHIP:['SHIPPED','COMPLETED','REFUNDED'],SHIPPED:['COMPLETED','REFUNDED'],COMPLETED:['REFUNDED']};
   if(!next[o.status]?.includes(target))bad('INVALID_ORDER_TRANSITION',409);
   if(target==='COMPLETED'&&o.status==='READY_TO_SHIP'&&o.fulfillment!=='PICKUP'||target==='SHIPPED'&&o.fulfillment!=='DELIVERY')bad('INVALID_FULFILLMENT_TRANSITION',409);
   if(target==='CANCELLED'){await release(c,o,text(b.reason,500),a.user);return project(c,{...o,status:target,payment_state:'CANCELLED'},true);}
   const lines=(await c.query('SELECT * FROM pos_online_order_lines WHERE order_id=$1 ORDER BY product_id',[o.id])).rows;
   if(target==='CONFIRMED'){
    if(o.payment_method!=='CREDIT'&&(b.payment_confirmed!==true||!b.reference))bad('MANUAL_PAYMENT_CONFIRMATION_REQUIRED');
    const account=o.payment_method==='CREDIT'?null:uuid(b.account_id);
    if(account)await getAccount(c,a,account);
    for(const l of lines)await getProduct(c,a,l.product_id);
    await c.query("UPDATE pos_online_reservations SET state='COMMITTED' WHERE order_id=$1",[o.id]);
    const total=BigInt(o.merchandise_total),payment={method:o.payment_method,amount:total.toString(),account_id:account,reference:b.reference,
     ...(o.payment_method==='CASH'?{tendered:total.toString()}: {})};
    const receipt=await saleWork(c,a,{items:lines.map(l=>({product_id:l.product_id,quantity:l.quantity})),payments:[payment],shift_id:b.shift_id,
     request_id:'online-sale:'+o.id,customer_id:o.customer_id,due_date:b.due_date},lines);
    o.sale_id=receipt.sale.id;o.shipping_operation_id=await shipping(c,a,o,account,false,o.payment_method==='CASH'?b.shift_id:null);
    await c.query("UPDATE pos_online_orders SET sale_id=$1,shipping_operation_id=$2,payment_state='CONFIRMED',status='CONFIRMED' WHERE id=$3",[o.sale_id,o.shipping_operation_id,o.id]);o.payment_state='CONFIRMED';
   }
   if(target==='REFUNDED'){
    if(!permitted(a,'SALE_REFUND'))bad('MERCHANT_PERMISSION_DENIED',403);
    await returns.postWork(c,a,{source_id:o.sale_id,items:lines.map(l=>({product_id:l.product_id,quantity:l.quantity})),request_id:'online-refund:'+o.id,
     reason:text(b.reason,500),refund_confirmed:b.refund_confirmed,reference:b.reference,shift_id:b.shift_id},false,true);
    const ac=(await c.query('SELECT account_id FROM pos_money_movements WHERE operation_id=$1 ORDER BY account_id LIMIT 1',[o.sale_id])).rows[0]?.account_id;
    o.shipping_refund_id=await shipping(c,a,o,ac,true,o.payment_method==='CASH'?b.shift_id:null);await c.query("UPDATE pos_online_orders SET payment_state='REFUNDED',shipping_refund_id=$1 WHERE id=$2",[o.shipping_refund_id,o.id]);o.payment_state='REFUNDED';
   }
   const courier=target==='SHIPPED'?text(b.courier,120):o.courier,tracking=target==='SHIPPED'?optional(b.tracking,120):o.tracking;
   const updated=(await c.query("UPDATE pos_online_orders SET status=$1,updated_at=now(),courier=$2,tracking=$3,shipped_at=CASE WHEN $1='SHIPPED' THEN now() ELSE shipped_at END WHERE id=$4 RETURNING *",[target,courier,tracking,o.id])).rows[0];
   await event(c,o,target,a.user,optional(b.reason,500));await afterStage('online-transition');return project(c,updated,true);
  });
 }
 const onlineReport=req=>run(req,'reports.read',async(c,a)=>{
  const from=req.query.from||'1970-01-01',to=req.query.to||'9999-12-31';if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||to<from)bad('INVALID_PERIOD');
  const statuses=(await c.query("SELECT status,count(*) count FROM pos_online_orders WHERE business_id=$1 AND (created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 GROUP BY status",[a.business,from,to,a.member.timezone])).rows;
  const channels=(await c.query(`SELECT channel,count(*) FILTER(WHERE kind='SALE') sale_count,coalesce(sum(total) FILTER(WHERE kind='SALE'),0) gross,
   coalesce(sum(total) FILTER(WHERE kind='SALE_RETURN'),0) refunds,coalesce(sum(CASE WHEN kind='SALE' THEN total ELSE -total END),0) net
   FROM pos_business_operations WHERE business_id=$1 AND kind IN('SALE','SALE_RETURN') AND (created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 GROUP BY channel`,[a.business,from,to,a.member.timezone])).rows;
  const top=(await c.query(`SELECT l.product_id,l.name,sum(CASE WHEN o.kind='SALE' THEN l.total ELSE -l.total END) net,sum(CASE WHEN o.kind='SALE' THEN l.quantity ELSE -l.quantity END) quantity
   FROM pos_business_lines l JOIN pos_business_operations o ON o.id=l.operation_id WHERE o.business_id=$1 AND o.channel='ONLINE' AND o.kind IN('SALE','SALE_RETURN')
   AND (o.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 GROUP BY l.product_id,l.name ORDER BY net DESC,l.product_id LIMIT 20`,[a.business,from,to,a.member.timezone])).rows;
  const customers=(await c.query(`SELECT p.id,p.name,sum(CASE WHEN o.kind='SALE' THEN o.total ELSE -o.total END) net FROM pos_business_operations o
   JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id WHERE o.business_id=$1 AND o.channel='ONLINE' AND o.kind IN('SALE','SALE_RETURN')
   AND (o.created_at AT TIME ZONE $4)::date BETWEEN $2 AND $3 GROUP BY p.id,p.name ORDER BY net DESC,p.id LIMIT 20`,[a.business,from,to,a.member.timezone])).rows;
  const online=channels.find(x=>x.channel==='ONLINE'),count=BigInt(online?.sale_count||0);
  return {from,to,timezone:a.member.timezone,order_count:statuses.reduce((n,s)=>n+Number(s.count),0),statuses,channels,top_products:top,top_customers:customers,
   average_online_order_value:count?(BigInt(online.gross)/count).toString():'0',formula:'Committed canonical merchandise sales only; returns subtract once; shipping separate OTHER_INCOME/EXPENSE, no COGS; unpaid reservations are not sales.'};
 });
 return {storefront,publicProduct,checkout,publicOrder,cancelOrder,storeProfile,storeSettings,onlineProduct,customerAccess,orders,orderDetail,orderPaymentContext,transition,onlineReport,expireOnline:expire};
}
module.exports={createBusinessOnline};
