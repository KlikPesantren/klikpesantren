# POS Kantin V1 — Phase 3 local cashier application

Baseline: Phase 2 `14351f5921bd3e9c29796a241435edebf0bfc91c`.

## App and environments

Independent `pos-app/`, display **POS KlikPesantren**, package `com.klikpesantren.pos`.
Expo 56 / React Native 0.85 / React 19.2.3. No EAS project, Firebase copy, cloud
build, Wali package modification, or new migration.

`POS_ENV=development|staging|production`, `EXPO_PUBLIC_POS_API_URL` contains only
the non-secret API base. Development defaults to loopback; Android emulator may
use `http://10.0.2.2:3000`. Other HTTP hosts are rejected. Production defaults to
`https://api.klikpesantren.com`. Staging/production must use HTTPS. These APIs and
migrations 094/095 are **not deployed/applied by this task**.

Local: `npm --prefix pos-app install`, `npm --prefix pos-app start`.
No cloud-build scripts are supplied.

## Cashier workflow

Tenant `/auth/login` with tenant slug, username, password. The fresh DB actor,
existing RBAC and `pos_cashier_assignments` decide merchant/unit access. Context
bootstrap is an authorized directory read, not a tenant-wide sales read. Concrete
catalog/summary/preview/history/recovery calls require specific unit, merchant
and registry terminal. Disabled, unresolved, non-POS and Attendance devices are
excluded; forged IDs fail closed. An open shift pins context on both API and UI.

Five bottom tabs: Beranda, Kasir, Transaksi, Produk, Lainnya. Beranda shows actor,
context and server-derived current-shift totals. Open/close shift uses Phase 1;
drawer expectation excludes RFID/QRIS and includes current-drawer cash refunds.
Catalog and history page sizes cap at 50, stable ordering; unit switch immediately
clears old rows and generation guards prevent stale requests repainting them.

Cart calculates integer BigInt previews only. Server recalculates prices,
availability and discounts. Discount control requires `pos.discount` and reason.
Cash receipt uses server tender/change. Manual QRIS distinguishes DRAFT/PENDING
from PAID/CONFIRMED and requires explicit actual reference confirmation.
Refund/void use Phase 1 services, reasons and explicit confirmation. RFID refunds
credit original account; cash requires open drawer; external refund stays pending
until explicitly confirmed. No financial offline queue, inventory, gateway or
automatic Buku Kas posting.

## Durable payment recovery and secrets

SecureStore holds token and one pending immutable request, including credential
when necessary. Chunked journal values remain below 2KB. Cleanup metadata is
written first; READY commit manifest is written last. Interrupted writes cannot
submit, fail closed, and all staged chunks remain removable on logout.
Failure/corruption fails closed. A request ID is created and durably persisted
**before** submit, UI locks double taps, timeout/5xx/auth uncertainty preserves
UNKNOWN. Restart loads that exact owner-bound request. Read-only request-status
lookup returns the committed receipt; NOT_FOUND retries the exact same payload
and key. Refund recovery repeats its Phase 1 idempotent key. A different user
cannot resume another user's journal. Reauthentication with the same user is
available. Logout is blocked until uncertain payment resolves; afterward token
and journal are erased. An interrupted chunk erase fails closed rather than
silently creating another checkout. Recovery after a damaged journal requires
controlled investigation; do not manually discard it to retry a payment.

Browser preview credentials are memory-only and intentionally **not** restart
durable. Android SecureStore is the supported durable financial client. There
is no AsyncStorage/localStorage secret persistence or client/server UID logging.

## RFID hardware

`CredentialReader.scan()` abstracts the reader. `TestCredentialReader` is gated
by both development environment and `__DEV__`, with hidden input cleared after
reading. Production does not pretend Android NFC equals RC522: physical adapter
remains **pending hardware validation**. Preview is read-only same-unit canonical
Wallet and active membership. Balance is checked again atomically at checkout.
No legacy saldo/Payment/POS handler, device secret, Attendance pairing, EDC or
firmware is reused/modified.

## Verification

`npm run test:pos-mobile`: static contracts, executable client/vault tests and
real localhost PostgreSQL/JWT HTTP tests, including response-loss/restart with
exactly one sale/payment/debit. Fixture host `127.0.0.1:55439`, database
`pos_phase1_test`, role `pos_test_owner`; hardcoded identity gates prevent any
production fallback. This suite resets **only that isolated fixture schema**.
Canonical login/JWT/financial code runs unchanged; test-only tenant lookup and
feature adapters account for the minimal fixture schema. Missing-account
projection test injects an explicitly empty same-unit read; Phase 1 separately
tests the real missing-account financial path.

Other gates: Phase 1/2, Attendance/device/Wallet/multi-unit regressions, frontend
build, POS ESLint, Expo dependency check, local Android bundle export. Local
bundle export is not APK/native/device acceptance. Browser helper ACL failure
and absence of connected Android device mean visual, soft-keyboard and physical
reader acceptance are **NOT EXECUTED**, not PASS.

Next: **Phase 4 — integrated acceptance, physical RFID reader decision, production
migration/deployment readiness**. No production action is authorized by Phase 3.

### Executed local evidence (2026-10-06)

- `npm run test:pos-mobile`: PASS; static native/security checks, 9 client tests,
  9 PostgreSQL/HTTP mobile groups (plus 23 Phase 1 setup groups).
- `npm run test:pos-v1`: PASS, 23 PostgreSQL groups and static financial guards.
- `npm run test:pos-admin`: PASS, 14 Admin groups plus Phase 1 fixture tests.
- `npm run test:absensi-rfid-final`: PASS, 23 source/executable suites including
  Phase 1/2A, sessions, multi-unit, secret rotation, RFID policy and Wallet separation.
- `node scripts/test-device-management.js`,
  `node scripts/test-device-management-routes.js`: PASS.
- `npm --prefix frontend run build`: PASS; existing large-chunk warning retained.
- `npm --prefix pos-app run lint`: PASS; targeted backend ESLint and `node --check`
  on new backend/test JavaScript: PASS; `git diff --check`: PASS.
- `npx expo install --check` in `pos-app`: dependencies compatible.
- Android Hermes and web exports: PASS locally, with final production HTTPS
  configuration verified separately. No native APK/AAB or cloud build.
- Private-credential pattern scan: 0 findings. Existing 094/095 checksums frozen.
- Visual acceptance: NOT EXECUTED. Browser helper failed twice with Windows
  deny-read ACL error; `adb devices` reported no connected device. No Android
  soft-keyboard, physical reader or real-device result is claimed.
