# POS Kantin V1 — Admin Control Center (Phase 2)

Local feature branch: `codex/pos-v1-admin-control-center`.
Starting Phase 1: `8c467c886882ecace9aadda2d8570f60f101c4f5`.
Production, credentials, firmware and deployment are unchanged. No POS APK.

## Navigation and ownership

`/pos/{dashboard,transactions,products,categories,merchants,cashiers,shifts,refunds,reconciliation,settings}` is the new POS KANTIN group.
Legacy Wallet merchant/refund URLs remain. The generic registry stays at Sistem → Perangkat (`/rfid-devices`), with a separate POS panel; no second registry.
The registry entry permits `rfid.view` OR `pos.view`. Its Attendance panel preserves the previous tenant/unit RFID feature and permission requirements. Attendance pairing, source, firmware, NVS and EDC01/EDC02 are unchanged.

Every POS Admin operation re-verifies the authenticated tenant/user/status/RBAC and canonical unit access inside its transaction. No client tenant ID/unit arrays are authority. All-unit reads require explicit ALL and a verified tenant superadmin. Writes require a concrete unit and reject ALL. Operator spoof is 403. Missing scope is 400 UNIT_REQUIRED; foreign tenant units remain denied by the existing unit guard.
The original Express request is passed to the scope resolver: Express 5's query getter must not be lost by object spreading. Real HTTP tests cover this, not only plain-object unit tests.

## Read API

`GET /pos/admin/dashboard`, `/transactions`, `/transactions/:id`, `/shifts`, `/refunds`, `/reconciliation`, `/management/:kind`.
Management kinds: products, categories, merchants, cashiers, users, terminals.
The parent `/pos` router applies canonical auth/tenant middleware; the service independently repeats authority checks.
Page size defaults to 25, maximum 100; deterministic ordering includes an identity tiebreaker. Search/date/merchant/cashier/terminal/method/payment/sale status filters are server-side. Reconciliation accepts a shift ID. Invalid calendar dates are rejected before SQL. Reports use a repeatable-read read-only transaction so financial values share one snapshot. No browser history-wide aggregation and no per-row query loop.

## Financial definitions

- Gross sales: SUM(grand_total) of PAID sales in the selected sale/business-date cohort.
- Refunds: SUM(CONFIRMED linked refunds) across the lifecycle of those selected sales. Refund date is not substituted for sale date.
- Net sales: gross minus those confirmed refunds.
- Average: floor(gross / paid transaction count), or zero when count is zero.
- Items: gross quantity from immutable paid-sale item snapshots; amount-only refunds do not invent refunded quantities.
- Refund rate: paid transactions with a confirmed refund / paid count (display truncated to two decimal places).
- Payment breakdown: only PAID + CONFIRMED payments. Pending TRANSFER_QRIS is displayed separately, never revenue. Wallet topups are never POS sales.
- Open shifts: current OPEN count by authorized unit/merchant/cashier/terminal, irrespective of historical sale date; displayed as a current operational gauge.
- Peak hours use the original sale timezone. Merchant/top-product summaries group by snapshot names to preserve historical truth.

RFID reconciliation compares POS amounts to their explicitly linked canonical Wallet debit/credit. Account, tenant, unit, source, type, direction and reference must match. Differences and invalid per-entry links are both exposed: +Rp1/-Rp1 cannot silently offset into a green total.
Cash expected = opening cash + CASH confirmed sales - CASH confirmed refunds attributed to that drawer. RFID and QRIS never inflate physical cash. Closed actual/expected/difference fields are read-only; NULL actual cash is not displayed as Rp0.
Money inputs remain integer strings; BIGINT formatting uses Intl + BigInt, never Number conversion for monetary amounts.

## Admin writes and lifecycle

Product create/edit/archive uses Phase 1 server-price authority. No inventory/stock field or hard-delete. Historical item/payment snapshots remain untouched. Category create/edit/active is merchant/unit scoped. New categories and merchants use the existing active defaults; edit supports deactivation.
Merchants reuse merchant_rfid. NULL/ambiguous unit displays PERLU KONFIGURASI to an authorized superadmin; explicit selected-unit assignment is required. Existing concrete-unit reassignment is blocked, never used to rewrite history. Conflicting device unit ownership is rejected.
Cashiers reuse existing tenant users and Phase 1 assignments. Assignment is not a permission grant; POS capabilities remain managed in the existing Roles UI. No wallet.manage expansion.
Terminal configuration updates the existing device POS capability/unit/merchant only. Attendance-mode devices are rejected. Changing merchant for a terminal with POS shift history is rejected. No credential/pairing/enable-status rotation.
Refund/void/payment confirmation use ONLY Phase 1 financial routes. The Admin UI is not a privileged bypass: active cashier assignment, permitted merchant/terminal and original lifecycle rules still apply. Cash refund requires the actor's OPEN drawer. RFID credits the original same-unit account; external return remains PENDING until explicit confirmation and reference. Void is for unpaid DRAFT only. Refund/Draft/Void history remains visible.
Refund retries preserve an idempotency key after uncertain network failure; an in-flight lock prevents duplicate submits. Success feedback is emitted before background refresh. Errors remain visible. Unit/page remount keys plus aborted read requests prevent stale responses/forms overwriting another workspace. Master lookup uses bounded server search/pagination. Pagination buttons are explicitly non-submit buttons.
Settings only links implemented merchant/cashier/device/Roles readiness. No gateway/printer/offline Wallet/accounting settings.

## Migration and runtime privileges

094 is unchanged (SHA-256 `0605eef6c75d82d076269aa12aac4f52aede96b74add5a48a7188f886fb30e51`).
095 adds `pos.reconcile`, maps it to global superadmin through existing RBAC, and adds reporting indexes on sale scope/date/sort, merchant/sort, shift scope/sort, refund scope/sort and product merchant/sort. Existing payment/refund reference indexes are reused. No historical financial updates, ownership backfill or production grants.
095 UP → DOWN → second UP is rehearsed against the guarded localhost fixture and preserves sale/item/payment/Wallet fingerprints. DOWN removes only 095 indexes/permission mappings. Neither 094 nor 095 has been applied to production in this task.

In addition to reviewed Phase 1 runtime privileges:

- SELECT on existing tenants/units/users/user_unit_scope, RBAC tables, merchant_rfid/devices, POS tables and wallet_transactions for scoped reporting.
- UPDATE(name,active) on pos_categories.
- UPDATE(nama_merchant,status,unit_id,location_resolution_status,pos_enabled) on merchant_rfid for explicit configuration.
- UPDATE(unit_id,merchant_id,location_resolution_status,pos_enabled) on devices for POS configuration.
- Existing Phase 1 INSERT/update/sequence privileges remain necessary for reused create/assignment/refund/void APIs; none is broadened for reporting.

No new DELETE, DDL, owner, superuser or schema-owner grant. Actual scoped config/report operations run under the isolated restricted runtime role. Production privilege changes: NONE.

## Verification and limits

`npm run test:pos-admin` runs static/frontend contract checks and real PostgreSQL integration. It first runs the 23 Phase 1 groups, then the 14 Admin groups. Exact localhost/port/database/role identity is checked before disposable fixture setup. No DATABASE_URL/production fallback.
Scale: 3,000 additional generated sales, 3 merchants, 3 units across 2 tenants, 3 cashiers and 3 payment methods. Cross-tenant data stays outside tenant-1 ALL; each of its two units has 1,000 scale sales. Page size 25 and non-overlapping pages are verified. Dashboard and transaction query counts are bounded independently of row count.
Selected scale cohort example: paid count 2,000; gross Rp200,000; RFID POS Rp66,600 = linked Wallet debit Rp66,600; debit/credit differences Rp0. A separate isolated negative test temporarily introduces two offsetting Rp1 ledger mismatches, verifies two invalid links, restores them in finally and asserts exact financial fingerprints restored.
Cash fixture: 10,000 + 52,007 - 17,000 = 45,007 expected; actual 45,005; observed drawer difference -2, deliberately retained as an audit example, not hidden or repaired.
Observed five-sample localhost medians around dashboard 74ms, transactions 16ms, reconciliation 82ms. These are synthetic local observations, not production SLA claims.

Required regressions: POS Phase 1; POS Admin; Wallet separation; RFID policy; device management and route contract; multi-unit; guru-unit scope; Attendance Phase 1/2A/sessions/hybrid; Absensi RFID final 23/23; targeted backend/frontend ESLint; JS syntax; frontend production build; migration manifest/checksum checks; git diff --check.
Browser visual/physical-device acceptance is not claimed by static/build tests. Responsive grids, table overflow and dark-mode tokens are implemented; live production acceptance belongs to a separately authorized release. No production smoke/deploy was performed.

Next phase only: Dedicated POS Android app shell + cashier workflow integration.
