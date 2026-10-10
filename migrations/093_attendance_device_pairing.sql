BEGIN;
-- Attendance-only provisioning; no historical device/payment backfill.
ALTER TABLE devices ADD COLUMN attendance_mode VARCHAR(20);
ALTER TABLE devices ADD CONSTRAINT devices_attendance_mode_check
  CHECK (attendance_mode IS NULL OR attendance_mode='ATTENDANCE');
CREATE TABLE attendance_device_pairings (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  device_id INTEGER NOT NULL,
  verifier CHAR(64) NOT NULL UNIQUE,
  issued_by INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_pairing_device_tenant_fkey FOREIGN KEY(tenant_id,device_id)
    REFERENCES devices(tenant_id,id) ON DELETE CASCADE,
  CONSTRAINT attendance_pairing_actor_tenant_fkey FOREIGN KEY(tenant_id,issued_by)
    REFERENCES users(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attendance_pairing_lifetime CHECK(expires_at>created_at)
);
CREATE INDEX attendance_pairing_device ON attendance_device_pairings(tenant_id,device_id);
COMMIT;
