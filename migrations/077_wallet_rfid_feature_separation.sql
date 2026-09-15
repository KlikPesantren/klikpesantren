-- ============================================================
-- KlikPesantren Finance 3 Phase 1 — Wallet/RFID feature separation
-- Additive only. Does not mutate wallet balances or RFID transaction amounts.
-- ============================================================

BEGIN;

INSERT INTO feature_catalog (key, label, description, is_core, sort_order)
VALUES
  ('wallet', 'Dompet Santri', 'Saldo, topup, penarikan, mutasi, dan transaksi Dompet Santri', false, 39)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  is_core = false,
  sort_order = EXCLUDED.sort_order;

-- Preserve existing access for active tenants that already had the app surface
-- available through legacy wallet virtual feature / RFID compatibility.
INSERT INTO tenant_features (tenant_id, feature_key, enabled, updated_at)
SELECT t.id, 'wallet', true, NOW()
FROM tenants t
WHERE EXISTS (
    SELECT 1
    FROM tenant_features tf
    WHERE tf.tenant_id = t.id
      AND tf.enabled = true
      AND tf.feature_key IN ('pembayaran', 'sahriyah', 'rfid')
  )
ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
  enabled = true,
  updated_at = NOW();

-- Any tenant that currently has RFID must also have wallet. RFID remains separate
-- and keeps its previous enabled/disabled state.
INSERT INTO tenant_features (tenant_id, feature_key, enabled, updated_at)
SELECT tf.tenant_id, 'wallet', true, NOW()
FROM tenant_features tf
WHERE tf.feature_key = 'rfid'
  AND tf.enabled = true
ON CONFLICT (tenant_id, feature_key) DO UPDATE SET
  enabled = true,
  updated_at = NOW();

ALTER TABLE unit_features
  DROP CONSTRAINT IF EXISTS unit_features_wallet_rfid_dependency;

-- Preserve unit access where Dompet was implicitly available with payments or RFID.
INSERT INTO unit_features (tenant_id, unit_id, feature_key, enabled, source, updated_at)
SELECT DISTINCT uf.tenant_id, uf.unit_id, 'wallet', true, 'custom', NOW()
FROM unit_features uf
JOIN tenant_features tf
  ON tf.tenant_id = uf.tenant_id
 AND tf.feature_key = 'wallet'
 AND tf.enabled = true
WHERE uf.enabled = true
  AND uf.feature_key IN ('pembayaran', 'rfid')
ON CONFLICT (tenant_id, unit_id, feature_key) DO UPDATE SET
  enabled = true,
  source = COALESCE(unit_features.source, 'custom'),
  updated_at = NOW();

-- RFID-enabled units must keep wallet enabled; this preserves existing RFID entitlement.
INSERT INTO unit_features (tenant_id, unit_id, feature_key, enabled, source, updated_at)
SELECT DISTINCT uf.tenant_id, uf.unit_id, 'wallet', true, 'custom', NOW()
FROM unit_features uf
WHERE uf.feature_key = 'rfid'
  AND uf.enabled = true
ON CONFLICT (tenant_id, unit_id, feature_key) DO UPDATE SET
  enabled = true,
  updated_at = NOW();

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_features_tenant_unit_feature
  ON unit_features (tenant_id, unit_id, feature_key);

-- Add RFID operational location attribution. Nullable for legacy rows when
-- deterministic attribution is unavailable.
ALTER TABLE merchant_rfid
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS location_resolution_status VARCHAR(30) NOT NULL DEFAULT 'resolved';

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS location_resolution_status VARCHAR(30) NOT NULL DEFAULT 'resolved';

ALTER TABLE transaksi_rfid
  ADD COLUMN IF NOT EXISTS location_unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS location_resolution_status VARCHAR(30) NOT NULL DEFAULT 'resolved';

-- Deterministic attribution: tenant has exactly one active RFID-enabled unit.
WITH single_rfid_unit AS (
  SELECT uf.tenant_id, MIN(uf.unit_id) AS unit_id
  FROM unit_features uf
  JOIN unit_pendidikan u
    ON u.id = uf.unit_id
   AND u.tenant_id = uf.tenant_id
   AND u.is_active = true
  WHERE uf.feature_key = 'rfid'
    AND uf.enabled = true
  GROUP BY uf.tenant_id
  HAVING COUNT(DISTINCT uf.unit_id) = 1
)
UPDATE merchant_rfid m
SET unit_id = s.unit_id,
    location_resolution_status = 'resolved'
FROM single_rfid_unit s
WHERE m.tenant_id = s.tenant_id
  AND m.unit_id IS NULL;

WITH single_rfid_unit AS (
  SELECT uf.tenant_id, MIN(uf.unit_id) AS unit_id
  FROM unit_features uf
  JOIN unit_pendidikan u
    ON u.id = uf.unit_id
   AND u.tenant_id = uf.tenant_id
   AND u.is_active = true
  WHERE uf.feature_key = 'rfid'
    AND uf.enabled = true
  GROUP BY uf.tenant_id
  HAVING COUNT(DISTINCT uf.unit_id) = 1
)
UPDATE devices d
SET unit_id = COALESCE(m.unit_id, s.unit_id),
    location_resolution_status = CASE WHEN COALESCE(m.unit_id, s.unit_id) IS NULL THEN 'REVIEW_REQUIRED' ELSE 'resolved' END
FROM single_rfid_unit s
LEFT JOIN merchant_rfid m
  ON m.tenant_id = s.tenant_id
WHERE d.tenant_id = s.tenant_id
  AND d.unit_id IS NULL
  AND (d.merchant_id IS NULL OR d.merchant_id = m.id);

UPDATE devices d
SET unit_id = m.unit_id,
    location_resolution_status = 'resolved'
FROM merchant_rfid m
WHERE d.tenant_id = m.tenant_id
  AND d.merchant_id = m.id
  AND d.unit_id IS NULL
  AND m.unit_id IS NOT NULL;

UPDATE transaksi_rfid tr
SET location_unit_id = COALESCE(d.unit_id, m.unit_id),
    location_resolution_status = CASE WHEN COALESCE(d.unit_id, m.unit_id) IS NULL THEN 'REVIEW_REQUIRED' ELSE 'resolved' END
FROM devices d
LEFT JOIN merchant_rfid m
  ON m.id = d.merchant_id
 AND m.tenant_id = d.tenant_id
WHERE tr.tenant_id = d.tenant_id
  AND tr.device_id = d.id
  AND tr.location_unit_id IS NULL;

UPDATE transaksi_rfid tr
SET location_unit_id = m.unit_id,
    location_resolution_status = CASE WHEN m.unit_id IS NULL THEN 'REVIEW_REQUIRED' ELSE 'resolved' END
FROM merchant_rfid m
WHERE tr.tenant_id = m.tenant_id
  AND tr.merchant_id = m.id
  AND tr.location_unit_id IS NULL;

UPDATE merchant_rfid
SET location_resolution_status = 'REVIEW_REQUIRED'
WHERE unit_id IS NULL;

UPDATE devices
SET location_resolution_status = 'REVIEW_REQUIRED'
WHERE unit_id IS NULL;

UPDATE transaksi_rfid
SET location_resolution_status = 'REVIEW_REQUIRED'
WHERE location_unit_id IS NULL;

INSERT INTO multi_unit_backfill_review (
  tenant_id, entity_type, entity_id, reason, status, detail, created_at, updated_at
)
SELECT tenant_id, 'merchant_rfid', id, 'AMBIGUOUS_RFID_LOCATION_UNIT', 'REVIEW_REQUIRED',
       jsonb_build_object('marker', 'RFID_LOCATION_ATTRIBUTION', 'source', 'migration_077'),
       NOW(), NOW()
FROM merchant_rfid
WHERE unit_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO multi_unit_backfill_review (
  tenant_id, entity_type, entity_id, reason, status, detail, created_at, updated_at
)
SELECT tenant_id, 'devices', id, 'AMBIGUOUS_RFID_LOCATION_UNIT', 'REVIEW_REQUIRED',
       jsonb_build_object('marker', 'RFID_LOCATION_ATTRIBUTION', 'source', 'migration_077'),
       NOW(), NOW()
FROM devices
WHERE unit_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO multi_unit_backfill_review (
  tenant_id, entity_type, entity_id, reason, status, detail, created_at, updated_at
)
SELECT tenant_id, 'transaksi_rfid', id, 'AMBIGUOUS_RFID_LOCATION_UNIT', 'REVIEW_REQUIRED',
       jsonb_build_object('marker', 'RFID_LOCATION_ATTRIBUTION', 'source', 'migration_077'),
       NOW(), NOW()
FROM transaksi_rfid
WHERE location_unit_id IS NULL
ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_merchant_rfid_tenant_unit
  ON merchant_rfid (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_devices_tenant_unit
  ON devices (tenant_id, unit_id);
CREATE INDEX IF NOT EXISTS idx_transaksi_rfid_tenant_location_unit
  ON transaksi_rfid (tenant_id, location_unit_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'merchant_rfid_unit_tenant_fkey'
  ) THEN
    ALTER TABLE merchant_rfid
      ADD CONSTRAINT merchant_rfid_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'devices_unit_tenant_fkey'
  ) THEN
    ALTER TABLE devices
      ADD CONSTRAINT devices_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transaksi_rfid_location_unit_tenant_fkey'
  ) THEN
    ALTER TABLE transaksi_rfid
      ADD CONSTRAINT transaksi_rfid_location_unit_tenant_fkey
      FOREIGN KEY (tenant_id, location_unit_id) REFERENCES unit_pendidikan(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE merchant_rfid VALIDATE CONSTRAINT merchant_rfid_unit_tenant_fkey;
ALTER TABLE devices VALIDATE CONSTRAINT devices_unit_tenant_fkey;
ALTER TABLE transaksi_rfid VALIDATE CONSTRAINT transaksi_rfid_location_unit_tenant_fkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM tenant_features r
    LEFT JOIN tenant_features w
      ON w.tenant_id = r.tenant_id
     AND w.feature_key = 'wallet'
     AND w.enabled = true
    WHERE r.feature_key = 'rfid'
      AND r.enabled = true
      AND w.tenant_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 077 blocked: tenant rfid enabled without wallet';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unit_features r
    LEFT JOIN unit_features w
      ON w.tenant_id = r.tenant_id
     AND w.unit_id = r.unit_id
     AND w.feature_key = 'wallet'
     AND w.enabled = true
    WHERE r.feature_key = 'rfid'
      AND r.enabled = true
      AND w.unit_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 077 blocked: unit rfid enabled without wallet';
  END IF;
END $$;

COMMIT;
