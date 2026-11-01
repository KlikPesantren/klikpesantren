// Append-only revisions of standalone money operations. Never handles stock, Wallet or debt.
function createMoneyRevisions({run,read,bad,uuid,text,amount,hash,lock,beginOperation,insertOperation,moneyRow,moneyWork,getAccount,accountBalance,afterStage}){
 const permitted=(a,p)=>{if(!a.member.effective_permissions.includes(p))bad('MERCHANT_PERMISSION_DENIED',403);};
 const actionable=o=>['EXPENSE','OTHER_INCOME','TRANSFER'].includes(o.kind)&&(!o.source_id||o.receipt_snapshot?.finance_action==='CORRECTION');
 async function revise(req){return run(req,'FINANCE_CORRECT',async(c,a)=>{
  permitted(a,'FINANCE_TRANSACTION_VIEW');const b=req.body||{},id=uuid(req.params.operationId),reason=text(b.reason,500);
  if(!['CANCEL','CORRECT'].includes(b.action))bad('INVALID_FINANCE_ACTION');
  await lock(c,'pos-money-revise:'+a.business+':'+id);
  const original=(await c.query('SELECT * FROM pos_business_operations WHERE id=$1 AND business_id=$2',[id,a.business])).rows[0];
  if(!original)bad('FINANCE_OPERATION_NOT_FOUND',404);if(!actionable(original))bad('DOMAIN_REVERSAL_REQUIRED',409);
  permitted(a,{EXPENSE:'EXPENSE_CREATE',OTHER_INCOME:'OTHER_INCOME_CREATE',TRANSFER:'TRANSFER_CREATE'}[original.kind]);
  if(b.action==='CORRECT'&&original.kind==='TRANSFER')bad('TRANSFER_CORRECTION_REQUIRES_CANCEL',409);
  const replacement=b.action==='CORRECT'?{kind:original.kind,account_id:uuid(b.replacement?.account_id),amount:String(amount(b.replacement?.amount,true)),reason:text(b.replacement?.reason||original.reason,500),category_id:original.finance_category_id||undefined}:null;
  const fields={source:id,action:b.action,reason,reverse_fee:b.reverse_fee===true,replacement};
  const op=await beginOperation(c,a,b,'MONEY_REVERSAL',fields);
  if(op.replay){const row=(await c.query("SELECT id FROM pos_business_operations WHERE business_id=$1 AND source_id=$2 AND receipt_snapshot->>'finance_action'='CORRECTION'",[a.business,id])).rows[0];return {id:op.id,replacement_id:row?.id||null,replay:true};}
  if((await c.query("SELECT 1 FROM pos_business_operations WHERE business_id=$1 AND source_id=$2 AND kind='MONEY_REVERSAL'",[a.business,id])).rowCount)bad('MONEY_ALREADY_REVISED',409);
  const fees=original.kind==='TRANSFER'?(await c.query("SELECT * FROM pos_business_operations WHERE business_id=$1 AND source_id=$2 AND kind='EXPENSE' ORDER BY id",[a.business,id])).rows:[];
  if(b.reverse_fee===true&&fees.length)permitted(a,'EXPENSE_CREATE');
  const sources=[original,...(b.reverse_fee===true?fees:[])];
  const legs=(await c.query('SELECT * FROM pos_money_movements WHERE business_id=$1 AND operation_id=ANY($2::uuid[]) ORDER BY account_id,id',[a.business,sources.map(o=>o.id)])).rows;
  if(!legs.length)bad('INVALID_MONEY_REVERSAL');
  const accounts=[...new Set([...legs.map(l=>l.account_id),...(replacement?[replacement.account_id]:[])])].sort();
  const accountLabels=[];for(const account of accounts)accountLabels.push(await getAccount(c,a,account));
  const today=(await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS day",[a.member.timezone])).rows[0].day;
  for(const source of sources){
   const reversal=source.id===id?op:await beginOperation(c,a,{request_id:'reverse-fee:'+hash(op.request+source.id)},'MONEY_REVERSAL',{source:source.id,parent:op.id,reason});
   await insertOperation(c,a,reversal,'MONEY_REVERSAL',{source:source.id,total:BigInt(source.total),paid:BigInt(source.paid),reason,accountingDate:today,reference:source.reference,
    snapshot:{name:a.member.receipt_name||a.member.display_name,accounts:accountLabels,finance_action:'REVERSAL',original_id:source.id,original_kind:source.kind,parent_reversal:source.id===id?null:op.id,action:b.action,reverse_fee:b.reverse_fee===true}});
   for(const leg of legs.filter(l=>l.operation_id===source.id))await moneyRow(c,a,reversal.id,leg.account_id,-BigInt(leg.amount));
  }
  await afterStage('money-reversal');
  let corrected=null;
  if(replacement)corrected=await moneyWork(c,a,{...replacement,date:today,request_id:'correct-money:'+hash(op.request)}, {original:id,reason});
  for(const account of accounts)if(await accountBalance(c,a.business,account)<0n)bad('INSUFFICIENT_BUSINESS_FUNDS',409);
  await afterStage('money-correction');
  return {id:op.id,replacement_id:corrected?.id||null,replay:false};
 });}
 async function document(req){return read(req,'FINANCE_TRANSACTION_VIEW',async(c,a)=>{
  const o=(await c.query("SELECT o.*,to_char(o.effective_date,'YYYY-MM-DD') AS business_date FROM pos_business_dated_operations o WHERE id=$1 AND business_id=$2",[uuid(req.params.operationId),a.business])).rows[0];if(!o)bad('FINANCE_OPERATION_NOT_FOUND',404);
  if(o.kind==='SALE'){permitted(a,'SALE_VIEW');return {sale_id:o.id};}
  const links=(await c.query("SELECT id,kind,receipt_snapshot FROM pos_business_operations WHERE business_id=$1 AND source_id=$2 AND (kind='MONEY_REVERSAL' OR receipt_snapshot->>'finance_action'='CORRECTION') ORDER BY id",[a.business,o.id])).rows;
  const reversal=links.find(x=>x.kind==='MONEY_REVERSAL'),correction=links.find(x=>x.receipt_snapshot?.finance_action==='CORRECTION');
  const legs=(await c.query('SELECT m.id,m.account_id,m.amount,ac.name,ac.kind FROM pos_money_movements m JOIN pos_business_accounts ac ON ac.id=m.account_id AND ac.business_id=m.business_id WHERE m.operation_id=$1 AND m.business_id=$2 ORDER BY m.amount,m.id',[o.id,a.business])).rows;
  for(const leg of legs){const saved=o.receipt_snapshot?.accounts?.find(ac=>ac.id===leg.account_id);if(saved)leg.name=saved.name;}
  const fees=o.kind==='TRANSFER'?(await c.query("SELECT f.id,f.total FROM pos_business_operations f WHERE f.business_id=$1 AND f.source_id=$2 AND f.kind='EXPENSE' AND NOT EXISTS(SELECT 1 FROM pos_business_operations r WHERE r.source_id=f.id AND r.business_id=f.business_id AND r.kind='MONEY_REVERSAL')",[a.business,o.id])).rows:[];
  return {finance_document:{...o,status:reversal?(correction?'CORRECTED':'CANCELLED'):'POSTED',reversal_id:reversal?.id||null,correction_id:correction?.id||null,can_cancel:a.member.effective_permissions.includes({EXPENSE:'EXPENSE_CREATE',OTHER_INCOME:'OTHER_INCOME_CREATE',TRANSFER:'TRANSFER_CREATE'}[o.kind])&&actionable(o)&&!reversal&&a.member.effective_permissions.includes('FINANCE_CORRECT'),can_correct:a.member.effective_permissions.includes({EXPENSE:'EXPENSE_CREATE',OTHER_INCOME:'OTHER_INCOME_CREATE'}[o.kind])&&['EXPENSE','OTHER_INCOME'].includes(o.kind)&&actionable(o)&&!reversal&&a.member.effective_permissions.includes('FINANCE_CORRECT'),legs,fees,timezone:a.member.timezone},branding:{...(o.receipt_snapshot?.name?o.receipt_snapshot:{name:a.member.display_name,legacy_current_brand:true}),legacy_current_accounts:!o.receipt_snapshot?.accounts}};
 });}
 return {reviseMoney:revise,moneyDocument:document};
}
module.exports={createMoneyRevisions};
