const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {ALL,effective}=require('../../services/posBusinessPermissions');
const {errorText}=require('../src/domain.cjs');

const app=fs.readFileSync(path.join(__dirname,'../src/MerchantBusinessApp.jsx'),'utf8')+fs.readFileSync(path.join(__dirname,'../src/FinancialWorkspace.jsx'),'utf8');
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

test('occupied terminal or cash drawer gives an actionable shift error',()=>{
  assert.equal(errorText({code:'SHIFT_RESOURCE_IN_USE'}),'Terminal atau laci kas sedang dipakai shift pengguna lain. Tutup shift tersebut atau pilih terminal/laci lain.');
  assert.match(service,/SHIFT_RESOURCE_IN_USE/);
  assert.match(service,/pos_business_shift_terminal/);
  assert.match(service,/pos_business_shift_drawer/);
});

test('owner finance has reviewed sheet confirmation and idempotent canonical posting',()=>{
 for(const text of ['Kasbox','Transfer Saldo','Pengeluaran','Pemasukan Lain-lain','Arus Kas'])assert.ok(app.includes(text));
 assert.ok(app.includes("post.current('/money'"));assert.match(app,/request_id:requestId.current/);
 assert.match(app,/saveLock.current/);assert.match(app,/Konfirmasi & Simpan/);
});
test('clean reports preserve truthful scope and omit metrics outside permission',()=>{
 assert.match(app,/Hasil Usaha Operasional/);assert.match(app,/HPP FIFO/);
 assert.match(app,/k\[key\]!=null/);assert.match(app,/belum mencakup seluruh aset dan kewajiban/);
 assert.doesNotMatch(app,/SalesChart|Arti Angka|Cakupan Hasil Usaha/);
});
