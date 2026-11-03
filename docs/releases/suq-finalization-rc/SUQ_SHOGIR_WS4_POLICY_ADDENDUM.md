# WS4 Addendum — approved policies, local implementation and regression

3 November 2026. Baseline: `da41d18a601280551eaf471e506681aea4c857b4`. Implementasi source disimpan dalam commit lokal lanjutan; SHA final dicatat pada handover canonical. Tidak ada production change atau APK build.

## Hasil

**POLICY IMPLEMENTATION: PARTIAL.** Tujuh keputusan resmi dipakai sebagai otorisasi lokal. Alur aman sudah diimplementasikan dan diuji; SQ-07 untuk cutoff usaha yang sudah mempunyai histori tetap PARTIAL. Tidak menganggap finalisasi usaha baru membuktikan rekonsiliasi usaha berjalan.

| Kebijakan | Status | Bukti |
|---|---|---|
| Handover | PASS lokal | /pos-business/:businessId/shifts/takeover; posBusinessPolicies.takeoverShift + canonical closeShiftWork; UI TakeoverControls; race dua Owner/replay/forced failure |
| Opening | PARTIAL | posBusinessInitialization existing + runInitialization pre-access lock; satu finalisasi dan koreksi immutable, dua finalizer 200/409; active-history guard tetap |
| Credential Admin | PASS lokal | /pos/admin/wallet-credentials relatif ke router Admin yang ada; posAdminCredentials.credentialAction memakai verified user/tenant/unit, tenant superadmin dan capability canonical pos.config.manage; merchant endpoints 403; real clone RBAC diuji |
| SKU/barcode | PASS lokal | /products/:productId/identity; identityWork, unique constraints, immutable policy event; Import identity change 409; historical receipt SKU tetap |
| Opname approval | PASS lokal | POST/GET stock-opname-drafts, POST stock-opnames dengan draft_id + APPROVE; draft bukan mutation stock; Owner approval + FIFO; role/cost/stale/ABA/concurrency diuji |
| Nonstacking | PASS pada kombinasi terdefinisi; mixed-manual PARTIAL | Existing pricing engine/prioritas tidak diubah; cart policy note; persen/nominal/qty/Member/bundle/snapshot/refund lulus. Tidak membuat aturan baru mixed cart |
| Refund/settlement | PASS lokal | Pra-payout outstanding turun; pasca-payout recovery; satu debit/kredit/payout pada retry/race; 21 finance scenarios dan rangkaian operasional |

Endpoint Admin memakai prefix mount aktual di app.js/server/router; path dalam tabel bersifat relatif terhadap router Admin. Tidak mengubah autentikasi JWT tenant maupun merchant session.

## Targeted failure yang ditemukan dan diperbaiki

Race dua Owner finalisasi membuka deadlock 40P01: access memegang FOR SHARE business, satu finalizer menunggu advisory lock sambil menahan share, finalizer lain meng-upgrade business lock. runInitialization kini memverifikasi sesi, mengambil advisory lock initialization **sebelum** access mengambil share business. Setelah perbaikan: tepat satu 200 dan satu 409 INITIALIZATION_FINALIZED, satu saldo awal canonical. Tidak menambahkan retry SQL tanpa batas atau scheduler.

## QA

- Mobile: **177 PASS**, 0 fail/skip; lima tes handler baru untuk takeover, identity, Owner-only UI, approval dan durable retries.
- PostgreSQL: **29 operational/policy + 21 finance = 50 skenario PASS**; 474 transaksi service restricted runtime; seluruh fingerprint tabel sebelum/sesudah rollback **UNCHANGED**.
- Catalog/XLSX: **7 kelompok PASS**, 2.001 produk / 67 halaman; search nama/SKU/barcode, pagination/scoping, biaya tidak bocor, stale/ABA count, parse/preview/commit/retry/export dan blok bypass identitas. Tidak memakai file/data Owner production.
- Concurrency actual commit: **8 skenario PASS** pada salinan lokal baru: Wallet payment, settlement payout, post-payout refund, takeover, unique identity, approval count, opening finalization, Admin credential issue/replace/revoke. Salinan TEST ONLY dipertahankan, tidak menimpa clone lama.
- Forced rollback: old/new shift, product identifiers, FIFO count correction dan policy audit semuanya rollback bersama bila failure sebelum audit.
- Audit: runtime tidak diberi UPDATE/DELETE event; trigger menolak perubahan/penghapusan bahkan oleh pemilik clone. Credential audit tidak menyimpan token mentah.
- Lint: 0 error; tiga warning import Constants existing.
- Android: source/native dependencies tetap; package com.klikpesantren.pos/code10 dan HTTPS. Tidak membangun APK. Physical NFC/card/printer acceptance NOT TESTED.

Angka 474 adalah transaksi service lokal suite, bukan jumlah statement SQL atau proyeksi CU-hours. Tidak ada koneksi Neon atau production monitoring.

## Clone dan ACL

Clone rehearsal `suq_policy_d03ebbe1dd`, sumber lokal `suq_production_rc_ac8c7ae9d4_test`; host 127.0.0.1, port 55439. Source clone WS4 telah mempunyai provenance rehearsal sebelumnya; bukan klaim snapshot production terbaru. Role service `suq_clone_runtime_7d4e9e147f`, fixture loader `kp_acceptance`; seluruh service call memakai SET LOCAL ROLE, termasuk RBAC Admin sukses dengan permission resolver aktual.

Migration baru: `122_pos_operational_policy_controls.sql`. Membuat event append-only + unique request/approval dan trigger immutable; menambah admin_created_by dan actor constraint ke tabel credential canonical sambil mempertahankan credential lama. Tidak menambah ledger saldo atau backfill finansial. Nama 122 tidak bertabrakan dengan file baseline worktree/canonical saat pemeriksaan; nomor/checksum tetap harus direkonsiliasi sebelum release berizin.

Delta baru runtime: SELECT, INSERT pada pos_business_policy_events. INSERT pos_wallet_credentials dan UPDATE(active,revoked_at) sudah ada pada manifest; tidak memperluas UPDATE credential atau ledger. Clone sumber belum memiliki UPDATE(sku,barcode), sehingga dua izin kolom existing pada manifest direhearsal juga. Cash_accounts UPDATE(id) tetap dependency WS3/WS4. Jangan menyebut semua itu sebagai GRANT production yang telah dilakukan.

## Batas release / WS5

**READY FOR WS5: NO untuk acceptance/release final saat SQ-07 belum selesai.** Source siap menjadi dasar pekerjaan WS5 terarah, tanpa mengulang audit. P1 lokal: SQ-01 CLOSED, SQ-08 CLOSED, SQ-07 PARTIAL. Belum ada prosedur finalisasi cutoff usaha dengan ledger aktif yang terbukti, termasuk mapping AR/AP historis dan stok FIFO; tidak menonaktifkan BUSINESS_ACTIVITY_ALREADY_STARTED atau memasukkan opening kedua untuk menyamarkan gap.

Gap lain: mixed manual discount belum eksplisit; hardware/file asli belum diuji; audit master harga/promo dan selector legacy masih PARTIAL. Semua status 22 temuan ada di SUQ_SHOGIR_WS4_FINDINGS.md.

Next technical action: siapkan rekonsiliasi cutoff usaha berhistori beserta mapping canonical cash/bank, FIFO dan sumber AR/AP pada fixture clone, dengan invariant tanpa double opening. Jangan meminta persetujuan ulang ketujuh kebijakan dan jangan menerapkan opening ke Syirkah313 production dari dugaan saldo.
