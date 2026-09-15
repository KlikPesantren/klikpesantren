BEGIN;

ALTER TABLE wallet_accounts
  ADD COLUMN IF NOT EXISTS unit_id INTEGER;

UPDATE wallet_accounts
SET unit_id = pesantren.unit_id
FROM (
  SELECT tenant_id, MIN(id) AS unit_id
  FROM unit_pendidikan
  WHERE is_active = true
    AND (
      UPPER(COALESCE(preset_key,'')) = 'PESANTREN'
      OR UPPER(COALESCE(kode,'')) = 'PESANTREN'
      OR UPPER(COALESCE(nama,'')) = 'PESANTREN'
    )
  GROUP BY tenant_id
) pesantren
WHERE wallet_accounts.unit_id IS NULL
  AND wallet_accounts.tenant_id = pesantren.tenant_id;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM wallet_accounts WHERE unit_id IS NULL) THEN
    RAISE EXCEPTION 'WALLET_PER_UNIT_PESANTREN_UNIT_REQUIRED';
  END IF;
END $$;

ALTER TABLE wallet_accounts
  ALTER COLUMN unit_id SET NOT NULL;

ALTER TABLE wallet_accounts
  DROP CONSTRAINT IF EXISTS wallet_accounts_tenant_santri_unique;

ALTER TABLE wallet_accounts
  ADD CONSTRAINT wallet_accounts_unit_tenant_fkey
  FOREIGN KEY (unit_id, tenant_id)
  REFERENCES unit_pendidikan(id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE wallet_accounts
  ADD CONSTRAINT wallet_accounts_tenant_unit_santri_unique
  UNIQUE (tenant_id, unit_id, santri_id);

CREATE UNIQUE INDEX IF NOT EXISTS wallet_accounts_id_tenant_unit_unique
  ON wallet_accounts(id, tenant_id, unit_id);

CREATE INDEX IF NOT EXISTS wallet_accounts_tenant_unit_status_idx
  ON wallet_accounts(tenant_id, unit_id, status);

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_id INTEGER;

UPDATE wallet_transactions wt
SET unit_id = wa.unit_id,
    santri_id = wa.santri_id
FROM wallet_accounts wa
WHERE wa.id = wt.wallet_account_id
  AND wa.tenant_id = wt.tenant_id
  AND (wt.unit_id IS NULL OR wt.santri_id IS NULL);

ALTER TABLE wallet_transactions
  ALTER COLUMN unit_id SET NOT NULL,
  ALTER COLUMN santri_id SET NOT NULL;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_unit_tenant_fkey
  FOREIGN KEY (unit_id, tenant_id)
  REFERENCES unit_pendidikan(id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_santri_tenant_fkey
  FOREIGN KEY (santri_id, tenant_id)
  REFERENCES santri(id, tenant_id)
  ON DELETE RESTRICT;

ALTER TABLE wallet_transactions
  ADD CONSTRAINT wallet_transactions_account_tenant_unit_fkey
  FOREIGN KEY (wallet_account_id, tenant_id, unit_id)
  REFERENCES wallet_accounts(id, tenant_id, unit_id)
  ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS wallet_transactions_tenant_unit_santri_created_idx
  ON wallet_transactions(tenant_id, unit_id, santri_id, created_at, id);

DO $$
DECLARE
  before_balance BIGINT;
  after_balance BIGINT;
  ledger_mismatch INTEGER;
  cross_account INTEGER;
BEGIN
  SELECT COALESCE(SUM(saldo),0) INTO before_balance FROM santri;
  SELECT COALESCE(SUM(current_balance),0) INTO after_balance FROM wallet_accounts;
  IF before_balance <> after_balance THEN
    RAISE EXCEPTION 'WALLET_PER_UNIT_TOTAL_BALANCE_MISMATCH';
  END IF;

  SELECT COUNT(*) INTO ledger_mismatch
  FROM wallet_accounts wa
  LEFT JOIN (
    SELECT wallet_account_id, SUM(CASE WHEN direction='credit' THEN amount ELSE -amount END) net
    FROM wallet_transactions
    GROUP BY wallet_account_id
  ) ledger ON ledger.wallet_account_id = wa.id
  WHERE wa.current_balance <> COALESCE(ledger.net,0);
  IF ledger_mismatch <> 0 THEN
    RAISE EXCEPTION 'WALLET_PER_UNIT_LEDGER_MISMATCH';
  END IF;

  SELECT COUNT(*) INTO cross_account
  FROM wallet_transactions wt
  JOIN wallet_accounts wa ON wa.id = wt.wallet_account_id
  WHERE wa.tenant_id <> wt.tenant_id
     OR wa.unit_id <> wt.unit_id
     OR wa.santri_id <> wt.santri_id;
  IF cross_account <> 0 THEN
    RAISE EXCEPTION 'WALLET_PER_UNIT_TRANSACTION_SCOPE_MISMATCH';
  END IF;
END $$;

COMMIT;
