# Auto Alfa minimal production recovery — 1 November 2026

Decision: CONDITIONAL GO for this narrow source patch, pending explicit Owner deployment approval. This does not certify Neon Free budget safety or hardware acceptance. No deployment, push, production SQL/write, migration, GRANT, environment/plan change or restart is part of this release preparation.

## Verified baseline and ledger

Parent is deployed Git SHA a5a3aa40c127841dfdf83ac3b8eaa99a1f4a2b2c, not canonical development HEAD. Railway deployment f8efbb8e-b41d-4731-98b8-a89a8775322e maps to this source through metadata, one RUNNING instance on api.klikpesantren.com. Production target previously verified through Railway configuration: ep-still-meadow-ao61w8sx-pooler.c-2.ap-southeast-1.aws.neon.tech / neondb.

Owner-supplied export fancy-river-27105749_production_neondb_2026-11-01_09-23-15.csv: 80 rows, 80 unique filenames, 64-character hex checksums, filename/checksum/applied_at. SHA256 c9cf2644aefec66f5140853f08b1247ab01c6eac555550bb310e4f47063b677c. Export production origin is Owner-attested and linked to prior target verification; filename alone does not independently establish the endpoint.

All80 records MATCH the108 non-rollback SQL files in immutable parent Git blobs, applying the deployed runner's original/LF/CRLF checksum equivalence. No mismatches or extra/unknown rows. Of28 source files absent from ledger,10 are explicitly SUPERSEDED and18 have APPLY_RECONCILIATION policy; every designated replacement is recorded with matching checksum. Missing required migrations under this policy:0. No migration is inferred missing from numeric maximum or count differences. Matching ledger proves recorded source identity, not absence of every possible live DDL drift. Baseline timestamps may be ledger-recording time rather than original DDL execution time.

Read-only catalog evidence obtained before release preparation verifies attendance columns, membership dates, runtime attendance/sequence grants, occurrence/result uniqueness and due index. Runtime cannot SELECT schema_migrations; no new privilege was granted. Current task uses the Owner export offline and does not query production.

## File manifest and dependencies

Production changes are exactly:

- services/attendanceAutoAlfaService.js: reuse tested deadline scheduler, startup/materialized catch-up, closed-candidate exclusion, bounded5/10/20/40/60-minute failure backoff, cooldown/coalescing, safe structured logs and no session advisory lock. Canonical occurrence transaction locks and unique constraints remain.
- routes/attendanceSessionRoutes.js: import and3 hooks after successful session creation or committed schedule/session edit. Failed writes/commits and denied requests do not reschedule.
- services/attendanceCoreService.js: only closeOccurrence membership cutoff changes. Do not mark a student/teacher before joined_at or enrollment.start_date relative to occurrence date. Other core behavior is the production baseline.

Tests: scripts/test-november-scheduler.js, scripts/test-attendance-auto-alfa.js, scripts/test-auto-alfa-release-hooks.js. Documentation: this file. No dependency, package, migration, firmware or mobile changes. Existing072/083/092 attendance/membership foundation and tenant-feature/core dependencies remain; no new schema or grants are intended.

No new academic-year/semester snapshot code, e-Rapor or POS changes are imported. Baseline already contains existing POS functionality and it is preserved, not re-released as a new feature. In particular resolveOccurrence is the baseline implementation, without canonical's new academic_semesters queries. Billing, RFID and financial processing are unchanged.

## Local evidence on exact candidate

- Fake-time scheduler21 PASS: deadlines, idle behavior, retries/recovery, reschedule cooldown, overlap coalescing and singleton restart.24h no-deadline=one startup run plus deadline lookup; outage24h=27 attempts versus288 with fixed5-minute retry. This is not measured CUh.
- Job contract PASS: transaction rollback, tenant-local day, overdue recovery, duplicate closure and removal of session advisory lock.
- Mock route handlers11 PASS:3 hooks run exactly once after write/commit; failed write/commit, denied permission and cross-unit rejection do not reschedule. No production DB or HTTP calls.
- Real PostgreSQL24 PASS on loopback55439 isolated schema in an existing guarded local fixture: multi-tenant/timezone, membership cutoff, manual preservation, concurrent effective-once closure, failures, closed/cancelled/future windows; public fixture fingerprint unchanged. Test uses a per-tenant feature stub. Academic-snapshot assertion explicitly checks baseline NULL behavior. Actual production pool integration and physical RFID were not tested.
- Completed-day fixture sample39 ->1 runner SQL statements,28ms ->2ms; not a production benchmark or measured saving. Empty enforcement4 ->1 SQL. Runner counts exclude feature-provider pool work and subsequent deadline query.
- Offline migration line-ending/content-drift and reconciliation-policy tests PASS.
- Prior local Wallet27/settlement15 groups PASS with Rp0 reconciliation. Not rerun for this attendance-only patch; financial source unchanged.

## Approval and smoke after a future authorized deployment

Before approval, review parent/diff and confirm no intervening production deployment, schema/grant or endpoint change. Deploy this branch's commit only, never broad-merge the academic branch. No migration command or grant script is needed/intended.

After explicit Owner GO: verify expected release SHA/image/instance count; startup catch-up and structured scheduled/completed/idle events; no continuous minute scan. Verify login/context, manual attendance, one tenant-local deadline and one schedule edit. Check duplicate-close protection and no unexpected enrollment Alfa. No financial test transactions on production. Review device status/card synchronization/revocation with actual hardware before any separate firmware/cache change. Production smoke and hardware results remain NOT TESTED at release preparation.

## Rollback

Restore verified previous image sha256:8890bfb323b5f82513732d5c746c24186345f2c2459040d6ffbb7f37b95e980c / parent source a5a3aa40c127841dfdf83ac3b8eaa99a1f4a2b2c if deployment smoke fails. There is no DDL rollback. Keep all attendance records/events and financial ledgers; code rollback cannot undo results already produced. Any disputed attendance result requires canonical audited correction, not DELETE. Previous code reintroduces minute polling and pre-membership risk; Owner must assess recovery tradeoff. No rollback is executed now.

## Neon Free acceptance and remaining risks

Actual November usage, Console project/branch settings, active/suspend periods and per-feature CU attribution remain unmeasured. Polling source on baseline remains: Device/Audit3s; RFID Device/Monitor10s; firmware heartbeat30s and snapshot around60s; billing startup/hourly and per-lookup. Actual active clients/devices are unknown. These paths can prevent autosuspend; no caching/revocation/security or billing policy was weakened.

Hypothetical0.25CU always active for720November hours=180CUh, above user's100CUh allowance; internal70CUh permits280active hours including idle tails. Capacity and autosuspend assumptions are not verified current settings. Fixing Auto Alfa alone does not certify Free feasibility. Failed53000 attempts are not successful queries or billable wakeups.

After authorized deploy, observe existing Console usage/active time daily initially, including one genuine idle window and actual device/Admin activity. Propose warnings50/70/85CUh of100 allocation; do not silently configure alerts, paid monitoring, feature shutdown, provider plan/autoscale changes or SQL polling. Compare comparable operational windows before claiming savings. This release schedules no monitoring job and adds no diagnostic SQL.

Legacy NULL joined/start dates do not prove complete historical membership. Feature-provider production reads, all live constraints/triggers, transaction-pool behavior and physical devices remain limits of local proof. Deadline reschedule hooks cover the3 verified session write paths; direct external DB edits are outside that contract.
