const test=require('node:test'),assert=require('node:assert/strict');
const {MONTHS,validDate,businessToday,calendarDays,displayDate,displayPeriod,moveMonth,rankingRows}=require('../src/financePresentation.cjs');
test('business date follows merchant timezone across year boundary, independent of device timezone',()=>{
 const now=new Date('2025-12-31T18:30:00Z');assert.equal(businessToday('Asia/Jakarta',now),'2026-01-01');assert.equal(businessToday('America/New_York',now),'2025-12-31');
 assert.equal(displayDate('2026-10-29'),'29 Oktober 2026');assert.equal(displayPeriod('2026-02','month'),'Februari 2026');assert.equal(displayPeriod('2026','year'),'2026');assert.equal(MONTHS.length,12);
});
test('calendar handles leap years, Monday grid, month rollover and invalid dates',()=>{
 assert(validDate('2024-02-29'));for(const date of ['2025-02-29','2026-04-31','2026-00-01','2026-1-02','2026-12-00'])assert(!validDate(date));
 const leap=calendarDays(2024,2);assert.equal(leap.length,42);assert.equal(leap.filter(Boolean).length,29);assert.equal(leap[3],'2024-02-01');
 assert.deepEqual(moveMonth(2025,12,1),{year:2026,month:1});assert.deepEqual(moveMonth(2026,1,-1),{year:2025,month:12});
});
test('rankings preserve canonical server order, top 20 limits, UOM and permission omissions',()=>{
 const products=Array.from({length:25},(_,i)=>({product_id:String(i),name:'P'+i,net_quantity:String(25-i),uom:'pcs',net_revenue:String((25-i)*1000)}));
 const customers=Array.from({length:25},(_,i)=>({id:String(i),name:'C'+i,net_spend:String(25000-i),transaction_count:i+1}));
 const rows=rankingRows({sales:{products},top_customers:customers});
 assert.equal(rows.length,42);assert.equal(rows[0].title,'Top 20 Produk Terlaris');assert.equal(rows[21].title,'Top 20 Pelanggan');
 assert.equal(rows[20].product_id,'19');assert.equal(rows[22].name,'C0');assert.equal(rows[1].uom,'pcs');assert.deepEqual(rankingRows({}),[]);
 assert.equal(rankingRows({sales:{products:[]}})[1].type,'empty');assert.equal(rankingRows({top_customers:[]})[0].title,'Top 20 Pelanggan');
 assert.equal(products.length,25);
});
