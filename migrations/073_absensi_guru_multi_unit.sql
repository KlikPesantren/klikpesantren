-- 073: Absensi Guru multi-unit event scope.
-- Additive unit snapshot for teacher attendance. Legacy guru.unit_id stays compatibility-only.

ALTER TABLE absensi_guru
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS guru_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absensi_guru_unit_tenant_fkey'
  ) THEN
    ALTER TABLE absensi_guru
      ADD CONSTRAINT absensi_guru_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absensi_guru_guru_unit_tenant_fkey'
  ) THEN
    ALTER TABLE absensi_guru
      ADD CONSTRAINT absensi_guru_guru_unit_tenant_fkey
      FOREIGN KEY (tenant_id, guru_unit_id) REFERENCES guru_units(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absensi_guru_actor_user_fkey'
  ) THEN
    ALTER TABLE absensi_guru
      ADD CONSTRAINT absensi_guru_actor_user_fkey
      FOREIGN KEY (actor_user_id) REFERENCES users(id)
      ON DELETE SET NULL NOT VALID;
  END IF;
END $$;

UPDATE absensi_guru ag
SET unit_id = deterministic.unit_id,
    guru_unit_id = deterministic.guru_unit_id
FROM (
  SELECT tenant_id, guru_id, MIN(id) AS guru_unit_id, MIN(unit_id) AS unit_id
  FROM guru_units
  WHERE status = 'active'
    AND left_at IS NULL
  GROUP BY tenant_id, guru_id
  HAVING COUNT(DISTINCT unit_id) = 1
) deterministic
WHERE ag.tenant_id = deterministic.tenant_id
  AND ag.guru_id = deterministic.guru_id
  AND ag.unit_id IS NULL;

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT ag.tenant_id,
       'absensi_guru',
       ag.id,
       'AMBIGUOUS_ABSENSI_GURU_UNIT',
       jsonb_build_object(
         'guru_id', ag.guru_id,
         'bulan', ag.bulan,
         'tahun', ag.tahun,
         'active_unit_count', COALESCE(member_counts.unit_count, 0)
       )
FROM absensi_guru ag
LEFT JOIN (
  SELECT tenant_id, guru_id, COUNT(DISTINCT unit_id) AS unit_count
  FROM guru_units
  WHERE status = 'active'
    AND left_at IS NULL
  GROUP BY tenant_id, guru_id
) member_counts
  ON member_counts.tenant_id = ag.tenant_id
 AND member_counts.guru_id = ag.guru_id
WHERE ag.unit_id IS NULL
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absensi_guru_unique') THEN
    ALTER TABLE absensi_guru DROP CONSTRAINT absensi_guru_unique;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absensi_guru_guru_id_bulan_tahun_key') THEN
    ALTER TABLE absensi_guru DROP CONSTRAINT absensi_guru_guru_id_bulan_tahun_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absensi_guru_guru_bulan_tahun_key') THEN
    ALTER TABLE absensi_guru DROP CONSTRAINT absensi_guru_guru_bulan_tahun_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_absensi_guru_tenant_unit_period
  ON absensi_guru (tenant_id, unit_id, tahun, bulan);

CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_guru_tenant_unit_guru_period
  ON absensi_guru (tenant_id, unit_id, guru_id, bulan, tahun)
  WHERE unit_id IS NOT NULL;
