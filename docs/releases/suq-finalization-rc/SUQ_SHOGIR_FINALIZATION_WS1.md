# SUQ SHOGIR — Finalization 1/5

Tanggal: 3 November 2026. Status: **PARTIAL — implementasi teknis aman selesai; tiga P1 masih membutuhkan kebijakan bisnis.**

Sumber utama: `SUQ_SHOGIR_FINAL_PRODUCT_AUDIT.md`. Tidak ada audit ulang monorepo, koneksi Neon, perubahan production, migration, GRANT, build APK, atau deployment dalam pekerjaan ini.

## Source dan batas perubahan

- Worktree existing: `D:\0Aiki\Administrasi Santri Digital\klikpesantren-suq-hotfix-deploy`.
- Branch development: `codex/suq-finalization-ws1`.
- Backend baseline: `329028cb66d2665b38b036c8b7160bd8e53bec33`.
- Mobile baseline direkonsiliasi dari `b0885269c8b0bc2e55f0e27da3c0fdf2d5673c9e`, sehingga perbaikan production v9 existing tidak hilang. Perbedaan banyak file `pos-app` terhadap HEAD backend mencakup baseline ini; bukan seluruhnya fitur WS1 baru.
- Release A `54f346f` adalah ancestor backend baseline; file scheduler, hook, dan attendance tidak diubah.
- Perubahan development belum dibuat menjadi commit/release candidate. Tidak ada perubahan signing, package, endpoint production, atau APK hasil build.
- Perubahan lokal canonical yang sudah ada pada `services/academicReportService.js` dan `scripts/manage-academic-runtime-privileges.js` dipertahankan.

## Delapan P1 dan dependensi

| Audit | Status WS1 | Implementasi / batas | Dependensi |
|---|---|---|---|
| SQ-01 konflik shift | PARTIAL | Workspace menampilkan operator, terminal, laci, ID/waktu shift dan kepemilikan. Pesan konflik menjelaskan tindakan. Penutupan sah tetap hanya oleh operator sendiri, dengan kas aktual, expected, selisih, dan waktu pada record shift existing. Owner menutup shift orang lain tetap 403. | Kebijakan handover/penutupan oleh Owner belum diputuskan. Tidak ada takeover atau penutupan otomatis. |
| SQ-02 katalog terpotong | PASS lokal | Cursor pagination scope merchant, pencarian server nama/SKU/barcode, loader mobile mengambil halaman berikutnya dan menghapus duplikat batas halaman. Legacy array tetap didukung; inventori legacy tetap 300. | Backend dan source mobile baru harus dirilis bersama kelak; maksimal 100 halaman, kegagalan eksplisit jika melampaui batas. |
| SQ-03 opname stale | PASS lokal | Endpoint `/stock-opnames` menerima count absolut, expected stock dan movement version. Server mengunci produk, memvalidasi keduanya lalu menghitung delta; memakai movement/layer/alokasi FIFO canonical. | Permission ADJUST + OPNAME; penambahan nilai stok juga memerlukan COST_VIEW. Kebijakan approval opname belum ditambahkan. |
| SQ-04 permission granular | PASS lokal | Create/update/import memeriksa otoritas harga/biaya server-side; update tanpa field terlindungi mempertahankan nilainya. Opname tidak lagi cukup memiliki ADJUST saja. | Hak efektif existing; tidak menambah role atau memperluas permission production. |
| SQ-05 kebocoran biaya | PASS lokal | Katalog/inventori tidak memilih reference purchase price tanpa COST_VIEW; respons create/update disaring; export XLSX biaya kosong, preview/commit import penuh memerlukan permission harga dan biaya. | Tidak mengubah hak laporan profit atau pembelian yang memang diberikan terpisah. |
| SQ-06 retry mutasi | PASS lokal pada jalur tercakup | Jurnal SecureStore menyimpan path, server, merchant, user, request ID dan body asli sebelum POST untuk purchase, return, AR/AP payment, adjustment, opname, opening dan money revision. Retry identik dapat dikirim dari dialog atau banner setelah remount. Payload berubah atau konteks berbeda ditolak. | Idempotency canonical existing tetap sumber kebenaran. Sales dan MoneyForm mempertahankan jurnal existing. Acceptance Android fisik belum dilakukan. |
| SQ-07 cutoff/saldo awal | BELUM DIUBAH | Tidak menetapkan tanggal otomatis dan tidak merekonstruksi saldo berdasarkan asumsi. | Owner menetapkan cutoff dan prosedur rekonsiliasi opening terhadap histori existing. |
| SQ-08 lifecycle credential Wallet | BELUM DIUBAH | Tidak mengubah siapa yang dapat provision/revoke sebelum mandat Admin/merchant diperjelas. | Keputusan otoritas, expiry, rotasi/revoke, kartu hilang dan audit lifecycle. |

`PASS lokal` berarti bukti kode dan tes lokal di bawah, bukan acceptance perangkat atau production.

## Perubahan teknis inti

### Shift

`services/posBusinessWorkspace.js:workspace` mengembalikan `active_shifts` hanya bila akun memiliki SHIFT_OPEN, dengan scope merchant pada join terminal/laci. `MerchantBusinessApp.jsx:Cashier/Shifts` menampilkan konteks konflik dan arahan penutupan sah. Hak `shiftRow` tidak dilonggarkan. Record shift existing menyimpan operator pembuka/penutup (penutup harus operator yang sama), waktu dan rekonsiliasi kas. Mekanisme handover lintas operator **belum diimplementasikan** karena kebijakannya belum ada.

### Permission dan identitas produk

`posBusinessService.product`, `posBusinessWorkspace.updateProduct/inventory`, dan `posProductWorkbookService` melakukan pemeriksaan/proyeksi server-side. Mobile tidak mengirim field biaya dari editor untuk akun tanpa COST_VIEW.

Perubahan SKU/barcode lewat editor manual sebelumnya diabaikan dengan HTTP 200. Sekarang perubahan, termasuk mengosongkan barcode, ditolak eksplisit `PRODUCT_IDENTIFIER_POLICY_REQUIRED` tanpa menyimpan perubahan lain. Tidak ada kebijakan baru yang mengizinkan perubahan identitas. Matching/import existing tidak diubah diam-diam.

### Opname dan audit

`POST /pos-business/:businessId/stock-opnames` → `stockOpname`:

1. Validasi ADJUST dan OPNAME; hash immutable intent dengan request ID canonical.
2. Replay operation yang sudah berhasil sebelum pemeriksaan stale.
3. Kunci produk melalui `getProduct`, sama dengan mutasi stok canonical.
4. Bandingkan jumlah stok dan `count(*)` movement sebagai revision append-only. Perubahan keluar-masuk yang mengembalikan jumlah ke angka semula tetap terdeteksi.
5. Tulis operation dan movement/FIFO dalam transaksi yang sama.
6. Simpan count awal, count fisik, revision, alasan dan actor melalui operation `receipt_snapshot` existing. Tidak membuat ledger/saldo paralel atau migration baru.

Client mengikat snapshot ke saat produk dipilih; refresh data tidak otomatis mengganti baseline count yang sedang diisi. Request legacy dengan penanda `OPNAME:` ditolak `OPNAME_CLIENT_UPDATE_REQUIRED`. Penyesuaian relatif manual tetap memiliki semantik existing; tidak dianggap count fisik.

### Retry dan hasil posting

`mutationJournal.cjs` memakai `saleJournal.cjs` dan vault SecureStore chunked existing. Timeout/5xx/403/401 mempertahankan intent; kegagalan validasi definitif membersihkannya. Retry payload yang berubah diblokir. Jurnal dibatasi allowlist endpoint dan path money revision UUID.

`MerchantBusinessApp.submit` mengembalikan hasil POST yang sudah berhasil walaupun refresh daftar gagal, dengan pesan transaksi tersimpan. Form retur tidak lagi dikosongkan ketika POST gagal. Setelah recovery dari banner, form di-remount agar intent lama tidak dikirim sebagai transaksi baru. Kredensial/token tidak dicetak ke log.

## Bukti tes

### Runtime HTTP dan role terbatas — PASS

Perintah: `node scripts/test-suq-ws1-runtime.js` dalam worktree SUQ.

- Identitas diverifikasi: `127.0.0.1:55439`, database `suq_production_rc_ac8c7ae9d4_test`.
- Service/route HTTP aktual dijalankan dengan role `suq_clone_runtime_7d4e9e147f`, bukan owner. Owner lokal hanya menyiapkan fixture dalam outer transaction.
- Enam kelompok: konflik shift/penutupan sah; seluruh 201 produk dan pencarian server; redaksi biaya/permission/identitas; XLSX export dan import guard; stale/ABA/replay opname serta snapshot/FIFO; read/write lintas tenant ditolak.
- Semua fixture dan operation di-rollback; verifikasi merchant sintetis tidak tersisa.

### Concurrency PostgreSQL nyata — PASS

Perintah: `node scripts/test-suq-ws1-concurrency.js`.

- Membuat salinan lokal baru dari clone existing, tanpa menimpa clone lama. Identitas loopback diverifikasi sebelum CREATE DATABASE. Tidak ada role/GRANT baru.
- Salinan terakhir: `suq_ws1_concurrency_2f38c2089f`; dipertahankan bersama fixture TEST ONLY untuk bukti.
- Koneksi service terpisah menggunakan SET ROLE runtime terbatas.
- Dua request dengan ID sama: satu operation, satu replay.
- Dua count berbeda dengan snapshot sama: hanya satu 200; lainnya 409 stale.
- Count bersaing dengan movement FIFO: serialisasi konsisten, tanpa lost update atau stok dihitung ganda.

### Regresi finansial — PASS

Harness lokal `.tmp/test-ws1-financial.cjs` di canonical memakai test pricing/finance exact source `b0885269` terhadap service worktree yang diperbaiki, dan role runtime existing. Tidak membuat role/GRANT baru.

- 13 skenario pricing/Wallet/refund: harga umum/member/grosir, qty 1–7, bundle, nonstacking, pembayaran canonical, debit Wallet sekali saat retry, refund canonical, histori immutable dan merchant isolation.
- 21 skenario finansial: opening AR/AP, transfer dua kaki dan biaya, forced rollback, FIFO, laporan harian/bulanan/tahunan, pagination >500 baris, settlement/cutoff, cancellation/correction dan reversal tanpa UPDATE ledger.
- 335 transaksi service memakai role runtime terbatas.
- Fingerprint seluruh tabel clone sebelum/sesudah **UNCHANGED**; seluruh fixture suite di-rollback. Error constraint 23514 yang tercatat pada harness merupakan skenario penolakan yang memang diuji.

### Mobile dan Auto Alfa — PASS

- Seluruh **146 tes mobile PASS**, termasuk delapan tes WS1 untuk jurnal persisten, scope user/merchant/server, exact retry, revision dan pagination.
- Tes upload native menggunakan SDK 57.0.31 existing read-only melalui `POS_EXPO_SDK_ROOT=C:\sqb7e082\node_modules\expo`; tidak melakukan npm install atau build.
- ESLint file terdampak: exit 0, zero errors; satu warning existing pada default import `Constants`.
- Syntax check backend dan scoped diff whitespace check PASS.
- `test-november-scheduler.js`: **21 checks PASS**, zero Neon queries.
- `test-auto-alfa-release-hooks.js`: **11 checks PASS**, zero DB queries.
- `test-attendance-auto-alfa.js`: idempotency/failure rollback PASS.

## Daftar delta WS1 utama

Di luar rekonsiliasi baseline mobile b0885269:

- `services/posBusinessService.js`
- `services/posBusinessWorkspace.js`
- `services/posProductWorkbookService.js`
- `services/posProductPage.js` (baru)
- `routes/posBusinessRoutes.js`
- `pos-app/src/MerchantBusinessApp.jsx`
- `pos-app/src/domain.cjs`
- `pos-app/src/mutationJournal.cjs` (baru)
- `pos-app/src/productPages.cjs` (baru)
- `pos-app/tests/ws1-foundation.test.cjs` (baru)
- `scripts/test-suq-ws1-runtime.js` (baru)
- `scripts/test-suq-ws1-concurrency.js` (baru)

## Keputusan Owner yang dikelompokkan

1. **Shift:** siapa boleh menutup/meneruskan shift operator lain, konfirmasi hitung kas dan penanganan selisih; apakah perlu persetujuan dua pihak? Sampai diputuskan hanya penutupan sendiri yang aktif.
2. **Pembukuan awal:** tanggal cutoff resmi dan rekonsiliasi histori merchant existing; jangan menambahkan opening yang menghitung aset dua kali.
3. **Identitas produk:** apakah SKU/barcode boleh diubah, oleh siapa, batas setelah transaksi, dan aturan matching import. Histori tetap immutable.
4. **Opname:** siapa menghitung/menyetujui selisih, toleransi, bukti, serta biaya stok masuk. Proteksi stale/concurrency telah aktif di source tanpa menetapkan kebijakan approval.
5. **Credential Wallet:** mandat Admin versus merchant, expiry, revoke/replace dan kartu hilang. Tidak mengubah otoritas provisioning pada tahap ini.
6. **Diskon keranjang campuran:** alokasi diskon manual terhadap item harga khusus/bundle. Nonstacking existing dipertahankan.
7. **Rekonsiliasi/refund/settlement:** bukti pengembalian eksternal, kewenangan, partial refund dan perlakuan biaya. Tidak menyamakan reversal buku dengan pengembalian uang provider.

## Checkpoint berikutnya

Review keputusan kelompok 1, 2 dan 5 untuk menutup tiga P1 tersisa. Kelompok lain diperlukan sebelum workstream terkait mengubah aturan bisnis. Implementasi WS1 ini siap review lokal, **belum rilis**. Tes HP/UX fisik, deployment compatibility langsung dan production acceptance tidak diklaim PASS. Tidak ada APK build, deployment, migration atau perubahan production.
