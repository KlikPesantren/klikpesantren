// Read-only aggregate snapshot for the final Play production gate. No row data or credentials are printed.
const pool = require("../db");

const tenantId = Number(process.env.PLAY_GATE_TENANT_ID || 1);
if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error("INVALID_TENANT_ID");

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const settlementIndex = (await client.query(
      "SELECT to_regclass('public.uq_pembayaran_sahriyah_settlement_idempotency') IS NOT NULL AS present",
    )).rows[0].present;
    if (!settlementIndex) throw new Error("SAHRIYAH_SETTLEMENT_UNIQUE_INDEX_MISSING");
    const sahriyah = (await client.query(`
      WITH ledger AS (
        SELECT tenant_id, tagihan_id, COALESCE(SUM(nominal),0)::bigint AS paid
        FROM pembayaran_sahriyah WHERE tenant_id=$1 GROUP BY tenant_id, tagihan_id
      ), bills AS (
        SELECT t.id, t.nominal, t.total_bayar, t.sisa_tagihan, t.legacy_resolution_status,
          COALESCE(l.paid,0) AS paid,
          GREATEST(t.nominal-COALESCE(l.paid,0),0) AS canonical_remaining
        FROM tagihan_sahriyah t LEFT JOIN ledger l
          ON l.tenant_id=t.tenant_id AND l.tagihan_id=t.id
        WHERE t.tenant_id=$1
      )
      SELECT COUNT(*)::int AS bills,
        COALESCE(SUM(nominal),0)::bigint AS nominal,
        COALESCE(SUM(paid),0)::bigint AS ledger_paid,
        COALESCE(SUM(canonical_remaining),0)::bigint AS canonical_remaining,
        COALESCE(SUM(sisa_tagihan),0)::bigint AS cached_remaining,
        COUNT(*) FILTER (WHERE COALESCE(total_bayar,0)<>paid)::int AS paid_cache_mismatch_rows,
        COALESCE(SUM(ABS(COALESCE(total_bayar,0)-paid)),0)::bigint AS paid_cache_mismatch_rupiah,
        COUNT(*) FILTER (WHERE COALESCE(sisa_tagihan,0)<>canonical_remaining)::int AS stale_remaining_rows,
        COALESCE(SUM(ABS(COALESCE(sisa_tagihan,0)-canonical_remaining)),0)::bigint AS stale_remaining_rupiah,
        COUNT(*) FILTER (WHERE COALESCE(sisa_tagihan,0)<>canonical_remaining
          AND legacy_resolution_status='REVIEW_REQUIRED')::int AS ambiguous_stale_rows
      FROM bills
    `, [tenantId])).rows[0];
    const payments = (await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM pembayaran WHERE tenant_id=$1) AS bills,
        (SELECT COALESCE(SUM(nominal_bayar),0)::bigint FROM pembayaran WHERE tenant_id=$1) AS paid_cache,
        (SELECT COUNT(*)::int FROM pembayaran_detail WHERE tenant_id=$1) AS detail_rows,
        (SELECT COALESCE(SUM(nominal),0)::bigint FROM pembayaran_detail WHERE tenant_id=$1) AS detail_nominal,
        (SELECT COALESCE(SUM(nominal),0)::bigint FROM buku_kas
          WHERE tenant_id=$1 AND source='pembayaran' AND jenis='Masuk') AS cash_posted,
        (SELECT COALESCE(SUM(nominal),0)::bigint FROM buku_kas
          WHERE tenant_id=$1 AND source='pembayaran_reversal' AND jenis='Keluar') AS cash_reversed
    `, [tenantId])).rows[0];
    const wallet = (await client.query(`
      WITH ledger AS (
        SELECT wallet_account_id,
          COALESCE(SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)::bigint AS net
        FROM wallet_transactions WHERE tenant_id=$1 GROUP BY wallet_account_id
      )
      SELECT COUNT(*)::int AS accounts,
        COALESCE(SUM(a.current_balance),0)::bigint AS current_balance,
        COALESCE(SUM(COALESCE(l.net,0)),0)::bigint AS ledger_net,
        COUNT(*) FILTER (WHERE a.current_balance<>COALESCE(l.net,0))::int AS mismatch_accounts,
        COALESCE(SUM(ABS(a.current_balance-COALESCE(l.net,0))),0)::bigint AS mismatch_rupiah,
        (SELECT COUNT(*)::int FROM wallet_transactions WHERE tenant_id=$1) AS transactions
      FROM wallet_accounts a LEFT JOIN ledger l ON l.wallet_account_id=a.id
      WHERE a.tenant_id=$1
    `, [tenantId])).rows[0];
    await client.query("ROLLBACK");
    console.log(JSON.stringify({ mode: "READ_ONLY", tenant_id: tenantId,
      sahriyah_settlement_unique_index: settlementIndex, sahriyah, payments, wallet }, null, 2));
    if (Number(sahriyah.paid_cache_mismatch_rupiah) !== 0 ||
        Number(sahriyah.nominal) !== Number(sahriyah.ledger_paid) + Number(sahriyah.canonical_remaining) ||
        Number(payments.detail_nominal) !== Number(payments.cash_posted) ||
        Number(payments.paid_cache) !== Number(payments.cash_posted) - Number(payments.cash_reversed) ||
        Number(wallet.mismatch_rupiah) !== 0) process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
