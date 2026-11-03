// Owner-approved local policy controls. All financial writes reuse canonical helpers.
function createBusinessPolicies(h) {
 const {run,read,bad,uuid,amount,text,makeId,hash,serialize,lock,getProduct,getAccount,closeShiftWork,postApprovedOpname,afterStage}=h;
 const owner=a=>{if(a.member.role!=='OWNER')bad('OWNER_REQUIRED',403);};
 function request(b){const r=text(b.request_id,160);if(r.length<8)bad('INVALID_REQUEST_ID');return r;}
 async function begin(c,a,kind,b,fields){const key=request(b),digest=hash(serialize({actor:a.user,...fields}));await lock(c,`pos-policy:${a.business}:${kind}:${key}`);const old=(await c.query('SELECT * FROM pos_business_policy_events WHERE business_id=$1 AND kind=$2 AND request_id=$3',[a.business,kind,key])).rows[0];if(old&&old.request_hash!==digest)bad('IDEMPOTENCY_CONFLICT',409);return {key,digest,old};}
 async function event(c,a,kind,intent,subject,payload,source=null){const id=makeId();await c.query(`INSERT INTO pos_business_policy_events(id,business_id,tenant_id,actor_id,kind,request_id,request_hash,subject_id,payload,source_event_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[id,a.business,a.member.tenant_id,a.user,kind,intent.key,intent.digest,subject,serialize(payload),source]);return id;}
 const takeoverShift=req=>run(req,'SHIFT_OPEN',async(c,a)=>{
  owner(a);const b=req.body||{},source=uuid(b.shift_id),actual=amount(b.actual_cash),reason=text(b.reason,500);
  if(b.confirmation!=='TAKEOVER')bad('TAKEOVER_CONFIRMATION_REQUIRED');
  const intent=await begin(c,a,'SHIFT_HANDOVER',b,{source,actual,reason});if(intent.old)return {...intent.old.payload,audit_id:intent.old.id,replay:true};
  await lock(c,'pos-handover:'+a.business+':'+source);
  const s=(await c.query('SELECT * FROM pos_business_shifts WHERE id=$1 AND business_id=$2 FOR UPDATE',[source,a.business])).rows[0];
  if(!s)bad('SHIFT_DENIED',403);if(s.status!=='OPEN')bad('SHIFT_NOT_OPEN',409);if(s.user_id===a.user)bad('TAKEOVER_OTHER_OPERATOR_REQUIRED',409);
  await getAccount(c,a,s.cash_account_id);
  if((await c.query("SELECT id FROM pos_business_shifts WHERE business_id=$1 AND user_id=$2 AND status='OPEN'",[a.business,a.user])).rowCount)bad('SHIFT_ALREADY_OPEN',409);
  const terminal=(await c.query('SELECT id FROM pos_business_terminals WHERE id=$1 AND business_id=$2 AND active FOR SHARE',[s.terminal_id,a.business])).rows[0];if(!terminal)bad('TERMINAL_DENIED',403);
  const closed=await closeShiftWork(c,a,s,actual);
  const next=(await c.query('INSERT INTO pos_business_shifts(id,business_id,user_id,terminal_id,cash_account_id,opening_cash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[makeId(),a.business,a.user,s.terminal_id,s.cash_account_id,actual.toString()])).rows[0];
  await afterStage('shift-handover');
  const oldOperator=(await c.query('SELECT name FROM pos_merchant_users WHERE id=$1',[s.user_id])).rows[0];
  const result={old_operator_name:oldOperator.name,new_operator_name:a.userName,original_shift_id:s.id,new_shift_id:next.id,old_operator:s.user_id,new_operator:a.user,terminal_id:s.terminal_id,cash_account_id:s.cash_account_id,actual_cash:actual.toString(),expected_cash:closed.expected_cash,difference:closed.difference,closed_at:closed.closed_at,opened_at:next.opened_at,reason};
  result.audit_id=await event(c,a,'SHIFT_HANDOVER',intent,s.id,result);return {...result,replay:false};
 });
 async function identityWork(c,a,b,productId){
  owner(a);const id=uuid(productId),sku=text(b.sku,80),barcode=b.barcode==null||b.barcode===''?null:text(b.barcode,100),reason=text(b.reason,500);
  const intent=await begin(c,a,'IDENTITY_CHANGE',b,{id,sku,barcode,reason});if(intent.old)return {...intent.old.payload,audit_id:intent.old.id,replay:true};
  await lock(c,'pos-product-identities:'+a.business);
  const before=(await c.query('SELECT sku,barcode FROM pos_business_products WHERE id=$1 AND business_id=$2 FOR UPDATE',[id,a.business])).rows[0];if(!before)bad('PRODUCT_NOT_FOUND',404);
  if((await c.query('SELECT id FROM pos_business_products WHERE business_id=$1 AND id<>$2 AND (sku=$3 OR ($4::text IS NOT NULL AND barcode=$4))',[a.business,id,sku,barcode])).rowCount)bad('PRODUCT_IDENTIFIER_DUPLICATE',409);
  await c.query('UPDATE pos_business_products SET sku=$1,barcode=$2 WHERE id=$3 AND business_id=$4',[sku,barcode,id,a.business]);
  await afterStage('product-identity');
  const result={product_id:id,before,after:{sku,barcode},reason};result.audit_id=await event(c,a,'IDENTITY_CHANGE',intent,id,result);return {...result,replay:false};
 }
 const changeProductIdentity=req=>run(req,'PRODUCT_MANAGE',(c,a)=>identityWork(c,a,req.body||{},req.params.productId));
 const draftOpname=req=>run(req,'INVENTORY_OPNAME',async(c,a)=>{
  const b=req.body||{},id=uuid(b.product_id),actual=amount(b.actual_stock),expected=amount(b.expected_stock),version=amount(b.expected_version),reason=text(b.reason,500);
  const intent=await begin(c,a,'OPNAME_DRAFT',b,{id,actual,expected,version,reason});if(intent.old)return {draft_id:intent.old.id,...intent.old.payload,replay:true};
  await getProduct(c,a,id);const current=(await c.query('SELECT coalesce(sum(quantity),0)::text stock,count(*)::text version FROM pos_inventory_movements WHERE business_id=$1 AND product_id=$2',[a.business,id])).rows[0];
  if(BigInt(current.stock)!==expected||BigInt(current.version)!==version)bad('STOCK_SNAPSHOT_STALE',409);
  const payload={product_id:id,actual_stock:actual.toString(),expected_stock:expected.toString(),expected_version:version.toString(),reason,status:'PENDING'};
  const draft_id=await event(c,a,'OPNAME_DRAFT',intent,id,payload);return {draft_id,...payload,replay:false};
 });
 const approveOpname=req=>run(req,'INVENTORY_ADJUST',async(c,a)=>{
  owner(a);const b=req.body||{};if(!b.draft_id)bad('OPNAME_APPROVAL_REQUIRED',409);
  const draftId=uuid(b.draft_id),reason=text(b.reason,500),unitCost=amount(b.unit_cost||0);
  if(b.confirmation!=='APPROVE')bad('OPNAME_CONFIRMATION_REQUIRED');
  const intent=await begin(c,a,'OPNAME_APPROVAL',b,{draftId,reason,unitCost});if(intent.old)return {...intent.old.payload,audit_id:intent.old.id,replay:true};
  await lock(c,'pos-opname-draft:'+a.business+':'+draftId);
  const draft=(await c.query("SELECT * FROM pos_business_policy_events WHERE id=$1 AND business_id=$2 AND kind='OPNAME_DRAFT'",[draftId,a.business])).rows[0];if(!draft)bad('OPNAME_DRAFT_DENIED',403);
  if(BigInt(draft.payload.actual_stock)>BigInt(draft.payload.expected_stock)&&b.unit_cost==null)bad('OPNAME_COST_REQUIRED');
  if((await c.query("SELECT id FROM pos_business_policy_events WHERE business_id=$1 AND source_event_id=$2 AND kind='OPNAME_APPROVAL'",[a.business,draftId])).rowCount)bad('OPNAME_ALREADY_APPROVED',409);
  const posted=await postApprovedOpname(c,a,{...draft.payload,request_id:'opname-approve:'+hash(intent.key),reason,unit_cost:unitCost.toString()});
  await afterStage('opname-approval');
  const result={...posted,draft_id:draftId,counted_by:draft.actor_id,approved_by:a.user,count_reason:draft.payload.reason,reason};
  result.audit_id=await event(c,a,'OPNAME_APPROVAL',intent,draft.subject_id,result,draftId);return result;
 });
 const policyHistory=req=>read(req,'INVENTORY_OPNAME',async(c,a)=>{
  const rows=(await c.query(`SELECT d.id,d.subject_id,d.actor_id,d.payload,d.created_at,p.name,ap.id approval_id,ap.actor_id approved_by FROM pos_business_policy_events d JOIN pos_business_products p ON p.id=d.subject_id AND p.business_id=d.business_id LEFT JOIN pos_business_policy_events ap ON ap.source_event_id=d.id AND ap.business_id=d.business_id AND ap.kind='OPNAME_APPROVAL' WHERE d.business_id=$1 AND d.kind='OPNAME_DRAFT' ORDER BY d.created_at DESC,d.id LIMIT 100`,[a.business])).rows;
  return {drafts:rows,limit:100};
 });
 return {takeoverShift,identityWork,changeProductIdentity,draftOpname,approveOpname,policyHistory};
}
module.exports={createBusinessPolicies};
