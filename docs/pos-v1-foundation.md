# POS Kantin V1 — Phase 1 backend foundation

Local feature implementation only. Migration 094 is **not applied to production**.
No UI, APK, firmware, gateway, inventory counts, settlement or Buku Kas posting.
Existing merchant/device identities are reused; new `pos_enabled` defaults false.
Unresolved/NULL-unit merchants and terminals are rejected, never inferred or
backfilled. Attendance terminals cannot be converted through this API.

## Authority and API

Mount `/pos` uses the existing Admin JWT/session and tenant middleware. Each
operation rechecks the current user, tenant status, permission and explicit unit
inside its transaction, using existing `loadVerifiedUser`/`assertUnitAccess`.
No `scope=all` fallback, including reads in this first phase. The authenticated
tenant/user is authoritative, not body `tenant_id` or cashier identity.
Selling also requires active merchant assignment and enabled POS terminal in
the same concrete unit/merchant. A device secret cannot authorize a cashier.
Cashiers need POS permissions, not `wallet.manage`, topup or adjustment powers.

Endpoints (all authenticated, unit-specific):

| Endpoint | Permission | Contract |
| --- | --- | --- |
| GET `/catalog` | pos.view | query unit_id, merchant_id; scoped products/categories |
| POST `/categories` | pos.products.manage | unit_id, merchant_id, name |
| POST `/products`, PATCH `/products/:id` | pos.products.manage | full sku/name/price/category_id/active/available fields |
| POST `/merchants` | pos.config.manage | new canonical merchant identity, explicit authorized unit and name |
| POST `/merchants/:id/config` | pos.config.manage | enable/disable POS only; proven existing unit required |
| POST `/terminals/:id/config` | pos.config.manage | existing same-unit/merchant non-Attendance terminal only |
| POST `/merchants/:id/cashiers` | pos.config.manage | existing active tenant user, unit access, active assignment |
| POST `/shifts/open` | pos.shifts.manage | merchant_id, terminal_id, opening_cash |
| POST `/shifts/:id/close` | pos.shifts.manage | same cashier/terminal, actual_cash; server computes expected/difference |
| POST `/checkout` | pos.sell (+ pos.discount if used) | stable request_id, merchant_id, terminal_id, shift_id, items, payment |
| GET `/sales/:id` | pos.view | immutable sale/items/payment in active unit |
| POST `/sales/:id/confirm-payment` | pos.sell | explicit confirmed=true and reference, original open cashier shift |
| POST `/sales/:id/void` | pos.sell | unpaid DRAFT only, reason and original open cashier shift |
| POST `/refunds` | pos.refund | payment_id, stable request_id, positive amount, reason; cash requires current shift_id |
| POST `/refunds/:id/confirm` | pos.refund | external refund only, confirmed=true and external return reference |

Every body includes unit_id (or explicit workspace X-Unit-Id). Money responses
are decimal integer strings; send strings for large BIGINT input amounts.
Unsafe JS numeric inputs, fractions, negative amounts and overflow are rejected.
Product prices are read/locked server-side. Client price/subtotal/grand_total
fields are ignored; they cannot affect charged amounts. Cart limit: 100 lines.
Duplicate product lines are rejected. Monetary discounts require reason and
pos.discount; cumulative integer allocation reconciles exactly without rounding
loss or negative lines. SKU, product/category, merchant/cashier/terminal names
are snapshotted. Archiving/repricing cannot rewrite completed history.

## Payments, transactions and retry

- RFID: ONLINE only, Wallet and RFID unit entitlements required. Isolated POS
  trim/lowercase-hex credential lookup; ambiguity checked before eligibility.
  Active identity + active/non-exited membership + existing same-unit account
  required. No account creation or another-unit fallback. Frozen/closed reject.
  Account row locked FOR UPDATE before sufficiency/debit; sale/items/payment,
  canonical ledger debit and account update commit in one transaction.
- CASH: tendered >= server total; change=tendered-total. Payment amount is total,
  not tendered. No Wallet/Buku Kas effect.
- TRANSFER_QRIS: `payment.confirmed` defaults false (DRAFT/PENDING). Explicit
  cashier confirmation records actor/time; no proof upload/gateway auto-approval.
  Later confirmation requires an explicit external reference. An explicit
  confirmed checkout is a manual cashier attestation, not bank verification.

An advisory transaction lock + unique tenant/request_id serialize retry. Hash
includes normalized cart, authenticated actor, unit/merchant/terminal/shift,
discount and method-specific data (credential digest only, never UID). Same
key/payload returns original sale even after product changes; mismatch is 409.
Replays are still subject to current authorization. RFID remaining balance is
the immutable debit's `wallet_balance_after`, not a misleading live balance.
No raw UID or device credential is stored in POS snapshots or emitted by POS
logging/error responses. Do not put credentials in request URLs.

## Shift, void and refund

One OPEN shift per tenant terminal and cashier, DB-enforced. All Phase 1
checkouts require an OPEN shift. Checkout, cash refund and close share the
drawer row lock. Closing with unresolved DRAFT sales is rejected. Closed shift
cannot be changed or used for new checkout. Expected cash = opening cash +
confirmed cash payments - confirmed cash refunds. RFID/QRIS excluded. Actual
cash and difference are persisted independently; nonzero count difference is
reported, never silently adjusted. No arbitrary drawer adjustment feature.

VOID preserves unpaid sale/payment history and has no Wallet credit. Paid
sales cannot be voided. Refunds preserve original totals/items and are linked
corrections with reason/actor/time. Per-payment lock and reserved refund total
(including external pending) prevent cumulative over-refund.

RFID refunds credit the original exact account atomically; frozen accounts may
receive corrective credits, closed accounts reject. Cash refunds debit the
current authorized OPEN drawer. Transfer/QRIS refunds are PENDING until an
explicit return reference and manual confirmation; never pretend bank funds
have returned. Amount-based partial refunds are implemented; later item/quantity
allocation can extend linked refund lines without changing original quantities.

Deferred DB constraint triggers enforce sale/items/payment exact totals,
canonical Wallet payment/refund references and cumulative refund limits.
Immutable UPDATE guards protect sale items, completed sales/payments/refunds
and closed shifts. No DELETE trigger blocks authorized tenant lifecycle cleanup;
normal POS exposes no DELETE endpoint and requires no DELETE grant.

## Runtime least-privilege plan (no production grants performed)

| Objects | Operations needed |
| --- | --- |
| pos_cashier_assignments | SELECT, INSERT, UPDATE |
| pos_categories | SELECT, INSERT (no edit API in Phase 1) |
| pos_products | SELECT, INSERT, UPDATE |
| pos_shifts, pos_sales, pos_payments, pos_refunds | SELECT, INSERT, UPDATE (guarded lifecycle only) |
| pos_sale_items | SELECT, INSERT; no UPDATE/DELETE |
| tenants/users/unit_pendidikan/user_unit_scope/RBAC/unit_features | existing SELECT |
| merchant_rfid | SELECT, INSERT scoped new merchant; UPDATE(pos_enabled) only for POS config |
| devices | SELECT; UPDATE(pos_enabled) only for POS config |
| santri, santri_units | SELECT; existing UPDATE(status) needed for PostgreSQL row-lock reads; POS never writes identity/membership |
| wallet_accounts | SELECT; UPDATE(current_balance,updated_at) |
| wallet_transactions | SELECT, INSERT; USAGE wallet_transactions_id_seq |
| merchant_rfid_id_seq | USAGE for explicit new merchant INSERT only |

No POS DELETE, sequence ownership, DDL, ALL PRIVILEGES, superuser, CREATEDB,
CREATEROLE, replication, BYPASSRLS or ownership transfer. Existing general
runtime privileges outside POS are not changed/revoked in this phase. The local
test validates actual execution using a restricted role and denies DELETE,
item UPDATE and schema CREATE. Public schema USAGE/connect are sufficient;
POS UUID IDs require no sequence grants. Only the two existing sequences named
above are needed by actual INSERT operations; no blanket sequence permission.

## Migration and reproducible evidence

094 adds eight scoped POS tables, POS capability columns/indexes, seven POS
permissions and superadmin mappings. No tenant/device ownership inference,
Wallet rewrite, legacy saldo/backfill, Attendance changes or runtime grants.
094 rollback is for empty non-production rehearsal only and rejects existing
sale/refund/shift history. POS permission keys must be absent before first UP;
they are new to this source baseline. Restore/recovery planning before a later
production release is separate; no production migration is authorized now.

`npm run test:pos-v1` includes source/manifest checks and REAL PostgreSQL tests.
The DB harness refuses any target except localhost:55439, pos_test_owner,
database pos_phase1_test. It does not read DATABASE_URL or connection .env.
It resets only that isolated fixture schema. Existing Wallet 078/079 are
rehearsed on empty synthetic baseline; POS 094 UP/DOWN/UP is also exercised.

Observed exact examples:

- Wallet 20000: parallel independent 15000 checkouts -> one paid / one
  INSUFFICIENT_BALANCE; final 5000; one debit and one payment.
- RFID paid sale 15000 = payment 15000 = ledger debit 15000.
- Partial RFID refund 5000 = canonical same-account credit 5000.
- Cash sale 37000, tender 50000, change 13000; payment contribution 37000.
- Drawer fixture: opening 10000 + cash sales 52007 - refunds 17000 = 45007;
  entered actual 45005, reported difference -2 (intentional counting fixture,
  not a financial reconciliation mismatch).
- Ledger/payment/refund/account reconciliation mismatch count = 0.

Known pre-existing withdrawal status-check gap remains untouched; POS has its
own explicit account-status validation. Legacy /rfid/payment, /rfid/refund,
santri.saldo, transaksi_rfid, Attendance and all EDC firmware remain unchanged.
