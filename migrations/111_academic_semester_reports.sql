-- 111: Official semester report cards, immutable publication snapshots and class ranking.
BEGIN;

CREATE TABLE academic_report_config_versions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  unit_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  name VARCHAR(120) NOT NULL,
  template_code VARCHAR(40) NOT NULL DEFAULT 'STANDARD_A4',
  institution_identity JSONB NOT NULL DEFAULT '{}'::jsonb,
  grading_config JSONB NOT NULL DEFAULT '{"scale_min":0,"scale_max":100,"rounding_scale":2}'::jsonb,
  attendance_enabled BOOLEAN NOT NULL DEFAULT true,
  homeroom_notes_enabled BOOLEAN NOT NULL DEFAULT true,
  development_notes_enabled BOOLEAN NOT NULL DEFAULT false,
  ranking_enabled BOOLEAN NOT NULL DEFAULT true,
  wali_publication_enabled BOOLEAN NOT NULL DEFAULT true,
  signer JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_config_unit_fk FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id),
  CONSTRAINT report_config_actor_fk FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id),
  CONSTRAINT report_config_grading_object CHECK(jsonb_typeof(grading_config)='object'),
  UNIQUE(tenant_id,unit_id,version), UNIQUE(tenant_id,unit_id,id), UNIQUE(tenant_id,id)
);

CREATE TABLE academic_report_config_subjects (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  config_version_id BIGINT NOT NULL,
  mata_pelajaran_id INTEGER NOT NULL,
  display_order SMALLINT NOT NULL DEFAULT 0,
  required BOOLEAN NOT NULL DEFAULT true,
  include_in_ranking BOOLEAN NOT NULL DEFAULT true,
  mastery_score NUMERIC(8,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_config_subject_config_fk FOREIGN KEY(tenant_id,unit_id,config_version_id)
    REFERENCES academic_report_config_versions(tenant_id,unit_id,id),
  CONSTRAINT report_config_subject_mapel_fk FOREIGN KEY(tenant_id,mata_pelajaran_id)
    REFERENCES mata_pelajaran(tenant_id,id),
  CONSTRAINT report_config_mastery_nonnegative CHECK(mastery_score IS NULL OR mastery_score>=0),
  UNIQUE(tenant_id,unit_id,config_version_id,mata_pelajaran_id), UNIQUE(tenant_id,id)
);

-- Explicit user-to-subject assignment. No teacher receives blanket report-card authority.
CREATE TABLE academic_report_teacher_assignments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  mata_pelajaran_id INTEGER NOT NULL,
  kelas_id INTEGER,
  active BOOLEAN NOT NULL DEFAULT true,
  assigned_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_teacher_unit_fk FOREIGN KEY(tenant_id,unit_id) REFERENCES unit_pendidikan(tenant_id,id),
  CONSTRAINT report_teacher_user_fk FOREIGN KEY(tenant_id,user_id) REFERENCES users(tenant_id,id),
  CONSTRAINT report_teacher_actor_fk FOREIGN KEY(tenant_id,assigned_by) REFERENCES users(tenant_id,id),
  CONSTRAINT report_teacher_mapel_fk FOREIGN KEY(tenant_id,mata_pelajaran_id)
    REFERENCES mata_pelajaran(tenant_id,id),
  CONSTRAINT report_teacher_class_fk FOREIGN KEY(tenant_id,kelas_id) REFERENCES kelas(tenant_id,id),
  UNIQUE(tenant_id,unit_id,user_id,mata_pelajaran_id,kelas_id), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX uq_report_teacher_assignment_any_class
  ON academic_report_teacher_assignments(tenant_id,unit_id,user_id,mata_pelajaran_id)
  WHERE kelas_id IS NULL;

CREATE TABLE academic_semester_grades (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  academic_year_id BIGINT NOT NULL,
  academic_semester_id BIGINT NOT NULL,
  enrollment_id BIGINT NOT NULL,
  santri_unit_id BIGINT NOT NULL,
  kelas_id INTEGER NOT NULL,
  mata_pelajaran_id INTEGER NOT NULL,
  final_score NUMERIC(8,2) NOT NULL,
  achievement_description TEXT,
  actor_user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semester_grade_year_fk FOREIGN KEY(tenant_id,unit_id,academic_year_id)
    REFERENCES academic_years(tenant_id,unit_id,id),
  CONSTRAINT semester_grade_semester_fk FOREIGN KEY(tenant_id,unit_id,academic_semester_id)
    REFERENCES academic_semesters(tenant_id,unit_id,id),
  CONSTRAINT semester_grade_enrollment_fk FOREIGN KEY(tenant_id,enrollment_id)
    REFERENCES santri_kelas_enrollments(tenant_id,id),
  CONSTRAINT semester_grade_member_fk FOREIGN KEY(tenant_id,santri_unit_id) REFERENCES santri_units(tenant_id,id),
  CONSTRAINT semester_grade_class_fk FOREIGN KEY(tenant_id,kelas_id) REFERENCES kelas(tenant_id,id),
  CONSTRAINT semester_grade_mapel_fk FOREIGN KEY(tenant_id,mata_pelajaran_id)
    REFERENCES mata_pelajaran(tenant_id,id),
  CONSTRAINT semester_grade_actor_fk FOREIGN KEY(tenant_id,actor_user_id) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,unit_id,academic_semester_id,enrollment_id,mata_pelajaran_id), UNIQUE(tenant_id,id)
);

CREATE TABLE academic_semester_grade_corrections (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  semester_grade_id BIGINT NOT NULL,
  old_score NUMERIC(8,2) NOT NULL,
  new_score NUMERIC(8,2) NOT NULL,
  old_description TEXT,
  new_description TEXT,
  reason TEXT NOT NULL,
  actor_user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT semester_grade_correction_reason CHECK(BTRIM(reason)<>''),
  CONSTRAINT semester_grade_correction_grade_fk FOREIGN KEY(tenant_id,semester_grade_id)
    REFERENCES academic_semester_grades(tenant_id,id),
  CONSTRAINT semester_grade_correction_actor_fk FOREIGN KEY(tenant_id,actor_user_id) REFERENCES users(tenant_id,id)
);

CREATE TABLE academic_report_cards (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  academic_year_id BIGINT NOT NULL,
  academic_semester_id BIGINT NOT NULL,
  enrollment_id BIGINT NOT NULL,
  santri_unit_id BIGINT NOT NULL,
  kelas_id INTEGER NOT NULL,
  config_version_id BIGINT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  revision_of_id BIGINT,
  status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  homeroom_notes TEXT,
  development_notes TEXT,
  revision_reason TEXT,
  submitted_by INTEGER, submitted_at TIMESTAMPTZ,
  approved_by INTEGER, approved_at TIMESTAMPTZ,
  published_by INTEGER, published_at TIMESTAMPTZ,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_card_status CHECK(status IN('DRAFT','REVIEW','REVISION_REQUIRED','APPROVED','PUBLISHED')),
  CONSTRAINT report_card_semester_fk FOREIGN KEY(tenant_id,unit_id,academic_semester_id)
    REFERENCES academic_semesters(tenant_id,unit_id,id),
  CONSTRAINT report_card_year_fk FOREIGN KEY(tenant_id,unit_id,academic_year_id)
    REFERENCES academic_years(tenant_id,unit_id,id),
  CONSTRAINT report_card_enrollment_fk FOREIGN KEY(tenant_id,enrollment_id) REFERENCES santri_kelas_enrollments(tenant_id,id),
  CONSTRAINT report_card_member_fk FOREIGN KEY(tenant_id,santri_unit_id) REFERENCES santri_units(tenant_id,id),
  CONSTRAINT report_card_class_fk FOREIGN KEY(tenant_id,kelas_id) REFERENCES kelas(tenant_id,id),
  CONSTRAINT report_card_config_fk FOREIGN KEY(tenant_id,unit_id,config_version_id)
    REFERENCES academic_report_config_versions(tenant_id,unit_id,id),
  CONSTRAINT report_card_revision_fk FOREIGN KEY(tenant_id,revision_of_id) REFERENCES academic_report_cards(tenant_id,id),
  CONSTRAINT report_card_creator_fk FOREIGN KEY(tenant_id,created_by) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,unit_id,academic_semester_id,enrollment_id,version), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX uq_report_card_current_nonpublished
  ON academic_report_cards(tenant_id,unit_id,academic_semester_id,enrollment_id)
  WHERE status<>'PUBLISHED';

CREATE TABLE academic_report_ranking_finalizations (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  academic_year_id BIGINT NOT NULL,
  academic_semester_id BIGINT NOT NULL,
  kelas_id INTEGER NOT NULL,
  config_version_id BIGINT NOT NULL,
  version INTEGER NOT NULL,
  input_checksum VARCHAR(64) NOT NULL,
  ranking_snapshot JSONB NOT NULL,
  participant_count INTEGER NOT NULL,
  finalized_by INTEGER NOT NULL,
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_ranking_participants CHECK(participant_count>0),
  CONSTRAINT report_ranking_snapshot_array CHECK(jsonb_typeof(ranking_snapshot)='array'),
  CONSTRAINT report_ranking_semester_fk FOREIGN KEY(tenant_id,unit_id,academic_semester_id)
    REFERENCES academic_semesters(tenant_id,unit_id,id),
  CONSTRAINT report_ranking_class_fk FOREIGN KEY(tenant_id,kelas_id) REFERENCES kelas(tenant_id,id),
  CONSTRAINT report_ranking_config_fk FOREIGN KEY(tenant_id,unit_id,config_version_id)
    REFERENCES academic_report_config_versions(tenant_id,unit_id,id),
  CONSTRAINT report_ranking_actor_fk FOREIGN KEY(tenant_id,finalized_by) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,unit_id,academic_semester_id,kelas_id,version), UNIQUE(tenant_id,id)
);

CREATE TABLE academic_report_publications (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  report_card_id BIGINT NOT NULL,
  ranking_finalization_id BIGINT NOT NULL,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  snapshot_checksum VARCHAR(64) NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  published_by INTEGER NOT NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_publication_snapshot_object CHECK(jsonb_typeof(snapshot)='object'),
  CONSTRAINT report_publication_card_fk FOREIGN KEY(tenant_id,report_card_id) REFERENCES academic_report_cards(tenant_id,id),
  CONSTRAINT report_publication_ranking_fk FOREIGN KEY(tenant_id,ranking_finalization_id)
    REFERENCES academic_report_ranking_finalizations(tenant_id,id),
  CONSTRAINT report_publication_actor_fk FOREIGN KEY(tenant_id,published_by) REFERENCES users(tenant_id,id),
  UNIQUE(tenant_id,report_card_id,version), UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX uq_report_publication_current ON academic_report_publications(tenant_id,report_card_id) WHERE is_current;

CREATE TABLE academic_report_workflow_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  report_card_id BIGINT NOT NULL,
  from_status VARCHAR(24), to_status VARCHAR(24) NOT NULL,
  reason TEXT, actor_user_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT report_workflow_card_fk FOREIGN KEY(tenant_id,report_card_id) REFERENCES academic_report_cards(tenant_id,id),
  CONSTRAINT report_workflow_actor_fk FOREIGN KEY(tenant_id,actor_user_id) REFERENCES users(tenant_id,id)
);

CREATE INDEX idx_semester_grades_workspace ON academic_semester_grades(tenant_id,unit_id,academic_semester_id,kelas_id,enrollment_id);
CREATE INDEX idx_report_cards_workspace ON academic_report_cards(tenant_id,unit_id,academic_semester_id,kelas_id,status);
CREATE INDEX idx_report_publications_wali ON academic_report_publications(tenant_id,is_current,published_at DESC);

COMMIT;
