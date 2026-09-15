-- 072: Academic multi-unit scope foundation.
-- Additive only. Legacy guru.unit_id and santri.kelas_id remain compatibility fields.

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_pendidikan_tenant_id_id
  ON unit_pendidikan (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guru_tenant_id_id
  ON guru (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_tenant_id_id
  ON santri (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mata_pelajaran_tenant_id_id
  ON mata_pelajaran (tenant_id, id);

CREATE TABLE IF NOT EXISTS guru_units (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  guru_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  joined_at DATE,
  left_at DATE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guru_units_status_check CHECK (status IN ('active','inactive','left')),
  CONSTRAINT guru_units_dates_check CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at),
  CONSTRAINT guru_units_guru_tenant_fkey FOREIGN KEY (tenant_id, guru_id)
    REFERENCES guru(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT guru_units_unit_tenant_fkey FOREIGN KEY (tenant_id, unit_id)
    REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_guru_units_tenant_id_id
  ON guru_units (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_guru_units_active
  ON guru_units (tenant_id, guru_id, unit_id)
  WHERE status = 'active' AND left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_guru_units_primary
  ON guru_units (tenant_id, guru_id)
  WHERE status = 'active' AND left_at IS NULL AND is_primary = true;
CREATE INDEX IF NOT EXISTS idx_guru_units_unit_active
  ON guru_units (tenant_id, unit_id, guru_id)
  WHERE status = 'active' AND left_at IS NULL;

INSERT INTO guru_units (
  tenant_id, guru_id, unit_id, status, joined_at, is_primary, metadata
)
SELECT
  g.tenant_id,
  g.id,
  g.unit_id,
  CASE
    WHEN LOWER(TRIM(COALESCE(g.status, 'Aktif'))) IN ('aktif','active','') THEN 'active'
    ELSE 'inactive'
  END,
  g.tanggal_masuk,
  true,
  jsonb_build_object('backfill_source', 'guru.unit_id', 'migration', '072')
FROM guru g
JOIN unit_pendidikan u
  ON u.id = g.unit_id
 AND u.tenant_id = g.tenant_id
WHERE g.unit_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE mata_pelajaran
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mata_pelajaran_unit_tenant_fkey'
  ) THEN
    ALTER TABLE mata_pelajaran
      ADD CONSTRAINT mata_pelajaran_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

UPDATE mata_pelajaran mp
SET unit_id = inferred.unit_id,
    metadata = COALESCE(mp.metadata, '{}'::jsonb) || jsonb_build_object('backfill_source', 'kelas_mata_pelajaran', 'migration', '072')
FROM (
  SELECT km.tenant_id, km.mata_pelajaran_id, MIN(k.unit_id) AS unit_id
  FROM kelas_mata_pelajaran km
  JOIN kelas k ON k.id = km.kelas_id AND k.tenant_id = km.tenant_id
  GROUP BY km.tenant_id, km.mata_pelajaran_id
  HAVING COUNT(DISTINCT k.unit_id) = 1
) inferred
WHERE mp.tenant_id = inferred.tenant_id
  AND mp.id = inferred.mata_pelajaran_id
  AND mp.unit_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_mata_pelajaran_tenant_unit
  ON mata_pelajaran (tenant_id, unit_id, aktif);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mata_pelajaran_tenant_unit_nama
  ON mata_pelajaran (tenant_id, unit_id, LOWER(TRIM(nama)))
  WHERE unit_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mata_pelajaran_tenant_nama_key'
  ) THEN
    ALTER TABLE mata_pelajaran DROP CONSTRAINT mata_pelajaran_tenant_nama_key;
  END IF;
END $$;

ALTER TABLE kelas_mata_pelajaran
  ADD COLUMN IF NOT EXISTS unit_id INTEGER;

UPDATE kelas_mata_pelajaran km
SET unit_id = k.unit_id
FROM kelas k
WHERE k.id = km.kelas_id
  AND k.tenant_id = km.tenant_id
  AND km.unit_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'kelas_mata_pelajaran_unit_tenant_fkey'
  ) THEN
    ALTER TABLE kelas_mata_pelajaran
      ADD CONSTRAINT kelas_mata_pelajaran_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_kelas_mapel_tenant_unit
  ON kelas_mata_pelajaran (tenant_id, unit_id, kelas_id);

ALTER TABLE absensi
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS enrollment_id BIGINT,
  ADD COLUMN IF NOT EXISTS kelas_id INTEGER,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

ALTER TABLE nilai_mingguan
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS enrollment_id BIGINT,
  ADD COLUMN IF NOT EXISTS kelas_id INTEGER,
  ADD COLUMN IF NOT EXISTS mata_pelajaran_id INTEGER,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

ALTER TABLE hafalan
  ADD COLUMN IF NOT EXISTS unit_id INTEGER,
  ADD COLUMN IF NOT EXISTS santri_unit_id BIGINT,
  ADD COLUMN IF NOT EXISTS enrollment_id BIGINT,
  ADD COLUMN IF NOT EXISTS kelas_id INTEGER,
  ADD COLUMN IF NOT EXISTS actor_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS source VARCHAR(30) NOT NULL DEFAULT 'admin';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'absensi_unit_tenant_fkey') THEN
    ALTER TABLE absensi ADD CONSTRAINT absensi_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nilai_unit_tenant_fkey') THEN
    ALTER TABLE nilai_mingguan ADD CONSTRAINT nilai_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'hafalan_unit_tenant_fkey') THEN
    ALTER TABLE hafalan ADD CONSTRAINT hafalan_unit_tenant_fkey
      FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

UPDATE absensi a
SET unit_id = su.unit_id,
    santri_unit_id = su.id,
    enrollment_id = e.id,
    kelas_id = e.kelas_id
FROM santri_units su
LEFT JOIN LATERAL (
  SELECT ske.id, ske.kelas_id
  FROM santri_kelas_enrollments ske
  WHERE ske.tenant_id = su.tenant_id
    AND ske.santri_unit_id = su.id
    AND ske.status = 'active'
    AND ske.end_date IS NULL
  ORDER BY ske.id DESC
  LIMIT 1
) e ON TRUE
WHERE a.tenant_id = su.tenant_id
  AND a.santri_id = su.santri_id
  AND su.status = 'active'
  AND su.left_at IS NULL
  AND a.unit_id IS NULL
  AND (
    a.kelas_id IS NULL
    OR e.kelas_id = a.kelas_id
    OR NOT EXISTS (
      SELECT 1 FROM santri_units su2
      WHERE su2.tenant_id = a.tenant_id
        AND su2.santri_id = a.santri_id
        AND su2.status = 'active'
        AND su2.left_at IS NULL
        AND su2.id <> su.id
    )
  );

UPDATE nilai_mingguan n
SET unit_id = su.unit_id,
    santri_unit_id = su.id,
    enrollment_id = e.id,
    kelas_id = e.kelas_id
FROM santri_units su
LEFT JOIN LATERAL (
  SELECT ske.id, ske.kelas_id
  FROM santri_kelas_enrollments ske
  WHERE ske.tenant_id = su.tenant_id
    AND ske.santri_unit_id = su.id
    AND ske.status = 'active'
    AND ske.end_date IS NULL
  ORDER BY ske.id DESC
  LIMIT 1
) e ON TRUE
WHERE n.tenant_id = su.tenant_id
  AND n.santri_id = su.santri_id
  AND su.status = 'active'
  AND su.left_at IS NULL
  AND n.unit_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM santri_units su2
    WHERE su2.tenant_id = n.tenant_id
      AND su2.santri_id = n.santri_id
      AND su2.status = 'active'
      AND su2.left_at IS NULL
      AND su2.id <> su.id
  );

UPDATE hafalan h
SET unit_id = su.unit_id,
    santri_unit_id = su.id,
    enrollment_id = e.id,
    kelas_id = e.kelas_id
FROM santri_units su
LEFT JOIN LATERAL (
  SELECT ske.id, ske.kelas_id
  FROM santri_kelas_enrollments ske
  WHERE ske.tenant_id = su.tenant_id
    AND ske.santri_unit_id = su.id
    AND ske.status = 'active'
    AND ske.end_date IS NULL
  ORDER BY ske.id DESC
  LIMIT 1
) e ON TRUE
WHERE h.tenant_id = su.tenant_id
  AND h.santri_id = su.santri_id
  AND su.status = 'active'
  AND su.left_at IS NULL
  AND h.unit_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM santri_units su2
    WHERE su2.tenant_id = h.tenant_id
      AND su2.santri_id = h.santri_id
      AND su2.status = 'active'
      AND su2.left_at IS NULL
      AND su2.id <> su.id
  );

CREATE INDEX IF NOT EXISTS idx_absensi_tenant_unit_date
  ON absensi (tenant_id, unit_id, tanggal);
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_tenant_unit_santri_tanggal_sesi
  ON absensi (tenant_id, unit_id, santri_id, tanggal, sesi)
  WHERE unit_id IS NOT NULL;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absensi_santri_tanggal_sesi_key'
  ) THEN
    ALTER TABLE absensi DROP CONSTRAINT absensi_santri_tanggal_sesi_key;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_nilai_tenant_unit_period
  ON nilai_mingguan (tenant_id, unit_id, tahun, bulan);
CREATE UNIQUE INDEX IF NOT EXISTS uq_nilai_tenant_unit_santri_mapel_period
  ON nilai_mingguan (tenant_id, unit_id, santri_id, mapel, bulan, tahun)
  WHERE unit_id IS NOT NULL;
DROP INDEX IF EXISTS nilai_mingguan_tenant_santri_mapel_bulan_tahun_key;

CREATE INDEX IF NOT EXISTS idx_hafalan_tenant_unit_period
  ON hafalan (tenant_id, unit_id, tahun, bulan);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hafalan_tenant_unit_santri_period
  ON hafalan (tenant_id, unit_id, santri_id, bulan, tahun, pekan)
  WHERE unit_id IS NOT NULL;
DROP INDEX IF EXISTS hafalan_tenant_santri_bulan_tahun_pekan_key;

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT mp.tenant_id, 'mata_pelajaran', mp.id, 'AMBIGUOUS_MAPEL_UNIT',
       jsonb_build_object('nama', mp.nama, 'unit_count', ambiguous.unit_count)
FROM mata_pelajaran mp
JOIN (
  SELECT km.tenant_id, km.mata_pelajaran_id, COUNT(DISTINCT k.unit_id) AS unit_count
  FROM kelas_mata_pelajaran km
  JOIN kelas k ON k.id = km.kelas_id AND k.tenant_id = km.tenant_id
  GROUP BY km.tenant_id, km.mata_pelajaran_id
  HAVING COUNT(DISTINCT k.unit_id) > 1
) ambiguous
  ON ambiguous.tenant_id = mp.tenant_id
 AND ambiguous.mata_pelajaran_id = mp.id
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT n.tenant_id, 'nilai_mingguan', n.id, 'AMBIGUOUS_NILAI_UNIT',
       jsonb_build_object('santri_id', n.santri_id, 'bulan', n.bulan, 'tahun', n.tahun)
FROM nilai_mingguan n
WHERE n.unit_id IS NULL
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT h.tenant_id, 'hafalan', h.id, 'AMBIGUOUS_HAFALAN_UNIT',
       jsonb_build_object('santri_id', h.santri_id, 'bulan', h.bulan, 'tahun', h.tahun)
FROM hafalan h
WHERE h.unit_id IS NULL
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;
