const express = require('express');
const auth = require('../middleware/authMiddleware');
const tenant = require('../middleware/tenantMiddleware');
const service = require('../services/posService');

// Unit/RBAC/merchant/terminal authority is rechecked inside each transaction.
function createPosRouter({ pos = service, authenticate = auth, tenantContext = tenant } = {}) {
  const router = express.Router();
  router.use(authenticate, tenantContext);
  router.use('/admin',require('./posAdminRoutes').createPosAdminRouter());
  const handle = operation => async (req,res) => {
    try { res.json({success:true,data:await pos[operation](req)}); }
    catch (e) {
      const status=e.status || (e.code==='23505'?409:['23503','23514','22P02','22003'].includes(e.code)?400:500);
      // Never log body, credential, SQL detail or errors containing them.
      if (status===500) console.error('[POS]',{code:e.code||'INTERNAL',operation});
      res.status(status).json({success:false,code:e.status?e.code:status===409?'CONFLICT':status===400?'INTEGRITY_REJECTED':'POS_INTERNAL_ERROR'});
    }
  };
  router.get('/catalog',handle('catalog'));
  router.post('/categories',handle('category'));
  router.post('/products',handle('product'));
  router.patch('/products/:id',handle('product'));
  router.post('/merchants',handle('createMerchant'));
  router.post('/merchants/:id/config',handle('configureMerchant'));
  router.post('/terminals/:id/config',handle('configureTerminal'));
  router.post('/merchants/:id/cashiers',handle('assignCashier'));
  router.post('/shifts/open',handle('openShift'));
  router.post('/shifts/:id/close',handle('closeShift'));
  router.post('/checkout',handle('checkout'));
  router.get('/sales/:id',handle('sale'));
  router.post('/sales/:id/confirm-payment',handle('confirmPayment'));
  router.post('/sales/:id/void',handle('voidSale'));
  router.post('/refunds',handle('refund'));
  router.post('/refunds/:id/confirm',handle('confirmRefund'));
  return router;
}
module.exports=createPosRouter();
module.exports.createPosRouter=createPosRouter;
