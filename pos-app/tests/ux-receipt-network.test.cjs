const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createReceiptActions,receiptActionError}=require('../src/receiptFile.cjs');
const {buildReceiptHtml,normalizeDevicePreferences}=require('../src/receiptOutput.cjs');
const {homeLayout}=require('../src/homeLayout.cjs');
const receipt={sale:{id:'stored-sale',total:'1000',created_at:'2026-10-28T01:00:00Z'},branding:{name:'Toko <script>',receipt:'R-1'},items:[{name:'Barang & barang',quantity:'1',unit_price:'1000',total:'1000'}],payments:[{method:'CASH',amount:'1000'}]};
function nativeMocks(){
 const calls=[];
 return {calls,platform:'android',Print:{printAsync:async x=>calls.push(['print',x]),printToFileAsync:async x=>{calls.push(['pdf',x]);return{uri:'file:///cache/receipt.pdf',numberOfPages:1};}},
 FileSystem:{EncodingType:{Base64:'base64'},getInfoAsync:async()=>({exists:true,size:1234}),readAsStringAsync:async(_uri,opt)=>opt.length?'JVBERi0=':'JVBERi0xLjQK',writeAsStringAsync:async(...a)=>calls.push(['write',...a]),StorageAccessFramework:{requestDirectoryPermissionsAsync:async()=>({granted:true,directoryUri:'content://folder'}),createFileAsync:async(...a)=>{calls.push(['create',...a]);return'content://folder/receipt.pdf';}}},
 Sharing:{isAvailableAsync:async()=>true,shareAsync:async(...a)=>calls.push(['share',...a])}};
}
test('fresh install without device preferences produces escaped canonical receipt',()=>{
 assert.equal(normalizeDevicePreferences(null).paper_width,'58');
 const html=buildReceiptHtml(receipt);assert.match(html,/Toko &lt;script&gt;/);assert.match(html,/Rp1\.000/);assert.doesNotMatch(html,/<script>/);
});
test('print opens native framework; save writes a real PDF to SAF; share uses PDF MIME',async()=>{
 const m=nativeMocks(),output=createReceiptActions(m);
 await output(receipt,'print',null);assert.equal(m.calls[0][0],'print');
 await output(receipt,'save',null);assert.ok(m.calls.some(c=>c[0]==='create'&&c[3]==='application/pdf'));assert.ok(m.calls.some(c=>c[0]==='write'&&c[1].startsWith('content://')));
 await output(receipt,'share',null);const shared=m.calls.find(c=>c[0]==='share');assert.equal(shared[2].mimeType,'application/pdf');
});
test('cancelled save writes nothing; invalid file and native failures are explicit and never resubmit sale',async()=>{
 const m=nativeMocks(),original=JSON.stringify(receipt);
 m.FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync=async()=>({granted:false});
 assert.deepEqual(await createReceiptActions(m)(receipt,'save'),{cancelled:true});assert.ok(!m.calls.some(c=>c[0]==='write'));
 m.FileSystem.getInfoAsync=async()=>({exists:true,size:0});
 await assert.rejects(()=>createReceiptActions(m)(receipt,'share'),{code:'RECEIPT_PDF_INVALID'});
 m.Print.printAsync=async()=>{throw Error('native failure');};
 await assert.rejects(()=>createReceiptActions(m)(receipt,'print'),{code:'RECEIPT_PRINT_FAILED'});
 assert.equal(JSON.stringify(receipt),original);assert.match(receiptActionError({code:'RECEIPT_PDF_INVALID'}),/Transaksi tetap tersimpan/);
});
test('home uses measured safe viewport and allows overflow/accessibility fallback',()=>{
 for(const height of [540,600,700])assert.deepEqual(homeLayout({height,width:360,fontScale:1,contentHeight:490}),{compact:true,scroll:false,gap:5});
 assert.equal(homeLayout({height:400,width:360}).scroll,true);
 assert.equal(homeLayout({height:600,width:360,fontScale:1.5}).scroll,true);
 assert.equal(homeLayout({height:540,width:360,contentHeight:620}).scroll,true);
});
test('Selesai closes completed sale locally; testing URL change keeps saved session',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/MerchantBusinessApp.jsx'),'utf8');
 assert.match(source,/mode==="success"\?"Selesai"/);
 const done=source.slice(source.indexOf('if(receipt)return'),source.indexOf('const invalid=',source.indexOf('if(receipt)return')));
 assert.match(done,/setReceipt\(null\);setCartOpen\(false\);setPaymentOpen\(false\)/);assert.match(done,/setCart\(\[\]\)/);assert.doesNotMatch(done,/submitSale|navigate\(/);
 const change=source.slice(source.indexOf('async function testAndUseServer'),source.indexOf('async function logout'));
 assert.doesNotMatch(change,/vault.remove|setSession\(null\)/);
 assert.match(change,/if \(address !== serverBase\)/);
 assert.match(source,/catch \(refreshError\).*setError/);
});
test('API distinguishes HTTP auth/server/invalid JSON and timeout without a network mislabel',async()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../src/api.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function makeApi','function makeApi');
 let response;
 const sandbox={AbortController,URLSearchParams,setTimeout,clearTimeout,Constants:{expoConfig:{extra:{posEnvironment:'development'}}},FileSystem:{},fetch:async()=>{if(response instanceof Error)throw response;return response;}};
 vm.runInNewContext(source,sandbox);const api=sandbox.makeApi(null,undefined,'http://192.168.4.10:55440');
 for(const status of [401,403,404,500]){
  response={ok:false,status,json:async()=>({})};
  await assert.rejects(()=>api('/pos-business/login'),e=>e.status===status&&e.code!=='NETWORK');
 }
 response={ok:false,status:500,json:async()=>{throw SyntaxError('not JSON');}};
 await assert.rejects(()=>api('/pos-business/login'),{code:'SERVER_ERROR',status:500});
 response=Object.assign(Error('timeout'),{name:'AbortError'});
 await assert.rejects(()=>api('/pos-business/login'),{code:'NETWORK_TIMEOUT'});
});
