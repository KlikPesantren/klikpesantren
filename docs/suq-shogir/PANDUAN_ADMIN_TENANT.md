# Panduan Admin Tenant — Suq Shogir

Terakhir diperbarui: 9 Oktober 2026

Panduan ini untuk Superadmin tenant KlikPesantren yang menyiapkan toko atau kantin di Suq Shogir. Admin tenant mengelola identitas merchant, unit layanan, status, dan integrasi. Admin tenant **tidak** mendapat akses ke laba, HPP, utang, biaya, modal, prive, atau ledger privat merchant eksternal.

## Membuat merchant

1. Masuk ke Web Admin Tenant.
2. Buka **Sistem → Toko & Kantin**.
3. Pilih satu unit aktif. Pembuatan merchant tidak menerima scope semua unit.
4. Klik **Tambah merchant**.
5. Isi nama usaha, jenis **Internal pesantren** atau **Eksternal / pihak ketiga**, data legal/kontak bila tersedia, nama Owner, ID login Owner, serta unit yang dilayani.
6. Klik **Buat merchant & Owner** sekali.
7. Simpan kode aktivasi yang tampil satu kali dan kirimkan langsung kepada Owner melalui kanal aman.

Admin tidak membuat atau mengetahui password Owner. Owner mengaktifkan akun dan memilih password sendiri. Kode aktivasi disimpan server sebagai hash, kedaluwarsa dalam 48 jam, dan tidak tampil lagi pada replay request.

## Status dan integrasi

Pada detail merchant, Admin dapat mengatur:

- merchant aktif/nonaktif;
- integrasi institusi;
- Dompet Santri;
- toko online.

Perubahan tercatat dalam audit merchant. Menonaktifkan merchant menghentikan akses operasional tanpa menghapus riwayat.

## Aturan keamanan

- Gunakan ID login yang tidak dipakai tenant lain.
- Jangan mengirim kode aktivasi lewat grup umum.
- Jangan meminta password Owner/Kasir/Supervisor.
- Satu merchant dapat melayani beberapa unit yang terbukti milik tenant.
- Data privat merchant eksternal tidak boleh disalin ke dashboard Admin.
- Jika request diulang akibat koneksi terputus, gunakan request yang sama; server menjaga idempotensi dan tidak menerbitkan ulang secret.

## Verifikasi selesai

- Merchant muncul pada unit yang benar.
- Owner berstatus menunggu aktivasi atau aktif.
- Tidak ada akun kas, terminal, produk, atau data demo yang dibuat otomatis.
- Owner dapat melanjutkan checklist operasional dari aplikasi Suq Shogir.
