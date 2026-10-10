// Read-only projections of the canonical V2 immutable ledgers. No copied balances.
function createBusinessMetrics({run,bad,dueDate}) {
  async function customers(req) {
    return run(req,'REPORT_CUSTOMER',async(c,a)=>{
      const ranking=req.query.ranking || 'SPEND';
      const orders={SPEND:'net_spend DESC',FREQUENCY:'transaction_count DESC',RECENT:'last_purchase DESC NULLS LAST'};
      if(!orders[ranking])bad('INVALID_RANKING');
      const rows=(await c.query(`WITH sales AS (
        SELECT party_id,sum(total) gross_spend,count(*) transaction_count,max(created_at) last_purchase,
         coalesce(sum(total) FILTER(WHERE channel='POS'),0) pos_gross,
         coalesce(sum(total) FILTER(WHERE channel='ONLINE'),0) online_gross
        FROM pos_business_operations WHERE business_id=$1 AND kind='SALE' GROUP BY party_id
      ), returns AS (
        SELECT party_id,sum(total) returned_value,
         coalesce(sum(total) FILTER(WHERE channel='POS'),0) pos_returns,
         coalesce(sum(total) FILTER(WHERE channel='ONLINE'),0) online_returns
        FROM pos_business_operations WHERE business_id=$1 AND kind='SALE_RETURN' GROUP BY party_id
      ), ar AS (
        SELECT party_id,sum(amount) outstanding FROM pos_debt_movements WHERE business_id=$1 AND kind='AR' GROUP BY party_id
      ) SELECT p.id,p.name,p.active,coalesce(s.gross_spend,0) gross_spend,
        coalesce(s.gross_spend,0)-coalesce(r.returned_value,0) net_spend,
        coalesce(s.transaction_count,0) transaction_count,s.last_purchase,
        CASE WHEN coalesce(s.transaction_count,0)=0 THEN 0 ELSE trunc(s.gross_spend/s.transaction_count) END average_transaction,
        coalesce(s.pos_gross,0)-coalesce(r.pos_returns,0) pos_spend,
        coalesce(s.online_gross,0)-coalesce(r.online_returns,0) online_spend,
        coalesce(r.returned_value,0) returned_value,coalesce(ar.outstanding,0) outstanding_receivable
       FROM pos_business_parties p LEFT JOIN sales s ON s.party_id=p.id LEFT JOIN returns r ON r.party_id=p.id
       LEFT JOIN ar ON ar.party_id=p.id WHERE p.business_id=$1 AND p.kind='CUSTOMER'
       ORDER BY ${orders[ranking]},p.id LIMIT 200`,[a.business])).rows;
      return {ranking,customers:rows,limit:200,
        semantics:'Lifetime posted ledger amounts; net spend subtracts returns; average uses gross tickets, whole Rupiah. Guests are not merged into Customer master.'};
    });
  }
  async function aging(req) {
    const kind=req.query.kind || 'AR';
    return run(req,kind==='AP'?'AP_VIEW':'AR_VIEW',async(c,a)=>{
      if(!['AR','AP'].includes(kind))bad('INVALID_DEBT_KIND');
      const asOf=req.query.as_of ? dueDate(req.query.as_of) : (await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS report_date",[a.member.timezone])).rows[0].report_date;
      const rows=(await c.query(`WITH outstanding AS (
        SELECT d.source_id,d.party_id,sum(d.amount) outstanding
        FROM pos_debt_movements d JOIN pos_business_operations o ON o.id=d.operation_id AND o.business_id=d.business_id
        WHERE d.business_id=$1 AND d.kind=$2 AND (o.created_at AT TIME ZONE $4)::date<=$3::date
        GROUP BY d.source_id,d.party_id HAVING sum(d.amount)>0
      ) SELECT x.source_id,x.party_id,p.name,o.due_date,x.outstanding,
        greatest(0,$3::date-o.due_date) days_overdue,
        CASE WHEN o.due_date >= $3::date THEN 'CURRENT' WHEN $3::date-o.due_date<=30 THEN '1_30'
         WHEN $3::date-o.due_date<=60 THEN '31_60' WHEN $3::date-o.due_date<=90 THEN '61_90' ELSE '91_PLUS' END bucket
       FROM outstanding x JOIN pos_business_operations o ON o.id=x.source_id AND o.business_id=$1
       JOIN pos_business_parties p ON p.id=x.party_id AND p.business_id=$1
       ORDER BY o.due_date,x.source_id`,[a.business,kind,asOf,a.member.timezone])).rows;
      const buckets={CURRENT:0n,'1_30':0n,'31_60':0n,'61_90':0n,'91_PLUS':0n};
      for(const r of rows)buckets[r.bucket]+=BigInt(r.outstanding);
      return {kind,as_of:asOf,timezone:a.member.timezone,items:rows,
        buckets:Object.fromEntries(Object.entries(buckets).map(([k,v])=>[k,v.toString()])),
        outstanding:rows.reduce((sum,r)=>sum+BigInt(r.outstanding),0n).toString()};
    });
  }
  return {customers,aging};
}
module.exports={createBusinessMetrics};
