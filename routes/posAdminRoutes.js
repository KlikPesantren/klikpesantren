const express=require('express');
const service=require('../services/posAdminService');
// Mounted behind the canonical /pos auth + tenant middleware. Service repeats
// verified tenant/user/unit/permission checks in every transaction.
function createPosAdminRouter({admin=service}={}){
 const router=express.Router();
 const handle=operation=>async(req,res)=>{try{res.json({success:true,data:await admin[operation](req)});}catch(e){
  const status=e.status||(['23503','23514','22P02','22003'].includes(e.code)?400:e.code==='23505'?409:500);
  if(status===500)console.error('[POS admin]',{operation,code:e.code||'INTERNAL'});
  res.status(status).json({success:false,code:e.status?e.code:status===500?'POS_INTERNAL_ERROR':'INTEGRITY_REJECTED'});
 }};
 for(const operation of ['dashboard','transactions','shifts','refunds','reconciliation'])router.get('/'+operation,handle(operation));
 router.get('/transactions/:id',handle('detail'));
 router.get('/management/:kind',handle('management'));
 router.get('/businesses-v2',handle('businessesV2'));
 router.post('/businesses-v2',handle('onboardBusiness'));
 router.patch('/businesses-v2/:id',handle('editBusinessV2'));
 router.patch('/categories/:id',handle('editCategory'));
 router.patch('/merchants/:id',handle('editMerchant'));
 router.patch('/terminals/:id',handle('configureTerminal'));
 return router;
}
module.exports={createPosAdminRouter};
