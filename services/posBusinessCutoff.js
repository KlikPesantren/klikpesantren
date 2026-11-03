// One immutable checkpoint over canonical ledgers. Finalizing never posts money,
// stock or debt; subsequent corrections are canonical audited journals today.
function createBusinessCutoff(h){
 const {run,bad,uuid,amount,text,makeId,hash,serialize,lock,accountBalance,getAccount,getProduct,availableCost,consume,addLayer,stockRow,moneyRow,debtRow,beginOperation,insertOperation,afterStage}=h;
 const owner=a=>{if(a.member.role!=='OWNER')bad('OWNER_REQUIRED',403);};
 const signed=v=>{if(!/^-?[1-9]\d*$/.test(String(v)))bad('INVALID_INTEGER');const n=BigInt(v);if(n>9223372036854775807n||n< -9223372036854775807n)bad('INVALID_INTEGER');return n;};
 async function snapshot(c,a){
  const accounts=(await c.query(`WITH flow AS (SELECT account_id,amount FROM pos_money_movements WHERE business_id=$1 UNION ALL SELECT merchant_account_id,amount FROM pos_wallet_settlement_payouts WHERE business_id=$1), balances AS (SELECT account_id,sum(amount) n FROM flow GROUP BY account_id) SELECT a.id,a.name,a.kind,coalesce(b.n,0)::text balance FROM pos_business_accounts a LEFT JOIN balances b ON b.account_id=a.id WHERE a.business_id=$1 AND a.kind IN('CASH','BANK','QRIS') ORDER BY a.id LIMIT 20001`,[a.business])).rows;
  if(accounts.some(ac=>BigInt(ac.balance)<0n))bad('CUTOFF_NEGATIVE_ACCOUNT',409);
  const inventory=(await c.query(`WITH stock AS (SELECT product_id,sum(quantity) quantity FROM pos_inventory_movements WHERE business_id=$1 GROUP BY product_id),
   used AS (SELECT layer_id,sum(quantity) quantity FROM pos_inventory_allocations WHERE business_id=$1 GROUP BY layer_id),
   fifo AS (SELECT l.product_id,sum(l.received_quantity-coalesce(u.quantity,0)) quantity,sum((l.received_quantity-coalesce(u.quantity,0))*l.unit_cost) value FROM pos_inventory_layers l LEFT JOIN used u ON u.layer_id=l.id WHERE l.business_id=$1 GROUP BY l.product_id)
   SELECT p.id,p.name,p.sku,coalesce(s.quantity,0)::text quantity,coalesce(f.quantity,0)::text fifo_quantity,coalesce(f.value,0)::text value FROM pos_business_products p LEFT JOIN stock s ON s.product_id=p.id LEFT JOIN fifo f ON f.product_id=p.id WHERE p.business_id=$1 ORDER BY p.id LIMIT 20001`,[a.business])).rows;
  if(inventory.some(p=>BigInt(p.quantity)<0n||p.quantity!==p.fifo_quantity||BigInt(p.value)<0n))bad('CUTOFF_FIFO_INCONSISTENT',409);
  const debts=(await c.query(`SELECT d.source_id,d.party_id,d.kind,coalesce(sum(d.amount),0)::text outstanding,max(o.due_date)::text due_date,max(o.reference) reference,max(p.name) name FROM pos_debt_movements d JOIN pos_business_operations o ON o.id=d.source_id AND o.business_id=d.business_id LEFT JOIN pos_business_parties p ON p.id=d.party_id AND p.business_id=d.business_id WHERE d.business_id=$1 GROUP BY d.source_id,d.party_id,d.kind HAVING sum(d.amount)<>0 ORDER BY d.kind,d.source_id LIMIT 20001`,[a.business])).rows;
  if(debts.some(d=>BigInt(d.outstanding)<0n))bad('CUTOFF_DEBT_INCONSISTENT',409);
  if([accounts,inventory,debts].some(rows=>rows.length>20000))bad('CUTOFF_SNAPSHOT_TOO_LARGE',413);
  const versions=(await c.query(`SELECT (SELECT count(*)::text FROM pos_money_movements WHERE business_id=$1) money,(SELECT count(*)::text FROM pos_inventory_movements WHERE business_id=$1) stock,(SELECT count(*)::text FROM pos_debt_movements WHERE business_id=$1) debt,(SELECT count(*)::text FROM pos_business_operations WHERE business_id=$1) operations,(SELECT count(*)::text FROM pos_wallet_settlement_payouts WHERE business_id=$1) payouts`,[a.business])).rows[0];
  const wallet=(await c.query(`SELECT coalesce(sum(CASE WHEN direction='debit' THEN amount ELSE -amount END),0)::text net FROM pos_business_wallet_links WHERE business_id=$1`,[a.business])).rows[0];
  const paid=BigInt((await c.query('SELECT coalesce(sum(amount),0)::text n FROM pos_wallet_settlement_payouts WHERE business_id=$1',[a.business])).rows[0].n),net=BigInt(wallet.net);
  const outstanding=net>paid?net-paid:0n,recovery=paid>net?paid-net:0n;
  const sum=(rows,key)=>rows.reduce((s,r)=>s+BigInt(r[key]),0n),cashBank=sum(accounts,'balance'),stock=sum(inventory,'value'),ar=sum(debts.filter(d=>d.kind==='AR'),'outstanding'),ap=sum(debts.filter(d=>d.kind==='AP'),'outstanding');
  const assets=cashBank+stock+ar+outstanding,liabilities=ap+recovery;
  const data={accounts,inventory,debts,versions,settlement:{outstanding:String(outstanding),recovery:String(recovery)},totals:{cash_bank_qris:String(cashBank),inventory:String(stock),receivables:String(ar),payables:String(ap),assets:String(assets),liabilities:String(liabilities),net_tracked_assets:String(assets-liabilities)}};
  return {snapshot:data,snapshot_hash:hash(serialize(data)),today:(await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS business_day",[a.member.timezone])).rows[0].business_day};
 }
 const cutoffStatus=req=>run(req,'BUSINESS_SETTINGS_MANAGE',async(c,a)=>{
  owner(a);const finalized=(await c.query('SELECT * FROM pos_business_cutoffs WHERE business_id=$1',[a.business])).rows[0];
  const corrections=(await c.query("SELECT id,actor_id,payload,created_at FROM pos_business_policy_events WHERE business_id=$1 AND kind='CUTOFF_CORRECTION' ORDER BY created_at,id LIMIT 500",[a.business])).rows;
  if(finalized)return {finalized:true,cutoff:finalized,corrections,semantics:'Snapshot only; never added to balances. Corrections are new audited journals.'};
  const initialized=(await c.query('SELECT id FROM pos_business_initializations WHERE business_id=$1',[a.business])).rowCount;
  return {finalized:false,opening_finalized:!!initialized,...await snapshot(c,a),corrections};
 });
 const finalizeCutoff=req=>run(req,'BUSINESS_SETTINGS_MANAGE',async(c,a)=>{
  owner(a);const b=req.body||{},request=text(b.request_id,160),reason=text(b.reason,500),evidence=text(b.evidence_reference,500);if(request.length<8)bad('INVALID_REQUEST_ID');if(b.confirmation!=='FINALIZE_CUTOFF')bad('CUTOFF_CONFIRMATION_REQUIRED');
  const digest=hash(serialize({actor:a.user,reason,evidence,expected_hash:b.expected_hash,cutoff_date:b.cutoff_date}));
  const old=(await c.query('SELECT * FROM pos_business_cutoffs WHERE business_id=$1',[a.business])).rows[0];if(old){if(old.request_id!==request||old.request_hash!==digest)bad('CUTOFF_ALREADY_FINALIZED',409);return {id:old.id,replay:true,cutoff:old};}
  await c.query('SELECT id FROM pos_businesses WHERE id=$1 FOR UPDATE',[a.business]);
  if((await c.query('SELECT id FROM pos_business_initializations WHERE business_id=$1',[a.business])).rowCount)bad('INITIALIZATION_FINALIZED',409);
  if((await c.query("SELECT id FROM pos_business_shifts WHERE business_id=$1 AND status='OPEN'",[a.business])).rowCount)bad('CUTOFF_CLOSE_SHIFTS_FIRST',409);
  const current=await snapshot(c,a);if(current.snapshot.versions.operations==='0')bad('CUTOFF_USE_OPENING_FOR_NEW_BUSINESS',409);
  if(b.cutoff_date!==current.today)bad('CUTOFF_CURRENT_DAY_REQUIRED',409);if(b.expected_hash!==current.snapshot_hash)bad('CUTOFF_SNAPSHOT_STALE',409);
  const id=makeId();await c.query(`INSERT INTO pos_business_cutoffs(id,business_id,tenant_id,finalized_by,request_id,request_hash,snapshot_hash,cutoff_date,snapshot,reason,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[id,a.business,a.member.tenant_id,a.user,request,digest,current.snapshot_hash,b.cutoff_date,serialize(current.snapshot),reason,evidence]);
  await c.query(`INSERT INTO pos_business_policy_events(id,business_id,tenant_id,actor_id,kind,request_id,request_hash,subject_id,payload) VALUES($1,$2,$3,$4,'CUTOFF_FINALIZED',$5,$6,$7,$8)`,[makeId(),a.business,a.member.tenant_id,a.user,request,digest,id,serialize({cutoff_id:id,reason,evidence_reference:evidence,snapshot_hash:current.snapshot_hash})]);
  await afterStage('cutoff-finalize');return {id,replay:false,snapshot:current.snapshot};
 });
 const correctCutoff=req=>run(req,'BUSINESS_SETTINGS_MANAGE',async(c,a)=>{
  owner(a);const b=req.body||{},kind=b.kind,target=uuid(b.target_id),reason=text(b.reason,500),evidence=text(b.evidence_reference,500);
  if(!['ACCOUNT','INVENTORY','AR','AP'].includes(kind))bad('INVALID_CORRECTION_KIND');if(b.confirmation!=='CORRECT_CUTOFF')bad('CORRECTION_CONFIRMATION_REQUIRED');
  const baseline=(await c.query('SELECT id,snapshot FROM pos_business_cutoffs WHERE business_id=$1',[a.business])).rows[0];if(!baseline)bad('CUTOFF_REQUIRED',409);
  const quantity=kind==='INVENTORY'?signed(b.quantity_delta):null,delta=kind==='INVENTORY'?null:signed(b.amount_delta),cost=kind==='INVENTORY'&&quantity>0n?amount(b.unit_cost):null;
  const f={source:baseline.id,kind,target,quantity,delta,cost,reason,evidence,total:0n,paid:0n};const op=await beginOperation(c,a,b,'OPENING_ADJUSTMENT',f);if(op.replay)return {id:op.id,replay:true};
  let value=delta,movement=null,party=null,source=null,due=null;
  if(kind==='ACCOUNT'){if(!baseline.snapshot.accounts.some(ac=>ac.id===target))bad('CUTOFF_TARGET_DENIED',403);await getAccount(c,a,target,delta<0n?-delta:0n);}
  else if(kind==='INVENTORY'){if(!baseline.snapshot.inventory.some(p=>p.id===target))bad('CUTOFF_TARGET_DENIED',403);await getProduct(c,a,target);movement=makeId();value=quantity>0n?quantity*cost:-(await availableCost(c,a,target,-quantity));}
  else{const original=baseline.snapshot.debts.find(d=>d.source_id===target&&d.kind===kind);if(!original)bad('CUTOFF_TARGET_DENIED',403);party=original.party_id;source=target;due=original.due_date;await lock(c,'pos-source:'+a.business+':'+target);const current=BigInt((await c.query('SELECT coalesce(sum(amount),0)::text n FROM pos_debt_movements WHERE business_id=$1 AND source_id=$2 AND kind=$3',[a.business,target,kind])).rows[0].n);if(current+delta<0n)bad('DEBT_OVERPAYMENT',409);}
  f.total=value<0n?-value:value;f.snapshot={cutoff_id:baseline.id,correction_kind:kind,target_id:target,amount_delta:String(value),quantity_delta:quantity?.toString()||null,evidence_reference:evidence};
  // A cutoff is a snapshot, not a source operation. Keep its reference in the
  // immutable snapshot; source_id is reserved for a real canonical invoice.
  delete f.source;await insertOperation(c,a,op,'OPENING_ADJUSTMENT',f);
  if(kind==='ACCOUNT')await moneyRow(c,a,op.id,target,value);
  else if(kind==='INVENTORY'){await stockRow(c,a,op.id,target,movement,quantity,value<0n?-value:value,quantity>0n?'ADJUSTMENT_IN':'ADJUSTMENT_OUT',reason);if(quantity>0n)await addLayer(c,a,target,movement,quantity,cost);else if(await consume(c,a,target,-quantity,movement)!==-value)bad('COST_MISMATCH',409);}
  else await debtRow(c,a,op.id,{party,due},kind,value,source);
  const auditId=makeId();
  await c.query(`INSERT INTO pos_business_policy_events(id,business_id,tenant_id,actor_id,kind,request_id,request_hash,subject_id,payload) VALUES($1,$2,$3,$4,'CUTOFF_CORRECTION',$5,$6,$7,$8)`,[auditId,a.business,a.member.tenant_id,a.user,op.request,op.requestHash,baseline.id,serialize({...f.snapshot,operation_id:op.id,reason})]);
  await c.query(`INSERT INTO pos_business_cutoff_corrections(id,cutoff_id,business_id,operation_id,audit_event_id,kind,account_id,product_id,debt_source_id,amount_delta,quantity_delta,unit_cost,actor_id,reason,evidence_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,[makeId(),baseline.id,a.business,op.id,auditId,kind,kind==='ACCOUNT'?target:null,kind==='INVENTORY'?target:null,kind==='AR'||kind==='AP'?target:null,String(value),quantity?.toString()||null,cost?.toString()??null,a.user,reason,evidence]);
  await afterStage('cutoff-correction');return {id:op.id,replay:false};
 });
 return {cutoffStatus,finalizeCutoff,correctCutoff};
}
module.exports={createBusinessCutoff};
