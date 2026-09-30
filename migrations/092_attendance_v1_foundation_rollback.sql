-- Non-production rehearsal rollback for migration 092 only.
BEGIN;
DROP TABLE IF EXISTS attendance_results;
DROP TABLE IF EXISTS attendance_events;
DROP TABLE IF EXISTS attendance_occurrence_units;
DROP TABLE IF EXISTS attendance_occurrences;
DROP TABLE IF EXISTS attendance_session_weekdays;
DROP TABLE IF EXISTS attendance_session_units;
DROP INDEX IF EXISTS idx_devices_tenant_enabled;
ALTER TABLE devices DROP CONSTRAINT IF EXISTS devices_connection_state_check;
ALTER TABLE devices DROP COLUMN IF EXISTS last_authenticated_at,
  DROP COLUMN IF EXISTS secret_rotated_at, DROP COLUMN IF EXISTS device_secret_hash,
  DROP COLUMN IF EXISTS connection_state, DROP COLUMN IF EXISTS enabled;
ALTER TABLE attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_same_day_window_check;
DROP INDEX IF EXISTS uq_attendance_sessions_tenant_id;
DROP INDEX IF EXISTS uq_devices_tenant_id;
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_attendance_timezone_not_blank;
ALTER TABLE tenants DROP COLUMN IF EXISTS attendance_timezone;
COMMIT;
