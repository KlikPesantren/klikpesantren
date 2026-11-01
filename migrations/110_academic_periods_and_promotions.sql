-- 110: Unit-scoped academic periods and auditable class promotion foundation.
BEGIN;

CREATE TABLE academic_years (
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  unit_id INTEGER NOT NULL, name VARCHAR(20) NOT NULL, start_date DATE NOT NULL,
  end_date DATE NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER, activated_at TIMESTAMPTZ, closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_year_dates CHECK(start_date <= end_date),
  CONSTRAINT academic_year_status CHECK(status IN('DRAFT','ACTIVE','CLOSED')),
  CONSTRAINT academic_year_unit_fk FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id),
  CONSTRAINT academic_year_actor_fk FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,unit_id,name), UNIQUE(tenant_id,id), UNIQUE(tenant_id,unit_id,id)
);
CREATE UNIQUE INDEX uq_academic_year_active ON academic_years(tenant_id,unit_id) WHERE status='ACTIVE';

CREATE TABLE academic_semesters (
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER NOT NULL,
  academic_year_id BIGINT NOT NULL, term VARCHAR(8) NOT NULL,
  start_date DATE NOT NULL, end_date DATE NOT NULL, status VARCHAR(12) NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER, activated_at TIMESTAMPTZ, closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_semester_term CHECK(term IN('GANJIL','GENAP')),
  CONSTRAINT academic_semester_dates CHECK(start_date <= end_date),
  CONSTRAINT academic_semester_status CHECK(status IN('DRAFT','ACTIVE','CLOSED')),
  CONSTRAINT academic_semester_year_fk FOREIGN KEY(tenant_id,unit_id,academic_year_id)
    REFERENCES academic_years(tenant_id,unit_id,id),
  CONSTRAINT academic_semester_actor_fk FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,unit_id,academic_year_id,term), UNIQUE(tenant_id,id), UNIQUE(tenant_id,unit_id,id)
);
CREATE UNIQUE INDEX uq_academic_semester_active ON academic_semesters(tenant_id,unit_id) WHERE status='ACTIVE';

CREATE TABLE academic_grade_levels (
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER NOT NULL,
  code VARCHAR(40) NOT NULL, name VARCHAR(100) NOT NULL, sort_order INTEGER NOT NULL,
  duration_years SMALLINT NOT NULL DEFAULT 1, is_terminal BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT academic_grade_duration CHECK(duration_years BETWEEN 1 AND 20),
  CONSTRAINT academic_grade_unit_fk FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id),
  UNIQUE(tenant_id,unit_id,code), UNIQUE(tenant_id,unit_id,sort_order),
  UNIQUE(tenant_id,id), UNIQUE(tenant_id,unit_id,id)
);

ALTER TABLE kelas ADD COLUMN academic_grade_level_id BIGINT;
ALTER TABLE kelas ADD CONSTRAINT kelas_academic_grade_fk FOREIGN KEY(tenant_id,unit_id,academic_grade_level_id)
  REFERENCES academic_grade_levels(tenant_id,unit_id,id) NOT VALID;

-- Required by tenant-scoped foreign keys below. Historical schemas only
-- guaranteed the global primary key on id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_kelas_enrollments_tenant_id_id
  ON santri_kelas_enrollments(tenant_id,id);

ALTER TABLE santri_kelas_enrollments
  ADD COLUMN academic_year_id BIGINT,
  ADD COLUMN academic_semester_id BIGINT,
  ADD COLUMN academic_grade_level_id BIGINT,
  ADD COLUMN level_started_academic_year_id BIGINT;
ALTER TABLE santri_kelas_enrollments ADD CONSTRAINT enrollment_year_fk
  FOREIGN KEY(tenant_id,academic_year_id) REFERENCES academic_years(tenant_id,id) NOT VALID;
ALTER TABLE santri_kelas_enrollments ADD CONSTRAINT enrollment_semester_fk
  FOREIGN KEY(tenant_id,academic_semester_id) REFERENCES academic_semesters(tenant_id,id) NOT VALID;
ALTER TABLE santri_kelas_enrollments ADD CONSTRAINT enrollment_grade_level_fk
  FOREIGN KEY(tenant_id,academic_grade_level_id) REFERENCES academic_grade_levels(tenant_id,id) NOT VALID;

ALTER TABLE nilai_mingguan ADD COLUMN academic_year_id BIGINT, ADD COLUMN academic_semester_id BIGINT;
ALTER TABLE absensi ADD COLUMN academic_year_id BIGINT, ADD COLUMN academic_semester_id BIGINT;
ALTER TABLE nilai_mingguan ADD CONSTRAINT nilai_academic_year_fk
  FOREIGN KEY(tenant_id,academic_year_id) REFERENCES academic_years(tenant_id,id) NOT VALID;
ALTER TABLE nilai_mingguan ADD CONSTRAINT nilai_academic_semester_fk
  FOREIGN KEY(tenant_id,academic_semester_id) REFERENCES academic_semesters(tenant_id,id) NOT VALID;
ALTER TABLE absensi ADD CONSTRAINT absensi_academic_year_fk
  FOREIGN KEY(tenant_id,academic_year_id) REFERENCES academic_years(tenant_id,id) NOT VALID;
ALTER TABLE absensi ADD CONSTRAINT absensi_academic_semester_fk
  FOREIGN KEY(tenant_id,academic_semester_id) REFERENCES academic_semesters(tenant_id,id) NOT VALID;
-- An occurrence may include multiple units. Snapshot the period per participant unit,
-- never as one ambiguous occurrence-wide value.
ALTER TABLE attendance_occurrence_units
  ADD COLUMN academic_year_id BIGINT,
  ADD COLUMN academic_semester_id BIGINT;
ALTER TABLE attendance_occurrence_units ADD CONSTRAINT attendance_occurrence_units_year_fk
  FOREIGN KEY(tenant_id,unit_id,academic_year_id) REFERENCES academic_years(tenant_id,unit_id,id) NOT VALID;
ALTER TABLE attendance_occurrence_units ADD CONSTRAINT attendance_occurrence_units_semester_fk
  FOREIGN KEY(tenant_id,unit_id,academic_semester_id) REFERENCES academic_semesters(tenant_id,unit_id,id) NOT VALID;

CREATE TABLE academic_promotion_batches (
  id UUID PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER NOT NULL,
  source_academic_year_id BIGINT NOT NULL, target_academic_year_id BIGINT NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL, request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'COMPLETED', actor_user_id INTEGER NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotion_batch_status CHECK(status IN('COMPLETED')),
  CONSTRAINT promotion_batch_unit_fk FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id),
  CONSTRAINT promotion_batch_source_fk FOREIGN KEY(tenant_id,unit_id,source_academic_year_id) REFERENCES academic_years(tenant_id,unit_id,id),
  CONSTRAINT promotion_batch_target_fk FOREIGN KEY(tenant_id,unit_id,target_academic_year_id) REFERENCES academic_years(tenant_id,unit_id,id),
  CONSTRAINT promotion_batch_actor_fk FOREIGN KEY(tenant_id,actor_user_id) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,unit_id,idempotency_key), UNIQUE(tenant_id,unit_id,id)
);

CREATE TABLE academic_promotion_decisions (
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER NOT NULL,
  batch_id UUID NOT NULL, santri_unit_id BIGINT NOT NULL, source_enrollment_id BIGINT,
  target_enrollment_id BIGINT, source_kelas_id INTEGER, target_kelas_id INTEGER,
  source_grade_level_id BIGINT, target_grade_level_id BIGINT,
  decision VARCHAR(24) NOT NULL, reason TEXT, effective_date DATE NOT NULL, actor_user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT promotion_decision_check CHECK(decision IN('NAIK','TETAP','LULUS','PINDAH','PERLU_PEMERIKSAAN')),
  CONSTRAINT promotion_decision_batch_fk FOREIGN KEY(tenant_id,unit_id,batch_id) REFERENCES academic_promotion_batches(tenant_id,unit_id,id),
  CONSTRAINT promotion_decision_member_fk FOREIGN KEY(tenant_id,santri_unit_id) REFERENCES santri_units(tenant_id,id),
  CONSTRAINT promotion_decision_source_enrollment_fk FOREIGN KEY(tenant_id,source_enrollment_id) REFERENCES santri_kelas_enrollments(tenant_id,id),
  CONSTRAINT promotion_decision_target_enrollment_fk FOREIGN KEY(tenant_id,target_enrollment_id) REFERENCES santri_kelas_enrollments(tenant_id,id),
  CONSTRAINT promotion_decision_source_class_fk FOREIGN KEY(tenant_id,source_kelas_id) REFERENCES kelas(tenant_id,id),
  CONSTRAINT promotion_decision_target_class_fk FOREIGN KEY(tenant_id,target_kelas_id) REFERENCES kelas(tenant_id,id),
  CONSTRAINT promotion_decision_source_level_fk FOREIGN KEY(tenant_id,source_grade_level_id) REFERENCES academic_grade_levels(tenant_id,id),
  CONSTRAINT promotion_decision_target_level_fk FOREIGN KEY(tenant_id,target_grade_level_id) REFERENCES academic_grade_levels(tenant_id,id),
  CONSTRAINT promotion_decision_actor_fk FOREIGN KEY(tenant_id,actor_user_id) REFERENCES users(tenant_id,id),
  UNIQUE(batch_id,santri_unit_id)
);
CREATE INDEX idx_promotion_history_member ON academic_promotion_decisions(tenant_id,santri_unit_id,effective_date DESC);

CREATE TABLE academic_grade_corrections (
  id BIGSERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, unit_id INTEGER NOT NULL,
  nilai_id INTEGER NOT NULL, academic_semester_id BIGINT, old_value NUMERIC, new_value NUMERIC NOT NULL,
  reason TEXT NOT NULL, actor_user_id INTEGER NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grade_correction_reason CHECK(BTRIM(reason)<>''),
  CONSTRAINT grade_correction_unit_fk FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id),
  CONSTRAINT grade_correction_nilai_fk FOREIGN KEY(nilai_id) REFERENCES nilai_mingguan(id),
  CONSTRAINT grade_correction_semester_fk FOREIGN KEY(tenant_id,academic_semester_id) REFERENCES academic_semesters(tenant_id,id),
  CONSTRAINT grade_correction_actor_fk FOREIGN KEY(tenant_id,actor_user_id) REFERENCES users(tenant_id,id)
);

-- Existing history deliberately remains unmapped. No date-derived backfill is safe.
CREATE INDEX idx_academic_year_unit ON academic_years(tenant_id,unit_id,start_date);
CREATE INDEX idx_academic_semester_unit ON academic_semesters(tenant_id,unit_id,start_date);

COMMIT;
