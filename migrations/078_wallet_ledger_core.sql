BEGIN;

CREATE TABLE IF NOT EXISTS wallet_accounts (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  santri_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen','closed')),
  current_balance BIGINT NOT NULL DEFAULT 0 CHECK (current_balance >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_accounts_tenant_santri_unique UNIQUE (tenant_id, santri_id),
  CONSTRAINT wallet_accounts_santri_tenant_fkey FOREIGN KEY (santri_id, tenant_id)
    REFERENCES santri(id, tenant_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_id_tenant_unique ON wallet_accounts(id, tenant_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  wallet_account_id BIGINT NOT NULL REFERENCES wallet_accounts(id) ON DELETE RESTRICT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL CHECK (type IN ('opening_balance','topup','withdrawal','payment','refund','adjustment','reversal')),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('credit','debit')),
  amount BIGINT NOT NULL CHECK (amount > 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  reference_type VARCHAR(60),
  reference_id VARCHAR(120),
  source VARCHAR(40) NOT NULL,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  location_unit_id INTEGER,
  merchant_id INTEGER,
  device_id INTEGER,
  idempotency_key VARCHAR(160) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallet_transactions_tenant_idempotency_unique UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT wallet_transactions_account_tenant_fkey FOREIGN KEY (wallet_account_id, tenant_id)
    REFERENCES wallet_accounts(id, tenant_id) ON DELETE RESTRICT,
  CONSTRAINT wallet_transactions_location_unit_tenant_fkey FOREIGN KEY (location_unit_id, tenant_id)
    REFERENCES unit_pendidikan(id, tenant_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS wallet_transactions_account_created_idx ON wallet_transactions(wallet_account_id, created_at, id);
CREATE INDEX IF NOT EXISTS wallet_transactions_tenant_unit_created_idx ON wallet_transactions(tenant_id, location_unit_id, created_at);
CREATE INDEX IF NOT EXISTS wallet_transactions_reference_idx ON wallet_transactions(tenant_id, reference_type, reference_id);

INSERT INTO wallet_accounts (tenant_id, santri_id, current_balance, created_at, updated_at)
SELECT tenant_id, id, COALESCE(saldo,0), COALESCE(created_at,NOW()), NOW()
FROM santri
ON CONFLICT (tenant_id, santri_id) DO NOTHING;

INSERT INTO wallet_transactions (
  wallet_account_id, tenant_id, type, direction, amount, balance_after,
  reference_type, reference_id, source, location_unit_id, merchant_id, device_id,
  idempotency_key, created_at
)
SELECT wa.id, tr.tenant_id,
  CASE LOWER(TRIM(COALESCE(tr.trx_type,'payment')))
    WHEN 'topup' THEN 'topup' WHEN 'refund' THEN 'refund'
    WHEN 'withdrawal' THEN 'withdrawal' ELSE 'payment' END,
  CASE WHEN LOWER(TRIM(COALESCE(tr.trx_type,'payment'))) IN ('topup','refund') THEN 'credit' ELSE 'debit' END,
  tr.nominal, tr.saldo_akhir, 'transaksi_rfid', tr.id::text, 'legacy_rfid',
  tr.location_unit_id, tr.merchant_id, tr.device_id,
  'legacy-rfid:' || tr.tenant_id || ':' || tr.id, tr.created_at
FROM transaksi_rfid tr
JOIN wallet_accounts wa ON wa.tenant_id=tr.tenant_id AND wa.santri_id=tr.santri_id
ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail, status)
SELECT tr.tenant_id, 'transaksi_rfid', tr.id, 'WALLET_RECONCILIATION_REQUIRED',
  jsonb_build_object('marker','ORPHAN_LEGACY_WALLET_TRANSACTION','preserved',true), 'REVIEW_REQUIRED'
FROM transaksi_rfid tr
LEFT JOIN santri s ON s.id=tr.santri_id AND s.tenant_id=tr.tenant_id
WHERE s.id IS NULL
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM wallet_accounts wa JOIN santri s ON s.id=wa.santri_id AND s.tenant_id=wa.tenant_id
    WHERE wa.current_balance<>COALESCE(s.saldo,0)
  ) THEN RAISE EXCEPTION 'WALLET_BALANCE_RECONCILIATION_FAILED'; END IF;
  IF EXISTS (
    SELECT 1 FROM wallet_accounts wa LEFT JOIN (
      SELECT wallet_account_id, SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) net
      FROM wallet_transactions GROUP BY wallet_account_id
    ) l ON l.wallet_account_id=wa.id WHERE wa.current_balance<>COALESCE(l.net,0)
  ) THEN RAISE EXCEPTION 'WALLET_LEDGER_SUM_RECONCILIATION_FAILED'; END IF;
END $$;

COMMIT;
