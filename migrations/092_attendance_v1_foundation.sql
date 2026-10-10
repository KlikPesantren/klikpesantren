-- 092: Attendance V1 additive foundation. Legacy attendance/RFID/wallet stay intact.
BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS attendance_timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Jakarta';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenants_attendance_timezone_not_blank') THEN
    ALTER TABLE tenants ADD CONSTRAINT tenants_attendance_timezone_not_blank CHECK (BTRIM(attendance_timezone)<>'') NOT VALID;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_sessions_tenant_id ON attendance_sessions(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_tenant_id ON devices(tenant_id,id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='attendance_sessions_same_day_window_check') THEN
    ALTER TABLE attendance_sessions ADD CONSTRAINT attendance_sessions_same_day_window_check
      CHECK ((start_time IS NULL AND end_time IS NULL) OR
        (start_time IS NOT NULL AND end_time IS NOT NULL AND start_time<end_time)) NOT VALID;
  END IF;
END $$;

-- unit_id stays the owner/default; rows below are extra units. There is no ALL.
CREATE TABLE IF NOT EXISTS attendance_session_units(
  tenant_id INTEGER NOT NULL, session_id BIGINT NOT NULL, unit_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,session_id,unit_id),
  CONSTRAINT attendance_session_units_tenant_fkey FOREIGN KEY(tenant_id)
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT attendance_session_units_session_tenant_fkey FOREIGN KEY(tenant_id,session_id)
    REFERENCES attendance_sessions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attendance_session_units_unit_tenant_fkey FOREIGN KEY(tenant_id,unit_id)
    REFERENCES unit_pendidikan(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);

-- Empty weekday set means every day, preserving current behavior.
CREATE TABLE IF NOT EXISTS attendance_session_weekdays(
  tenant_id INTEGER NOT NULL, session_id BIGINT NOT NULL, day_of_week SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,session_id,day_of_week),
  CONSTRAINT attendance_session_weekdays_day_check CHECK(day_of_week BETWEEN 0 AND 6),
  CONSTRAINT attendance_session_weekdays_tenant_fkey FOREIGN KEY(tenant_id)
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT attendance_session_weekdays_session_tenant_fkey FOREIGN KEY(tenant_id,session_id)
    REFERENCES attendance_sessions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS attendance_occurrences(
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL, occurrence_date DATE NOT NULL, timezone VARCHAR(80) NOT NULL,
  window_start TIMESTAMPTZ NOT NULL, window_end TIMESTAMPTZ NOT NULL,
  state VARCHAR(20) NOT NULL DEFAULT 'active', cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ,
  CONSTRAINT attendance_occurrences_window_check CHECK(window_start<window_end),
  CONSTRAINT attendance_occurrences_timezone_not_blank CHECK(BTRIM(timezone)<>''),
  CONSTRAINT attendance_occurrences_state_check CHECK(state IN('active','cancelled','closed')),
  CONSTRAINT attendance_occurrences_closed_at_check CHECK((state='closed' AND closed_at IS NOT NULL) OR state<>'closed'),
  CONSTRAINT attendance_occurrences_session_tenant_fkey FOREIGN KEY(tenant_id,session_id)
    REFERENCES attendance_sessions(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_occurrences_tenant_id ON attendance_occurrences(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_occurrences_session_date ON attendance_occurrences(tenant_id,session_id,occurrence_date);
CREATE INDEX IF NOT EXISTS idx_attendance_occurrences_close_due ON attendance_occurrences(state,window_end,tenant_id);

-- Unit eligibility is snapshotted per occurrence so later session edits are not retroactive.
CREATE TABLE IF NOT EXISTS attendance_occurrence_units(
  tenant_id INTEGER NOT NULL, occurrence_id BIGINT NOT NULL, unit_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(tenant_id,occurrence_id,unit_id),
  CONSTRAINT attendance_occurrence_units_tenant_fkey FOREIGN KEY(tenant_id)
    REFERENCES tenants(id) ON DELETE CASCADE,
  CONSTRAINT attendance_occurrence_units_occurrence_tenant_fkey FOREIGN KEY(tenant_id,occurrence_id)
    REFERENCES attendance_occurrences(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attendance_occurrence_units_unit_tenant_fkey FOREIGN KEY(tenant_id,unit_id)
    REFERENCES unit_pendidikan(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);


CREATE TABLE IF NOT EXISTS attendance_events(
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  event_key VARCHAR(160) NOT NULL, provider VARCHAR(80) NOT NULL, device_id INTEGER,
  credential_reference VARCHAR(200), person_type VARCHAR(20), person_id BIGINT, occurrence_id BIGINT,
  captured_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome VARCHAR(40) NOT NULL, provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_events_key_not_blank CHECK(BTRIM(event_key)<>''),
  CONSTRAINT attendance_events_provider_not_blank CHECK(BTRIM(provider)<>''),
  CONSTRAINT attendance_events_person_type_check CHECK(person_type IS NULL OR person_type IN('santri','guru')),
  CONSTRAINT attendance_events_person_pair_check CHECK((person_type IS NULL)=(person_id IS NULL)),
  CONSTRAINT attendance_events_device_tenant_fkey FOREIGN KEY(tenant_id,device_id)
    REFERENCES devices(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attendance_events_occurrence_tenant_fkey FOREIGN KEY(tenant_id,occurrence_id)
    REFERENCES attendance_occurrences(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_events_tenant_id ON attendance_events(tenant_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_events_idempotency ON attendance_events(tenant_id,event_key);
CREATE INDEX IF NOT EXISTS idx_attendance_events_occurrence_person ON attendance_events(tenant_id,occurrence_id,person_type,person_id);

CREATE TABLE IF NOT EXISTS attendance_results(
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  occurrence_id BIGINT NOT NULL, person_type VARCHAR(20) NOT NULL, person_id BIGINT NOT NULL,
  status CHAR(1) NOT NULL, source VARCHAR(20) NOT NULL, effective_at TIMESTAMPTZ,
  source_event_id BIGINT, actor_user_id INTEGER, protected_manual BOOLEAN NOT NULL DEFAULT false,
  auto_generated BOOLEAN NOT NULL DEFAULT false, provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_results_person_type_check CHECK(person_type IN('santri','guru')),
  CONSTRAINT attendance_results_status_check CHECK(status IN('H','I','S','A')),
  CONSTRAINT attendance_results_source_check CHECK(source IN('admin','manual','device','system')),
  CONSTRAINT attendance_results_manual_protection_check CHECK(NOT protected_manual OR source IN('admin','manual')),
  CONSTRAINT attendance_results_auto_check CHECK(NOT auto_generated OR(source='system' AND status='A')),
  CONSTRAINT attendance_results_occurrence_tenant_fkey FOREIGN KEY(tenant_id,occurrence_id)
    REFERENCES attendance_occurrences(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attendance_results_event_tenant_fkey FOREIGN KEY(tenant_id,source_event_id)
    REFERENCES attendance_events(tenant_id,id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT attendance_results_actor_tenant_fkey FOREIGN KEY(tenant_id,actor_user_id)
    REFERENCES users(tenant_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_results_person_occurrence
  ON attendance_results(tenant_id,occurrence_id,person_type,person_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_results_source_event
  ON attendance_results(tenant_id,source_event_id) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_results_person_history
  ON attendance_results(tenant_id,person_type,person_id,occurrence_id);

-- New devices use a hash. Plaintext is temporary compatibility until rotation.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS connection_state VARCHAR(20) NOT NULL DEFAULT 'offline',
  ADD COLUMN IF NOT EXISTS device_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_authenticated_at TIMESTAMPTZ;
UPDATE devices SET enabled=false WHERE status='false' OR status='disabled';
UPDATE devices SET connection_state=CASE WHEN status='online' THEN 'online'
  WHEN status='offline' THEN 'offline' ELSE 'unknown' END;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='devices_connection_state_check') THEN
    ALTER TABLE devices ADD CONSTRAINT devices_connection_state_check
      CHECK(connection_state IN('online','offline','unknown')) NOT VALID;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_devices_tenant_enabled ON devices(tenant_id,enabled,device_id);

COMMIT;
