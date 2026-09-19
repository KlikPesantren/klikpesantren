// Sahriyah money is derived from its payment ledger. Stored totals/remaining
// are denormalized caches and may be stale on historical or newly inserted rows.
function assertAlias(alias) {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error("Invalid SQL alias");
  return alias;
}

function sahriyahLedgerJoin(billAlias = "t", ledgerAlias = "sahriyah_ledger") {
  const bill = assertAlias(billAlias);
  const ledger = assertAlias(ledgerAlias);
  return `LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(ps.nominal), 0)::bigint AS paid,
           COALESCE(SUM(ps.nominal_beras), 0)::numeric AS paid_beras
    FROM pembayaran_sahriyah ps
    WHERE ps.tagihan_id = ${bill}.id AND ps.tenant_id = ${bill}.tenant_id
  ) ${ledger} ON TRUE`;
}

function sahriyahCanonicalExpressions(billAlias = "t", ledgerAlias = "sahriyah_ledger") {
  const bill = assertAlias(billAlias);
  const ledger = assertAlias(ledgerAlias);
  const paid = `${ledger}.paid`;
  const paidBeras = `${ledger}.paid_beras`;
  const remaining = `GREATEST(COALESCE(${bill}.nominal, 0) - ${paid}, 0)`;
  const remainingBeras = `GREATEST(COALESCE(${bill}.nominal_beras, 0) - ${paidBeras}, 0)`;
  const status = `CASE
    WHEN (${paid} > 0 OR ${paidBeras} > 0)
      AND ${remaining} = 0 AND ${remainingBeras} = 0 THEN 'Lunas'
    WHEN ${paid} > 0 OR ${paidBeras} > 0 THEN 'Cicilan'
    ELSE 'Belum Lunas'
  END`;
  return { paid, paidBeras, remaining, remainingBeras, status };
}

function sahriyahCanonicalSelect(billAlias = "t", ledgerAlias = "sahriyah_ledger") {
  const value = sahriyahCanonicalExpressions(billAlias, ledgerAlias);
  return `${value.paid} AS canonical_total_bayar,
    ${value.remaining} AS canonical_sisa_tagihan,
    ${value.paidBeras} AS canonical_beras_terbayar,
    ${value.remainingBeras} AS canonical_sisa_beras,
    ${value.status} AS canonical_status`;
}

function projectCanonicalSahriyah(row) {
  const {
    canonical_total_bayar,
    canonical_sisa_tagihan,
    canonical_beras_terbayar,
    canonical_sisa_beras,
    canonical_status,
    ...rest
  } = row;
  return {
    ...rest,
    total_bayar: canonical_total_bayar,
    sisa_tagihan: canonical_sisa_tagihan,
    beras_terbayar: canonical_beras_terbayar,
    sisa_beras: canonical_sisa_beras,
    status: canonical_status,
  };
}

module.exports = {
  sahriyahLedgerJoin,
  sahriyahCanonicalExpressions,
  sahriyahCanonicalSelect,
  projectCanonicalSahriyah,
};
