const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {rupiah}=require('../src/domain.cjs');
const {pricingInput}=require('../src/pricingCart.cjs');
const {buildReceiptText}=require('../src/receiptOutput.cjs');
test('exact id-ID currency formatting handles null, zero, negative, fractions and bigint without rounding',()=>{
 for(const [input,expected] of [[340000,'Rp340.000'],['3400000','Rp3.400.000'],[5000,'Rp5.000'],[null,'Rp0'],[0,'Rp0'],['-12345','-Rp12.345'],['1234.1250','Rp1.234,125'],['9223372036854775807','Rp9.223.372.036.854.775.807']])assert.equal(rupiah(input),expected);
 assert.equal(rupiah('not money'),'—');
});
test('cart contract sends identities/quantities and explicit packages, never trusted prices',()=>{
 const request=pricingInput([{id:'a',quantity:3,selling_price:'1'},{id:'bundle:p',promotion_id:'p',quantity:2,selling_price:'0'}],'customer','member');
 assert.deepEqual(request,{items:[{product_id:'a',quantity:'3'}],packages:[{promotion_id:'p',quantity:'2'}],customer_id:'customer',price_level_id:'member'});
 assert.equal(JSON.stringify(request).includes('selling_price'),false);
});
test('home/menu/sales/detail contracts preserve domains and restrict pricing controls',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/MerchantBusinessApp.jsx'),'utf8');
 const pricing=fs.readFileSync(path.join(__dirname,'../src/PricingScreens.jsx'),'utf8');
 assert.match(source,/TRANSAKSI:"Penjualan"/);assert.doesNotMatch(source,/openMenuGroups|Pengaturan yang perlu dilengkapi/);
 assert.match(source,/can\("PRICE_LEVEL_SELECT"\)/);assert.match(source,/const canPay=quoteReady/);assert.match(source,/PurchaseInvoiceSheet id=\{invoiceId\}/);
 const {navigation}=require('../src/merchantAccess.cjs');assert.ok(navigation(['PRICING_MANAGE']).includes('LEVEL HARGA'));assert.ok(!navigation(['SALE_CREATE','PRODUCT_VIEW']).includes('LEVEL HARGA'));
 assert.match(pricing,/Tambah Promo/);assert.match(pricing,/Minimal Pembelian/);assert.match(pricing,/Pengaturan Lanjutan/);
 assert.match(pricing,/Tanggal Mulai/);assert.match(pricing,/Harga Produk/);assert.doesNotMatch(pricing,/Threshold \/ minimum qty|Mulai ISO/);
 assert.match(source,/INVALID_PROMOTION_PERIOD/);assert.match(source,/INVALID_PROMOTION_PRIORITY/);
});
test('receipt retains actual level price, item discount and stored promotion name',()=>{
 const text=buildReceiptText({sale:{id:'sale',total:'12500',created_at:'2026-10-28'},items:[{name:'Air',quantity:'3',unit_price:'5000',discount:'2500',total:'12500',pricing_snapshot:{level_name:'Member',parts:[{promotion_id:'p',name:'Tiga Hemat'}]}}],payments:[{method:'CASH',amount:'12500'}]});
 assert.match(text,/Rp12\.500/);assert.match(text,/Diskon item/);assert.match(text,/Member/);assert.match(text,/Tiga Hemat/);
});
