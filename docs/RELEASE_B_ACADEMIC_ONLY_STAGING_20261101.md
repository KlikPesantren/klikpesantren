# Release B: academic-only staging package

Status BLOCKED for production activation. Parent is deployed Release A 54f346faa9db24ed600562923e2176e883a1e8ee. Academic source 7e347eed95160bdb2990033108a01d6fa2661953.

Only academic/e-Rapor/Wali and direct attendance/permission/frontend dependencies are imported; new SUQ/POS backend/mobile changes are excluded. Auto Alfa scheduler and3 hooks stay byte-identical to Release A; closeOccurrence cutoff is retained, with the new academic occurrence snapshot requiring academic110.

Frontend production build passed after npm ci from the existing lockfile; output source files are identical to this tree. Local periods23, report24, restricted-role7, scope12, AutoAlfa24 and auth/Wali regressions PASS on fresh synthetic fixtures. These are not a production clone.

One metadata-only READ ONLY production preflight proved existing role cannot read9 of129 public tables, including schema_migrations, pos_wallet_credential_audits and permission/audit tables. No production business data was read and no grants changed. Owner/auditor backup access is not available in this session. Full consistent backup, verified provenance, restore and migration rehearsal on production-derived data remain BLOCKED. No partial export is called identical.

Migration plan: full filename 110_academic_periods_and_promotions.sql then111_academic_semester_reports.sql; no POS110/111-115. Existing Owner ledger80 matches production baseline,10 superseded and18 reconciled omissions are expected. Numeric prefixes overlap with SUQ: use exact filenames/checksums, never number-only tracking. New15-table/17-sequence academic runtime manifest needs least-privilege rehearsal. No live migration/GRANT authorized or executed.

Before migration approval: Owner obtains a consistent protected production backup/provenance manifest, checks SHA256, restores to a fresh isolated local target, verifies ledger/objects/constraints/approved row/reconciliation fingerprints, takes local backup, applies110 then111 and scoped runtime grants, reruns academic/e-Rapor/Wali/attendance/AutoAlfa/Wallet tests and restores an independent target to prove recovery. Historical NULL periods remain unmapped; do not fabricate backfill.

Rollback: application source/image rollback can retain additive nullable fields/new tables and all snapshots/audits; do not destructive-DOWN or restore a production database over newer financial writes. Forward audited correction after academic data is used. Backup/restore must first be tested offline.

No Release B deployment authorization was given. No push/deploy/production write/plan/env change. Source Release A remains active. No APK is part of B. Native Wali/physical/device and operator acceptance remain untested.
