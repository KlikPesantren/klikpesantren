# SUQ SHOGIR — Finalization 3/5

Tanggal: 3 November 2026.

**Status: PARTIAL keseluruhan; perbaikan teknis dan integrasi lokal PASS.** Tiga P1 kebijakan dari WS1 tetap terbuka. NFC/barcode fisik belum diuji. Izin minimum settlement hanya direhearsal pada clone. Tidak ada perubahan production, migration production, APK build, deployment atau transaksi uang nyata.

## Baseline

Referensi utama: SUQ_SHOGIR_FINAL_PRODUCT_AUDIT.md, SUQ_SHOGIR_FINALIZATION_WS1.md dan SUQ_SHOGIR_FINALIZATION_WS2.md.

- Worktree existing: D:\0Aiki\Administrasi Santri Digital\klikpesantren-suq-hotfix-deploy.
- Branch tetap codex/suq-finalization-ws1.
- Backend baseline 329028cb66d2665b38b036c8b7160bd8e53bec33; mobile baseline b0885269c8b0bc2e55f0e27da3c0fdf2d5673c9e, ditambah perubahan lokal WS1–WS3.
- Tidak membuat commit/release candidate baru. Hasil WS1 dan WS2 dipertahankan.
- Tidak mengakses Neon/Railway production. Source Auto Alfa dan migration tidak diubah.
- Data pembayaran, santri dan credential pengujian sintetis; password, UID/token mentah serta data pribadi tidak dicetak.

## Perbaikan yang terbukti

### Konflik shift

services/posBusinessService.js — openShift sekarang memprioritaskan konflik shift milik operator sendiri, kemudian waktu/ID. Sebelumnya, operator yang sudah punya shift sekaligus memilih resource yang dipakai orang lain bisa mendapat kode konflik berbeda menurut urutan row.

Operator yang sudah punya shift mendapat SHIFT_ALREADY_OPEN; resource conflict tanpa shift sendiri tetap SHIFT_RESOURCE_IN_USE. Permission, unique constraints, kas awal dan hak penutupan tidak dilonggarkan. Owner tetap tidak boleh menutup shift Kasir lain melalui endpoint penutupan biasa. Operator, terminal, laci dan waktu aktif dari WS1 tetap tersedia.

### Preview Wallet

Cashier.scanWallet sebelumnya memakai wrapper umum yang menangkap error dan mengembalikan undefined. Penolakan revoked/inactive/permission hilang menjadi kegagalan preview generik. Respons lambat juga dapat mengisi draft setelah unit/metode berubah.

- walletPreview.cjs memakai transport existing yang meneruskan error asli.
- Wajib unit eksplisit, response eligible, kecocokan unit dan saldo response integer.
- Epoch draft pembayaran dan callback validitas reader diperiksa setelah respons. Hasil lama tidak di-commit jika konteks berubah atau reader dibatalkan.
- Satu pemindaian hanya melakukan preview; tidak mendebit saldo.
- Tidak menambah otoritas saldo, top-up, cash-out atau debit offline.

### NFC dan barcode

WalletCredentialScanner.jsx diperkuat dengan:

- Pembatalan saat setup, menunggu tag, getTag, preview, background, unmount, unit/konteks berubah atau Kasir tidak aktif.
- Sequence check sesudah await agar sesi/tag lama tidak melanjutkan preview.
- Cleanup scan lama tidak membatalkan scan baru.
- Event rescan yang mengantre tidak boleh mulai setelah konteks dinonaktifkan.
- Timer timeout dibersihkan; pembatalan mengembalikan status READY.
- Kamera yang menunggu izin tidak dibuka lagi setelah konteks berubah.
- Barcode dibatasi satu pembacaan aktif dan membawa guard konteks yang sama.
- Error revoked/inactive, unit, tidak kompatibel, timeout dan server dibedakan.

NFC tetap dimulai melalui tombol Baca NFC pada tahap pembayaran Dompet dengan unit sah. Tidak menjadi listener global di layar lain. UID mempertahankan urutan byte/nol awal; barcode/QR tetap token opaque sah.

**Bukti native mock dan kontrak otomatis saja. Perangkat, antena, kartu serta pembacaan fisik: NOT TESTED.**

### Settlement dengan role terbatas

Tes menemukan 42501 pada pos_business_wallet_links: endpoint meminta FOR UPDATE pada ledger yang privilege-nya memang SELECT/INSERT saja.

Perbaikan services/posAdminService.js — settleWallet:

- Menghapus row lock redundan pada link ledger immutable.
- Mempertahankan advisory transaction lock merchant dan FOR UPDATE pada row merchant.
- Sale/refund POS memegang FOR SHARE pada row merchant yang sama selama transaksi, sehingga kewajiban tidak dapat berubah melintas pemeriksaan payout.
- Scope, expected outstanding, idempotency, allocation dan constraint rekonsiliasi tetap berlaku.
- Lock rekening kas yayasan dipertahankan untuk serialisasi payout dari kas yang sama.

Lock kas yayasan memerlukan UPDATE pada minimal satu kolom tabel metadata. Manifest lokal config/posRuntimePrivileges.js sekarang meminta **UPDATE(id) pada cash_accounts**, bukan UPDATE ledger atau saldo. Kode settlement tidak melakukan UPDATE id.

Izin ini direhearsal hanya pada clone: pada suite rollback ikut di-rollback; pada salinan concurrency hanya berlaku di database lokal tersebut. **Belum ada GRANT production.** Rilis nanti perlu review diff/ACL dan persetujuan Owner. Tidak memerlukan migration schema baru.

Pembuktian ACL clone: tidak ada UPDATE pada kolom mana pun di pos_business_wallet_links; permission lock metadata cash_accounts.id tersedia pada clone concurrency.

## Aturan pricing yang berlaku — tidak diubah

| Kondisi | Perilaku existing yang diuji |
|---|---|
| Harga Umum | Default; master selling_price menjadi referensi |
| Member/Grosir/custom | Dipilih Kasir per item; assignment customer tidak otomatis memilih harga |
| Harga khusus belum diatur | UI menawarkan level tersedia; kontrak legacy engine dapat fallback ke Umum dengan snapshot fallback |
| Persen | Dari Harga Umum; Rp5.000 − 15% = Rp4.250 |
| Nominal | Dari Harga Umum; Rp5.000 − Rp1.000 = Rp4.000 |
| Kuantitas EVERY | Kelompok berulang, sisa unit Harga Umum; qty 1–7 diuji |
| Kuantitas ONCE | Satu kelompok ketika minimum terpenuhi |
| Konflik promo | Priority menurun lalu ID stabil; tidak bergantung urutan item |
| Keranjang protected | Harga khusus/promo/paket tidak menerima diskon manual tambahan |
| Diskon manual | Memerlukan permission dan alasan pada keranjang yang diizinkan engine |
| Keranjang campuran | Larangan manual berlaku pada seluruh protected cart; tidak membuat alokasi Umum-only baru |
| Paket | Harga final, komponen asli, alokasi snapshot, stok dan FIFO canonical |
| Retur | Nilai/snapshot transaksi asli, bukan harga terbaru |
| Promo target level lama | Tetap dijeda untuk review; data lama tidak dihapus |

Tidak mengubah priority, syarat Member, eligibility, stacking atau distribusi diskon campuran.

## Pembayaran, refund dan laporan

- Cash memakai laci shift sah; uang diterima/kembalian tidak menambah omzet melebihi pembayaran.
- Bank/QRIS manual memerlukan akun, referensi dan konfirmasi manual; tidak menjadi konfirmasi otomatis provider.
- Wallet memvalidasi merchant, tenant, unit, membership, credential dan akun. Posting memakai ledger Wallet Admin yang sama.
- Kehilangan respons sesudah commit memakai request ID/body asli dari jurnal.
- Refund kembali ke akun/unit original, tanpa memilih tujuan lewat credential baru.
- Refund sebelum payout mengurangi kewajiban; refund sesudah payout mengkredit Wallet sekali dan menghasilkan recovery.
- Payout mengurangi kas yayasan serta mengkredit akun merchant, tanpa SALE atau debit Wallet baru.
- Reversal/correction, FIFO, cash/bank, AR/AP, periode laporan dan immutable snapshots tetap diuji.
- Refund pembukuan eksternal tidak dianggap otomatis mengembalikan uang bank/QRIS.

## Bukti pengujian

### Integrasi rollback — PASS

Harness canonical: .tmp/test-ws3-financial.cjs. Source suite operasional worktree: scripts/test-suq-ws3-operations-db.js. Jalankan melalui harness clone, bukan mengubah target database literal secara manual.

- Identitas: 127.0.0.1:55439, suq_production_rc_ac8c7ae9d4_test.
- Role service: suq_clone_runtime_7d4e9e147f, bukan owner.
- **21 skenario operasional/pricing:** 13 regresi pricing existing dan delapan tambahan WS3.
- **21 skenario finance:** transfer/reversal, opening AR/AP, settlement/report projection, FIFO, history dan permission.
- **387 transaksi service** memakai runtime terbatas.
- Fingerprint seluruh tabel clone sebelum/sesudah **UNCHANGED**; fixture, operasi dan GRANT suite di-rollback.
- Deferred constraints diperiksa pada boundary payout sebelum refund berikutnya untuk memodelkan dua commit terpisah. Constraint tidak diubah/dinonaktifkan.
- Admin settlement memakai fixture sintetis aktif; resolver user/unit/superadmin aktual dijalankan. Adapter permission fixture menyediakan pos.view/pos.reconcile; adapter tanpa permission juga diuji ditolak. Tidak mengklaim login Admin production diuji.
- Feature flags Wallet/RFID disediakan aktif secara eksplisit untuk dummy fixture. Tidak mengubah flags production atau mengklaim konfigurasi perangkat production terverifikasi.

### Concurrency commit nyata — PASS

Perintah dari worktree: node scripts/test-suq-ws3-concurrency.js.

- Salinan lokal baru dari clone existing, tidak menimpa database lama.
- Salinan final suq_ws3_payments_e43ab38996 dipertahankan sebagai bukti.
- Multi-koneksi SET ROLE runtime terbatas; HTTP login/sale/refund dan service settlement aktual.
- Dua sale dengan ID sama: satu operation, satu debit, satu movement FIFO.
- Dua payout dengan ID berbeda untuk obligation sama: satu berhasil, satu SETTLEMENT_SELECTION_STALE. Replay pemenang memakai payout sama.
- Dua refund dengan ID sama sesudah payout: satu kredit, satu retur, recovery Rp5.000 dan outstanding nol.
- Commit nyata memvalidasi deferred constraints pada boundary normal.
- UPDATE ledger tidak diberikan. Izin metadata minimum kas hanya pada clone ini.
- Feature flags dummy dinyatakan eksplisit pada factory; tidak bergantung flags unit yang diwarisi backup.

### Mobile/reader — PASS

Dengan POS_EXPO_SDK_ROOT menunjuk C:\sqb7e082\node_modules\expo, jalankan node --test tests/*.test.cjs dari pos-app.

**165 tests PASS, 0 fail**, termasuk delapan tes WS3 untuk:

1. Error asli, preview stale dan salah unit.
2. Offline gagal, preview sah tidak memanggil debit.
3. Handler NFC aktual: UID, cleanup dan timeout.
4. Cancel saat native setup.
5. Cancel saat getTag dan rapid rescan.
6. Disabled/unit/background/unmount.
7. Timeout/tag tidak kompatibel/unknown/revoked/inactive/server.
8. Queued rescan setelah konteks dinonaktifkan.

Host controls dan native manager dimock; tes menjalankan handler aktual, bukan HP fisik.

### Regresi source

- Enam kelompok runtime HTTP WS1 diulang sesudah perubahan diagnosis shift: PASS dengan rollback.
- Seluruh tes mobile WS1/WS2 tetap PASS.
- Syntax backend dan scoped whitespace check PASS.
- Tidak mengubah attendance/Auto Alfa atau migration.
- Tidak ada npm install, APK build atau koneksi SQL production.

## Desain handover — belum aktif

Tidak menambah route atau hak takeover:

1. Owner melihat operator, terminal/laci dan waktu shift.
2. Operator sah menutup dengan hitung kas; successor membuka shift baru memakai identitas sendiri.
3. Penutupan atas nama operator lain memerlukan keputusan otoritas, alasan, bukti kas, selisih, konfirmasi dan audit immutable.
4. Calon handover wajib mengunci shift/resource, memvalidasi status/versi, idempotent, satu penutupan/pembukaan, tanpa mengedit histori.
5. Operator yang tidak tersedia memerlukan prosedur darurat tersendiri; tidak diaktifkan lewat flag tersembunyi.

| Skenario | Saat ini / calon acceptance |
|---|---|
| Owner menutup shift Kasir lain | SHIFT_DENIED, sudah diuji |
| Operator menutup sendiri | Actual/expected/difference/time dan retry diuji |
| Takeover tanpa kebijakan | Tidak ada route/aksi aktif |
| Shift lintas merchant | Harus ditolak tanpa mutasi |
| Shift berubah sejak halaman dimuat | Calon handover wajib menolak stale state |
| Double retry | Calon kontrak satu rangkaian audit |
| Selisih kas | Owner perlu menetapkan approval dan pencatatan; tidak diasumsikan nol |

## Matriks keputusan Owner

| Keputusan | Perilaku aman sekarang | Skenario setelah keputusan |
|---|---|---|
| Handover | Hanya tutup sendiri | Operator hadir/tidak hadir, selisih, stale, retry, merchant berbeda |
| Cutoff opening | Tidak menetapkan saldo/tanggal otomatis | Stok/AR/AP dan histori tanpa double count |
| Credential lifecycle | Hak existing; revoked/inactive ditolak saat bayar | Admin-only/approval merchant, expiry, kartu hilang, rotasi dan audit |
| Diskon campuran | Larangan seluruh protected cart dipertahankan | Bila alokasi Umum-only disetujui: rounding IDR, bundle/special, refund dan urutan item |
| Refund/settlement eksternal | Konfirmasi manual dan recovery existing | Bukti provider, approval, biaya dan partial refund |

Tiga P1 tetap terbuka: SQ-01 handover, SQ-07 cutoff opening, SQ-08 lifecycle credential. Matriks ini bukan persetujuan bisnis baru.

## Delta file WS3

- services/posBusinessService.js — diagnosis konflik shift.
- services/posAdminService.js — lock settlement ledger.
- config/posRuntimePrivileges.js — deklarasi izin metadata minimum kas untuk review rilis.
- pos-app/src/MerchantBusinessApp.jsx — preview/epoch/konteks reader.
- pos-app/src/WalletCredentialScanner.jsx — lifecycle/cancel/timeout.
- pos-app/src/nfcFeedback.cjs — feedback spesifik.
- pos-app/src/walletPreview.cjs — baru.
- pos-app/tests/ws3-wallet-scanner.test.cjs — baru.
- Dua tes kontrak existing diselaraskan ke helper preview, disertai tes perilaku.
- scripts/test-suq-ws3-operations-db.js dan scripts/test-suq-ws3-concurrency.js — baru.

## Checkpoint berikutnya

Lanjut Workstream 4/5 dengan hasil lokal ini. Bawa tiga keputusan P1 dan dependency ACL kas ke review akhir. Acceptance HP/kartu nyata dilakukan kemudian; tidak dinyatakan PASS sekarang. Perubahan permission/backend production dan APK tetap memerlukan tahap release terpisah yang disetujui Owner.
