# SUQ SHOGIR — RC readiness dan rencana rilis WS4

3 November 2026. Dokumen ini adalah rencana, **bukan otorisasi eksekusi production**.

## Source

- Satu RC lokal melanjutkan backend 329028cb66d2665b38b036c8b7160bd8e53bec33, mobile b0885269c8b0bc2e55f0e27da3c0fdf2d5673c9e dan hasil WS1–WS4.
- SHA final dicatat pada laporan penyerahan WS4; untuk checkout paket ini gunakan git rev-parse HEAD.
- RC tidak mengambil perubahan akademik uncommitted dari canonical.
- Baseline Release A Auto Alfa tetap dalam ancestry; file scheduler/hook tidak berubah.
- Android source: com.klikpesantren.pos, versi 1.0.1, versionCode 10, HTTPS https://api.klikpesantren.com, developmentClient false untuk production-apk.
- SourceCommit harus diinjeksikan saat build melalui POS_BUILD_COMMIT=SHA RC aktual. Tidak menulis SHA sendiri ke source sehingga tidak menimbulkan referensi commit melingkar.

## Dependency database

**Migration baru WS1–WS4: NONE.** Baseline mengasumsikan schema POS production yang telah ada. Jangan menjalankan ulang migrasi akademik 110/111 atau enam migrasi POS lama.

Satu delta privilege yang direhearsal:

    GRANT UPDATE (id) ON TABLE public.cash_accounts TO kp_app_runtime_20260917;

Ini SQL usulan untuk review, **belum dijalankan production**. Nama role/target dan ACL awal wajib diverifikasi pada pre-deploy berizin. Bila hak sudah tersedia, tidak perlu GRANT ulang. Tidak memberi UPDATE pada pos_business_wallet_links, wallet_transactions, money/inventory movements, settlement allocations atau payout ledger.

Tujuan UPDATE(id) hanya memenuhi kebutuhan PostgreSQL FOR UPDATE pada row metadata treasury; source settlement tidak mengubah id/saldo metadata. Manifest strict harus menunjukkan tidak ada delta privilege tabel/kolom lain.

## Perubahan backend

- Proyeksi biaya sesuai capability dan permission field harga/biaya.
- Pagination/filter pencarian produk/inventori, lookup produk dan cursor sesuai merchant/query.
- Opname count absolut dengan baseline/version, product lock, idempotency dan audit snapshot.
- Diagnosis konflik shift sendiri yang deterministik; tidak memberi takeover.
- Settlement tanpa row lock redundan pada ledger immutable; merchant/treasury locks tetap ada.
- Metadata remaining qty dan sumber retur hanya untuk SALE_REFUND, tanpa membuka biaya ke Kasir biasa.
- Preview import memberi before/after perubahan identitas; export mengikuti semua filter aktif. Aturan mutasi/matching existing tetap sama.

## Perubahan Android

- WS1 durable retry, permission projection dan kontrak opname.
- WS2 browser server berhalaman, modal fokus produk/stok/harga/promo/paket/Excel.
- WS3 preview Wallet yang mempertahankan kode error, guard stale draft, cancel/timeout/native scanner.
- WS4 eligibility produk sesuai backend, retur tanpa input UUID, sisa kuantitas dan stale-receipt guard.
- Metadata versi baru agar hasil build nanti tidak ambigu dengan APK v9.
- Native dependencies tidak ditambah untuk fitur baru. Introspeksi source menggunakan SDK57 existing; binary/signature/ABI final belum dibangun.

## Acceptance matrix

| Alur | Bukti lokal | Status / batas |
|---|---|---|
| Owner/Kasir login, shift dan permissions | Runtime HTTP serta 22 skenario operasional | PASS; takeover tetap ditolak |
| Produk/katalog | 2.001 produk, 67 halaman, item terakhir nama/SKU/barcode | PASS; API bounded |
| Detail/edit/back, harga, promo/paket | Handler screen aktual + seluruh tes mobile | PASS lokal; visual HP belum diuji |
| Import/export | Multipart/SDK57, preview/commit/retry/invalid/oversize/filter | PASS dummy; file asli Owner belum acceptance |
| Stok/opname | Stale/ABA/retry, real concurrency WS1, journey WS4 dan FIFO | PASS; approval bisnis belum ditambah |
| Harga/promo → bayar → receipt/refund/report | 22 skenario operasional | PASS; priority/nonstacking existing dipertahankan |
| Cash/Bank/QRIS manual | Validasi akun, referensi dan konfirmasi | PASS; bukan provider otomatis |
| Wallet/refund/settlement | 43 skenario operasional/finance dan real concurrency | PASS clone, satu debit/kredit/payout |
| Audit dan tenant | Actor/reason/request references, row history, negatif role/scope | PASS finansial; audit master SQ-20 masih OPEN |
| Android source | Config/introspection + library manifest NFC optional | PASS source; final merged APK NOT BUILT |
| NFC/barcode/perangkat/printer | Native mock/codec | PHYSICAL NOT TESTED |
| Saldo ekonomi usaha | Agregat internal / tracked assets | Baseline/cutoff dan bukti kas/bank nyata belum disetujui |

## Pemeriksaan yang dapat diulang dari RC

Di worktree backend, dengan PostgreSQL clone existing localhost 55439 dan role QA terbatas:

    node scripts/run-suq-release-qa.js
    node scripts/test-suq-ws4-catalog.js
    node scripts/test-suq-ws3-concurrency.js

Runner financial terikat literal ke clone lokal, tidak membaca DATABASE_URL atau .env. Suite rollback memverifikasi fingerprint seluruh tabel. Suite concurrency membuat salinan lokal baru, menyimpan data TEST ONLY, dan tidak menimpa database lama.

Mobile, memakai SDK57 existing tanpa install dependency:

    $env:POS_EXPO_SDK_ROOT='C:\sqb7e082\node_modules\expo'
    node --test tests/*.test.cjs

Introspeksi source Android dari root worktree:

    $env:POS_EXPO_SDK_ROOT='C:\sqpromo7\node_modules\expo'
    node scripts/check-suq-android-source.js

Ini konfigurasi/mod source offline, bukan Gradle/EAS/APK build. Manifest library menyatakan NFC optional. Final merged manifest, signature dan ABI tetap harus diperiksa ketika build berikutnya memang diizinkan.

## Blocker dan batas rilis

1. Tiga P1 kebijakan: handover, cutoff pembukuan awal, lifecycle credential Wallet.
2. Kebijakan tambahan pada BUSINESS_POLICY_DECISIONS.md belum disetujui.
3. Hardware/file asli/perangkat dan acceptance finansial fisik belum dilakukan.
4. Delta source/ACL settlement belum di production dan memerlukan persetujuan terpisah.
5. Audit master SQ-20 belum lengkap; selector legacy dan diagnostik/error masih mempunyai gap P2/P3 pada matriks 22 temuan. Tidak ditutup menggunakan tes modul lain. Fitur audit master baru tidak dibuat dalam larangan fitur baru WS4.

RC siap untuk review keputusan dan acceptance terkontrol di WS5; **belum production GO**.

## Urutan deployment — hanya setelah diotorisasi

1. Cocokkan source/backend aktif, schema ledger dan target database aktual; ambil backup konsisten terbaru melalui jalur sah, simpan provenance/checksum. Jangan mengasumsikan source production masih baseline lama.
2. Rekam ACL awal dan pastikan satu-satunya delta adalah metadata cash_accounts.id. Tidak perlu migration schema baru.
3. Setelah persetujuan khusus, terapkan delta minimal yang belum tersedia dan deploy hanya backend RC melalui branch resmi; satu instance/scheduler Auto Alfa tetap.
4. Smoke test non-destruktif login/context/catalog/permission/report. Tidak melakukan dummy sale pada production.
5. Build APK hanya setelah instruksi berikutnya, gunakan source SHA RC dan signing existing tanpa membuka private key. Verifikasi package/code10/HTTPS/cleartext/signature/SHA-256/ABI dan final merged manifest.
6. Distribusi/acceptance perangkat sesuai izin, backend testing terisolasi/data dummy untuk transaksi pengujian.
7. Baru setelah acceptance dan keputusan bisnis, ajukan go-live yang sesuai. Tidak menggabungkan pengembangan akademik lain.

Backend lebih dahulu, aplikasi baru kemudian. API receipt baru bersifat additive untuk v9; aplikasi v10 memerlukan backend refund context. Opname legacy yang memakai delta stale sengaja ditolak dengan pesan pembaruan aplikasi; komunikasikan jendela update agar operator tidak mengulang mutasi.

## Pemulihan

- Sebelum rollout, simpan identitas image/source backend yang benar-benar berjalan dan compatible mobile sebelumnya.
- Bila P0, hentikan rollout dan gunakan source/image pemulihan yang telah diverifikasi/disetujui, bukan canonical HEAD.
- Tidak ada down migration atau restore database otomatis untuk RC ini.
- Bila privilege cash_accounts.id ditambahkan khusus rollout, kembalikan hanya privilege itu sesuai ACL awal dan izin Owner; jangan mencabut hak yang sudah ada atau memberi UPDATE ledger.
- Rollback ke backend lama dapat mengembalikan bug permission settlement/opname. Jangan mengklaim rollback aman hanya karena image tersedia; batasi operasi terdampak sampai diverifikasi.
- Mutasi yang sudah commit tidak dihapus. Refund/reversal/koreksi harus melalui domain canonical dan alasan/audit.
- Pertahankan Auto Alfa deadline scheduler; amati metrik/log provider existing tanpa SQL keep-alive atau load test Neon.
