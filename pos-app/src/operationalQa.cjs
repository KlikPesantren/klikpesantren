function sellableProduct(p){try{return p.active===true&&p.sellable===true&&BigInt(p.available??p.on_hand??0)>0n;}catch{return false;}}
function returnQuantityAllowed(receipt,product,quantity){if(!/^[1-9]\d*$/.test(String(quantity)))return false;const row=receipt?.refund_context?.items?.find(p=>p.product_id===product);return !!row&&BigInt(quantity)<=BigInt(row.remaining_quantity);}
function eligiblePromotion(p,now=Date.now()){return p.active===true&&!p.level_id&&(!p.starts_at||+new Date(p.starts_at)<=now)&&(!p.ends_at||+new Date(p.ends_at)>now);}
module.exports={sellableProduct,returnQuantityAllowed,eligiblePromotion};
