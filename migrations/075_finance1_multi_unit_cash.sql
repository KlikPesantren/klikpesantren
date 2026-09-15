-- 075: Finance 1 multi-unit cash foundation.
-- Additive only:
-- - buku_kas becomes the canonical unit cash ledger with deterministic legacy attribution.
-- - cash_accounts/cash_account_transactions become tenant-level Kas Yayasan.
-- - cash_transfers links atomic internal transfers between Unit cash and Kas Yayasan.

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_pendidikan_tenant_id_id
  ON unit_pendidikan (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_id_id
  ON users (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_buku_kas_tenant_id_id
  ON buku_kas (tenant_id, id);

ALTER TABLE buku_kas
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS transfer_id UUID,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

DO $$
DECLARE
  unresolved_tenants INTEGER;
BEGIN
  WITH buku_tenants AS (
    SELECT tenant_id
    FROM buku_kas
    GROUP BY tenant_id
  ),
  candidate_counts AS (
    SELECT bt.tenant_id, COUNT(u.id)::int AS candidates
    FROM buku_tenants bt
    LEFT JOIN unit_pendidikan u
      ON u.tenant_id = bt.tenant_id
     AND u.is_active = true
     AND UPPER(TRIM(COALESCE(u.preset_key, ''))) = 'PESANTREN'
     AND UPPER(TRIM(COALESCE(u.unit_type, ''))) = 'PESANTREN'
     AND UPPER(TRIM(COALESCE(u.kode, ''))) = 'PESANTREN'
    GROUP BY bt.tenant_id
  )
  SELECT COUNT(*) INTO unresolved_tenants
  FROM candidate_counts
  WHERE candidates <> 1;

  IF unresolved_tenants > 0 THEN
    RAISE EXCEPTION 'Migration 075 blocked: canonical PESANTREN unit is not unique for % tenant(s)', unresolved_tenants;
  END IF;
END $$;

WITH pondok_unit AS (
  SELECT tenant_id, id AS unit_id
  FROM unit_pendidikan
  WHERE is_active = true
    AND UPPER(TRIM(COALESCE(preset_key, ''))) = 'PESANTREN'
    AND UPPER(TRIM(COALESCE(unit_type, ''))) = 'PESANTREN'
    AND UPPER(TRIM(COALESCE(kode, ''))) = 'PESANTREN'
)
UPDATE buku_kas bk
SET unit_id = pu.unit_id
FROM pondok_unit pu
WHERE bk.tenant_id = pu.tenant_id
  AND bk.unit_id IS NULL;

DO $$
DECLARE
  unresolved_rows INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved_rows
  FROM buku_kas
  WHERE unit_id IS NULL;

  IF unresolved_rows > 0 THEN
    RAISE EXCEPTION 'Migration 075 blocked: % buku_kas rows still have NULL unit_id', unresolved_rows;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS cash_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_type VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_accounts_type_check CHECK (account_type IN ('foundation')),
  CONSTRAINT cash_accounts_status_check CHECK (status IN ('active','inactive')),
  CONSTRAINT cash_accounts_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT cash_accounts_tenant_type_key UNIQUE (tenant_id, account_type)
);

INSERT INTO cash_accounts (tenant_id, account_type, name)
SELECT t.id, 'foundation', 'Kas Yayasan'
FROM tenants t
ON CONFLICT (tenant_id, account_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS cash_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  direction VARCHAR(30) NOT NULL,
  source_unit_id INTEGER,
  destination_unit_id INTEGER,
  foundation_account_id UUID NOT NULL,
  amount BIGINT NOT NULL,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  keterangan TEXT,
  actor_user_id INTEGER,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_transfers_direction_check CHECK (direction IN ('unit_to_foundation','foundation_to_unit')),
  CONSTRAINT cash_transfers_amount_check CHECK (amount > 0),
  CONSTRAINT cash_transfers_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT cash_transfers_direction_semantics_check CHECK (
    (direction = 'unit_to_foundation' AND source_unit_id IS NOT NULL AND destination_unit_id IS NULL)
    OR
    (direction = 'foundation_to_unit' AND source_unit_id IS NULL AND destination_unit_id IS NOT NULL)
  ),
  CONSTRAINT cash_transfers_foundation_fkey
    FOREIGN KEY (tenant_id, foundation_account_id) REFERENCES cash_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transfers_source_unit_fkey
    FOREIGN KEY (tenant_id, source_unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transfers_destination_unit_fkey
    FOREIGN KEY (tenant_id, destination_unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_transfers_actor_user_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_transfers_tenant_idempotency
  ON cash_transfers (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_account_transactions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_account_id UUID NOT NULL,
  transfer_id UUID,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jenis VARCHAR(20) NOT NULL,
  kategori VARCHAR(100) NOT NULL,
  keterangan TEXT,
  nominal BIGINT NOT NULL,
  petugas VARCHAR(100),
  actor_user_id INTEGER,
  source VARCHAR(40) NOT NULL DEFAULT 'manual',
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cash_account_transactions_jenis_check CHECK (jenis IN ('Masuk','Keluar')),
  CONSTRAINT cash_account_transactions_nominal_check CHECK (nominal > 0),
  CONSTRAINT cash_account_transactions_account_fkey
    FOREIGN KEY (tenant_id, cash_account_id) REFERENCES cash_accounts(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_account_transactions_transfer_fkey
    FOREIGN KEY (tenant_id, transfer_id) REFERENCES cash_transfers(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT cash_account_transactions_actor_user_fkey
    FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_account_transactions_tenant_idempotency
  ON cash_account_transactions (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buku_kas_unit_tenant_fkey') THEN
    ALTER TABLE buku_kas ADD CONSTRAINT buku_kas_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buku_kas_actor_user_fkey') THEN
    ALTER TABLE buku_kas ADD CONSTRAINT buku_kas_actor_user_fkey
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'buku_kas_transfer_fkey') THEN
    ALTER TABLE buku_kas ADD CONSTRAINT buku_kas_transfer_fkey
      FOREIGN KEY (tenant_id, transfer_id) REFERENCES cash_transfers(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE buku_kas ALTER COLUMN unit_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_buku_kas_tenant_unit_tanggal
  ON buku_kas (tenant_id, unit_id, tanggal DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_buku_kas_tenant_transfer
  ON buku_kas (tenant_id, transfer_id)
  WHERE transfer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_buku_kas_tenant_idempotency
  ON buku_kas (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_account_transactions_tenant_account_tanggal
  ON cash_account_transactions (tenant_id, cash_account_id, tanggal DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_cash_account_transactions_tenant_transfer
  ON cash_account_transactions (tenant_id, transfer_id)
  WHERE transfer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_transfers_tenant_created
  ON cash_transfers (tenant_id, created_at DESC);

ALTER TABLE buku_kas VALIDATE CONSTRAINT buku_kas_unit_tenant_fkey;
ALTER TABLE buku_kas VALIDATE CONSTRAINT buku_kas_actor_user_fkey;
ALTER TABLE buku_kas VALIDATE CONSTRAINT buku_kas_transfer_fkey;

INSERT INTO permissions (key, label, grup) VALUES
  ('kas_yayasan.view', 'Lihat Kas Yayasan', 'kas_yayasan'),
  ('kas_yayasan.manage', 'Kelola Kas Yayasan', 'kas_yayasan'),
  ('cash_transfer.manage', 'Transfer Antar Kas', 'kas_yayasan')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'superadmin'
  AND p.key IN ('kas_yayasan.view','kas_yayasan.manage','cash_transfer.manage')
ON CONFLICT DO NOTHING;
