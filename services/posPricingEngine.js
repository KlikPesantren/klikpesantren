// Canonical integer IDR pricing. General is the only promotion reference.
const MAX=9223372036854775807n;
const fail=code=>{throw Object.assign(Error(code),{code,status:400});};
function integer(value,positive=false){if(!/^(0|[1-9]\d*)$/.test(String(value)))fail('INVALID_PRICING_INTEGER');const n=BigInt(value);if(n>MAX||(positive&&!n))fail('INVALID_PRICING_INTEGER');return n;}
function allocate(total,weights){const sum=weights.reduce((s,n)=>s+n,0n);if(total<0n||total>sum)fail('PROMO_PRICE_EXCEEDS_BASE');let cumulative=0n,allocated=0n;return weights.map(w=>{cumulative+=w;const next=sum?total*cumulative/sum:0n,value=next-allocated;allocated=next;return value;});}
function calculatePricing({products,level,levels=[],prices=[],promotions=[],items=[],packages=[],now=Date.now()}){
 const general=levels.find(l=>l.is_default)|| (level?.is_default?level:{id:null,name:'Harga Umum',is_default:true});
 level=level||general;
 const productMap=new Map(products.map(p=>[p.id,p])),resolve=id=>{const chosen=levels.find(l=>l.id===id&&l.active!==false)||(level.id===id?level:null);if(!chosen)fail('PRICE_LEVEL_DENIED');return chosen;};
 const price=(p,l)=>{const row=!l.is_default&&prices.find(r=>r.level_id===l.id&&r.product_id===p.id);return {unit:integer(row?row.price:p.selling_price),fallback:!l.is_default&&!row};};
 const eligible=promotions.filter(p=>p.active&&!p.level_id&&(!p.starts_at||+new Date(p.starts_at)<=now)&&(!p.ends_at||+new Date(p.ends_at)>now)).sort((a,b)=>Number(b.priority)-Number(a.priority)||a.id.localeCompare(b.id));
 const result=new Map(),offers=[];
 const add=(p,qty,unit,net,selected,part)=>{
  const old=result.get(p.id)||{product_id:p.id,quantity:0n,unit_price:unit,total:0n,pricing_snapshot:{currency:'IDR',reference_price:String(integer(p.selling_price)),level_id:selected.id,level_name:selected.name,parts:[]}};
  if(old.unit_price!==unit){old.unit_price=old.unit_price>unit?old.unit_price:unit;old.pricing_snapshot.level_id=null;old.pricing_snapshot.level_name='Per bagian transaksi';}
  old.quantity+=qty;if(old.quantity>MAX)fail('INVALID_PRICING_INTEGER');old.total+=net;
  old.pricing_snapshot.parts.push({...part,level_id:selected.id,level_name:selected.name,unit_price:String(unit),quantity:String(qty),discount:String(qty*unit-net),total:String(net)});
  result.set(p.id,old);
 };
 if(items.length+packages.length>100||(!items.length&&!packages.length))fail('INVALID_ITEMS');
 if(new Set(items.map(i=>i.product_id)).size!==items.length||new Set(packages.map(i=>i.promotion_id)).size!==packages.length)fail('DUPLICATE_PRODUCT');
 for(const item of [...items].sort((a,b)=>a.product_id.localeCompare(b.product_id))){
  const p=productMap.get(item.product_id);if(!p||!p.active||!p.sellable)fail('PRODUCT_DENIED');
  const selected=item.price_level_id?resolve(item.price_level_id):level,{unit,fallback}=price(p,selected),qty=integer(item.quantity,true),gross=qty*unit;
  const promo=selected.is_default?eligible.find(o=>['QUANTITY','PERCENT','FIXED'].includes(o.kind)&&o.product_id===p.id&&qty>=BigInt(o.threshold||1)&&
   (o.kind!=='QUANTITY'||integer(o.group_price)<=unit*integer(o.threshold,true))&&(o.kind!=='FIXED'||integer(o.discount_amount)<=unit)):null;
  let net=gross,part={kind:'BASE',fallback};
  if(promo){
   if(promo.kind==='QUANTITY'){const threshold=integer(promo.threshold,true),groups=promo.mode==='ONCE'?1n:qty/threshold;net=groups*integer(promo.group_price)+(qty-groups*threshold)*unit;part={kind:promo.kind,threshold:String(threshold),group_price:promo.group_price,groups:String(groups),mode:promo.mode};}
   else {const perUnit=promo.kind==='PERCENT'?unit*integer(promo.discount_bps)/10000n:integer(promo.discount_amount);if(perUnit>unit||promo.kind==='PERCENT'&&integer(promo.discount_bps)>10000n)fail('INVALID_DISCOUNT');net=qty*(unit-perUnit);part={kind:promo.kind,discount_bps:promo.discount_bps,discount_amount:promo.discount_amount,unit_discount:String(perUnit),rounding:'FLOOR_IDR_PER_UNIT'};}
   part={...part,promotion_id:promo.id,name:promo.name};offers.push({...part,quantity:String(qty),total:String(net)});
  }
  add(p,qty,unit,net,selected,part);
 }
 for(const pack of [...packages].sort((a,b)=>a.promotion_id.localeCompare(b.promotion_id))){
  const promo=eligible.find(p=>p.id===pack.promotion_id&&p.kind==='BUNDLE');if(!promo)fail('PROMOTION_UNAVAILABLE');
  const groups=integer(pack.quantity,true),components=[...promo.components].sort((a,b)=>a.product_id.localeCompare(b.product_id));
  if(components.length<2||new Set(components.map(c=>c.product_id)).size!==components.length)fail('INVALID_BUNDLE');
  const weights=components.map(c=>{const p=productMap.get(c.product_id);if(!p||!p.active||!p.sellable)fail('PRODUCT_DENIED');return integer(p.selling_price)*integer(c.quantity,true)*groups;});
  const totals=allocate(integer(promo.group_price)*groups,weights);
  components.forEach((c,i)=>add(productMap.get(c.product_id),integer(c.quantity,true)*groups,integer(productMap.get(c.product_id).selling_price),totals[i],general,{kind:'BUNDLE',promotion_id:promo.id,name:promo.name,groups:String(groups),group_price:promo.group_price}));
  offers.push({kind:'BUNDLE',promotion_id:promo.id,name:promo.name,groups:String(groups),total:String(integer(promo.group_price)*groups)});
 }
 const lines=[...result.values()].sort((a,b)=>a.product_id.localeCompare(b.product_id)).map(i=>{const gross=i.quantity*i.unit_price;if(gross>MAX||i.total>MAX||i.total>gross)fail('INVALID_TOTAL');const commercialGross=i.pricing_snapshot.parts.reduce((sum,p)=>sum+BigInt(p.quantity)*BigInt(p.unit_price),0n);i.pricing_snapshot.commercial_gross=String(commercialGross);i.pricing_snapshot.commercial_discount=String(commercialGross-i.total);return {...i,quantity:String(i.quantity),unit_price:String(i.unit_price),total:String(i.total),discount:String(gross-i.total)};});
 const subtotal=lines.reduce((s,l)=>s+BigInt(l.pricing_snapshot.commercial_gross),0n),total=lines.reduce((s,l)=>s+BigInt(l.total),0n);
 if(subtotal>MAX||total>MAX||lines.length>100)fail('INVALID_TOTAL');
 const manualEligible=lines.reduce((sum,l)=>sum+l.pricing_snapshot.parts.filter(p=>p.kind==='BASE'&&p.level_id===general.id).reduce((n,p)=>n+BigInt(p.total),0n),0n);
 return {general_level_id:general.id,manual_discount_eligible_total:String(manualEligible),level:{id:level.id,name:'Harga dipilih per item'},lines,offers,subtotal:String(subtotal),discount:String(subtotal-total),total:String(total),currency:'IDR',protected_pricing:offers.length>0||lines.some(l=>l.pricing_snapshot.parts.some(p=>p.level_id!==general.id))};
}
module.exports={calculatePricing,integer,allocate};
