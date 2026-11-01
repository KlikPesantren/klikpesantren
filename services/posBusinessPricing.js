const {calculatePricing,integer}=require('./posPricingEngine');
function createBusinessPricing({run,bad,uuid,text,makeId,lock}){
 const available=async c=>!!(await c.query("SELECT to_regclass('public.pos_price_levels') present")).rows[0].present;
 async function configuration(c,a){
  if(!await available(c))bad('PRICING_MIGRATION_REQUIRED',503);
  await lock(c,'pos-pricing:'+a.business);
  await c.query("INSERT INTO pos_price_levels(id,business_id,name,is_default) VALUES($1,$2,'Harga Umum',true) ON CONFLICT DO NOTHING",[makeId(),a.business]);
  const levels=(await c.query('SELECT * FROM pos_price_levels WHERE business_id=$1 ORDER BY is_default DESC,name,id',[a.business])).rows;
  const prices=(await c.query('SELECT level_id,product_id,price FROM pos_product_level_prices WHERE business_id=$1 ORDER BY level_id,product_id',[a.business])).rows;
  const promotions=(await c.query('SELECT * FROM pos_price_promotions WHERE business_id=$1 ORDER BY priority DESC,id',[a.business])).rows;
  const components=(await c.query('SELECT promotion_id,product_id,quantity FROM pos_price_bundle_components WHERE business_id=$1 ORDER BY promotion_id,product_id',[a.business])).rows;
  promotions.forEach(p=>{p.components=components.filter(c=>c.promotion_id===p.id);p.compatibility=p.level_id?'LEGACY_LEVEL_TARGET_PAUSED':'GENERAL_ONLY';});
  return {levels,prices,promotions,currency:'IDR'};
 }
 const list=req=>run(req,'PRODUCT_VIEW',(c,a)=>configuration(c,a));
 async function quoteWork(c,a,b){
  if(!Array.isArray(b.items)||b.items.length>100||b.packages!=null&&!Array.isArray(b.packages)||(b.packages||[]).length>100)bad('INVALID_ITEMS');
  const config=await configuration(c,a);
  let customer=null;
  if(b.customer_id){customer=(await c.query("SELECT price_level_id FROM pos_business_parties WHERE business_id=$1 AND id=$2 AND kind='CUSTOMER' AND active FOR SHARE",[a.business,uuid(b.customer_id)])).rows[0];if(!customer)bad('CUSTOMER_DENIED',403);}
  if(b.price_level_id&&!a.member.effective_permissions.includes('PRICE_LEVEL_SELECT'))bad('MERCHANT_PERMISSION_DENIED',403);
  const selected=b.price_level_id?uuid(b.price_level_id):null;
  let level=config.levels.find(l=>l.id===selected&&l.active);
  if(b.price_level_id&&!level)bad('PRICE_LEVEL_DENIED',403);
  level=level||config.levels.find(l=>l.is_default);
  const items=(b.items||[]).map(i=>{if(i.price_level_id&&!a.member.effective_permissions.includes('PRICE_LEVEL_SELECT'))bad('MERCHANT_PERMISSION_DENIED',403);if(i.price_level_id&&!config.levels.some(l=>l.id===uuid(i.price_level_id)&&l.active))bad('PRICE_LEVEL_DENIED',403);if(i.price_level_id&&!config.levels.find(l=>l.id===uuid(i.price_level_id))?.is_default&&!config.prices.some(p=>p.level_id===uuid(i.price_level_id)&&p.product_id===uuid(i.product_id)))bad('PRICE_LEVEL_PRICE_UNAVAILABLE',409);return {product_id:uuid(i.product_id),quantity:String(integer(i.quantity,true)),...(i.price_level_id?{price_level_id:uuid(i.price_level_id)}:{})};});
  const packages=(b.packages||[]).map(i=>({promotion_id:uuid(i.promotion_id),quantity:String(integer(i.quantity,true))}));
  const products=(await c.query('SELECT id,name,sku,uom,selling_price,active,sellable FROM pos_business_products WHERE business_id=$1 ORDER BY id FOR SHARE',[a.business])).rows;
  const now=+(await c.query('SELECT clock_timestamp() value')).rows[0].value;
  return calculatePricing({...config,products,level,items,packages,now});
 }
 const quote=req=>run(req,'SALE_CREATE',(c,a)=>quoteWork(c,a,req.body||{}));
 const saveLevel=req=>run(req,'PRICING_MANAGE',async(c,a)=>{
  await configuration(c,a);const b=req.body,id=b.id?uuid(b.id):makeId();
  if(b.currency&&b.currency!=='IDR')bad('INVALID_CURRENCY');
  if(b.id){const old=(await c.query('SELECT is_default FROM pos_price_levels WHERE id=$1 AND business_id=$2',[id,a.business])).rows[0];if(!old)bad('PRICE_LEVEL_DENIED',403);if(old.is_default)bad('DEFAULT_LEVEL_IMMUTABLE');}
  return (await c.query(`INSERT INTO pos_price_levels(id,business_id,name,active) VALUES($1,$2,$3,$4)
   ON CONFLICT(id) DO UPDATE SET name=excluded.name,active=excluded.active WHERE pos_price_levels.business_id=excluded.business_id RETURNING *`,[id,a.business,text(b.name,80),b.active!==false])).rows[0];
 });
 const savePrice=req=>run(req,'PRICING_MANAGE',async(c,a)=>{
  const config=await configuration(c,a),b=req.body,level=config.levels.find(l=>l.id===uuid(b.level_id)&&l.active&&!l.is_default);
  if(!level)bad('PRICE_LEVEL_DENIED',403);
  if(!(await c.query('SELECT id FROM pos_business_products WHERE id=$1 AND business_id=$2',[uuid(b.product_id),a.business])).rowCount)bad('PRODUCT_DENIED',403);
  if(b.price==null){await c.query('DELETE FROM pos_product_level_prices WHERE business_id=$1 AND level_id=$2 AND product_id=$3',[a.business,level.id,b.product_id]);return {fallback:true};}
  return (await c.query(`INSERT INTO pos_product_level_prices(business_id,level_id,product_id,price) VALUES($1,$2,$3,$4)
   ON CONFLICT(business_id,level_id,product_id) DO UPDATE SET price=excluded.price RETURNING *`,[a.business,level.id,b.product_id,String(integer(b.price))])).rows[0];
 });
 const assignCustomer=req=>run(req,'PRICING_MANAGE',async(c,a)=>{
  const config=await configuration(c,a),b=req.body;
  if(b.level_id&&!config.levels.some(l=>l.id===uuid(b.level_id)&&l.active))bad('PRICE_LEVEL_DENIED',403);
  const row=(await c.query("UPDATE pos_business_parties SET price_level_id=$3 WHERE id=$1 AND business_id=$2 AND kind='CUSTOMER' AND active RETURNING id,price_level_id",[uuid(b.customer_id),a.business,b.level_id||null])).rows[0];
  if(!row)bad('CUSTOMER_DENIED',403);return row;
 });
 const savePromotion=req=>run(req,'PRICING_MANAGE',async(c,a)=>{
  const config=await configuration(c,a),b=req.body,id=b.id?uuid(b.id):makeId();
  // A client-generated id makes a timed-out CREATE safe to retry. Existing ids
  // remain strictly scoped to the authenticated merchant.
  const owner=b.id?(await c.query('SELECT business_id FROM pos_price_promotions WHERE id=$1 FOR UPDATE',[id])).rows[0]:null;
  if(owner&&owner.business_id!==a.business)bad('PROMOTION_DENIED',403);
  if(!['QUANTITY','BUNDLE','PERCENT','FIXED'].includes(b.kind)||!['EVERY','ONCE'].includes(b.mode||'EVERY'))bad('INVALID_PROMOTION');
  if(b.currency&&b.currency!=='IDR')bad('INVALID_CURRENCY');
  if(b.level_id)bad('LEGACY_PROMOTION_REQUIRES_REVIEW');
  const components=b.kind==='BUNDLE'?(b.components||[]).map(i=>({product_id:uuid(i.product_id),quantity:String(integer(i.quantity,true))})):[];
  if(b.kind==='BUNDLE'&&(components.length<2||components.length>50||new Set(components.map(c=>c.product_id)).size!==components.length))bad('INVALID_BUNDLE');
  const product=b.kind!=='BUNDLE'?uuid(b.product_id):null;
  const percent=b.kind==='PERCENT'?String(integer(b.discount_bps)):null,fixed=b.kind==='FIXED'?String(integer(b.discount_amount)):null;
  if(percent&&BigInt(percent)>10000n)bad('INVALID_DISCOUNT');
  if(fixed){const p=(await c.query('SELECT selling_price FROM pos_business_products WHERE id=$1 AND business_id=$2 FOR SHARE',[product,a.business])).rows[0];if(!p||BigInt(fixed)>BigInt(p.selling_price))bad('INVALID_DISCOUNT');}
  for(const pid of [product,...components.map(c=>c.product_id)].filter(Boolean))if(!(await c.query('SELECT id FROM pos_business_products WHERE id=$1 AND business_id=$2 AND active',[pid,a.business])).rowCount)bad('PRODUCT_DENIED',403);
  const date=value=>{if(!value)return null;const d=new Date(value);if(!Number.isFinite(+d))bad('INVALID_PROMOTION_PERIOD');return d.toISOString();};
  const start=date(b.starts_at),end=date(b.ends_at);if(start&&end&&start>=end)bad('INVALID_PROMOTION_PERIOD');
  const priority=Number(b.priority||0);if(!Number.isInteger(priority)||Math.abs(priority)>100000)bad('INVALID_PROMOTION_PRIORITY');
  const saved=(await c.query(`INSERT INTO pos_price_promotions(id,business_id,name,kind,product_id,threshold,group_price,mode,priority,level_id,starts_at,ends_at,active,discount_bps,discount_amount)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,product_id=excluded.product_id,
   threshold=excluded.threshold,group_price=excluded.group_price,mode=excluded.mode,priority=excluded.priority,level_id=excluded.level_id,
   starts_at=excluded.starts_at,ends_at=excluded.ends_at,active=excluded.active,discount_bps=excluded.discount_bps,discount_amount=excluded.discount_amount WHERE pos_price_promotions.business_id=excluded.business_id RETURNING id`,
  [id,a.business,text(b.name,120),b.kind,product,b.kind==='BUNDLE'?null:b.kind==='QUANTITY'?String(integer(b.threshold,true)):'1',['PERCENT','FIXED'].includes(b.kind)?'0':String(integer(b.group_price)),b.mode||'EVERY',priority,null,start,end,b.active!==false,percent,fixed])).rows[0];
  if(!saved)bad('PROMOTION_DENIED',403);
  await c.query('DELETE FROM pos_price_bundle_components WHERE business_id=$1 AND promotion_id=$2',[a.business,id]);
  for(const part of components)await c.query('INSERT INTO pos_price_bundle_components(business_id,promotion_id,product_id,quantity) VALUES($1,$2,$3,$4)',[a.business,id,part.product_id,part.quantity]);
  return saved;
 });
 return {pricing:list,pricingQuote:quote,savePriceLevel:saveLevel,saveLevelPrice:savePrice,assignCustomerPriceLevel:assignCustomer,savePromotion,quoteWork,available};
}
module.exports={createBusinessPricing};
