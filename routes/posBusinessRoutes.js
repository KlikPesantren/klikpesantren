const express = require('express');
const { createPosBusinessService } = require('../services/posBusinessService');
// Deliberately not mounted in the legacy /pos tenant router until V2 integration
// is complete. Tests use the real router with an explicitly isolated database.
function createPosBusinessRouter({ db, service = createPosBusinessService({ db }) }) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  const handle = method => async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    try { res.json({ success: true, data: await service[method](req) }); }
    catch (e) {
      const status = e.status || (e.code === '23505' ? 409 : ['23503', '23514', '22003', '22007', '22P02'].includes(e.code) ? 400 : 500);
      // No password, token, credential, SQL detail or raw body in logs/errors.
      if (status === 500) console.error('[POS business]', { operation: method, code: 'INTERNAL' });
      res.status(status).json({ success: false, code: e.status ? e.code : status === 409 ? 'CONFLICT' : status === 400 ? 'INTEGRITY_REJECTED' : 'POS_INTERNAL_ERROR' });
    }
  };
  router.post('/login', handle('login'));
  router.post('/logout', handle('logout'));
  router.get('/:businessId/store',handle('storeSettings'));
  router.post('/:businessId/store',handle('storeProfile'));
  router.post('/:businessId/products/:productId/online',handle('onlineProduct'));
  router.post('/:businessId/customers/online-access',handle('customerAccess'));
  router.get('/:businessId/orders',handle('orders'));
  router.get('/:businessId/order-payment-context',handle('orderPaymentContext'));
  router.get('/:businessId/orders/:orderId',handle('orderDetail'));
  router.post('/:businessId/orders/:orderId/transition',handle('transition'));
  router.get('/:businessId/online-report',handle('onlineReport'));
  router.post('/:businessId/wallet/preview',handle('walletPreview'));
  router.post('/:businessId/wallet/credentials',handle('provisionWalletCredential'));
  router.post('/:businessId/wallet/credentials/:credentialId/revoke',handle('revokeWalletCredential'));
  router.get('/:businessId/context', handle('context'));
  router.get('/:businessId/workspace', handle('workspace'));
  router.post('/:businessId/profile', handle('profile'));
  router.get('/:businessId/users', handle('members'));
  router.post('/:businessId/users/:userId', handle('updateMember'));
  router.get('/:businessId/parties', handle('directory'));
  router.get('/:businessId/inventory', handle('inventory'));
  router.get('/:businessId/activity', handle('activity'));
  router.post('/:businessId/products/:productId', handle('updateProduct'));
  router.get('/:businessId/products', handle('catalog'));
  router.get('/:businessId/books', handle('books'));
  router.get('/:businessId/reports', handle('report'));
  router.get('/:businessId/customers/metrics', handle('customers'));
  router.get('/:businessId/debts/aging', handle('aging'));
  router.get('/:businessId/sales/:operationId', handle('receipt'));
  for (const [path, operation] of [['users', 'member'], ['products', 'product'], ['parties', 'party'], ['accounts', 'account'],
    ['purchases', 'purchase'], ['stock-adjustments', 'adjustment'], ['money', 'money'], ['debt-payments', 'payDebt'],
    ['terminals', 'terminal'], ['shifts/open', 'openShift'], ['shifts/close', 'closeShift'], ['sales', 'sale'],
    ['sale-returns','saleReturn'],['purchase-returns','purchaseReturn']]) {
    router.post('/:businessId/' + path, handle(operation));
  }
  return router;
}
module.exports = { createPosBusinessRouter };
