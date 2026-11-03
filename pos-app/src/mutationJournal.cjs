const {createSaleJournal}=require('./saleJournal.cjs');
const PATHS=new Set(['/purchases','/sale-returns','/purchase-returns','/debt-payments','/stock-adjustments','/stock-opnames','/stock-opname-drafts','/shifts/takeover','/initialization/finalize','/initialization/corrections']);
const accepts=path=>PATHS.has(path)||/^\/products\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/identity$/i.test(path)||/^\/money\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/revise$/i.test(path);
function createMutationJournal({vault,send,server}){
 const journal=createSaleJournal({vault,key:'merchant-mutation-v1',retainStatuses:[401,403,408,429],send:envelope=>{
   if(envelope.server!==server)throw Object.assign(Error('PENDING_MUTATION_SERVER_MISMATCH'),{code:'PENDING_MUTATION_SERVER_MISMATCH'});
   if(!accepts(envelope.path))throw Error('INVALID_MUTATION_PATH');
   return send(envelope.path,envelope.body);
 }});
 return {read:journal.read,accepts,async submit(path,body,authority){
   const pending=await journal.read();
   // An explicit retry button may resubmit the exact frozen intent; edits stay blocked.
   if(path && pending?.payload.path===path && pending.payload.server===server && JSON.stringify(pending.payload.body)===JSON.stringify(body))return journal.submit(null,authority);
   return journal.submit(path?{request_id:body.request_id,path,body,server}:null,authority);
 }};
}
module.exports={createMutationJournal};
