# Troubleshooting — Suq Shogir

Terakhir diperbarui: 9 Oktober 2026

## Login gagal

- Pastikan ID login benar dan akun aktif.
- Untuk akun baru, gunakan **Aktivasi akun**, bukan form login.
- Kode aktivasi kedaluwarsa setelah 48 jam dan hanya dapat dipakai sekali.
- Setelah terlalu banyak percobaan gagal, tunggu jendela pembatasan login.

## Kode aktivasi hilang

Jangan membuat password bersama. Owner dapat menerbitkan ulang kode karyawan; kode lama dan sesi lama menjadi tidak berlaku. Untuk Owner pertama, hubungi Admin tenant melalui kanal resmi.

## Menu tidak terlihat

Menu mengikuti izin efektif. Minta Owner memeriksa **Pengguna & Akses**. Keluar dan masuk kembali bila sesi lama masih terbuka.

## Produk tidak tampil online

Periksa:

- merchant dan storefront aktif;
- produk aktif dan sellable;
- **Publikasi online** produk aktif;
- harga online valid;
- stok canonical tersedia.

Produk baru default tidak dipublikasikan.

## Stok tidak cocok

- Jangan edit stok langsung di database.
- Gunakan Stok Awal hanya untuk migrasi awal.
- Gunakan Pembelian untuk stok supplier, Penyesuaian untuk koreksi beralasan, dan Opname untuk hasil hitung fisik.
- Reservasi ONLINE memakai stok yang sama dengan POS.

## Transaksi timeout

- Jangan membuat request baru dengan ID berbeda.
- Buka riwayat atau gunakan retry yang mempertahankan request ID/payload.
- Timeout tidak sama dengan gagal; transaksi mungkin sudah committed.

## Saldo Dompet ditolak

Dompet Santri diverifikasi server berdasarkan tenant, unit, membership, wallet account, status, dan entitlement. Jangan memakai saldo legacy atau memindahkan credential antar-santri/unit.

## Selisih kas

Kas expected = kas awal + penjualan tunai terkonfirmasi − refund tunai terkonfirmasi. Bank, QRIS, kredit, dan Dompet tidak masuk laci kas fisik.

## Bantuan teknis

Catat waktu, akun/role, merchant, halaman, pesan error, dan request ID bila tersedia. Jangan mengirim password, kode aktivasi, token, UID RFID, atau credential lain melalui chat/grup.
