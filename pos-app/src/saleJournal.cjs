// One encrypted pending request. Serialize local store changes across mounted views.
const LOCKS=new WeakMap();
function atomic(vault,key,work){
 let map=LOCKS.get(vault);if(!map){map=new Map();LOCKS.set(vault,map);}
 const previous=map.get(key)||Promise.resolve(),result=previous.catch(()=>{}).then(work),tail=result.catch(()=>{});
 map.set(key,tail);tail.finally(()=>{if(map.get(key)===tail)map.delete(key);});return result;
}
function createSaleJournal({vault,key='merchant-sale',send,retainStatuses=[401,408,429]}){
 const failure=code=>Object.assign(Error(code),{code});
 const read=()=>atomic(vault,key,()=>vault.read(key));
 const clear=expected=>atomic(vault,key,async()=>{const current=await vault.read(key);if(current?.payload?.request_id===expected.payload.request_id)await vault.remove(key);});
 async function submit(payload,authority){
  const pending=await atomic(vault,key,async()=>{
   let current=await vault.read(key);
   if(current&&payload)throw failure('PENDING_SALE_REQUIRES_RETRY');
   if(!current){
    if(!payload?.request_id||!authority?.business_id||!authority?.user_id)throw failure('INVALID_SALE');
    current={business_id:authority.business_id,user_id:authority.user_id,payload:JSON.parse(JSON.stringify(payload))};
    await vault.write(key,current);
   }
   if(current.business_id!==authority.business_id||current.user_id!==authority.user_id)throw failure('PENDING_SALE_AUTHORITY_MISMATCH');
   return current;
  });
  try{const result=await send(pending.payload);await clear(pending);return result;}
  catch(error){if(error.status>=400&&error.status<500&&!retainStatuses.includes(error.status))await clear(pending);throw error;}
 }
 return {read,submit};
}
module.exports={createSaleJournal};
