async function loadProductPages(client,path){
 const inventory=path==='/inventory',out=[],seen=new Set();let cursor=null,first;
 for(let page=0;page<100;page++){
  const result=await client(path+'?paged=1'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
  if(Array.isArray(result))throw Object.assign(Error('PAGINATION_BACKEND_REQUIRED'),{code:'PAGINATION_BACKEND_REQUIRED'});
  if(!first)first=result;
  const items=inventory?result.products:result.items;
  if(!Array.isArray(items))throw Error('INVALID_PRODUCT_PAGE');
  for(const item of items)if(!seen.has(item.id)){seen.add(item.id);out.push(item);}
  if(!result.next_cursor)return inventory?{...first,products:out,next_cursor:null}:out;
  if(result.next_cursor===cursor)throw Error('INVALID_PRODUCT_CURSOR');
  cursor=result.next_cursor;
 }
 throw Object.assign(Error('PRODUCT_PAGE_LIMIT'),{code:'PRODUCT_PAGE_LIMIT'});
}
module.exports={loadProductPages};
