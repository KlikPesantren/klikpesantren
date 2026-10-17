const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {ALL,effective}=require('../../services/posBusinessPermissions');

const app=fs.readFileSync(path.join(__dirname,'../src/MerchantBusinessApp.jsx'),'utf8');
const service=fs.readFileSync(path.join(__dirname,'../../services/posBusinessService.js'),'utf8');

test('a true Owner receives every canonical operational permission',()=>{
  const owner=effective('OWNER',[]);
  assert.deepEqual(owner,ALL);
  for(const permission of ['SALE_CREATE','SALE_VIEW','SHIFT_OPEN','SHIFT_CLOSE','FINANCE_ACCOUNT_VIEW','EXPENSE_CREATE','TRANSFER_CREATE','AR_COLLECT','AP_PAY','REPORT_SALES','REPORT_PROFIT','REPORT_FINANCE'])assert.ok(owner.includes(permission),permission);
});

test('cashier identity is the authenticated membership and is not manufactured by the app',()=>{
  assert.match(app,/Masuk sebagai \{ROLE_LABELS\[context\.role\]/);
  assert.match(app,/Peran di usaha ini/);
  assert.match(app,/context\.role==="OWNER"/);
  assert.doesNotMatch(app,/context\.role\s*=\s*["']OWNER["']/);
  assert.match(service,/cashier_id:\s*a\.user/);
});

test('owner finance is grouped, permission-derived, and uses canonical money endpoint',()=>{
  for(const label of ['Kas & Bank','Catat','Riwayat','Piutang Customer','Utang Supplier','Laporan Keuangan'])assert.ok(app.includes(label),label);
  assert.match(app,/submit\("\/money"/);
  assert.match(app,/request_id:requestId\.current/);
  assert.match(app,/account\.id!==form\.account_id/);
  assert.match(app,/can\("AR_VIEW"\)/);
  assert.match(app,/can\("AP_VIEW"\)/);
});

test('reports distinguish sales, receipts, credit, and non-statutory operating result',()=>{
  assert.match(app,/Penjualan bersih adalah nilai penjualan setelah retur/);
  assert.match(app,/penjualan piutang tetap outstanding sampai ditagih/);
  assert.match(app,/bukan laba bersih\/statutory final/);
  assert.match(app,/HPP FIFO aktual/);
  assert.match(app,/context\.permissions\.includes\("REPORT_FINANCE"\)/);
});
