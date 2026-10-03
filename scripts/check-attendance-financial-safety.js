// Production READ ONLY. Never repair monetary caches or write business rows.
const assert=require('node:assert/strict');
const pool=require('../db');
const tables=['buku_kas','tagihan_sahriyah','pembayaran_sahriyah','pembayaran','pembayaran_detail','wallet_accounts','wallet_transactions'];
async function snapshot(db){
  const result={};
  for(const table of tables){
    result[table]=(await db.query(`SELECT COUNT(*)::int AS rows,
      md5(COALESCE(string_agg(row_to_json(t)::text,'' ORDER BY id),'')) AS fingerprint
      FROM ${table} t`)).rows[0];
  }
  return result;
}
async function main(){
  const db=await pool.connect();
  try{
    await db.query('BEGIN READ ONLY');
    const before=await snapshot(db);
    const wallet=(await db.query(`WITH ordered AS (
      SELECT wallet_account_id,tenant_id,balance_after,
        SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END)
          OVER(PARTITION BY tenant_id,wallet_account_id ORDER BY created_at,id) AS expected
      FROM wallet_transactions), net AS (
      SELECT tenant_id,wallet_account_id,SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) AS balance
      FROM wallet_transactions GROUP BY tenant_id,wallet_account_id)
      SELECT (SELECT COUNT(*) FROM ordered WHERE balance_after<>expected)::int AS running_mismatches,
        COUNT(*) FILTER(WHERE a.current_balance<>COALESCE(n.balance,0))::int AS account_mismatches,
        COALESCE(SUM(ABS(a.current_balance-COALESCE(n.balance,0))),0)::bigint AS rupiah_mismatch
      FROM wallet_accounts a LEFT JOIN net n ON n.tenant_id=a.tenant_id AND n.wallet_account_id=a.id`)).rows[0];
    assert.equal(wallet.running_mismatches,0);assert.equal(wallet.account_mismatches,0);assert.equal(Number(wallet.rupiah_mismatch),0);
    const after=await snapshot(db);assert.deepEqual(after,before);
    await db.query('ROLLBACK');
    console.log(JSON.stringify({mode:'READ_ONLY',wallet,financial_rows_unchanged:true,snapshot:before}));
  }finally{await db.query('ROLLBACK').catch(()=>{});db.release();await pool.end();}
}
main().catch(e=>{console.error(JSON.stringify({status:'NO-GO',error_class:e.code||e.name,
  assertion:e.name==='AssertionError'?e.message:undefined}));process.exitCode=1;});
