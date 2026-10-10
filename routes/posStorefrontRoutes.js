const express=require('express');
function createPosStorefrontRouter({service}){
 const router=express.Router();router.use(express.json({limit:'32kb'}));
 const handle=method=>async(req,res)=>{
  res.set({'Cache-Control':'no-store',Pragma:'no-cache','X-Content-Type-Options':'nosniff'});
  try{res.json({success:true,data:await service[method](req)});}catch(e){
   const status=e.status||(e.code==='23505'?409:['23514','23503','22003','22007','22P02'].includes(e.code)?400:500);
   if(status===500)console.error('[POS online]',{operation:method,code:'INTERNAL'});
   res.status(status).json({success:false,code:e.status?e.code:status===409?'CONFLICT':status===400?'INTEGRITY_REJECTED':'ONLINE_INTERNAL_ERROR'});
  }
 };
 router.get('/:slug',handle('storefront'));router.get('/:slug/products/:productId',handle('publicProduct'));
 router.post('/:slug/orders',handle('checkout'));router.get('/:slug/orders/:orderId',handle('publicOrder'));
 router.post('/:slug/orders/:orderId/cancel',handle('cancelOrder'));return router;
}
module.exports={createPosStorefrontRouter};
