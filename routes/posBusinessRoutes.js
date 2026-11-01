const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { createPosBusinessService } = require('../services/posBusinessService');
const { uploadImageBuffer } = require('../services/cloudinaryUploadService');
// Canonical merchant-owned API. It is intentionally isolated from tenant Admin
// authentication and mounted under /pos-business.
function createPosBusinessRouter({ db, service = createPosBusinessService({ db }), uploadImage = uploadImageBuffer }) {
  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));
  const productUpload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
      const ext = path.extname(file.originalname || '').toLowerCase();
      cb(allowed.has(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext) ? null : Error('INVALID_PRODUCT_IMAGE'),
        allowed.has(file.mimetype) && ['.jpg', '.jpeg', '.png', '.webp'].includes(ext));
    },
  });
  const workbookUpload = multer({
    storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase();
      const allowed = new Set([
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/octet-stream',
      ]);
      const valid = ext === '.xlsx' && allowed.has(file.mimetype);
      const error = valid ? null : Object.assign(Error('INVALID_PRODUCT_WORKBOOK'), { status: 400, code: 'INVALID_PRODUCT_WORKBOOK' });
      cb(error, valid);
    },
  });
  const respondError = (res, operation, e) => {
    const safeDbCodes=new Set(['INVALID_ACCOUNTING_DATE','ACCOUNTING_TIMEZONE_LOCKED','ACTIVE_DRAWER_REQUIRES_CURRENT_DATE']);
    if(safeDbCodes.has(e.message)){e.status=400;e.code=e.message;}
    if(new Set(['INVALID_MONEY_REVERSAL','MONEY_REVERSAL_LEGS_MISMATCH','MONEY_CORRECTION_REPLACEMENT_REQUIRED','MONEY_CORRECTION_REQUIRES_REVERSAL','LINKED_OPERATION_REQUIRES_DOMAIN_REVERSAL']).has(e.message)){e.status=409;e.code=e.message;}
    if(e.code==='55P03'){e.status=409;e.code='FINANCE_POST_RETRY';}
    const status = e.status || (e.code === 'LIMIT_FILE_SIZE' ? 413 : e.message === 'INVALID_PRODUCT_IMAGE' ? 400
      : e.code === '23505' ? 409 : ['23503', '23514', '22003', '22007', '22P02'].includes(e.code) ? 400 : 500);
    if (status === 500) console.error('[POS business]', { operation, code: 'INTERNAL' });
    res.status(status).json({ success: false, code: e.status ? e.code : status === 413 ? (operation.startsWith('productWorkbook') ? 'PRODUCT_WORKBOOK_TOO_LARGE' : 'PRODUCT_IMAGE_TOO_LARGE')
      : status === 409 ? 'CONFLICT' : status === 400 ? 'INVALID_PRODUCT_IMAGE' : 'POS_INTERNAL_ERROR' });
  };
  const handle = method => async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    try { res.json({ success: true, data: await service[method](req) }); }
    catch (e) {
      respondError(res, method, e);
    }
  };
  router.post('/login', handle('login'));
  router.post('/activate', handle('activate'));
  router.post('/logout', handle('logout'));
  router.get('/memberships', handle('memberships'));
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
  router.post('/:businessId/users/:userId/reissue-activation', handle('reissueMemberActivation'));
  router.get('/:businessId/parties', handle('directory'));
  router.post('/:businessId/parties/:partyId', handle('updateParty'));
  router.get('/:businessId/inventory', handle('inventory'));
  router.get('/:businessId/activity', handle('activity'));
  router.get('/:businessId/sales', handle('sales'));
  router.get('/:businessId/purchases', handle('purchases'));
  router.get('/:businessId/shifts', handle('shifts'));
  router.get('/:businessId/terminals', handle('terminals'));
  router.get('/:businessId/cash-drawers', handle('cashDrawers'));
  router.get('/:businessId/payment-accounts', handle('paymentAccounts'));
  router.get('/:businessId/wallet-settlement', handle('settlementPosition'));
  router.get('/:businessId/initialization', handle('initializationStatus'));
  router.post('/:businessId/initialization/finalize', handle('finalizeInitialization'));
  router.post('/:businessId/initialization/corrections', handle('correctInitialization'));
  router.post('/:businessId/product-assets', async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    try {
      const authority = await service.authorizeProductAsset(req);
      await new Promise((resolve, reject) => productUpload.single('file')(req, res, error => error ? reject(error) : resolve()));
      if (!req.file) throw Object.assign(Error('INVALID_PRODUCT_IMAGE'), { status: 400, code: 'INVALID_PRODUCT_IMAGE' });
      const uploaded = await uploadImage(req.file.buffer, {
        originalName: req.file.originalname, folder: `pos-products/${authority.business_id}`, productImage: true,
      });
      res.json({ success: true, data: { url: uploaded.secure_url } });
    } catch (e) { respondError(res, 'productAsset', e); }
  });
  const workbookFile = method => async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    try {
      await new Promise((resolve, reject) => workbookUpload.single('file')(req, res, error => error ? reject(error) : resolve()));
      const data = await service[method](req);
      res.json({ success: true, data });
    } catch (e) {
      if (e.details && e.status === 422) return res.status(422).json({ success: false, code: e.code, data: e.details });
      respondError(res, method, e);
    }
  };
  const workbookDownload = method => async (req, res) => {
    res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' });
    try {
      const file = await service[method](req);
      res.set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'X-Content-Type-Options': 'nosniff',
      });
      res.send(file.buffer);
    } catch (e) { respondError(res, method, e); }
  };
  router.get('/:businessId/products/template.xlsx', workbookDownload('productWorkbookTemplate'));
  router.post('/:businessId/products/import/preview', workbookFile('productWorkbookPreview'));
  router.post('/:businessId/products/import/commit', workbookFile('productWorkbookCommit'));
  router.get('/:businessId/products/export.xlsx', workbookDownload('productWorkbookExport'));
  router.get('/:businessId/cash-book/export.xlsx', workbookDownload('cashBookWorkbook'));
  router.post('/:businessId/products/:productId', handle('updateProduct'));
  router.get('/:businessId/products', handle('catalog'));
  router.get('/:businessId/books', handle('books'));
  router.get('/:businessId/finance-categories', handle('financeCategories'));
  router.get('/:businessId/money/:operationId/document',handle('moneyDocument'));
  router.post('/:businessId/money/:operationId/revise',handle('reviseMoney'));
  router.get('/:businessId/cash-book', handle('cashBook'));
  router.get('/:businessId/reports', handle('report'));
  router.get('/:businessId/customers/metrics', handle('customers'));
  router.get('/:businessId/debts/aging', handle('aging'));
  router.get('/:businessId/sales/:operationId', handle('receipt'));
  router.get('/:businessId/purchases/:operationId', handle('purchaseDetail'));
  router.get('/:businessId/pricing',handle('pricing'));
  router.post('/:businessId/pricing/quote',handle('pricingQuote'));
  router.post('/:businessId/pricing/levels',handle('savePriceLevel'));
  router.post('/:businessId/pricing/prices',handle('saveLevelPrice'));
  router.post('/:businessId/pricing/customer-level',handle('assignCustomerPriceLevel'));
  router.post('/:businessId/pricing/promotions',handle('savePromotion'));
  for (const [path, operation] of [['users', 'member'], ['products', 'product'], ['parties', 'party'], ['accounts', 'account'],
    ['purchases', 'purchase'], ['stock-adjustments', 'adjustment'], ['money', 'money'], ['debt-payments', 'payDebt'],
    ['terminals', 'terminal'], ['shifts/open', 'openShift'], ['shifts/close', 'closeShift'], ['sales', 'sale'],
    ['sale-returns','saleReturn'],['purchase-returns','purchaseReturn']]) {
    router.post('/:businessId/' + path, handle(operation));
  }
  return router;
}
module.exports = { createPosBusinessRouter };
