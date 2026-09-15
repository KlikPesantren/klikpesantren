-- 076: Finance 2 Pembayaran + Sahriyah unit ownership and explicit settlement.
-- Additive only. Legacy business fields and legacy Buku Kas Sahriyah postings are preserved.

CREATE UNIQUE INDEX IF NOT EXISTS uq_pembayaran_tenant_id_id ON pembayaran (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pembayaran_detail_tenant_id_id ON pembayaran_detail (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_jenis_tagihan_tenant_id_id ON jenis_tagihan (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tagihan_sahriyah_tenant_id_id ON tagihan_sahriyah (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pembayaran_sahriyah_tenant_id_id ON pembayaran_sahriyah (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sahriyah_setting_tenant_id_id ON sahriyah_setting (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_cash_account_transactions_tenant_id_id ON cash_account_transactions (tenant_id, id);

ALTER TABLE jenis_tagihan
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_destination VARCHAR(30) NOT NULL DEFAULT 'unit_cash',
  ADD COLUMN IF NOT EXISTS settlement_cash_account_id UUID,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'legacy';

ALTER TABLE pembayaran
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_destination VARCHAR(30) NOT NULL DEFAULT 'unit_cash',
  ADD COLUMN IF NOT EXISTS settlement_buku_kas_id INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_cash_account_transaction_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'legacy';

ALTER TABLE pembayaran_detail
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_destination VARCHAR(30) NOT NULL DEFAULT 'unit_cash',
  ADD COLUMN IF NOT EXISTS settlement_buku_kas_id INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_cash_account_transaction_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'legacy';

ALTER TABLE sahriyah_setting
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_destination VARCHAR(30) NOT NULL DEFAULT 'unit_cash',
  ADD COLUMN IF NOT EXISTS settlement_cash_account_id UUID,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS legacy_resolution_status VARCHAR(30) NOT NULL DEFAULT 'resolved';

ALTER TABLE tagihan_sahriyah
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_destination VARCHAR(30) NOT NULL DEFAULT 'unit_cash',
  ADD COLUMN IF NOT EXISTS settlement_buku_kas_id INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_cash_account_transaction_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS legacy_resolution_status VARCHAR(30) NOT NULL DEFAULT 'resolved';

ALTER TABLE pembayaran_sahriyah
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_destination VARCHAR(30) NOT NULL DEFAULT 'unit_cash',
  ADD COLUMN IF NOT EXISTS settlement_buku_kas_id INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_cash_account_transaction_id BIGINT,
  ADD COLUMN IF NOT EXISTS settlement_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'legacy';

ALTER TABLE sahriyah_setting DROP CONSTRAINT IF EXISTS sahriyah_setting_santri_id_key;
ALTER TABLE sahriyah_setting DROP CONSTRAINT IF EXISTS sahriyah_setting_tenant_santri_key;
DROP INDEX IF EXISTS sahriyah_setting_santri_id_key;
DROP INDEX IF EXISTS sahriyah_setting_tenant_santri_key;

WITH deterministic AS (
  SELECT tenant_id, santri_id, MIN(id) AS santri_unit_id, MIN(unit_id) AS unit_id
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
  HAVING COUNT(DISTINCT unit_id) = 1
)
UPDATE pembayaran p
SET unit_id = d.unit_id, santri_unit_id = d.santri_unit_id
FROM deterministic d
WHERE p.tenant_id = d.tenant_id AND p.santri_id = d.santri_id AND p.unit_id IS NULL;

WITH historical_deterministic AS (
  SELECT
    su.tenant_id,
    su.santri_id,
    MIN(su.id) AS santri_unit_id,
    MIN(su.unit_id) AS unit_id
  FROM santri_units su
  JOIN santri s
    ON s.id = su.santri_id
   AND s.tenant_id = su.tenant_id
  LEFT JOIN kelas k
    ON k.id = s.kelas_id
   AND k.tenant_id = s.tenant_id
  GROUP BY su.tenant_id, su.santri_id
  HAVING COUNT(DISTINCT su.unit_id) = 1
     AND (COUNT(DISTINCT k.unit_id) = 0 OR MIN(k.unit_id) = MIN(su.unit_id))
)
UPDATE pembayaran p
SET unit_id = d.unit_id, santri_unit_id = d.santri_unit_id
FROM historical_deterministic d
WHERE p.tenant_id = d.tenant_id AND p.santri_id = d.santri_id AND p.unit_id IS NULL;

UPDATE pembayaran_detail pd
SET unit_id = p.unit_id,
    santri_unit_id = p.santri_unit_id,
    settlement_destination = p.settlement_destination
FROM pembayaran p
WHERE pd.tenant_id = p.tenant_id AND pd.pembayaran_id = p.id AND pd.unit_id IS NULL;

WITH deterministic AS (
  SELECT tenant_id, santri_id, MIN(id) AS santri_unit_id, MIN(unit_id) AS unit_id
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
  HAVING COUNT(DISTINCT unit_id) = 1
)
UPDATE sahriyah_setting ss
SET unit_id = d.unit_id, santri_unit_id = d.santri_unit_id
FROM deterministic d
WHERE ss.tenant_id = d.tenant_id AND ss.santri_id = d.santri_id AND ss.unit_id IS NULL;

WITH historical_deterministic AS (
  SELECT
    su.tenant_id,
    su.santri_id,
    MIN(su.id) AS santri_unit_id,
    MIN(su.unit_id) AS unit_id
  FROM santri_units su
  JOIN santri s
    ON s.id = su.santri_id
   AND s.tenant_id = su.tenant_id
  LEFT JOIN kelas k
    ON k.id = s.kelas_id
   AND k.tenant_id = s.tenant_id
  GROUP BY su.tenant_id, su.santri_id
  HAVING COUNT(DISTINCT su.unit_id) = 1
     AND (COUNT(DISTINCT k.unit_id) = 0 OR MIN(k.unit_id) = MIN(su.unit_id))
)
UPDATE sahriyah_setting ss
SET unit_id = d.unit_id, santri_unit_id = d.santri_unit_id
FROM historical_deterministic d
WHERE ss.tenant_id = d.tenant_id AND ss.santri_id = d.santri_id AND ss.unit_id IS NULL;

WITH deterministic AS (
  SELECT tenant_id, santri_id, MIN(id) AS santri_unit_id, MIN(unit_id) AS unit_id
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
  HAVING COUNT(DISTINCT unit_id) = 1
)
UPDATE tagihan_sahriyah t
SET unit_id = d.unit_id, santri_unit_id = d.santri_unit_id
FROM deterministic d
WHERE t.tenant_id = d.tenant_id AND t.santri_id = d.santri_id AND t.unit_id IS NULL;

WITH historical_deterministic AS (
  SELECT
    su.tenant_id,
    su.santri_id,
    MIN(su.id) AS santri_unit_id,
    MIN(su.unit_id) AS unit_id
  FROM santri_units su
  JOIN santri s
    ON s.id = su.santri_id
   AND s.tenant_id = su.tenant_id
  LEFT JOIN kelas k
    ON k.id = s.kelas_id
   AND k.tenant_id = s.tenant_id
  GROUP BY su.tenant_id, su.santri_id
  HAVING COUNT(DISTINCT su.unit_id) = 1
     AND (COUNT(DISTINCT k.unit_id) = 0 OR MIN(k.unit_id) = MIN(su.unit_id))
)
UPDATE tagihan_sahriyah t
SET unit_id = d.unit_id, santri_unit_id = d.santri_unit_id
FROM historical_deterministic d
WHERE t.tenant_id = d.tenant_id AND t.santri_id = d.santri_id AND t.unit_id IS NULL;

UPDATE pembayaran_sahriyah ps
SET unit_id = t.unit_id,
    santri_unit_id = t.santri_unit_id,
    settlement_destination = t.settlement_destination
FROM tagihan_sahriyah t
WHERE ps.tenant_id = t.tenant_id AND ps.tagihan_id = t.id AND ps.unit_id IS NULL;

UPDATE sahriyah_setting
SET legacy_resolution_status = 'REVIEW_REQUIRED'
WHERE unit_id IS NULL
  AND (tenant_id, id) IN (
    (1, 1), (1, 2), (1, 3), (1, 30),
    (1, 31), (1, 32), (1, 37)
  );

UPDATE tagihan_sahriyah
SET legacy_resolution_status = 'REVIEW_REQUIRED'
WHERE unit_id IS NULL
  AND (tenant_id, id) IN ((1, 312));

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT entity.tenant_id, entity.entity_type, entity.entity_id, 'AMBIGUOUS_FINANCE2_UNIT',
       jsonb_build_object('santri_id', entity.santri_id, 'migration', '076', 'classification', entity.classification)
FROM (
  SELECT tenant_id, 'pembayaran' AS entity_type, id AS entity_id, santri_id, 'UNKNOWN_UNRESOLVED' AS classification
  FROM pembayaran WHERE unit_id IS NULL
  UNION ALL
  SELECT tenant_id, 'sahriyah_setting', id, santri_id,
         CASE WHEN (tenant_id, id) IN ((1, 1), (1, 2), (1, 3), (1, 30), (1, 31), (1, 32), (1, 37))
              THEN 'APPROVED_LEGACY_ORPHAN' ELSE 'UNKNOWN_UNRESOLVED' END
  FROM sahriyah_setting WHERE unit_id IS NULL
  UNION ALL
  SELECT tenant_id, 'tagihan_sahriyah', id, santri_id,
         CASE WHEN (tenant_id, id) IN ((1, 312))
              THEN 'APPROVED_LEGACY_ORPHAN' ELSE 'UNKNOWN_UNRESOLVED' END
  FROM tagihan_sahriyah WHERE unit_id IS NULL
) entity
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

DO $$
DECLARE unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved_count
  FROM (
    SELECT id FROM pembayaran WHERE unit_id IS NULL
    UNION ALL
    SELECT id FROM sahriyah_setting
    WHERE unit_id IS NULL
      AND (tenant_id, id) NOT IN (
        (1, 1), (1, 2), (1, 3), (1, 30),
        (1, 31), (1, 32), (1, 37)
      )
    UNION ALL
    SELECT id FROM tagihan_sahriyah
    WHERE unit_id IS NULL
      AND (tenant_id, id) NOT IN ((1, 312))
  ) unresolved;
  IF unresolved_count > 0 THEN
    RAISE EXCEPTION 'Migration 076 blocked: % Finance 2 rows require review', unresolved_count;
  END IF;
END $$;

ALTER TABLE pembayaran ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE pembayaran ALTER COLUMN santri_unit_id SET NOT NULL;
ALTER TABLE pembayaran_detail ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE pembayaran_detail ALTER COLUMN santri_unit_id SET NOT NULL;
ALTER TABLE pembayaran_sahriyah ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE pembayaran_sahriyah ALTER COLUMN santri_unit_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_pembayaran_settlement_destination_check') THEN
    ALTER TABLE pembayaran ADD CONSTRAINT finance2_pembayaran_settlement_destination_check CHECK (settlement_destination IN ('unit_cash','foundation_cash','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_pembayaran_detail_settlement_destination_check') THEN
    ALTER TABLE pembayaran_detail ADD CONSTRAINT finance2_pembayaran_detail_settlement_destination_check CHECK (settlement_destination IN ('unit_cash','foundation_cash','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_jenis_tagihan_settlement_destination_check') THEN
    ALTER TABLE jenis_tagihan ADD CONSTRAINT finance2_jenis_tagihan_settlement_destination_check CHECK (settlement_destination IN ('unit_cash','foundation_cash','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_sahriyah_setting_settlement_destination_check') THEN
    ALTER TABLE sahriyah_setting ADD CONSTRAINT finance2_sahriyah_setting_settlement_destination_check CHECK (settlement_destination IN ('unit_cash','foundation_cash','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_tagihan_sahriyah_settlement_destination_check') THEN
    ALTER TABLE tagihan_sahriyah ADD CONSTRAINT finance2_tagihan_sahriyah_settlement_destination_check CHECK (settlement_destination IN ('unit_cash','foundation_cash','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_pembayaran_sahriyah_settlement_destination_check') THEN
    ALTER TABLE pembayaran_sahriyah ADD CONSTRAINT finance2_pembayaran_sahriyah_settlement_destination_check CHECK (settlement_destination IN ('unit_cash','foundation_cash','none'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_sahriyah_setting_unit_required_for_active_check') THEN
    ALTER TABLE sahriyah_setting ADD CONSTRAINT finance2_sahriyah_setting_unit_required_for_active_check
      CHECK (
        legacy_resolution_status = 'REVIEW_REQUIRED'
        OR (unit_id IS NOT NULL AND santri_unit_id IS NOT NULL)
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'finance2_tagihan_sahriyah_unit_required_for_active_check') THEN
    ALTER TABLE tagihan_sahriyah ADD CONSTRAINT finance2_tagihan_sahriyah_unit_required_for_active_check
      CHECK (
        legacy_resolution_status = 'REVIEW_REQUIRED'
        OR (unit_id IS NOT NULL AND santri_unit_id IS NOT NULL)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_unit_tenant_fkey') THEN
    ALTER TABLE pembayaran ADD CONSTRAINT pembayaran_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_santri_unit_tenant_fkey') THEN
    ALTER TABLE pembayaran ADD CONSTRAINT pembayaran_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_detail_buku_kas_fkey') THEN
    ALTER TABLE pembayaran_detail ADD CONSTRAINT pembayaran_detail_buku_kas_fkey
      FOREIGN KEY (tenant_id, settlement_buku_kas_id) REFERENCES buku_kas(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_detail_unit_tenant_fkey') THEN
    ALTER TABLE pembayaran_detail ADD CONSTRAINT pembayaran_detail_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_detail_santri_unit_tenant_fkey') THEN
    ALTER TABLE pembayaran_detail ADD CONSTRAINT pembayaran_detail_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_detail_cash_account_transaction_fkey') THEN
    ALTER TABLE pembayaran_detail ADD CONSTRAINT pembayaran_detail_cash_account_transaction_fkey
      FOREIGN KEY (tenant_id, settlement_cash_account_transaction_id) REFERENCES cash_account_transactions(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'jenis_tagihan_unit_tenant_fkey') THEN
    ALTER TABLE jenis_tagihan ADD CONSTRAINT jenis_tagihan_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sahriyah_setting_unit_tenant_fkey') THEN
    ALTER TABLE sahriyah_setting ADD CONSTRAINT sahriyah_setting_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sahriyah_setting_santri_unit_tenant_fkey') THEN
    ALTER TABLE sahriyah_setting ADD CONSTRAINT sahriyah_setting_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tagihan_sahriyah_unit_tenant_fkey') THEN
    ALTER TABLE tagihan_sahriyah ADD CONSTRAINT tagihan_sahriyah_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tagihan_sahriyah_santri_unit_tenant_fkey') THEN
    ALTER TABLE tagihan_sahriyah ADD CONSTRAINT tagihan_sahriyah_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_sahriyah_buku_kas_fkey') THEN
    ALTER TABLE pembayaran_sahriyah ADD CONSTRAINT pembayaran_sahriyah_buku_kas_fkey
      FOREIGN KEY (tenant_id, settlement_buku_kas_id) REFERENCES buku_kas(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_sahriyah_unit_tenant_fkey') THEN
    ALTER TABLE pembayaran_sahriyah ADD CONSTRAINT pembayaran_sahriyah_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_sahriyah_santri_unit_tenant_fkey') THEN
    ALTER TABLE pembayaran_sahriyah ADD CONSTRAINT pembayaran_sahriyah_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pembayaran_sahriyah_cash_account_transaction_fkey') THEN
    ALTER TABLE pembayaran_sahriyah ADD CONSTRAINT pembayaran_sahriyah_cash_account_transaction_fkey
      FOREIGN KEY (tenant_id, settlement_cash_account_transaction_id) REFERENCES cash_account_transactions(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pembayaran_tenant_unit_santri_jenis_period
  ON pembayaran (tenant_id, unit_id, santri_id, jenis_tagihan_id, bulan, tahun)
  WHERE jenis_tagihan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pembayaran_tenant_unit_period ON pembayaran (tenant_id, unit_id, tahun, bulan);
CREATE INDEX IF NOT EXISTS idx_pembayaran_detail_tenant_unit ON pembayaran_detail (tenant_id, unit_id, pembayaran_id);
CREATE INDEX IF NOT EXISTS idx_jenis_tagihan_tenant_unit ON jenis_tagihan (tenant_id, unit_id, nama_tagihan);
CREATE INDEX IF NOT EXISTS idx_sahriyah_setting_tenant_unit ON sahriyah_setting (tenant_id, unit_id, santri_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sahriyah_setting_tenant_unit_santri
  ON sahriyah_setting (tenant_id, unit_id, santri_id)
  WHERE unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tagihan_sahriyah_tenant_unit_period ON tagihan_sahriyah (tenant_id, unit_id, tahun, bulan);
CREATE INDEX IF NOT EXISTS idx_pembayaran_sahriyah_tenant_unit ON pembayaran_sahriyah (tenant_id, unit_id, tagihan_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pembayaran_detail_settlement_idempotency
  ON pembayaran_detail (tenant_id, settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_pembayaran_sahriyah_settlement_idempotency
  ON pembayaran_sahriyah (tenant_id, settlement_idempotency_key)
  WHERE settlement_idempotency_key IS NOT NULL;

ALTER TABLE pembayaran VALIDATE CONSTRAINT pembayaran_unit_tenant_fkey;
ALTER TABLE pembayaran VALIDATE CONSTRAINT pembayaran_santri_unit_tenant_fkey;
ALTER TABLE pembayaran_detail VALIDATE CONSTRAINT pembayaran_detail_buku_kas_fkey;
ALTER TABLE pembayaran_detail VALIDATE CONSTRAINT pembayaran_detail_unit_tenant_fkey;
ALTER TABLE pembayaran_detail VALIDATE CONSTRAINT pembayaran_detail_santri_unit_tenant_fkey;
ALTER TABLE pembayaran_detail VALIDATE CONSTRAINT pembayaran_detail_cash_account_transaction_fkey;
ALTER TABLE jenis_tagihan VALIDATE CONSTRAINT jenis_tagihan_unit_tenant_fkey;
ALTER TABLE sahriyah_setting VALIDATE CONSTRAINT sahriyah_setting_unit_tenant_fkey;
ALTER TABLE sahriyah_setting VALIDATE CONSTRAINT sahriyah_setting_santri_unit_tenant_fkey;
ALTER TABLE tagihan_sahriyah VALIDATE CONSTRAINT tagihan_sahriyah_unit_tenant_fkey;
ALTER TABLE tagihan_sahriyah VALIDATE CONSTRAINT tagihan_sahriyah_santri_unit_tenant_fkey;
ALTER TABLE pembayaran_sahriyah VALIDATE CONSTRAINT pembayaran_sahriyah_buku_kas_fkey;
ALTER TABLE pembayaran_sahriyah VALIDATE CONSTRAINT pembayaran_sahriyah_unit_tenant_fkey;
ALTER TABLE pembayaran_sahriyah VALIDATE CONSTRAINT pembayaran_sahriyah_santri_unit_tenant_fkey;
ALTER TABLE pembayaran_sahriyah VALIDATE CONSTRAINT pembayaran_sahriyah_cash_account_transaction_fkey;
