const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/MerchantBusinessApp.jsx'),'utf8');
const accessSource=fs.readFileSync(path.join(__dirname,'../src/merchantAccess.cjs'),'utf8');
const serviceSource=fs.readFileSync(path.join(__dirname,'../../services/posBusinessService.js'),'utf8');

test('owner home uses canonical workspace/month figures without onboarding checklist',()=>{
  assert.match(source,/sales=w\.sales_today\|\|\{\}/);
  assert.match(source,/a=w\.attention\|\|\{\}/);
  assert.doesNotMatch(source,/Pengaturan yang perlu dilengkapi/);
  assert.match(source,/Penjualan hari ini/);
  assert.match(source,/Penjualan bulan ini/);
  assert.match(source,/Laba kotor bulan ini/);
  assert.match(source,/SalesMonthChart rows=\{report\.sales\?\.daily\}/);
  assert.match(source,/Hari tanpa penjualan tetap ditampilkan sebagai nol/);
  assert.match(serviceSource,/generate_series\(\$2::date,\$3::date,'1 day'::interval\) AS series\(day_value\)/);
  assert.match(serviceSource,/to_char\(series\.day_value,'YYYY-MM-DD'\) AS "day"/);
  assert.match(serviceSource,/GROUP BY series\.day_value ORDER BY series\.day_value/);
  assert.match(serviceSource,/daily:dailySales/);
});

test('business context survives secondary dashboard failures and exposes retry',()=>{
  const contextIndex=source.indexOf('setContext(nextContext);setModule(selected)');
  const loaderIndex=source.indexOf('const entries = await Promise.all');
  assert.ok(contextIndex>0&&loaderIndex>contextIndex,'context must be committed before optional projections load');
  assert.match(source,/title=\{error\?"Usaha belum dapat dimuat":"Memuat konteks usaha"\}/);
  assert.match(source,/onRetry=\{error\?\(\)=>run\(\(\)=>refresh\("BERANDA",session\)\)/);
});

test('session restore only discards invalid authority, not transient loader failures',()=>{
  assert.match(source,/shouldDiscardMerchantSession\(restoreError\)/);
  assert.match(source,/else if \(alive\) \{\s*setError\(errorText\(restoreError\)\)/);
  assert.match(source,/SESSION_INVALID_CODES = new Set\(\["MERCHANT_SESSION_INVALID", "AUTH_EXPIRED"\]\)/);
  assert.match(source,/const fallback = \{ token: saved\.token, businessId: null \}/);
  assert.match(source,/setDirectory\(found\); setSession\(fallback\)/);
});

test('cashier home is operational and contains no owner financial summary',()=>{
  assert.match(source,/isCashier\?"Siap melayani"/);
  assert.match(source,/isCashier\?<Card title=\{w\.open_shift/);
  assert.match(source,/dashboardActions\(context\.role,context\.permissions\)/);
});

test('cashier remains mounted across tab changes so the cart survives within one merchant context',()=>{
  assert.match(source,/common\.can\("SALE_CREATE"\)/);
  assert.match(source,/props\.module!=="KASIR"&&s\.hidden/);
  assert.match(source,/props\.module!=="KASIR"&&<ScrollView/);
  assert.match(source,/moduleCache\.current\.clear\(\)/);
});

test('menu exposes operational modules with plain Indonesian labels and permission filtering',()=>{
  for(const label of ['Pembelian Barang','Pelanggan','Piutang','Kasbox','Laporan Usaha','Karyawan & Akses','Pengaturan Usaha'])assert.ok(source.includes(label),label);
  for(const group of ['PRODUK & PERSEDIAAN','KONTAK','TRANSAKSI BARANG','KEUANGAN','LAPORAN','OPERASIONAL & PENGATURAN'])assert.ok(source.includes(group),group);
  assert.ok(accessSource.includes("label:'Produk & Stok'"));
  assert.match(source,/ids\.filter\(id=>navigation\.some/);
  assert.doesNotMatch(source,/openMenuGroups|expanded:opened/);
  assert.match(source,/menuGroupHeader}><Text/);
});
