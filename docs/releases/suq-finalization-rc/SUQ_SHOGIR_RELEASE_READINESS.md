# Release readiness — WS4 approved policy addendum

3 November 2026. Baseline da41d18a; semua perubahan WS1–WS4 dipertahankan dalam child RC lokal. SHA actual adalah git HEAD setelah commit. Ini bukan persetujuan production.

## Gate

PARTIAL; **belum siap final acceptance WS5 / production GO**. P1 SQ-07 usaha berhistori belum mempunyai alur cutoff aman yang direhearsal; guard lama dipertahankan. Keputusan tujuh kebijakan tidak pending. Harga manual mixed cart masih memerlukan rincian alokasi bila ingin diaktifkan. Native physical acceptance belum ada. Matriks seluruh22 ada di SUQ_SHOGIR_WS4_FINDINGS.md.

## Source/dependency

- Backend baru: policy controls, immutable audit, Owner takeover, approved opname, identity controls, Admin-only token lifecycle; canonical money/stock/Wallet unchanged.
- Android: PolicyControls, focused Owner identity/shift actions, draft/approval count, price-priority explanation, durable retry paths; production package com.klikpesantren.pos, versionCode10 dan HTTPS tetap. APK belum dibuat.
- Auto Alfa, akademik/e-Rapor dan modul bisnis di luar dependency POS tidak diubah.
- Satu migration additive baru **122_pos_operational_policy_controls.sql**, setelah ledger baseline yang relevan. Tidak mengedit isi/checksum migration lama. Reconcile nama/nomor/checksum pada pre-deploy berizin; jangan menjalankan semua migration pending secara otomatis.
- Schema: pos_business_policy_events append-only; pos_wallet_credentials.admin_created_by + created_by nullable dengan exactly-one actor constraint. Credential lama dipertahankan, tidak backfill/revoke massal. Tidak menambah balance ledger.
- ACL baru: SELECT, INSERT pada policy events. Existing credential INSERT dan UPDATE(active,revoked_at) tetap. UPDATE(sku,barcode) produk sudah manifest existing, tetapi clone lama belum punya; direhearsal pada clone. UPDATE(id) cash_accounts adalah dependency settlement WS3, tanpa UPDATE ledger. Lihat POLICY_DB_MANIFEST.json untuk checksum/delta.

## Acceptance matrix

| Alur | Lokal | Sisa gate |
|---|---|---|
| Owner takeover + discrepancy | PASS, race/retry/forced rollback | Kas fisik nyata belum diuji |
| Opening baru + corrections | PASS, one-time + concurrency | Existing-history cutoff **PARTIAL/P1** |
| Admin token lifecycle | PASS, resolver RBAC actual dan unit/tenant | Belum rollout Admin API/schema, belum physical card |
| SKU/barcode | PASS, Owner-only uniqueness race + immutable audit | UI HP belum diuji |
| Count/approval/FIFO | PASS draft tanpa posting, stale/ABA/race/rollback | Recount/approval fisik belum diuji |
| Pricing/promo/bundle | PASS defined rules + immutable refund | Mixed manual allocation belum diaktifkan |
| Wallet/refund/payout/recovery | PASS, restricted runtime + actual concurrency | Provider/bank reconciliation real NOT TESTED |
| Catalog/XLSX | PASS 2.001/67 pages, multipart/retry | Actual Owner workbook/native picker belum accepted |
| Master audit | Financial + policy identity PASS | Price/promo/full master before-after PARTIAL |
| Android | Config/source/177 handler/unit tests PASS | Final merged binary/signature/ABI dan hardware NOT TESTED |

## Reproducible local QA

Jalankan hanya dengan cluster testing 127.0.0.1:55439 dan fixture role existing. Tidak membaca DATABASE_URL/.env. Bootstrap memerlukan flag eksplisit dan selalu membuat nama clone baru, tidak menimpa database existing:

    node scripts/prepare-suq-policy-clone.js --create-local-clone
    $env:SUQ_QA_CLONE='nama_suq_policy_dari_output'
    node scripts/run-suq-release-qa.js
    node scripts/test-suq-ws4-catalog.js
    node scripts/test-suq-policy-concurrency.js

Jalankan suite rollback dan template-copy concurrency secara berurutan agar source clone tidak sedang dipakai saat CREATE DATABASE WITH TEMPLATE. Concurrency menyimpan salinan TEST ONLY baru; tidak ada DROP DATABASE/terminate session otomatis. Historic WS1–WS4 harness yang memuat kontrak sebelum kebijakan disetujui digantikan oleh test-suq-policy-db untuk kontrak saat ini, bukan alasan mengembalikan kebijakan lama.

Mobile dari pos-app:

    $env:POS_EXPO_SDK_ROOT='C:\sqpromo7\node_modules\expo'
    node --test tests/*.test.cjs
    $env:NODE_PATH='C:\sqpromo7\node_modules'
    node C:\sqpromo7\node_modules\eslint\bin\eslint.js .

## Rollout dan recovery — belum dieksekusi

1. Tutup SQ-07 dengan rehearsal cutoff usaha berhistori yang tidak double count; selesaikan acceptance/gap yang dipilih sebelum production GO.
2. Verifikasi source/backend/target/schema/ACL aktual dan backup konsisten terbaru melalui akses sah. Jangan memakai status production historis sebagai bukti current.
3. Minta persetujuan production khusus untuk migration122/checksum, ACL minimal, backend dan aplikasi yang tepat. Tidak ada izin itu pada addendum ini.
4. Setelah disetujui, terapkan satu migration terreview + ACL yang belum ada; deploy backend lebih dahulu. Tidak auto-run seluruh migration dan tidak deploy canonical HEAD yang berisi kerja lain.
5. Verifikasi health/auth/permission/API non-mutating. Old clients tidak boleh mengirim opname direct-post; server mengembalikan OPNAME_APPROVAL_REQUIRED. Import identity change juga membutuhkan editor baru. Komunikasikan update window.
6. Build/sign/distribusi APK hanya pada instruksi berikutnya, inject SHA actual; periksa merged manifest, HTTPS, cleartext false, package/code10, signature, ABI, SHA-256; lanjut physical acceptance pada backend/data terisolasi.
7. Bila P0: hentikan rollout, identifikasi baseline source/image yang benar-benar berjalan dan disetujui untuk recovery. Tidak restore database otomatis atau menghapus policy events/ledger. Schema122 additive dapat dipertahankan, tetapi **rollback source da41d18a mengaktifkan kembali credential merchant dan bypass approval opname**: jangan menganggapnya aman; gunakan forward-fix atau hentikan operasi terdampak sesuai otorisasi incident. Tidak mencabut GRANT lama atau mengubah Wallet balance untuk menyamarkan kegagalan.

Tidak ada scheduler/polling SQL baru. UI list draft hanya dimuat saat halaman/revision berubah, bukan interval background. Pakai log/provider metrics existing untuk observasi cost; tidak ada SQL keep-alive.
