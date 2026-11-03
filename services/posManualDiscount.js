// Allocate integer IDR only over eligible BASE/General parts. Products and parts
// already have canonical order; cumulative flooring conserves every Rupiah.
function allocateManualDiscount(quote,value){
 const discount=BigInt(value),fail=()=>{throw Object.assign(Error('MANUAL_DISCOUNT_EXCEEDS_ELIGIBLE'),{code:'MANUAL_DISCOUNT_EXCEEDS_ELIGIBLE',status:400});};
 const eligible=part=>part.kind==='BASE'&&part.level_id===quote.general_level_id;
 const weights=quote.lines.map(line=>line.pricing_snapshot.parts.map(p=>eligible(p)?BigInt(p.total):0n));
 const total=weights.flat().reduce((s,n)=>s+n,0n);if(discount<0n||discount>total)fail();
 let cumulative=0n,allocated=0n;
 return {eligible_total:String(total),rounding:'CUMULATIVE_FLOOR_IDR_PRODUCT_PART_ORDER',lines:quote.lines.map((line,i)=>{let lineDiscount=0n;const parts=line.pricing_snapshot.parts.map((part,j)=>{cumulative+=weights[i][j];const next=total?discount*cumulative/total:0n,amount=next-allocated;allocated=next;lineDiscount+=amount;return {...part,manual_discount:String(amount),total_after_manual:String(BigInt(part.total)-amount),manual_discount_eligible:eligible(part)};});return {product_id:line.product_id,discount:String(lineDiscount),parts};})};
}
module.exports={allocateManualDiscount};
