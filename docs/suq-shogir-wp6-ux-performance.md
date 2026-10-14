# Suq Shogir WP6 — UX and performance contract

## Measured workload changes

- Re-tapping an already active module within three seconds performs zero navigation requests. After that short debounce, a tap revalidates context and data. Previously every tap made six requests for Kasir (context plus five projections) or two for Produk.
- A long list renders at most 30 rows initially and adds 30 rows per explicit request. A 1,000-row fixture therefore renders 30 instead of 1,000 rows initially (97% fewer row trees).
- Module preview cache is limited to eight entries and 15 seconds. It is keyed by merchant, user, role and the sorted effective-permission set.

These are deterministic request/render workload measurements, not physical-device frame-time claims. Real Android latency and frame performance still require device instrumentation.

## Authority and invalidation

- Merchant context and effective permissions are fetched from the server on every real navigation.
- Cached module data is presentation-only and is immediately revalidated. A stale preview is visibly labelled if revalidation fails.
- Every successful mutation invalidates all cached projections for the active authority before data is fetched again.
- Merchant change, logout and expired authentication clear the cache.
- Stock, Wallet balance, payments, settlement and permissions remain server-authoritative. The API still validates every mutation.

## UX changes

- Navigation loading is separate from mutation submission state.
- Repeated mutation taps remain blocked by the existing operation lock and financial request-id/idempotency contracts.
- Long operational lists use bounded progressive rendering with an explicit “Tampilkan berikutnya” action.
- Kasir, shift close and finance entries reuse the cursor-safe integer Rupiah input.
- Disabled Kasir, shift and finance actions display their missing prerequisite.
- The obsolete direct “Saldo awal” finance action is not offered; opening positions remain exclusively in the audited initialization workflow.

## Unchanged external gates

- QRIS provider confirmation is not integrated.
- Physical NFC/card and barcode scanner compatibility remain device acceptance items.
- Settlement payouts still lack merchant destination-account attribution.
- Equity remains an operational derived presentation, not statutory accounts.
- Historical category reporting uses the current product master because historical lines do not snapshot category.
