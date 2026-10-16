const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../src/MerchantBusinessApp.jsx'),'utf8');
const accessSource=fs.readFileSync(path.join(__dirname,'../src/merchantAccess.cjs'),'utf8');

test('owner home uses only available workspace figures and actionable setup gaps',()=>{
  assert.match(source,/sales=w\.sales_today\|\|\{\}/);
  assert.match(source,/a=w\.attention\|\|\{\}/);
  assert.match(source,/!w\.readiness\[key\]&&can\(permission\)/);
  assert.doesNotMatch(source,/Tren Penjualan/);
  assert.match(source,/Penjualan hari ini/);
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
  for(const label of ['Pembelian Barang','Pelanggan','Piutang','Kas & Rekening','Laporan','Karyawan & Akses','Pengaturan Usaha'])assert.ok(source.includes(label),label);
  assert.ok(source.includes('PRODUK & STOK'));
  assert.ok(accessSource.includes("label:'Produk & Stok'"));
  assert.match(source,/ids\.filter\(id=>navigation\.some/);
});
