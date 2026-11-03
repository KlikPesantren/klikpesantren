# Rekonsiliasi 22 temuan — WS4 Policy Addendum

3 November 2026. Ini menggantikan status checkpoint WS4 untuk RC lanjutan baseline da41d18a. CLOSED berarti scope defect diuji secara lokal, bukan physical/production accepted. Tujuh kebijakan sudah disetujui Owner; sisa gap bukan permintaan persetujuan ulang.

| ID | Severity | Status | Bukti langsung / batas |
|---|---|---|---|
| SQ-01 | P1 | CLOSED lokal | takeoverShift + closeShiftWork dan TakeoverControls; actual/expected/difference, operator lama-baru, terminal/laci/waktu/reason, event immutable. Dua Owner race hanya satu takeover; frozen retry dan forced failure rollback. Tidak auto-close production |
| SQ-02 | P1 | CLOSED lokal | 2.001 produk/67 halaman server search nama/SKU/barcode/filter/cursor; barcode/catalog eligibility sesuai status/stok. Katalog Kasir tidak mengandalkan subset cache saja |
| SQ-03 | P1 | CLOSED lokal | Count draft tidak memutasi stok; Owner approval expected_stock/version, ABA/stale, FIFO, no-difference approval, competing approval dan retry satu movement. Tes service/API langsung |
| SQ-04 | P1 | CLOSED lokal | Permission backend price/cost/stock dan Owner identity/approval; Kasir default tidak bisa approval/identifier mutation. INVENTORY_OPNAME khusus memungkinkan count tanpa membuka biaya |
| SQ-05 | P1 | CLOSED lokal | Catalog/inventory/export/movement biaya di-redact untuk role tanpa izin; list draft tidak memuat unit_cost. Refund metadata tetap capability-scoped |
| SQ-06 | P1 | CLOSED lokal | Journal mencakup mutations existing + takeover/draft/identity; actual retry/race satu stock/debit/refund/payout. UI form gagal tidak dibuang; hasil POST sukses tidak dianggap gagal karena refresh |
| SQ-07 | P1 | PARTIAL | One-time initialization, immutable correction/effective-today dan concurrency 200/409 PASS. **Finalisasi cutoff usaha berhistori belum diimplementasikan/direhearsal**; BUSINESS_ACTIVITY_ALREADY_STARTED tetap. Saldo/HPP/source AR/AP nyata tidak boleh diasumsikan |
| SQ-08 | P1 | CLOSED lokal | Merchant Owner/Kasir issue/revoke 403; Admin actual RBAC + unit/tenant/superadmin, canonical token issue/replace/revoke dan credential race PASS. RFID Admin UID yang dicabut gagal resolve; offline tests fail-closed. Bukan hardware acceptance |
| SQ-09 | P2 | CLOSED lokal | ProductBrowser/FocusedEditor actual handler tests; cari-pilih-detail-edit-save/back menjaga browser state. Identity kini pada detail yang terlihat |
| SQ-10 | P2 | PARTIAL | Produk/stok/harga/promo/paket vertikal server search. Supplier/akun/beberapa invoice legacy masih horizontal |
| SQ-11 | P2 | CLOSED lokal | Editor focused + quote/pay/receipt/report; level khusus tanpa customer, snapshot asli dan nonstacking diuji |
| SQ-12 | P2 | CLOSED lokal | Owner identity editor/API reasoned + before/after/actor/time immutable; duplicate/concurrent collision ditolak; receipt lama tetap; import identity change gagal eksplisit agar tidak bypass audit |
| SQ-13 | P2 | PARTIAL | Specific transport/file/auth/stock/shift/refund/policy errors dan journal ada. Correlation ID lintas layanan serta seluruh legacy errors belum seragam |
| SQ-14 | P2 | CLOSED lokal | Delapan actual-handler scanner tests ready/wait/verify/cancel/background/context/timeout/queued scan; preview tidak debit. Bukan klaim native card fisik |
| SQ-15 | P2 | BLOCKED | HP/kartu/printer asli dan final merged binary belum diuji; tidak build APK pada addendum |
| SQ-16 | P2 | PARTIAL | Engine satu promo per eligible item, explicit existing priority DESC/ID ASC, special/bundle final dan manual protected-cart denial diuji. Alokasi manual Umum-only pada mixed cart belum ditetapkan, tetap fail-closed |
| SQ-17 | P2 | PARTIAL | Cash/manual Bank/QRIS/Wallet, refund pra-payout/outstanding dan pasca-payout recovery serta actual concurrent payout PASS clone. Source/schema/ACL belum production; rekonsiliasi provider/bank nyata belum accepted |
| SQ-18 | P2 | CLOSED lokal | Refund own-shift sesuai laci, remaining qty, external confirmations existing, receipt epoch/rejection form tests. Bukan pembatalan domain generik |
| SQ-19 | P2 | PARTIAL | SDK57 upload codec + multipart XLSX parse/preview/commit/retry/export/filter/permission PASS, limit import 1.000. Picker HP/file asli Owner belum diuji |
| SQ-20 | P2 | PARTIAL | Financial audit existing + audit identity/takeover/approval/credential kini immutable dan diuji. Before/after master harga/promo dan keseluruhan master belum lengkap |
| SQ-21 | P2 | PARTIAL | Aggregate periode/FIFO/AR/AP/reversal/recovery PASS; tetap aset terpantau, bukan neraca lengkap. Opening existing/rekonsiliasi kas-bank nyata belum selesai |
| SQ-22 | P3 | PARTIAL | Source SHA/manifest/config/code10 tersedia; panel diagnostik read-only dalam aplikasi belum ada |

Jumlah: **12 CLOSED lokal / 9 PARTIAL / 1 BLOCKED / 0 OPEN = 22**.

P0 terkonfirmasi tersisa: 0. Tiga P1 kebijakan awal: **SQ-01 CLOSED, SQ-07 PARTIAL, SQ-08 CLOSED**. Keputusan Owner sudah ada; SQ-07 adalah gap teknis/cakupan rekonsiliasi, bukan persetujuan pending.
