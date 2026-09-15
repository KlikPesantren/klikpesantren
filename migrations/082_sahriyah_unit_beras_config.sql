BEGIN;

-- NULL marks legacy rows so their historical invoice presentation remains unchanged.
ALTER TABLE tagihan_sahriyah
  ADD COLUMN IF NOT EXISTS beras_enabled_snapshot BOOLEAN;

COMMENT ON COLUMN tagihan_sahriyah.beras_enabled_snapshot IS
  'Per-tagihan snapshot. NULL=legacy presentation; false=no Beras component; true=Beras enabled.';

-- Preserve only units with deterministic historical Beras usage. Merely having an
-- old nominal_beras setting is not enough evidence to opt a unit in.
UPDATE unit_pendidikan u
SET settings = COALESCE(u.settings, '{}'::jsonb)
  || jsonb_build_object(
       'sahriyah',
       COALESCE(u.settings->'sahriyah', '{}'::jsonb)
         || jsonb_build_object('beras_enabled', true)
     ),
    updated_at = NOW()
WHERE NOT (COALESCE(u.settings->'sahriyah', '{}'::jsonb) ? 'beras_enabled')
  AND (
    EXISTS (
      SELECT 1
      FROM tagihan_sahriyah t
      WHERE t.tenant_id = u.tenant_id
        AND t.unit_id = u.id
        AND COALESCE(t.nominal_beras, 0) > 0
    )
    OR EXISTS (
      SELECT 1
      FROM pembayaran_sahriyah ps
      WHERE ps.tenant_id = u.tenant_id
        AND ps.unit_id = u.id
        AND COALESCE(ps.nominal_beras, 0) > 0
    )
  );

COMMIT;
