# SUQ SHOGIR — Finalization 2/5

Tanggal: 3 November 2026. **Status: PASS untuk implementasi dan pengujian lokal.** Acceptance visual/native pada HP belum diuji. Tidak ada build APK atau deployment. Tidak ada migration, GRANT, maupun perubahan data/configuration production. GRANT sementara pada clone lokal dijelaskan pada bagian pengujian.

## Scope dan kesinambungan WS1

Referensi: `SUQ_SHOGIR_FINAL_PRODUCT_AUDIT.md` dan `SUQ_SHOGIR_FINALIZATION_WS1.md`.

Pekerjaan dilanjutkan pada worktree existing `klikpesantren-suq-hotfix-deploy`, branch `codex/suq-finalization-ws1`. Backend baseline tetap `329028cb66d2665b38b036c8b7160bd8e53bec33`, mobile baseline `b0885269c8b0bc2e55f0e27da3c0fdf2d5673c9e`, ditambah perubahan lokal WS1 dan WS2. Belum dibuat commit/release candidate baru.

Proteksi WS1 dipertahankan: permission server-side, redaksi biaya, stock snapshot/version, product lock, idempotency journal, FIFO, scope merchant/tenant, dan penutupan shift oleh operator sah. File Auto Alfa, migration dan manifest privilege production tidak diubah.

## UX yang diselesaikan

### Produk

- Memilih hasil pencarian langsung membuka detail dalam modal layar fokus, dengan tombol kembali yang tetap terlihat.
- Detail → Edit → Simpan → Kembali tidak menempatkan editor di bawah daftar panjang.
- Browser daftar tetap terpasang di belakang modal; query, filter, cursor dan posisi daftar tidak di-reset saat editor disimpan/ditutup. Refresh mengulang halaman aktif, bukan mengembalikan ke halaman pertama.
- Nama, kategori, satuan, foto, status dan batas stok tetap dapat dikelola sesuai izin.
- SKU/barcode existing tampil sebagai data baca saja. Perubahan identitas manual tetap ditolak backend sesuai WS1; tidak membuat keputusan bisnis baru.
- Akun tanpa izin harga tidak memperoleh input perubahan harga. Field biaya disembunyikan dan tidak dikirim tanpa izin biaya.
- Form memberi pesan validasi spesifik untuk nama/SKU, batas panjang, Rupiah positif, biaya, dan batas stok.
- Kamera/galeri dan upload foto existing dipertahankan; kegagalan pemrosesan ditampilkan di editor.

### Stok dan opname

- Pemilihan produk memakai pencarian server, bukan deretan horizontal.
- Alur utama satu browser: Cari → Pilih → Detail/Penyesuaian → Simpan → Kembali ke hasil yang sama. Ganti Produk juga kembali ke browser tersebut.
- Editor menampilkan stok snapshot, reservasi, alasan, jumlah perubahan, delta dan stok akhir.
- Jumlah keluar yang membuat pratinjau negatif tidak dapat disimpan; server tetap memvalidasi stok tersedia/FIFO.
- Snapshot count diikat ke saat produk dipilih. Perubahan data yang datang kemudian tidak mengganti baseline count diam-diam.
- Payload opname tetap `actual_stock`, `expected_stock`, `expected_version`, alasan, biaya dan request ID asli. Tidak kembali mengirim delta dari cache.
- Permission ADJUST/OPNAME/COST_VIEW tetap berlaku. Akun baca saja tidak mendapatkan aksi simpan.
- Riwayat stok existing tetap dibatasi hingga 200 movement terbaru; batas ini dinyatakan di UI. WS2 tidak menambah endpoint riwayat finansial baru.

### Harga, promo, diskon dan paket

- Level harga memiliki detail fokus, lalu editor harga produk yang langsung terlihat setelah dipilih.
- Hasil pencarian menampilkan harga level yang dikonfigurasi dan Harga Umum pembanding; fallback dijelaskan.
- UI menjelaskan bahwa kasir memilih level per item, tanpa wajib memilih pelanggan. Harga khusus final tidak menerima promo tambahan.
- Promo tetap mendukung persen, nominal, kuantitas dan paket; form fokus, status, tanggal Indonesia, prioritas lanjutan dan preview dipertahankan.
- Contoh 15% dari Rp5.000 menampilkan Rp4.250 dalam tes interaksi.
- Memilih komponen paket langsung membuka editor jumlah komponen. Pencarian paket tidak kehilangan posisinya di belakang editor.
- Harga paket final, komponen asli, stok/FIFO dan nonstacking dijelaskan. Target level promo lama tetap dijeda sesuai existing policy; tidak mengaktifkan aturan penggabungan baru.

### Excel

- Import ditempatkan dalam layar fokus: pilih file → upload/parsing → validasi → preview → konfirmasi → hasil.
- Mendukung pembatalan picker, retry preview file yang sama, loading dan tombol konfirmasi yang nonaktif saat request berlangsung/preview invalid.
- Error dan success dari API tampil dalam modal, sehingga tidak tersembunyi di baliknya.
- File tetap `.xlsx`, maksimal 2 MB dan maksimal 1.000 baris sesuai kontrak existing.
- MIME workbook dinormalisasi setelah validasi ekstensi, untuk provider Android yang melaporkan tipe generik/lama. Server tetap memvalidasi isi/headers workbook; tidak memperlonggar parser.
- Preview menampilkan nama, SKU/barcode, harga, status baris dalam Bahasa Indonesia dan error per kolom.
- Metadata `identity_changes` memberi peringatan nilai SKU/barcode sebelum/sesudah pada preview. Aturan matching dan mutasi import existing tidak diubah.
- Retry commit workbook identik tidak membuat produk duplikat: analisis ulang menghasilkan UNCHANGED.
- Export mengikuti query, kategori, status aktif dan status stok yang diterapkan, untuk seluruh halaman hasil, bukan halaman HP saja.
- POST import yang sudah berhasil tetap dianggap berhasil walau refresh daftar gagal; pesan meminta muat ulang tanpa membuat import baru.

## Pencarian seluruh katalog

`ProductBrowser.jsx` memakai controller `productSearch.cjs` dan API yang sama dengan login/transaksi melalui `readFinancial` existing. Nama helper tidak mengubah scope endpoint atau permission.

- Query dikirim ke `/products` atau `/inventory` dengan `paged=1&page_size=30`.
- Nama, SKU, barcode, kategori, status aktif dan status stok difilter di server.
- Stock filter memakai stok tersedia setelah reservasi.
- Cursor diikat ke merchant, query, filter dan ukuran halaman; cursor dari filter berbeda ditolak.
- Pagination sebelumnya/berikutnya; stale response diabaikan; error HTTP permission/server dibedakan dari jaringan.
- Tidak menambah polling, interval atau server background baru. Data preload existing untuk domain lain tidak dirombak pada WS2; pencarian UX baru tidak mengandalkan filter cache tersebut.

## Bukti pengujian

### Mobile — PASS

Perintah dari `pos-app`:

```powershell
$env:POS_EXPO_SDK_ROOT='C:\sqb7e082\node_modules\expo'
node --test tests/*.test.cjs
```

**157 tests PASS, 0 fail.** Sepuluh tes WS2 menjalankan fungsi screen dan event handler aktual dengan host controls yang disubstitusi, mencakup Produk, permission, stok/opname, level harga, persen, paket, stale response, error dan validasi. Satu tes tambahan memverifikasi normalisasi MIME melalui serializer multipart SDK57 aktual. Ini bukan renderer/perangkat Android fisik.

### Backend/clone — PASS

Perintah dari worktree SUQ:

```powershell
node scripts/test-suq-ws2-runtime.js
```

- Target diverifikasi `127.0.0.1:55439`, database `suq_production_rc_ac8c7ae9d4_test`.
- Service dan Express router aktual, HTTP lokal, role runtime terbatas `suq_clone_runtime_7d4e9e147f`.
- **650 produk, 22 halaman** masing-masing maksimal 30, tidak ada ID hilang/duplikat.
- Produk ke-650 ditemukan lewat nama, SKU dan barcode; filter kategori/status, cursor invalid, batas ukuran halaman dan lookup inventory diuji.
- Export query produk terakhir serta filter stok diuji.
- Multipart XLSX aktual: upload, parsing, preview tanpa write, create/update, commit, retry UNCHANGED, duplicate row invalid, permission Kasir, MIME/ekstensi salah dan ukuran >2 MB.
- Preview perubahan identitas diuji tanpa menjalankan perubahan SKU tersebut.
- Fingerprint stok, FIFO, uang, utang dan Wallet sama sebelum/sesudah import.
- Proteksi WS1 shift, biaya, harga, stale/ABA/replay opname dan tenant isolation tetap PASS.
- Seluruh fixture dan mutasi di-rollback. Untuk menyamakan clone lama dengan ACL hotfix baseline, UPDATE(sku,barcode) diterapkan hanya pada role clone di outer transaction, lalu ikut di-rollback. Tidak ada GRANT production.

### Finansial — PASS

Harness `.tmp/test-ws1-financial.cjs` dijalankan ulang terhadap service worktree saat ini:

- **13 pricing/Wallet/refund** dan **21 finance** scenarios PASS.
- 335 transaksi service menggunakan runtime terbatas.
- Fingerprint seluruh tabel clone sebelum/sesudah **UNCHANGED**.
- Wallet single debit, retry, refund, FIFO, bundle, transfer dua kaki, reversal/correction, settlement/cutoff, laporan dan tenant isolation tercakup.

### Pemeriksaan source

- Parser/syntax checks PASS.
- Scoped whitespace check PASS.
- ESLint source terdampak exit 0; satu warning existing terkait default import `Constants`.
- Tidak ada npm install, APK build atau koneksi SQL production.

## Delta file WS2

- `pos-app/src/MerchantBusinessApp.jsx`
- `pos-app/src/PricingScreens.jsx`
- `pos-app/src/ProductBrowser.jsx` — baru
- `pos-app/src/productSearch.cjs` — baru
- `pos-app/tests/ws2-navigation.test.cjs` — baru
- `pos-app/tests/native-upload.test.cjs`
- `services/posProductPage.js` — memperluas helper WS1
- `services/posProductWorkbookService.js` — metadata preview dan filter export, tanpa perubahan aturan mutasi
- `scripts/test-suq-ws2-runtime.js` — baru

## Kebijakan yang tetap terbuka

Tidak mengaktifkan perubahan identitas produk manual, handover lintas operator, cutoff opening, approval opname, lifecycle credential Wallet, diskon keranjang campuran, atau aturan refund/settlement baru. Tiga P1 kebijakan dari WS1 tetap terbuka; WS2 tidak mengklaim menutupnya.

## Checkpoint

WS2 siap review lokal dan dapat diteruskan ke Workstream 3/5. Tampilan nyata, keyboard, kamera/picker hardware, dan scroll pada berbagai ukuran HP masih membutuhkan acceptance visual/native kemudian. Tidak ada klaim production GO atau acceptance fisik. Tidak membuat APK atau deploy pada tahap ini.
