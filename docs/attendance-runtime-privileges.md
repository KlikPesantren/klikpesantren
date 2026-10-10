# Runtime least privilege — Absensi RFID

Tidak ada grant production yang dilakukan oleh pengujian source/rehearsal.
Migration 093 hanya menambah nullable devices.attendance_mode dan pairing table;
tidak melakukan backfill atau mengubah credential historis.

Tambahan operasi runtime yang perlu diverifikasi terhadap role runtime sebenarnya:

| Object | Operasi |
|---|---|
| attendance_device_pairings | SELECT, INSERT, UPDATE |
| attendance_device_pairings_id_seq | USAGE (INSERT id default) |
| devices | SELECT, INSERT, UPDATE (sudah existing runtime) |
| audit_logs / sequence id-nya | SELECT/INSERT sesuai existing audit; USAGE sequence |
| attendance_occurrences | SELECT, INSERT, UPDATE |
| attendance_occurrence_units | SELECT, INSERT |
| attendance_results | SELECT, INSERT, UPDATE |
| attendance_events | SELECT, INSERT; normal runtime tidak UPDATE/DELETE |
| attendance_session_units | SELECT, INSERT, DELETE (replace config scoped) |
| attendance_session_weekdays | SELECT, INSERT, DELETE (replace config scoped) |
| sequence id default Attendance | USAGE hanya yang dipakai INSERT |

Helpers memakai SELECT pada users, roles/permission overrides, tenants,
unit_pendidikan, user_unit_scope, feature_catalog/tenant_features, santri,
santri_units, enrollment, guru/guru_units, absensi. Tidak perlu owner/superuser,
schema CREATE, ALL PRIVILEGES atau grant ke business table tambahan.

Pairing dihapus oleh FK tenant/device ON DELETE CASCADE melalui lifecycle tenant
existing; tidak ada DELETE grant/penghapusan pairings normal. devices tetap dihapus
oleh service hard-delete existing, tidak diubah menjadi soft-delete. Permission
metadata/sequence dan guarded migration ledger wajib dicek sebelum production
release, bukan diberi privilege luas untuk mengatasi error saat live.
