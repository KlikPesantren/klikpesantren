# Rekonsiliasi 22 temuan audit — WS4

Tanggal: 3 November 2026. CLOSED berarti defect scope lokal telah diperbaiki dengan bukti langsung; bukan production accepted atau HP fisik PASS. PARTIAL menyatakan gap yang tersisa. BLOCKED menyatakan keputusan/akses penerimaan yang diperlukan. OPEN belum diimplementasikan dalam lingkup perbaikan tanpa fitur baru.

| ID | Severity | Status | Bukti langsung / sisa gap |
|---|---|---|---|
| SQ-01 | P1 | BLOCKED | WS1/WS3 dan runtime WS4 membuktikan konteks konflik, diagnosis own-shift dan penutupan sah. Handover lintas operator masih menunggu kebijakan; tidak auto-close |
| SQ-02 | P1 | CLOSED | test-suq-ws4-catalog: 2.001 produk/67 halaman, query nama/SKU/barcode, scoped cursor; operationalQa + tes UI mengecualikan inactive/unsellable/out-of-stock dari katalog/barcode Kasir. Riwayat movement tetap dibatasi dan dinyatakan di UI, tidak diklaim lengkap |
| SQ-03 | P1 | CLOSED | Runtime stale/ABA/replay, concurrency WS1, journey WS4 count 9→8 di server dan FIFO layer tersisa 8. Snapshot/actor/alasan ada pada operation/movement |
| SQ-04 | P1 | CLOSED | Runtime request langsung menolak perubahan harga/biaya tanpa capability; opname memerlukan permission server. Tes role negatif dan UI tetap PASS |
| SQ-05 | P1 | CLOSED | Runtime catalog/inventory/movement/export menghilangkan biaya untuk role tidak berhak; Owner berhak tetap mendapatnya. Refund context juga tidak diberikan ke Kasir tanpa SALE_REFUND |
| SQ-06 | P1 | CLOSED | Durable mutation journal, lost-response checkout dan concurrency commit nyata membuktikan satu debit/movement/refund. Refresh gagal tidak mengubah POST sukses menjadi gagal; retur gagal mempertahankan form |
| SQ-07 | P1 | BLOCKED | Cutoff/baseline ekonomi usaha berjalan belum disetujui. Tidak membuat opening atau saldo pengganti |
| SQ-08 | P1 | BLOCKED | Payment revoked/inactive dan scope unit/tenant diuji. Otoritas lifecycle provision/revoke masih menunggu keputusan Admin/Owner |
| SQ-09 | P2 | CLOSED | ProductBrowser/FocusedEditor dan tes handler WS2/WS4 membuktikan pilih-detail-edit-save/back, browser tetap mounted. Acceptance visual HP tetap terpisah |
| SQ-10 | P2 | PARTIAL | Produk/stok/harga/promo/paket sudah memakai pencarian vertikal server. Selector supplier, akun dan beberapa invoice lama masih horizontal; tidak diklaim selesai karena tes modul lain |
| SQ-11 | P2 | CLOSED | Editor level fokus, preview dan aturan penggunaan kasir; journey WS3/WS4 Owner setting→Cashier quote/pay→immutable receipt/report |
| SQ-12 | P2 | PARTIAL | Silent success manual dihilangkan: field existing read-only dan request perubahan ditolak eksplisit. Import menampilkan perubahan identitas. Aturan mutabilitas akhir belum diputuskan |
| SQ-13 | P2 | PARTIAL | Transport/file/auth/shift/opname/Wallet/refund mempunyai error spesifik; sesi/jurnal tidak dibuang karena timeout. Correlation ID lintas layanan dan seluruh pesan legacy belum diseragamkan |
| SQ-14 | P2 | CLOSED | Delapan tes handler scanner aktual membuktikan READY/WAITING/VERIFYING, cancel/context/background/timeout/rapid rescan; preview tidak mendebit. Bukan bukti hardware |
| SQ-15 | P2 | BLOCKED | Native dependency, manifest source, library NFC optional dan codec diuji. HP/kartu/printer nyata dan final merged APK manifest belum diuji |
| SQ-16 | P2 | BLOCKED | Larangan diskon manual seluruh protected cart dipertahankan dan diuji. Perubahan alokasi mixed cart memerlukan Owner |
| SQ-17 | P2 | PARTIAL | Cash/manual Bank/QRIS/Wallet, payout/recovery dan treasury lock diuji pada clone runtime. Perlu usulan ACL metadata kas dan SOP/bukti rekonsiliasi eksternal; bukan provider otomatis |
| SQ-18 | P2 | CLOSED | WS4 menghapus input UUID shift, memilih own-shift yang cocok, menampilkan remaining qty dan bukti eksternal existing; tes UI stale receipt/rejection dan backend cash refund langsung PASS |
| SQ-19 | P2 | PARTIAL | SDK57 bytes/MIME, multipart parse/preview/commit/retry/filter export diuji; import >1.000 baris ditolak. File asli Owner dan picker di HP belum diterima secara fisik |
| SQ-20 | P2 | OPEN | Financial/permission/credential audit tetap ada. Audit before/after master produk/harga/promo/batch belum lengkap. Membangun subsystem audit master baru berada di luar targeted fix dan larangan fitur baru WS4 |
| SQ-21 | P2 | PARTIAL | Period/cutoff/FIFO/AR/AP/reversal/payout aggregates PASS. Tetap Aset Terpantau, bukan neraca lengkap; baseline dan rekonsiliasi kas/bank nyata belum disetujui/diverifikasi |
| SQ-22 | P3 | PARTIAL | RC versi 1.0.1/code10, source provenance dan manifest tersedia. Panel diagnostik read-only dalam aplikasi belum ditambahkan karena bukan targeted defect fix |

## Jumlah

- CLOSED lokal: **9**.
- PARTIAL: **7**.
- BLOCKED: **5**.
- OPEN: **1**.
- Total: **22**.
- P0 terkonfirmasi yang tersisa: **0**.
- P1 tersisa: **3**, semuanya keputusan bisnis yang telah dicatat sejak WS1.

Tidak menyamakan source RC siap ditinjau dengan aplikasi final siap production. SQ-10, SQ-13, SQ-20 dan SQ-22 tetap merupakan gap teknis/non-P1 yang harus dipilih prioritasnya; tidak disembunyikan sebagai PASS.
