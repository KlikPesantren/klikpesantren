# SUQ SHOGIR final source / production APK candidate

3 November 2026. Git HEAD identifies this RC; source SHA must be injected into EAS POS_BUILD_COMMIT. Parent is 2edffe6a. WS1–WS4 are retained. No production mutation, push, deployment or APK testing build performed by packaging.

## Implemented

- Existing-ledger cutoff: one immutable checkpoint, current business day, closed-shift requirement, expected snapshot hash, explicit reason/evidence. Zero financial postings at finalization. Owner corrections use canonical OPENING_ADJUSTMENT journals, real source invoices/FIFO, typed immutable audit, idempotency and existing deferred financial constraints. Not a second balance ledger or retrospective period rewrite.
- Mixed manual discount: only BASE/General parts without promos. Special prices, promos and bundles stay final. Canonical product/part order and cumulative floor IDR conserve every Rupiah; per-part and per-line allocations stored for original-value partial refunds/reports.
- Owner takeover, Admin-only credential lifecycle, reasoned unique SKU/barcode changes, draft count + Owner approval, scoped cost fields and durable retry retained.
- Master product/price/promo/bundle before/after actor audit, scoped Owner history with keyset paging. Normal application transactions set verified audit context. Maintenance/fixture owner SQL with no context is not falsely attributed. No claim of complete database-forensic logging against a compromised database role.
- Searchable vertical selectors replace legacy horizontal selectors; 650-choice UI test. Existing supplier directory/history remains bounded; do not claim an unlimited server directory. Catalog/product search covers 2,001 products/67 pages.
- Safe error correlation/status handling, production timeout messages, read-only diagnostics and native NFC guidance. No token/password/UID included in diagnostics.

## All22 findings

CLOSED local: SQ-01,02,03,04,05,06,07,08,09,11,12,13,14,16,18,20,22 =17.
PARTIAL: SQ-10 (bounded supplier/history directory beyond selector UX), SQ-17 (real provider/bank reconciliation/production rollout), SQ-19 (Owner actual workbook/native picker acceptance), SQ-21 (external economic verification, tracked assets are not complete balance sheet) =4.
BLOCKED: SQ-15 native physical card/printer acceptance =1. OPEN=0. No remaining confirmed P0/P1 code defect in tested scope. Local CLOSED is not physical acceptance or production GO.

## Deployment package — explicit approval still required

Verified production 329028cb, deployment073dfd34, one replica; target fancy-river-27105749 / ep-still-meadow-ao61w8sx / neondb. Current ledger88 through121; both122/123 absent. SKU/barcode UPDATE already present; treasury UPDATE(id) absent. Financial reconciliation function matches reviewed baseline105. Existing private129-table backup checksum verified, source Release A; a **fresh consistent backup of current production is required immediately before rollout**. Do not restore the older backup over current data.

1. Recheck source/deployment/endpoint and schema/financial function drift. Create a fresh consistent owner backup in the protected local location and verify provenance/SHA; no grants to runtime for backup.
2. After explicit Owner release approval, apply exactly122 then123 with hashes in DB_ACL_MANIFEST.json and record ledger through the migration runner policy. No academic or other pending migrations. No auto-migrate at startup.
3. Apply exactly the missing SELECT/INSERT on three new tables and UPDATE(id) on cash_accounts, to existing kp_app_runtime_20260917. No UPDATE/DELETE on immutable ledgers, snapshots or audit; no new balance authority.
4. Push normal dedicated RC branch if needed by verified official release path; deploy only frozen backend RC, no frontend/academic changes, no plan/secrets changes.
5. Smoke login/context/permission/report non-financial using authorized accounts. No dummy sale/attendance/Wallet mutation on production.
6. Install signed production APK only after compatible backend is available; run physical acceptance with approved safe test setup, without real money for testing.

## Recovery

No automatic database restore/down migration. Retain additive schema and immutable history. Preserve current verified Railway image/source identity before release. Preferred source recovery candidate2edffe6a retains Owner approval and Admin-only credential controls; compatibility must be rehearsed on schema123 before authorizing its use. Current329 image is available as incident fallback but reintroduces older POS policy gaps: never imply normal operations remain safe after reverting; stop affected usage and forward-fix. New APK needs cutoff/mixed-discount endpoints and cannot be accepted against an older backend. No unbounded repeated deploy. Auto Alfa deadline scheduler/hook source stays unchanged.

## Acceptance / remaining risks

Local:54 financial/policy scenarios,10 committed concurrency scenarios,7 catalog/XLSX groups,184 app cases, lint with existing import warnings. No new background SQL polling. NFC/barcode/camera/Print/Share source and dependency config included. Native release compile/signature/manifest/ABI/source/API/SHA are verified after the EAS job finishes; physical card, printer, camera picker and real workflow acceptance remain NOT TESTED. Production release status is conditional on approval, rollout and physical acceptance, even if an APK download exists.
