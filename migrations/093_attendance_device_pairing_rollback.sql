BEGIN;
DROP TABLE attendance_device_pairings;
ALTER TABLE devices DROP CONSTRAINT devices_attendance_mode_check;
ALTER TABLE devices DROP COLUMN attendance_mode;
COMMIT;
