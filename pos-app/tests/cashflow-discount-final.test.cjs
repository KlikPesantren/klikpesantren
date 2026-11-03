const test=require('node:test'),assert=require('node:assert/strict');
const {calculatePricing}=require('../../services/posPricingEngine');
const {percentBasisPoints,discountPreview,promotionPayload}=require('../src/promotionForm.cjs');
const {buildReceiptText,buildReceiptHtml}=require('../src/receiptOutput.cjs');
const {createReceiptActions}=require('../src/receiptFile.cjs');
const general={id:'g',name:'Harga Umum',active:true,is_default:true},member={id:'m',name:'Member',active:true},grosir={id:'r',name:'Grosir',active:true};
const products=[{id:'a',name:'Aqua Mineral',selling_price:'5000',active:true,sellable:true},{id:'b',name:'B',selling_price:'8000',active:true,sellable:true}];
const prices=[{level_id:'m',product_id:'a',price:'4500'},{level_id:'r',product_id:'a',price:'4000'}];
const percent={id:'p',name:'15 persen',kind:'PERCENT',active:true,product_id:'a',threshold:'1',discount_bps:'1500',priority:0};
const quantity={id:'q',name:'Tiga hemat',kind:'QUANTITY',active:true,product_id:'a',threshold:'3',group_price:'12500',mode:'EVERY',priority:0};
const calc=(items,promotions=[],extra={})=>calculatePricing({products,level:general,levels:[general,member,grosir],prices,promotions,items,...extra});
test('approved IDR examples use General reference and alternate final prices without stacking',()=>{
 assert.equal(calc([{product_id:'a',quantity:'1'}]).total,'5000');assert.equal(calc([{product_id:'a',quantity:'1'}],[percent]).total,'4250');
 assert.equal(calc([{product_id:'a',quantity:'1'}],[{...percent,kind:'FIXED',discount_amount:'1000'}]).total,'4000');
 for(const [price_level_id,total] of [['m','4500'],['r','4000']]){const q=calc([{product_id:'a',quantity:'1',price_level_id}],[percent]);assert.equal(q.total,total);assert.equal(q.offers.length,0);assert.equal(q.lines[0].discount,'0');}
 assert.deepEqual(Array.from({length:7},(_,i)=>calc([{product_id:'a',quantity:String(i+1)}],[quantity]).total),['5000','10000','12500','17500','22500','25000','30000']);
 assert.equal(calc([{product_id:'a',quantity:'3',price_level_id:'m'}],[quantity]).total,'13500');assert.equal(calc([{product_id:'a',quantity:'3',price_level_id:'r'}],[quantity]).total,'12000');
});
test('deterministic nonstack conflict, per-unit rounding and bundle General allocation',()=>{
 const fixed={...percent,id:'a-fixed',kind:'FIXED',discount_amount:'1000'},one=[{product_id:'a',quantity:'3'},{product_id:'b',quantity:'1'}];
 assert.deepEqual(calc(one,[percent,fixed]),calc([...one].reverse(),[fixed,percent]));assert.equal(calc(one,[percent,fixed]).offers.length,1);
 assert.equal(calc([{product_id:'a',quantity:'1'}],[{...percent,level_id:'m'}]).total,'5000');
 assert.equal(percentBasisPoints('15,25'),'1525');assert.throws(()=>percentBasisPoints('100.01'),{code:'INVALID_DISCOUNT'});assert.equal(discountPreview('5001',{kind:'PERCENT',discount_percent:'15'}).total,'4251');
 const bundle={id:'bundle',name:'Paket',kind:'BUNDLE',active:true,priority:0,group_price:'11000',components:[{product_id:'a',quantity:'1'},{product_id:'b',quantity:'1'}]};
 const q=calc([{product_id:'a',quantity:'1',price_level_id:'m'}],[percent,bundle],{packages:[{promotion_id:'bundle',quantity:'1'}]});assert.equal(q.total,'15500');assert.equal(q.subtotal,'17500');assert.equal(q.discount,'2000');
 const parts=q.lines.find(l=>l.product_id==='a').pricing_snapshot.parts;assert.equal(parts.find(p=>p.kind==='BASE').discount,'0');assert.equal(q.offers.filter(o=>o.kind==='PERCENT').length,0);
});
test('blank promo preview is absent and payload never retains customer/level targeting',()=>{
 assert.equal(discountPreview('5000',{kind:'PERCENT',discount_percent:''}),null);assert.equal(discountPreview('5000',{kind:'FIXED',discount_amount:''}),null);
 const payload=promotionPayload({name:'15%',kind:'PERCENT',product_id:'a',discount_percent:'15',level_id:'legacy'},'Asia/Jakarta',()=> 'id');
 assert.equal(payload.level_id,null);assert.equal(payload.discount_bps,'1500');assert.equal(payload.threshold,'1');
});
const proof={finance_document:{id:'uuid',kind:'EXPENSE',total:'1000',paid:'1000',business_date:'2026-10-29',created_at:'2026-10-29T00:00:00Z',status:'CANCELLED',reason:'<script>bad</script>',reversal_id:'reverse',legs:[{name:'Bank',amount:'-1000'}],timezone:'Asia/Jakarta'},branding:{name:'Usaha'}};
test('financial proof states cancellation and references, escapes HTML and reuses native PDF/share contract',async()=>{
 const text=buildReceiptText(proof);assert.match(text,/DIBATALKAN/);assert.match(text,/reverse/);assert.match(text,/29 Oktober 2026/);
 const html=buildReceiptHtml(proof);assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
 const calls=[];const output=createReceiptActions({platform:'web',Print:{printAsync:async()=>calls.push('print'),printToFileAsync:async()=>({uri:'test.pdf',numberOfPages:1})},FileSystem:{EncodingType:{Base64:'base64'},getInfoAsync:async()=>({exists:true,size:100}),readAsStringAsync:async()=> 'JVBERi0x'},Sharing:{isAvailableAsync:async()=>true,shareAsync:async()=>calls.push('share')}});
 await output(proof,'print');await output(proof,'share');assert.deepEqual(calls,['print','share']);
});


test('encrypted money request survives a new journal instance and permission/network ambiguity',async()=>{
 const {createVault}=require('../src/vault.cjs'),{createSaleJournal}=require('../src/saleJournal.cjs'),storage=new Map(),vault=createVault({getItemAsync:async k=>storage.get(k)??null,setItemAsync:async(k,v)=>storage.set(k,v),deleteItemAsync:async k=>storage.delete(k)});
 const authority={business_id:'biz',user_id:'owner'},payload={request_id:'immutable-money-id',kind:'EXPENSE',amount:'2000'},options={vault,key:'finance.biz.owner.EXPENSE',retainStatuses:[401,403,408,429]};
 const first=createSaleJournal({...options,send:async()=>{throw Object.assign(Error('lost response'),{code:'NETWORK'});}});
 await assert.rejects(()=>first.submit(payload,authority));
 const restarted=createSaleJournal({...options,send:async body=>{assert.deepEqual(body,payload);return {id:'canonical-id',replay:true};}});
 assert.deepEqual((await restarted.read()).payload,payload);assert.equal((await restarted.submit(null,authority)).replay,true);assert.equal(await restarted.read(),null);
 const denied=createSaleJournal({...options,send:async()=>{throw Object.assign(Error('permission changed'),{status:403});}});
 await assert.rejects(()=>denied.submit(payload,authority));assert.deepEqual((await denied.read()).payload,payload);
});
test('late response cannot erase a newer pending financial request',async()=>{
 const {createVault}=require('../src/vault.cjs'),{createSaleJournal}=require('../src/saleJournal.cjs'),store=new Map(),vault=createVault({getItemAsync:async k=>store.get(k)??null,setItemAsync:async(k,v)=>store.set(k,v),deleteItemAsync:async k=>store.delete(k)});
 const authority={business_id:'b',user_id:'u'};let finishOld;const gate=new Promise(resolve=>{finishOld=resolve;});
 const old=createSaleJournal({vault,key:'money',send:()=>gate}),oldRequest=old.submit({request_id:'A'},authority);
 while(!await old.read())await Promise.resolve();
 const retry=createSaleJournal({vault,key:'money',send:async()=>({id:'A'})});await retry.submit(null,authority);
 const newer=createSaleJournal({vault,key:'money',send:async()=>{throw Error('unknown B');}});await assert.rejects(()=>newer.submit({request_id:'B'},authority));
 finishOld({id:'A'});await oldRequest;assert.equal((await newer.read()).payload.request_id,'B');
});
