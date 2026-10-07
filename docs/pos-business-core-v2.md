# POS Business Core V2 — local implementation

## Audited baseline

Baseline `3357dee8070781fb13654906107f6f452c8dbf22`. Before redesign, inspected
migrations 094–096, posService, posMobileService, posAdminService, Admin
PosAdminPage and the POS mobile application.

V1 has sound transactional checkout, deferred Wallet reconciliation, immutable
posted snapshots, request hashes, row locking and physical cash shift formulas.
It assumes one educational unit per merchant and a tenant-admin cashier. It has
no stock/HPP, merchant account, supplier/AP, customer/AR or online domain.
One payment per sale prevents split payment. Amount-only refunds cannot prove
stock return quantities. These are architectural limitations, not UI defects.

## Compatibility

Do not rewrite 094–096 or guess legacy actors/ownership. New additive 097 isolates
merchant-owned books. Keep existing history and original actors. No automatic
santri/customer copying or inferred HPP/stock. V1 remains a compatibility surface;
V2 is incomplete until its checkout, UI and authorization integration gates pass.

Merchant ownership INTERNAL/EXTERNAL is separate from tenant integration,
authorized Wallet units and terminals. Tenant authorization is not merchant-book
membership. Merchant users are independent of tenant Admin users.

## Accounting

Integer Rupiah and whole product units initially; fractional input is rejected.
FIFO cost layers preserve exact integer cost. Product locks serialize allocation.
Unknown opening stock must never be assigned invented cost. Opening stock is an
explicit audited adjustment with supplied known unit cost.

Money movements are append-only signed entries. Capital is equity, not revenue;
withdrawals are equity, not operating expense. Wallet settlement is unresolved
business policy, not physical drawer cash. No automatic Buku Kas posting.
Posted returns use reversal records.

## Completion gates

Merchant/security → inventory/purchases/AP → customers/AR → money → checkout and
returns → Wallet adapters → online → reports → Admin boundary → mobile role UX.
Tests use only a guarded localhost database. Missing layers are incomplete, never
fake menu shells, invented financial reports or product acceptance PASS.

## Current executable checkpoint (not a complete V2 product)

097 UP/DOWN/UP, independent bcrypt-12 merchant login + hashed expiring session,
OWNER/SUPERVISOR/CASHIER server authorization, multi-merchant membership,
profile projection, product/customer/supplier/account/terminal masters,
FIFO stock adjustments and purchases, AP payments, capital/expenses/income/
prive/transfers, own shifts, cash/bank/QRIS/registered-credit sales, split
payment, AR collections, branded receipt snapshots and custom-period reports
are implemented with real PostgreSQL fixture tests. Anonymous credit and
credit-limit overruns fail closed. Posted records cannot be updated.

The V2 router is intentionally not mounted in the application yet. No new menu
is exposed. Existing V1 application and its acceptance APK are unchanged.

Still required: broader financial reversal types, Wallet/RFID/barcode canonical integration,
merchant onboarding/settings/account assignment UI, inventory/opname UI,
customer/supplier CRM/aging/report completeness, online stock reservation/orders/
shipping/storefront, tenant control-plane projection and role-based mobile UX.
Unsupported Wallet or ONLINE checkout is rejected, never simulated as paid.
No settlement policy is invented.

## Runtime privilege plan (no production grants)

All V2 tables: SELECT as used by service. Append-only operations, lines,
payments, movements, layers and allocations: INSERT only; no UPDATE/DELETE.
Products/accounts/parties: UPDATE(id) is required for PostgreSQL FOR UPDATE
locks; profile/master edit privileges are not yet implemented. Memberships,
users, sessions, businesses and terminals need UPDATE(id or token_hash) for
FOR SHARE, not blanket UPDATE. Shifts need INSERT, SELECT and UPDATE only on
status, closed_at, actual_cash, expected_cash, difference. Merchant sessions
need INSERT and DELETE for logout. Login limit rows need INSERT and UPDATE
attempts/started_at. User creation needs INSERT users/memberships, not tenant
Admin permission. These tables use client-generated UUIDs: no sequence grant.
Schema USAGE only; no CREATE, ownership, superuser or broad ALL PRIVILEGES.
The exact per-table/per-column grant plan is executable in the guarded local
runtime fixture test. It also includes UPDATE(id) on tenants for FOR SHARE;
there is no runtime tenant lifecycle/status mutation in the V2 service.
Future tenant lifecycle maintenance needs a separately audited deletion plan.
No runtime grant has been applied to production.

The rollback refuses to remove tables after any financial or shift history
exists. Rehearsal UP/DOWN/UP occurs only before posting disposable history.

## Formulas and limits

On hand = signed movement sum = received layer quantities minus allocations.
FIFO uses created_at, then UUID as deterministic tie-breaker under product locks.
COGS = allocated quantities × immutable layer unit costs. Purchase amount =
quantity × supplied authorized purchase cost. Sale prices come from product
master, not client fields. Order discount is cumulatively allocated to lines to
preserve exact Rupiah. Sale total = payments = paid + new AR. Purchase total =
paid + new AP. Collection/payable payment has its own operation, never a new
sale/purchase. Monetary balance is signed account movement sum.

Shift expected cash = opening physical cash + linked CASH sale receipts minus
linked cash sale returns when that module is implemented. AR/AP, bank, capital,
prive and Wallet clearing are not implicitly drawer movements. General merchant
account and physical shift drawer are distinct balances.

Report gross profit = posted sales minus posted returns minus net FIFO COGS; operating result adds other
income and subtracts operating expense. Capital/prive excluded. Do not call this
net profit. Online completeness is explicitly absent in this checkpoint.

## Verified local checkpoint

- `npm run test:pos-business-v2`: 40/40 real PostgreSQL groups, financial and
  stock difference Rp0, migration UP/DOWN/UP, forced rollback, concurrency,
  application authorization and exact least-privilege runtime operations.
- `npm run test:pos-v1`: 23 PostgreSQL groups plus static contract PASS.
- `npm run test:pos-admin`: 14 PostgreSQL groups plus static contract PASS.
- `npm run test:pos-mobile`: 19 unit tests and 11 PostgreSQL groups PASS.
- `npm run test:absensi-rfid-final`: 23 source/executable suites PASS.
- `node scripts/test-device-management.js`: PASS.

These are local software results, not UI/physical acceptance or production
reconciliation. Merchant onboarding, broader reversals, Wallet adapters, online shared
stock/reservations, comprehensive reports and both UI integrations remain gates.
Do not run 097 on production or publish this checkpoint as a completed V2 POS.

## Local continuation: returns, CRM and aging (PARTIAL product)

Migration 098 is additive: deferred INSERT-only return reconciliation triggers.
It does not edit migration 097 or existing financial rows. Local rehearsal runs
UP -> DOWN -> UP on an isolated loopback PostgreSQL fixture, preserving a SHA-256
fingerprint of every original ledger row. DOWN refuses after posted returns.
No new table/sequence privileges are needed: existing SELECT/INSERT history
privileges and product/account/shift lock privileges suffice. No production grants.

`sale-returns` and `purchase-returns` require `returns.post` merchant permission.
Original operations stay immutable. Return lines carry original product snapshots,
actor/time/reason/source/idempotency relationship; quantities cannot cumulatively
exceed original quantities. Source advisory locks serialize return and debt payment.
Retries replay one committed operation; changed payloads conflict. Whole-Rupiah
partial values use cumulative allocation so full return sums exactly to discounted
original total. COGS restores original FIFO allocation costs, not current prices.

Refund allocation is explicit: outstanding AR/AP first, then original receiving/
paying accounts in stable account UUID order. No arbitrary new refund account.
Cash sale refunds require the current operator's open shift and matching cash
account. Manual BANK/QRIS refunds require `refund_confirmed=true` and a reference;
paid supplier refunds require confirmed receipt. Credit returns reduce debt and
cannot invent a payout. Purchase returns consume only unconsumed ORIGINAL purchase
layers, rejecting unsafe returns even if unrelated product stock exists.
Supplier refunds affect the merchant account, not the checkout drawer.
These are operator-recorded confirmations, not payment-provider verification.
Wallet refunds are NOT supported yet; Wallet checkout remains fail-closed.

CRM `/customers/metrics`: separate preaggregations avoid join multiplication.
Lifetime gross spend, returns, net spend, POS/ONLINE net channel spend, count,
last purchase, whole-Rupiah gross-ticket average, and outstanding AR come from
canonical ledgers. SPEND/FREQUENCY/RECENT rankings are allowlisted and tie-broken
by customer UUID, capped at 200 customers. Guests are not merged or granted credit.
ONLINE fields support existing ledger channel semantics; they do NOT prove an
online order/checkout implementation.

`/debts/aging` uses source-level net signed debt, not sum of original invoices.
It reports CURRENT, 1_30, 31_60, 61_90 and 91_PLUS buckets plus per-source/party
outstanding, using merchant-local report date. Due day is CURRENT. Historical
as_of uses operations posted on/before that date, not today's net debt.
Both projections require reports.read; cashier private-finance access is denied.

Reports distinguish gross sales, returns, net sales, channel net sales and net
COGS. Gross profit = net sales - net COGS. Payment-method gross sale components
sum to gross sales. Refund account movements + returned receivable sum to return
value; later AR collection/refund is not mislabeled as original sale payment.
No Wallet debit is called physical cash and no Buku Kas posting is introduced.

Evidence: V2 foundation 40/40 and continuation 24/24 PostgreSQL groups PASS;
partial/full/concurrent returns, AP payment/return race, original multi-cost FIFO,
discount rounding, strict runtime privileges, forced rollback, HTTP authorization,
immutable history, schema rehearsal and reported money/stock reconcile Rp0.
Existing POS V1 (23), Admin (14), mobile (19 unit + 11 DB), Attendance (23 suites),
device-management and mobile lint remain PASS. These are LOCAL synthetic results.

Known gaps: canonical V2 Wallet/credential/refund integration; opaque barcode
provisioning; physical readers; storefront/order/shipping state machine; shared
POS/ONLINE reservation; online KPIs; settlement policy; onboarding/control-plane
and UI. V2 is mounted only in isolated HTTP integration tests, not server.js.
Do not deploy, run a production migration, invoke EAS or claim full V2 completion.
