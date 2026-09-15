-- 074: Operational multi-unit event scope.
-- Additive snapshot columns for Perizinan, Pelanggaran, Kesehatan, and Pengumuman scope semantics.

CREATE UNIQUE INDEX IF NOT EXISTS uq_perizinan_tenant_id_id
  ON perizinan (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pelanggaran_tenant_id_id
  ON pelanggaran (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kesehatan_santri_tenant_id_id
  ON kesehatan_santri (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pengumuman_tenant_id_id
  ON pengumuman (tenant_id, id);

ALTER TABLE perizinan
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

ALTER TABLE pelanggaran
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

ALTER TABLE kesehatan_santri
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

ALTER TABLE pengumuman
  ADD COLUMN IF NOT EXISTS scope_type VARCHAR(20);

UPDATE pengumuman
SET scope_type = CASE WHEN unit_id IS NULL THEN 'tenant' ELSE 'unit' END
WHERE scope_type IS NULL;

ALTER TABLE pengumuman
  ALTER COLUMN scope_type SET DEFAULT 'unit',
  ALTER COLUMN scope_type SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pengumuman_scope_type_check') THEN
    ALTER TABLE pengumuman
      ADD CONSTRAINT pengumuman_scope_type_check
      CHECK (scope_type IN ('tenant','unit'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pengumuman_scope_unit_check') THEN
    ALTER TABLE pengumuman
      ADD CONSTRAINT pengumuman_scope_unit_check
      CHECK ((scope_type = 'tenant' AND unit_id IS NULL) OR (scope_type = 'unit' AND unit_id IS NOT NULL));
  END IF;
END $$;

WITH deterministic AS (
  SELECT tenant_id, santri_id, MIN(id) AS santri_unit_id, MIN(unit_id) AS unit_id
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
  HAVING COUNT(DISTINCT unit_id) = 1
)
UPDATE perizinan p
SET unit_id = deterministic.unit_id,
    santri_unit_id = deterministic.santri_unit_id
FROM deterministic
WHERE p.tenant_id = deterministic.tenant_id
  AND p.santri_id = deterministic.santri_id
  AND p.unit_id IS NULL;

WITH deterministic AS (
  SELECT tenant_id, santri_id, MIN(id) AS santri_unit_id, MIN(unit_id) AS unit_id
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
  HAVING COUNT(DISTINCT unit_id) = 1
)
UPDATE pelanggaran p
SET unit_id = deterministic.unit_id,
    santri_unit_id = deterministic.santri_unit_id
FROM deterministic
WHERE p.tenant_id = deterministic.tenant_id
  AND p.santri_id = deterministic.santri_id
  AND p.unit_id IS NULL;

WITH deterministic AS (
  SELECT tenant_id, santri_id, MIN(id) AS santri_unit_id, MIN(unit_id) AS unit_id
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
  HAVING COUNT(DISTINCT unit_id) = 1
)
UPDATE kesehatan_santri k
SET unit_id = deterministic.unit_id,
    santri_unit_id = deterministic.santri_unit_id
FROM deterministic
WHERE k.tenant_id = deterministic.tenant_id
  AND k.santri_id = deterministic.santri_id
  AND k.unit_id IS NULL;

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT entity.tenant_id,
       entity.entity_type,
       entity.entity_id,
       'AMBIGUOUS_OPERATIONAL_UNIT',
       jsonb_build_object(
         'santri_id', entity.santri_id,
         'active_unit_count', COALESCE(member_counts.unit_count, 0),
         'migration', '074'
       )
FROM (
  SELECT tenant_id, 'perizinan' AS entity_type, id AS entity_id, santri_id FROM perizinan WHERE unit_id IS NULL
  UNION ALL
  SELECT tenant_id, 'pelanggaran' AS entity_type, id AS entity_id, santri_id FROM pelanggaran WHERE unit_id IS NULL
  UNION ALL
  SELECT tenant_id, 'kesehatan_santri' AS entity_type, id AS entity_id, santri_id FROM kesehatan_santri WHERE unit_id IS NULL
) entity
LEFT JOIN (
  SELECT tenant_id, santri_id, COUNT(DISTINCT unit_id) AS unit_count
  FROM santri_units
  WHERE status = 'active' AND left_at IS NULL
  GROUP BY tenant_id, santri_id
) member_counts
  ON member_counts.tenant_id = entity.tenant_id
 AND member_counts.santri_id = entity.santri_id
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

DO $$
DECLARE
  unresolved_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO unresolved_count
  FROM (
    SELECT id FROM perizinan WHERE unit_id IS NULL
    UNION ALL
    SELECT id FROM pelanggaran WHERE unit_id IS NULL
    UNION ALL
    SELECT id FROM kesehatan_santri WHERE unit_id IS NULL
  ) unresolved;

  IF unresolved_count > 0 THEN
    RAISE EXCEPTION 'Migration 074 blocked: % operational event rows require review', unresolved_count;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perizinan_unit_tenant_fkey') THEN
    ALTER TABLE perizinan ADD CONSTRAINT perizinan_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'perizinan_santri_unit_tenant_fkey') THEN
    ALTER TABLE perizinan ADD CONSTRAINT perizinan_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pelanggaran_unit_tenant_fkey') THEN
    ALTER TABLE pelanggaran ADD CONSTRAINT pelanggaran_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pelanggaran_santri_unit_tenant_fkey') THEN
    ALTER TABLE pelanggaran ADD CONSTRAINT pelanggaran_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kesehatan_santri_unit_tenant_fkey') THEN
    ALTER TABLE kesehatan_santri ADD CONSTRAINT kesehatan_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'kesehatan_santri_santri_unit_tenant_fkey') THEN
    ALTER TABLE kesehatan_santri ADD CONSTRAINT kesehatan_santri_santri_unit_tenant_fkey
      FOREIGN KEY (tenant_id, santri_unit_id) REFERENCES santri_units(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pengumuman_unit_tenant_fkey') THEN
    ALTER TABLE pengumuman ADD CONSTRAINT pengumuman_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE perizinan ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE perizinan ALTER COLUMN santri_unit_id SET NOT NULL;
ALTER TABLE pelanggaran ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE pelanggaran ALTER COLUMN santri_unit_id SET NOT NULL;
ALTER TABLE kesehatan_santri ALTER COLUMN unit_id SET NOT NULL;
ALTER TABLE kesehatan_santri ALTER COLUMN santri_unit_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_perizinan_tenant_unit_status
  ON perizinan (tenant_id, unit_id, status, tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_pelanggaran_tenant_unit_tanggal
  ON pelanggaran (tenant_id, unit_id, tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_kesehatan_santri_tenant_unit_created
  ON kesehatan_santri (tenant_id, unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pengumuman_tenant_scope_unit
  ON pengumuman (tenant_id, scope_type, unit_id, created_at DESC);

ALTER TABLE perizinan VALIDATE CONSTRAINT perizinan_unit_tenant_fkey;
ALTER TABLE perizinan VALIDATE CONSTRAINT perizinan_santri_unit_tenant_fkey;
ALTER TABLE pelanggaran VALIDATE CONSTRAINT pelanggaran_unit_tenant_fkey;
ALTER TABLE pelanggaran VALIDATE CONSTRAINT pelanggaran_santri_unit_tenant_fkey;
ALTER TABLE kesehatan_santri VALIDATE CONSTRAINT kesehatan_santri_unit_tenant_fkey;
ALTER TABLE kesehatan_santri VALIDATE CONSTRAINT kesehatan_santri_santri_unit_tenant_fkey;
ALTER TABLE pengumuman VALIDATE CONSTRAINT pengumuman_unit_tenant_fkey;
