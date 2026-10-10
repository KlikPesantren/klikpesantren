# Attendance V1 Phase 1 runtime privileges

This is a reviewed least-privilege plan, not a production grant change. Apply it
only after migration 092 passes non-production rehearsal and through the
controlled owner-level grant workflow.

The operations below come from services/attendanceCoreService.js:

| Object | Required runtime operations | Not required |
| --- | --- | --- |
| attendance_session_units | SELECT, INSERT, DELETE | UPDATE |
| attendance_session_weekdays | SELECT, INSERT, DELETE | UPDATE |
| attendance_occurrences | SELECT, INSERT, UPDATE | DELETE |
| attendance_occurrence_units | SELECT, INSERT | UPDATE, DELETE |
| attendance_events | SELECT, INSERT | UPDATE, DELETE |
| attendance_results | SELECT, INSERT, UPDATE | DELETE |

The three BIGSERIAL writers require USAGE on:

- attendance_occurrences_id_seq
- attendance_events_id_seq
- attendance_results_id_seq

No Phase 1 code calls currval, so sequence SELECT is not required. Existing
reference tables retain their already-audited operations; migration 092 does not
justify broader grants.

Owner-reviewed grant template (replace runtime_role explicitly):

    BEGIN;
    GRANT SELECT, INSERT, DELETE ON TABLE
      public.attendance_session_units,
      public.attendance_session_weekdays TO runtime_role;
    GRANT SELECT, INSERT, UPDATE ON TABLE
      public.attendance_occurrences,
      public.attendance_results TO runtime_role;
    GRANT SELECT, INSERT ON TABLE
      public.attendance_occurrence_units,
      public.attendance_events TO runtime_role;
    GRANT USAGE ON SEQUENCE
      public.attendance_occurrences_id_seq,
      public.attendance_events_id_seq,
      public.attendance_results_id_seq TO runtime_role;
    REVOKE UPDATE, DELETE ON TABLE public.attendance_events FROM runtime_role;
    COMMIT;

Tenant hard-delete is the sole lifecycle exception to event append-only behavior.
All six Phase 1 tables have direct tenant ownership with ON DELETE CASCADE, so FK
actions clean them after the authorized tenant-row delete without child-table
DELETE grants. Internal tenant-qualified FKs are deferred only until transaction
commit so the existing cleanup order remains valid without weakening tenant keys.

Do not grant ALL, schema DDL, ownership, role administration, TRUNCATE, UPDATE on
attendance_events, or direct DELETE on event/result/occurrence tables.
