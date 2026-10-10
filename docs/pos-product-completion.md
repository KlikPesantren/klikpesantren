# POS V1 Phase 3B — local product completion

Scope: dedicated mobile cashier presentation and canonical optional product image URL.
No production migration, deployment, financial operation, EAS build or physical reader claim.

## Daily flow

Login → authorized merchant/unit/terminal → open shift → Beranda → Kasir → cart
→ CASH / manual Transfer-QRIS / software RFID preview → immutable receipt
→ new customer → history/detail → authorized refund/void → close shift → logout.
Five icon-labelled tabs share a phone-first UI system. Cart, payment and shift primary
actions remain outside scrolling content. Developer review tooling starts collapsed,
is synthetic/read-only, and is excluded from production exports.

## Coverage map (automated software evidence, not physical acceptance)

| Requested scenarios | Evidence |
| --- | --- |
| 1–3 login/context, no shift, open shift | mobile PostgreSQL bootstrap/assignment/open-shift groups; V1 JWT and duplicate shift groups |
| 4–7 catalog, search/category, add, qty/remove | scoped mobile catalog integration; cashier domain cart tests |
| 8 discount permission/reason | workflow guard and V1 authorized discount/integer allocation tests |
| 9–12 cash/change, QRIS pending/confirmed | V1 real checkout/payment lifecycle; workflow tender/reference guards |
| 13–16 RFID preview/balance/wrong unit | read-only mobile preview and V1 wallet/membership rejection tests; workflow preview guards |
| 17–18 duplicate/timeout | concurrent PostgreSQL checkouts and real HTTP timeout/restart recovery with original request identity |
| 19–20 receipt/new customer | server immutable snapshots; receipt rendering; completed cart cleared before next checkout |
| 21 history/detail | server pagination/status/search/ownership integration; synthetic projection tests |
| 22–24 refund permission/partial/over-refund | V1 original wallet refund/concurrency; workflow reserved-refund guards |
| 25–26 lookup/offline | read-only scoped catalog; offline guard disables financial submission |
| 27–29 expected cash/close/no sale after close | V1 real SQL cash reconciliation and close-shift rejection; mobile runtime role reads |
| 30 tenant/unit/merchant/terminal isolation | V1, Admin and mobile scoped negative tests under actual isolated PostgreSQL |

Financial tests use ONLY localhost:55439 / pos_phase1_test synthetic fixtures.
Rp0 refers to exact canonical POS/Wallet reconciliation in these fixtures, not a new
production audit. An intentional cash-count discrepancy (-Rp2) is correctly reported,
not concealed as a reconciliation error.

## Minimal integration additions

096 adds nullable `pos_products.image_url` and a HTTPS/length constraint only.
Product create/edit accepts a public HTTPS URL; omitted field preserves existing value,
empty clears it. No uploads, binary storage, inventory or price/ledger change.
Admin management and mobile catalog read the same field. UP/DOWN/UP is rehearsed locally
with full financial row fingerprints preserved. 094/095 remain immutable.

Mobile summary counts related confirmed refunds against the originating sale shift for
net sales; physical cash refunds remain assigned to the refund cash-out shift. This
preserves gross-minus-related-refunds versus cash-drawer definitions.

## Acceptance boundary

Computer-use initialization failed with Windows sandbox deny-read ACL error; no actual
360/390/412 screenshots or native-device acceptance are claimed. Android/web production
exports and fixture exclusion are separate checks, not an APK build or visual PASS.
Physical CredentialReader integration is still separate: production UI never pretends
that the development reader is validated hardware. RFID financial writes require online
canonical server authorization; no offline financial queue exists.

Next phase: FULL PRODUCT REVIEW / ACCEPTANCE.
