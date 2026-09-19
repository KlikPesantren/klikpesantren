# Production runtime database privileges

Normal application requests use a LOGIN-only runtime role. The database owner remains
separate for controlled migrations and grants. Never put the owner credential in the
Railway runtime environment, and never run migrations with the runtime role.

## 2026-09 Absensi correction

`POST /absensi/batch` and `POST /absensi-guru` both use `INSERT ... ON CONFLICT DO
UPDATE`. Their target tables already allowed SELECT and INSERT, and their serial
sequences already allowed USAGE. The missing operation was UPDATE. The same static
audit gap affected three feature-management upserts. The following is the complete
operation-specific correction applied by the owner to production:

```sql
BEGIN;
GRANT UPDATE ON TABLE public.absensi, public.absensi_guru
  TO kp_app_runtime_20260917;
GRANT UPDATE ON TABLE public.tenant_role_overrides,
  public.unit_features, public.tenant_features
  TO kp_app_runtime_20260917;
COMMIT;
```

No SELECT, INSERT, DELETE, TRUNCATE, schema, sequence, ownership, or DDL grant was
added by this correction. The SQL is idempotent, but must be reviewed against the
target environment and executed only by an authorized owner session. No password or
tenant-specific value belongs in this manifest.

## Verification and exception

Run `NODE_ENV=production node scripts/audit-runtime-db-privileges.js` with the
intended runtime connection. The script scans application SQL, including `ON
CONFLICT DO UPDATE`, and checks operation and serial-sequence privileges inside a
read-only transaction. Do not use the owner connection for this verification.

The platform tenant-deletion path in `services/tenantHealthService.js` dynamically
deletes from many tables. It is deliberately surfaced as a separate privilege gap:
the normal runtime role is not granted broad DELETE access merely to satisfy that
destructive administrative workflow. Review that workflow and its separate
authorization model before enabling it. Never treat a successful Absensi smoke as
proof that tenant deletion is permitted.

The dynamic cleanup list is conditional on a `tenant_id` column. Four listed
tables (`absensi_santri`, `rfid_limit_override`, `rfid_limit_settings`, and
`rfid_override_logs`) lack that column in the audited production schema and are
skipped by the cleanup service. They are not missing runtime grants. The remaining
19 missing DELETE grants belong to the Platform tenant-deletion transaction, not
ordinary tenant requests. The endpoint is still exposed; a separately authorized
maintenance design is needed before treating that destructive operation as ready.

`schema_migrations` is owner-only and is excluded from runtime grants. Backup and
reconciliation-only tables must not be added to the runtime role without a proven
application request. Capture before/after `has_table_privilege` and
`has_sequence_privilege` evidence when changing any grant. A missing privilege
should be traced to a concrete query before another operation-specific grant.
