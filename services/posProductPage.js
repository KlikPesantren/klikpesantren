// Cursor is scope-bound and validated; it is a position, never an authority.
function productPage(req,business,bad,legacyLimit=200){
 const paged=req.query?.paged==='1',q=String(req.query?.q||'').trim();
 if(q.length>160)bad('INVALID_PRODUCT_SEARCH');
 let after={name:'',id:'00000000-0000-0000-0000-000000000000'};
 if(req.query?.cursor){try{if(String(req.query.cursor).length>4096)throw Error();after=JSON.parse(Buffer.from(req.query.cursor,'base64url').toString());if(after.business!==business||typeof after.name!=='string'||after.name.length>160||!/^([a-f0-9]{8}-)([a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(after.id))throw Error();}catch{bad('INVALID_PRODUCT_CURSOR');}}
 const size=req.query?.page_size==null?200:Number(req.query.page_size);
 if(!Number.isInteger(size)||size<1||size>200)bad('INVALID_PRODUCT_PAGE_SIZE');
 const category=String(req.query?.category||'').trim(),status=req.query?.status||'ALL',stock=req.query?.stock||'',product=req.query?.product_id||null;
 if(category.length>120||!['ALL','ACTIVE','INACTIVE'].includes(status)||!['','AVAILABLE','LOW','OUT'].includes(stock)||product&&!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(product))bad('INVALID_PRODUCT_FILTER');
 const queryKey=require('node:crypto').createHash('sha256').update(JSON.stringify([business,q,category,status,stock,product,size])).digest('hex');
 if(req.query?.cursor && after.query!==queryKey)bad('INVALID_PRODUCT_CURSOR');
 const values=[business,q,after.name,after.id,category,status,stock,product];
 const available="(coalesce(s.on_hand,0)-coalesce((SELECT sum(rr.quantity) FROM pos_online_reservations rr WHERE rr.business_id=p.business_id AND rr.product_id=p.id AND rr.state='RESERVED'),0))";
 const filter=`AND ($2='' OR strpos(lower(concat_ws(' ',p.name,p.sku,p.barcode)),lower($2))>0) AND (p.name,p.id)>($3,$4::uuid) AND ($5='' OR p.category=$5) AND ($6='ALL' OR p.active=($6='ACTIVE')) AND ($8::uuid IS NULL OR p.id=$8::uuid) AND ($7='' OR CASE $7 WHEN 'OUT' THEN ${available}<=0 WHEN 'LOW' THEN ${available}>0 AND ${available}<=p.minimum_stock WHEN 'AVAILABLE' THEN ${available}>0 END)`;
 return {values,filter,paged,limit:paged?size+1:legacyLimit,finish:rows=>{if(!paged)return rows.slice(0,legacyLimit);const items=rows.slice(0,size),last=items.at(-1);return {items,next_cursor:rows.length>size?Buffer.from(JSON.stringify({business,query:queryKey,name:last.name,id:last.id})).toString('base64url'):null};}};
}
module.exports={productPage};
