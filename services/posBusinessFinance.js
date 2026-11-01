// Canonical read projections: fixed-query aggregates and stable cursor in one MVCC snapshot.
function createBusinessFinance({read,bad,uuid,dueDate}) {
 const n=v=>BigInt(v||0),str=v=>v.toString();
 async function range(c,a,q={}) {
  let from,to;
  const today=(await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS day",[a.member.timezone])).rows[0].day;
  if(q.from||q.to){from=dueDate(q.from);to=dueDate(q.to);}
  else if(q.date){from=to=dueDate(q.date);}
  else if(q.month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(q.month))bad('INVALID_PERIOD');from=q.month+'-01';to=(await c.query("SELECT to_char(($1::date+interval '1 month'-interval '1 day'),'YYYY-MM-DD') AS day",[from])).rows[0].day;}
  else if(q.year){if(!/^(19|20|21)\d{2}$/.test(String(q.year)))bad('INVALID_PERIOD');from=q.year+'-01-01';to=q.year+'-12-31';}
  else {const unit={TODAY:'day',MONTH:'month',YEAR:'year'}[q.period||'MONTH'];if(!unit)bad('INVALID_PERIOD');from=(await c.query("SELECT to_char(date_trunc($1,now() AT TIME ZONE $2),'YYYY-MM-DD') AS day",[unit,a.member.timezone])).rows[0].day;to=today;}
  if(from>today)bad('FUTURE_PERIOD_UNAVAILABLE');if(to>today)to=today;
  if(from>to)bad('INVALID_PERIOD');if(new Date(to)-new Date(from)>3660*86400000)bad('PERIOD_TOO_LARGE');
  return {from,to,today};
 }
 const unified=`WITH dated AS MATERIALIZED (SELECT * FROM pos_business_dated_operations WHERE business_id=$1), unified AS (
 SELECT m.id,m.business_id,m.account_id,o.id source_id,o.kind,CASE WHEN o.kind='MONEY_REVERSAL' THEN o.receipt_snapshot->>'original_kind' ELSE o.kind END flow_kind,revised.id reversal_id,corrected.id correction_id,o.source_id original_id,m.amount,m.created_at occurred_at,o.effective_date business_date,
 o.reference,o.reason,o.actor_id,coalesce(m.attributed_shift_id,o.shift_id) shift_id,u.name actor_name,p.name party,
 fc.name category_name,o.finance_category_id
 FROM pos_money_movements m JOIN dated o ON o.id=m.operation_id AND o.business_id=m.business_id
 LEFT JOIN pos_business_operations revised ON revised.source_id=o.id AND revised.business_id=o.business_id AND revised.kind='MONEY_REVERSAL' AND revised.created_at<=$9::timestamptz AND (revised.xmin::text::xid8=pg_current_xact_id_if_assigned() OR pg_visible_in_snapshot(revised.xmin::text::xid8,coalesce(nullif(current_setting('pos.cashbook_snapshot',true),'')::pg_snapshot,pg_current_snapshot())))
 LEFT JOIN pos_business_operations corrected ON corrected.source_id=o.id AND corrected.business_id=o.business_id AND corrected.receipt_snapshot->>'finance_action'='CORRECTION' AND corrected.created_at<=$9::timestamptz AND (corrected.xmin::text::xid8=pg_current_xact_id_if_assigned() OR pg_visible_in_snapshot(corrected.xmin::text::xid8,coalesce(nullif(current_setting('pos.cashbook_snapshot',true),'')::pg_snapshot,pg_current_snapshot())))
 JOIN pos_merchant_users u ON u.id=o.actor_id
 LEFT JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id
 LEFT JOIN pos_finance_categories fc ON fc.id=o.finance_category_id AND fc.business_id=o.business_id
 JOIN pos_business_accounts ac ON ac.id=m.account_id AND ac.business_id=m.business_id
 WHERE $4::text IS NOT NULL AND m.business_id=$1 AND ac.kind IN('CASH','BANK','QRIS') AND m.created_at<=$9::timestamptz AND (coalesce(m.recorded_xid,m.xmin::text::xid8)=pg_current_xact_id_if_assigned() OR pg_visible_in_snapshot(coalesce(m.recorded_xid,m.xmin::text::xid8),coalesce(nullif(current_setting('pos.cashbook_snapshot',true),'')::pg_snapshot,pg_current_snapshot())))
 UNION ALL
 SELECT p.id,p.business_id,p.merchant_account_id,p.id,'WALLET_SETTLEMENT','WALLET_SETTLEMENT',NULL::uuid,NULL::uuid,NULL::uuid,p.amount,p.created_at,p.payout_date,
 p.reference,'Settlement Dompet',NULL::uuid,p.attributed_shift_id,'Admin KlikPesantren',NULL::text,NULL::text,NULL::uuid
 FROM pos_wallet_settlement_payouts p WHERE p.business_id=$1 AND p.merchant_account_id IS NOT NULL AND p.created_at<=$9::timestamptz AND (coalesce(p.recorded_xid,p.xmin::text::xid8)=pg_current_xact_id_if_assigned() OR pg_visible_in_snapshot(coalesce(p.recorded_xid,p.xmin::text::xid8),coalesce(nullif(current_setting('pos.cashbook_snapshot',true),'')::pg_snapshot,pg_current_snapshot())))
 ), running AS (SELECT x.*,sum(amount) OVER(PARTITION BY account_id ORDER BY business_date,occurred_at,id ROWS UNBOUNDED PRECEDING) running_balance FROM unified x),
 filtered AS (SELECT * FROM running WHERE business_date BETWEEN $2::date AND $3::date
 AND ($5::uuid IS NULL OR account_id=$5) AND ($6::text IS NULL OR kind=$6)
 AND ($7::uuid IS NULL OR actor_id=$7) AND ($8::uuid IS NULL OR shift_id=$8)
 AND ($10::text IS NULL OR ($10='IN' AND amount>0) OR ($10='OUT' AND amount<0)))`;
 async function balances(c,a,to=null,from=null,snapshot=null) {
  return (await c.query(`WITH dated AS MATERIALIZED (SELECT * FROM pos_business_dated_operations WHERE business_id=$1), movements AS (
   SELECT m.account_id,m.amount,o.effective_date AS day FROM pos_money_movements m
   JOIN dated o ON o.id=m.operation_id AND o.business_id=m.business_id
   WHERE m.business_id=$1 AND ($4::timestamptz IS NULL OR (m.created_at<=$4 AND (coalesce(m.recorded_xid,m.xmin::text::xid8)=pg_current_xact_id_if_assigned() OR pg_visible_in_snapshot(coalesce(m.recorded_xid,m.xmin::text::xid8),coalesce(nullif(current_setting('pos.cashbook_snapshot',true),'')::pg_snapshot,pg_current_snapshot())))))
   UNION ALL SELECT merchant_account_id,amount,payout_date FROM pos_wallet_settlement_payouts
   WHERE business_id=$1 AND merchant_account_id IS NOT NULL AND ($4::timestamptz IS NULL OR (created_at<=$4 AND (coalesce(recorded_xid,xmin::text::xid8)=pg_current_xact_id_if_assigned() OR pg_visible_in_snapshot(coalesce(recorded_xid,xmin::text::xid8),coalesce(nullif(current_setting('pos.cashbook_snapshot',true),'')::pg_snapshot,pg_current_snapshot()))))))
   SELECT ac.id,ac.name,ac.kind,ac.active,coalesce(sum(m.amount) FILTER(WHERE $2::date IS NULL OR m.day<=$2),0)::text balance,
   coalesce(sum(m.amount) FILTER(WHERE m.day<$3::date),0)::text opening_balance
   FROM pos_business_accounts ac LEFT JOIN movements m ON m.account_id=ac.id WHERE ac.business_id=$1
   GROUP BY ac.id ORDER BY ac.kind,ac.name,ac.id`,[a.business,to,from,snapshot])).rows;
 }
 async function categories(req){return read(req,null,async(c,a)=>{
  if(!a.member.effective_permissions.some(x=>['EXPENSE_CREATE','OTHER_INCOME_CREATE','FINANCE_TRANSACTION_VIEW'].includes(x)))bad('MERCHANT_PERMISSION_DENIED',403);
  return (await c.query('SELECT id,kind,code,name FROM pos_finance_categories WHERE business_id=$1 AND active ORDER BY kind,name',[a.business])).rows;
 });}
 async function books(req){return read(req,'FINANCE_ACCOUNT_VIEW',async(c,a)=>{
  const today=(await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS day",[a.member.timezone])).rows[0].day;
  const accounts=await balances(c,a,today),cash=accounts.filter(x=>x.kind==='CASH').reduce((s,x)=>s+n(x.balance),0n),bank=accounts.filter(x=>x.kind==='BANK').reduce((s,x)=>s+n(x.balance),0n);
  return {accounts,as_of:today,position_at:new Date().toISOString(),timezone:a.member.timezone,cash:str(cash),bank:str(bank),available_money:str(cash+bank),
   qris_pending:str(accounts.filter(x=>x.kind==='QRIS').reduce((s,x)=>s+n(x.balance),0n)),
   semantics:'Kas + bank tersedia. QRIS menunggu transfer settlement ke bank; Wallet clearing bukan uang tersedia.'};
 });}
 async function cashBook(req){return read(req,'FINANCE_TRANSACTION_VIEW',async(c,a)=>{
  const q=req.query||{},r=await range(c,a,q),requested=q.limit==null?50:Number(q.limit);if(!Number.isInteger(requested)||requested<1||requested>100)bad('INVALID_PAGE_SIZE');const limit=req._cashBookExport?25000:requested;
  const kinds=['OPENING','OPENING_ADJUSTMENT','EXPENSE','OTHER_INCOME','TRANSFER','CAPITAL','WITHDRAWAL','SALE','SALE_RETURN','PURCHASE','PURCHASE_RETURN','AR_COLLECTION','AP_PAYMENT','WALLET_SETTLEMENT','MONEY_REVERSAL'];
  if(q.kind&&!kinds.includes(q.kind)||q.direction&&!['IN','OUT'].includes(q.direction))bad('INVALID_MONEY_KIND');
  const eventView=q.view==='events'&&!req._cashBookExport; // Exports retain individual canonical ledger legs.
 if(q.view&&!['events','ledger'].includes(q.view))bad('INVALID_CASHBOOK_VIEW');
  if(eventView&&['account_id','kind','actor_id','shift_id','direction'].some(key=>q[key]))bad('EVENT_VIEW_DATE_FILTER_ONLY');
  const filter={...(eventView?{view:'events'}:{}),business:a.business,from:r.from,to:r.to,account:q.account_id?uuid(q.account_id):null,kind:q.kind||null,actor:q.actor_id?uuid(q.actor_id):null,shift:q.shift_id?uuid(q.shift_id):null,direction:q.direction||null};
  let cursor=null;
  if(q.cursor){try{cursor=JSON.parse(Buffer.from(q.cursor,'base64url').toString());if(JSON.stringify(cursor.filter)!==JSON.stringify(filter)||!Number.isFinite(Date.parse(cursor.at))||!Number.isFinite(Date.parse(cursor.time)))throw Error();dueDate(cursor.day);uuid(cursor.id);if(!/^\d+:\d+:[\d,]*$/.test(cursor.snapshot||''))throw Error();}catch{bad('INVALID_CURSOR');}}
  const snapshot=cursor?.snapshot||(await c.query('SELECT pg_current_snapshot()::text snapshot')).rows[0].snapshot;
  await c.query("SELECT set_config('pos.cashbook_snapshot',$1,true)",[snapshot]);
  const at=cursor?.at||(await c.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`)).rows[0].at;
  const v=[a.business,r.from,r.to,a.member.timezone,filter.account,filter.kind,filter.actor,filter.shift,at,filter.direction];
  const totals=(await c.query(unified+` SELECT count(*)::int total_rows,count(DISTINCT CASE WHEN flow_kind='TRANSFER' THEN source_id ELSE id END)::int total_events,
   coalesce(sum(amount) FILTER(WHERE flow_kind<>'TRANSFER' AND amount>0),0)::text money_in,
   coalesce(-sum(amount) FILTER(WHERE flow_kind<>'TRANSFER' AND amount<0),0)::text money_out FROM filtered`,v)).rows[0];
  if(req._cashBookExport&&totals.total_rows>limit)bad('CASH_BOOK_EXPORT_TOO_LARGE',413);
  const perAccount=(await c.query(unified+` SELECT account_id,
   coalesce(sum(amount) FILTER(WHERE flow_kind<>'TRANSFER' AND amount>0),0)::text money_in,
   coalesce(-sum(amount) FILTER(WHERE flow_kind<>'TRANSFER' AND amount<0),0)::text money_out,
   coalesce(sum(amount) FILTER(WHERE flow_kind='TRANSFER' AND amount>0),0)::text transfer_in,
   coalesce(-sum(amount) FILTER(WHERE flow_kind='TRANSFER' AND amount<0),0)::text transfer_out FROM filtered GROUP BY account_id`,v)).rows;
  const eventSql=unified+`, events AS (
   SELECT CASE WHEN f.flow_kind='TRANSFER' THEN f.source_id ELSE f.id END id,
    f.kind,f.flow_kind,f.source_id,f.business_date,max(f.reversal_id::text) reversal_id,max(f.correction_id::text) correction_id,max(f.original_id::text) original_id,max(f.occurred_at) occurred_at,max(f.reference) reference,max(f.reason) reason,
    max(f.actor_name) actor_name,max(f.category_name) category_name,
    sum(f.amount)::text amount,coalesce(max(f.amount) FILTER(WHERE f.amount>0),0)::text transfer_amount,
    max(ac.name) FILTER(WHERE f.amount<0) from_account,max(ac.name) FILTER(WHERE f.amount>0) to_account,
    jsonb_agg(jsonb_build_object('id',f.id,'account_id',f.account_id,'account_name',ac.name,'account_kind',ac.kind,
      'amount',f.amount::text,'running_balance',f.running_balance::text) ORDER BY f.amount,f.id) legs
   FROM filtered f JOIN pos_business_accounts ac ON ac.id=f.account_id AND ac.business_id=f.business_id
   GROUP BY CASE WHEN f.flow_kind='TRANSFER' THEN f.source_id ELSE f.id END,f.kind,f.flow_kind,f.source_id,f.business_date
  ) SELECT e.*,to_char(business_date,'YYYY-MM-DD') date,
   to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time,
   greatest(amount::numeric,0)::text money_in,greatest(-amount::numeric,0)::text money_out,
   flow_kind<>'TRANSFER' external_flow
   FROM events e WHERE ($11::date IS NULL OR (business_date,occurred_at,e.id)<($11::date,$12::timestamptz,$13::uuid))
   ORDER BY business_date DESC,occurred_at DESC,e.id DESC LIMIT $14`;
  const rows=(await c.query(eventView?eventSql:unified+` SELECT f.*,to_char(business_date,'YYYY-MM-DD') date,
   to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_time,ac.name account_name,ac.kind account_kind,greatest(amount,0)::text money_in,greatest(-amount,0)::text money_out,
   f.flow_kind<>'TRANSFER' external_flow FROM filtered f JOIN pos_business_accounts ac ON ac.id=f.account_id AND ac.business_id=f.business_id
   WHERE ($11::date IS NULL OR (business_date,occurred_at,f.id)<($11::date,$12::timestamptz,$13::uuid))
   ORDER BY business_date DESC,occurred_at DESC,f.id DESC LIMIT $14`,[...v,cursor?.day||null,cursor?.time||null,cursor?.id||null,limit+1])).rows;
  const more=rows.length>limit;if(more)rows.pop();const last=rows.at(-1);
  const options=await balances(c,a,r.to,r.from,at),accounts=options.filter(x=>['CASH','BANK','QRIS'].includes(x.kind)&&(!filter.account||x.id===filter.account)).map(x=>{
   const agg=perAccount.find(p=>p.account_id===x.id)||{money_in:'0',money_out:'0',transfer_in:'0',transfer_out:'0'};
   return {...x,...agg,ending_balance:x.balance,balance_change:str(n(x.balance)-n(x.opening_balance))};
  });
  const shifts=(await c.query(`SELECT s.id,s.status,s.opening_cash,s.expected_cash,s.actual_cash,s.difference,s.opened_at,s.closed_at,
   t.name terminal,ac.name drawer,u.name cashier FROM pos_business_shifts s
   JOIN pos_business_terminals t ON t.id=s.terminal_id JOIN pos_business_accounts ac ON ac.id=s.cash_account_id
   JOIN pos_merchant_users u ON u.id=s.user_id WHERE s.business_id=$1 AND (s.opened_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date
   AND ($6::text IS NULL OR $6::text IS NOT NULL) AND ($5::uuid IS NULL OR s.cash_account_id=$5) AND ($7::uuid IS NULL OR s.user_id=$7) AND ($8::uuid IS NULL OR s.id=$8)
   ORDER BY s.opened_at DESC,s.id LIMIT 200`,v.slice(0,8))).rows;
  const actors=(await c.query('SELECT DISTINCT u.id,u.name FROM pos_business_operations o JOIN pos_merchant_users u ON u.id=o.actor_id WHERE o.business_id=$1 ORDER BY u.name,u.id',[a.business])).rows;
  const opening=accounts.reduce((s,x)=>s+n(x.opening_balance),0n),ending=accounts.reduce((s,x)=>s+n(x.balance),0n);
  return {...r,snapshot_at:at,merchant:{name:a.member.display_name,timezone:a.member.timezone,currency:a.member.currency},
   rows,total_rows:totals.total_rows,...(eventView?{view:'events',total_events:totals.total_events}:{}),next_cursor:more?Buffer.from(JSON.stringify({filter,at,snapshot,day:last.date,time:last.cursor_time,id:last.id})).toString('base64url'):null,
   accounts,account_options:options.filter(x=>['CASH','BANK','QRIS'].includes(x.kind)),shifts,shift_options:shifts,actors,
   summary:{...totals,opening_balance:str(opening),ending_balance:str(ending),net_cash_flow:str(n(totals.money_in)-n(totals.money_out)),balance_change:str(ending-opening)},
   semantics:'Transfer Internal: dua sisi, bukan pendapatan/beban. Ringkasan arus mengikuti seluruh filter; saldo awal/akhir mengikuti akun dan tanggal, tidak filter jenis. QRIS belum tentu saldo bank tersedia.'};
 });}
 async function chart(c,a,r,q={}) {
  const grain=q.grain||((q.date||r.from===r.to)?'hour':q.year?'month':'day');
  if(!['hour','day','month'].includes(grain)||grain==='hour'&&r.from!==r.to)bad('INVALID_CHART_GRAIN');
  const rows=(await c.query(`WITH bins AS (
   SELECT generate_series(CASE WHEN $4='hour' THEN 0 ELSE 0 END,CASE WHEN $4='hour' THEN 23 ELSE 0 END) h
  ), sales AS (SELECT CASE WHEN $4='hour' THEN to_char(o.created_at AT TIME ZONE o.effective_timezone,'HH24')
   WHEN $4='month' THEN to_char(o.effective_date,'YYYY-MM') ELSE to_char(o.effective_date,'YYYY-MM-DD') END bucket,
   sum(CASE WHEN kind='SALE' THEN total ELSE -total END)::text net_sales,count(*) FILTER(WHERE kind='SALE') transactions
   FROM pos_business_dated_operations o WHERE business_id=$1 AND effective_date BETWEEN $2::date AND $3::date AND kind IN('SALE','SALE_RETURN') GROUP BY 1),
   labels AS (SELECT lpad(h::text,2,'0') bucket FROM bins WHERE $4='hour'
    UNION ALL SELECT to_char(d,CASE WHEN $4='month' THEN 'YYYY-MM' ELSE 'YYYY-MM-DD' END) FROM generate_series($2::date,$3::date,CASE WHEN $4='month' THEN interval '1 month' ELSE interval '1 day' END) d WHERE $4<>'hour')
   SELECT l.bucket,coalesce(s.net_sales,'0') net_sales,coalesce(s.transactions,0) transactions FROM labels l LEFT JOIN sales s USING(bucket) ORDER BY l.bucket`,[a.business,r.from,r.to,grain])).rows;
  return {grain,points:rows};
 }
 return {range,balances,categories,books,cashBook,chart};
}
module.exports={createBusinessFinance};
