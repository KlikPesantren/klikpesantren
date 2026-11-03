function pricingInput(cart,customer_id,price_level_id){return {
 items:cart.filter(p=>!p.promotion_id).map(p=>({product_id:p.id,quantity:String(p.quantity),...(p.price_level_id?{price_level_id:p.price_level_id}:{})})).sort((a,b)=>a.product_id.localeCompare(b.product_id)),
 packages:cart.filter(p=>p.promotion_id).map(p=>({promotion_id:p.promotion_id,quantity:String(p.quantity)})).sort((a,b)=>a.promotion_id.localeCompare(b.promotion_id)),
 ...(customer_id?{customer_id}:{}),...(price_level_id?{price_level_id}:{}),
};}
module.exports={pricingInput};
