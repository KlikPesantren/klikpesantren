const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const app=read('pos-app/App.js'),merchant=read('pos-app/src/MerchantBusinessApp.jsx'),access=read('pos-app/src/merchantAccess.cjs');
const api=read('pos-app/src/api.js'),vault=read('pos-app/src/vault.cjs'),parser=require('../pos-app/node_modules/@babel/parser');
for(const source of [app,merchant,read('pos-app/src/ui.js')]){
 const ast=parser.parse(source,{sourceType:'module',plugins:['jsx']});
 (function visit(node,parent){if(!node||typeof node!=='object')return;if(node.type==='JSXText'&&node.value.trim())assert.equal(parent?.openingElement?.name?.name,'Text',`Native literal outside Text: ${node.value.trim().slice(0,30)}`);for(const [key,value] of Object.entries(node)){if(['loc','start','end','extra'].includes(key))continue;if(Array.isArray(value))value.forEach(item=>visit(item,node));else if(value&&typeof value==='object')visit(value,node);}})(ast,null);
}
assert(app.includes('MerchantBusinessApp'));
assert(merchant.includes('/pos-business/login'));
assert(merchant.includes('/pos-business/memberships'));
assert(merchant.includes('merchant-session'));
assert(merchant.includes('navigationItems(nextContext.permissions)'));
assert(merchant.includes('/context'));
assert(!merchant.includes('/auth/login'));
assert(!merchant.includes('/pos/mobile/'));
for(const module of ['KASIR','TRANSAKSI','SHIFT','PRODUK','STOK','CUSTOMER','SUPPLIER','PEMBELIAN','PIUTANG','UTANG','KEUANGAN','LAPORAN','TOKO ONLINE','PENGGUNA','PENGATURAN'])assert(access.includes(`'${module}'`));
for(const endpoint of ['/sales','/sale-returns','/shifts/open','/shifts/close','/stock-adjustments','/parties','/purchases','/purchase-returns','/debt-payments','/money','/orders/','/products/','/store','/users/','/reset-credential','/profile','/reports?'])assert(merchant.includes(endpoint));
for(const permission of ['PRODUCT_COST_VIEW','REPORT_PROFIT','REPORT_FINANCE','PERMISSION_MANAGE','CAPITAL_MANAGE','PRIVE_MANAGE'])assert(merchant.includes(permission));
assert(merchant.includes('DOMPET_SANTRI'));
assert(merchant.includes('Powered by KlikPesantren'));
for(const capability of ['Retur Penjualan','Stok Opname','Cari Customer','Retur Pembelian','Hari Ini','Tahun Ini','Produk Online','Reset Kredensial & Cabut Sesi'])assert(merchant.includes(capability),`missing native operation: ${capability}`);
assert(merchant.includes('o.payment_method!=="CREDIT"&&(!accountId||!reference'));
assert(merchant.includes('request(`/reports?${query}`)'));
const executable=(app+merchant+api+vault).replace(/^\s*\/\/.*$/gm,'');
assert(!/console\.(log|error|warn)|AsyncStorage|localStorage|santri\.saldo|\/rfid\/(payment|refund)/.test(executable));
assert(!vault.includes('expo-secure-store'));
for(const [file,expected] of [['094_pos_v1_foundation.sql','0605eef6c75d82d076269aa12aac4f52aede96b74add5a48a7188f886fb30e51'],['095_pos_admin_control_center.sql','8cd8d6e2ff84b4bf1bd83613d2b872dfbc6ab68f4667e1349184d35dee2e3f10']]){
 const normalized=read('migrations/'+file).replace(/\r\n/g,'\n');assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'),expected);
}
const config=read('pos-app/app.config.js');assert(config.includes('com.klikpesantren.pos'));assert(!config.includes('com.klikpesantren.wali'));
const build=JSON.parse(read('pos-app/eas.json')).build;assert.deepEqual(Object.keys(build),['acceptance']);assert.equal(build.acceptance.android.buildType,'apk');
console.log('PASS canonical merchant auth, deterministic multi-business selector, operational permission-derived native modules, secure session vault, receipt and frozen Android identity');
