const test=require('node:test'),assert=require('node:assert/strict');
const {businessDateToIso,displayBusinessDate,isoToBusinessDate,promotionPayload,quantityPreview}=require('../src/promotionForm.cjs');

test('business dates display locally and serialize to exact Asia/Jakarta boundaries',()=>{
 assert.equal(displayBusinessDate('2026-10-28'),'28 Okt 2026');
 assert.equal(businessDateToIso('2026-10-28','Asia/Jakarta'),'2026-10-27T17:00:00.000Z');
 assert.equal(businessDateToIso('2026-11-28','Asia/Jakarta',true),'2026-11-28T16:59:59.999Z');
 assert.equal(isoToBusinessDate('2026-10-27T17:00:00.000Z','Asia/Jakarta'),'2026-10-28');
});

test('Ratiban form becomes canonical ISO payload and keeps one id for safe retry',()=>{
 const form={name:'Ratiban',kind:'QUANTITY',product_id:'11111111-1111-4111-8111-111111111111',threshold:'3',mode:'EVERY',group_price:'12500',priority:'',level_id:'',start_date:'2026-10-28',end_date:'2026-11-28',components:[],active:true};
 let calls=0;const first=promotionPayload(form,'Asia/Jakarta',()=>{calls++;return '22222222-2222-4222-8222-222222222222';});
 const retry=promotionPayload({...form,id:first.id},'Asia/Jakarta',()=>{calls++;return 'different';});
 assert.equal(calls,1);assert.deepEqual(retry,first);
 assert.equal(first.group_price,'12500');assert.equal(first.priority,'0');assert.match(first.starts_at,/T17:00:00\.000Z$/);assert.match(first.ends_at,/T16:59:59\.999Z$/);
});

test('invalid dates and priorities fail before network while inputs remain available',()=>{
 const base={name:'Promo',kind:'QUANTITY',product_id:'x',threshold:'3',mode:'EVERY',group_price:'12500',priority:'0',start_date:'2026-11-28',end_date:'2026-10-28'};
 assert.throws(()=>promotionPayload(base,'Asia/Jakarta',()=> 'id'),{code:'INVALID_PROMOTION_PERIOD'});
 assert.throws(()=>promotionPayload({...base,start_date:'2026-10-28',end_date:'2026-11-28',priority:'125000'},'Asia/Jakarta',()=> 'id'),{code:'INVALID_PROMOTION_PRIORITY'});
});

test('quantity preview matches the approved 3 for Rp12.500 every-multiple example',()=>{
 assert.deepEqual(quantityPreview('5000','3','12500','EVERY').map(row=>row.total),['5000','10000','12500','17500','22500','25000','30000']);
});
