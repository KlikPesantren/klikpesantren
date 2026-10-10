# Hari Pertama Operasional — Suq Shogir

Terakhir diperbarui: 9 Oktober 2026

Gunakan daftar ini sebelum menerima transaksi pelanggan.

## Sebelum buka

- [ ] Merchant dan unit layanan benar.
- [ ] Owner sudah mengaktifkan akun pribadi.
- [ ] Tanggal mulai pembukuan ditetapkan.
- [ ] Profil, alamat, kontak, dan struk sudah diperiksa.
- [ ] Akun Kas/Bank/QRIS sudah dibuat.
- [ ] Produk aktif memiliki SKU, harga, dan satuan yang benar.
- [ ] Stok awal dan HPP dimasukkan melalui **Stok Awal**.
- [ ] Saldo awal akun dimasukkan melalui **Saldo awal**.
- [ ] Kasir/Supervisor memakai akun sendiri, bukan akun Owner.
- [ ] Izin setiap anggota tim sudah diuji.
- [ ] Terminal dan shift kasir sesuai.
- [ ] Produk online dipublikasikan satu per satu setelah harga dan stok diperiksa.
- [ ] Branding storefront, kontak, jam layanan, pengiriman, dan instruksi pembayaran benar.

## Uji transaksi sintetis lokal/staging

Sebelum production, lakukan pada lingkungan non-production:

1. Satu penjualan tunai dan cek kembalian.
2. Satu penjualan Bank/QRIS dan cek status konfirmasi.
3. Satu pembelian supplier parsial dan cek utang.
4. Satu customer kredit dan cek piutang.
5. Satu retur dan cek stok/HPP/refund.
6. Satu order online, pembatalan, dan pelepasan reservasi.
7. Satu order online dikonfirmasi dan cek stok shared dengan POS.
8. Tutup shift dan cocokkan kas fisik.

Rp1 yang tidak dapat dijelaskan adalah NO-GO.

## Saat buka

- Buka shift sekali.
- Pastikan nama kasir, terminal, dan saldo awal kas benar.
- Jangan memakai data demo/review.
- Pantau order online dan stok menipis.
- Catat pengeluaran, modal, prive, dan pendapatan lain pada klasifikasi yang tepat.

## Saat tutup

- Hentikan transaksi baru.
- Pastikan pembayaran pending ditangani.
- Hitung kas fisik dan tutup shift.
- Tinjau selisih, retur, pembatalan, utang/piutang, dan order online.
- Simpan bukti eksternal sesuai kebijakan pesantren.
