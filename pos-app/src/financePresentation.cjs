const MONTHS=Object.freeze(['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember']);
const pad=n=>String(n).padStart(2,'0');
function isoDate(year,month,day){return String(year)+'-'+pad(month)+'-'+pad(day);}
function validDate(value){
 if(!/^(19|20|21)\d{2}-\d{2}-\d{2}$/.test(value||''))return false;
 const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
}
function businessToday(timezone,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const get=type=>parts.find(p=>p.type===type).value;return get('year')+'-'+get('month')+'-'+get('day');
}
function calendarDays(year,month){
 const first=new Date(Date.UTC(year,month-1,1)),offset=(first.getUTCDay()+6)%7,count=new Date(Date.UTC(year,month,0)).getUTCDate();
 return Array.from({length:42},(_,i)=>i>=offset&&i<offset+count?isoDate(year,month,i-offset+1):null);
}
function displayDate(value){if(!validDate(value))return 'Pilih tanggal';const [y,m,d]=value.split('-').map(Number);return d+' '+MONTHS[m-1]+' '+y;}
function displayPeriod(value,kind='date'){if(kind==='year')return String(value);if(kind==='month'){const [y,m]=String(value).split('-').map(Number);return MONTHS[m-1]+' '+y;}return displayDate(value);}
function moveMonth(year,month,delta){const date=new Date(Date.UTC(year,month-1+delta,1));return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1};}
function rankingRows(report){
 const result=[];
 if(report?.sales){result.push({id:'products-title',type:'section',title:'Top 20 Produk Terlaris'});
  const rows=(report.sales.products||[]).slice(0,20);
  result.push(...(rows.length?rows.map((p,i)=>({...p,id:'product-'+p.product_id,type:'product',rank:i+1})):[{id:'products-empty',type:'empty',title:'Belum ada produk terjual pada periode ini.'}]));
 }
 if(Array.isArray(report?.top_customers)){result.push({id:'customers-title',type:'section',title:'Top 20 Pelanggan'});
  result.push(...(report.top_customers.length?report.top_customers.slice(0,20).map((p,i)=>({...p,id:'customer-'+p.id,type:'customer',rank:i+1})):[{id:'customers-empty',type:'empty',title:'Belum ada pembelian pelanggan terdaftar.'}]));
 }
 return result;
}
module.exports={MONTHS,isoDate,validDate,businessToday,calendarDays,displayDate,displayPeriod,moveMonth,rankingRows};
