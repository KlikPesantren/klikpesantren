# Panduan mesin Absensi RFID

Panduan ini berlaku setelah release backend/Admin selesai. Hasil compile bukan
izin atau bukti pengujian fisik. Jangan memakai source arsip.

## Mesin baru / kosong dan menambah EDC02

1. Buka Arduino IDE dan sketch canonical:
   `C:\Users\hi\Documents\0Aiki\Administrasi Santri Digital\klikpesantren\firmware\Absensi_RFID\Absensi_RFID.ino`.
2. Gunakan ESP32 core **3.3.8**, board **ESP32 Dev Module**,
   FQBN `esp32:esp32:esp32`. Pilih port USB mesin yang benar.
3. Gunakan **Erase All Flash: Disabled**, termasuk mesin baru. Firmware mengenali
   partisi filesystem benar-benar kosong; tidak memformat data yang sudah ada.
4. Upload hanya setelah software release dinyatakan siap. Jangan erase NVS.
5. Mesin belum diprovision meminta **PIN SETUP 8-12**. Pilih 8–12 angka sendiri
   pada keypad lalu tekan **#**; **\*** mengulang input. Angka dimask, tidak
   ditampilkan/disimpan sebagai secret permanen. AP lalu masuk `SETUP HP AKTIF`. SSID berbeda per perangkat:
   `KlikPesantren-Setup-XXXX`. LCD menggilir nama lengkap dalam dua bagian
   lalu alamat `192.168.4.1`.
6. Hubungkan HP ke SSID tersebut menggunakan PIN yang baru Anda pilih sebagai
   password WPA2 sementara. PIN tidak ditampilkan di LCD/Serial/server dan bukan
   password Wi-Fi tujuan ataupun secret device.
7. Jika captive portal tidak terbuka, buka **http://192.168.4.1** di HP. Matikan
   sementara pindah otomatis ke data seluler/VPN bila HP meninggalkan AP.
8. Di Web Admin pilih **unit spesifik → RFID → Perangkat EDC → Tambah Perangkat**.
   Masukkan nama tampilan (misalnya EDC02). Server membuat identity, tenant dan
   unit assignment; jangan mengedit source, API URL, device ID atau secret.
9. Admin menampilkan **Kode Pairing**, berlaku 15 menit/sekali. Masukkan kode
   pada formulir HP bersama SSID/password Wi-Fi tujuan. Jangan simpan kode di chat.
10. Tekan **Simpan dan Hubungkan**. Mesin menghubungkan Wi-Fi, NTP, lalu exchange
    pairing melalui HTTPS CA-validated. Device secret hanya disimpan di NVS lokal;
    backend menyimpan bcrypt hash. Muat ulang halaman untuk status.
11. Setelah berhasil, AP ditutup otomatis. Mesin melanjutkan koneksi/snapshot
    tanpa perlu restart manual. Setelah waktu/cache sah tampil **ABSENSI SIAP**.
12. Periksa status/last seen pada Admin. Nama dan assignment boleh berbeda antar
    mesin; source firmware dan hardware profile sama. **Source edit required: NO**.

## Ganti Wi-Fi tanpa Arduino

Tahan tombol fisik **D selama 3 detik dari standby**, kemudian lepaskan, atau
tekan **# → 2**. Bila worker sibuk, layar menunggu sampai worker selesai tanpa
menghapus pekerjaan. Buka AP/192.168.4.1 seperti di atas.
Isi Wi-Fi baru; **biarkan kode pairing kosong** bila credential masih valid.
Identitas, secret, counter, cache dan queue tidak dihapus. Tidak ada factory reset
otomatis. Kehilangan Wi-Fi biasa tidak otomatis membuka AP.
Menu/# dan hold D juga tersedia saat konfigurasi valid tetapi mesin masih
menunggu koneksi Wi-Fi/NTP; ini jalur recovery, bukan izin tap tanpa waktu sah.

**Batal setup:** D pendek membatalkan input PIN maupun AP. AP/DNS/HTTP ditutup,
Wi-Fi lama dihubungkan kembali otomatis; tidak perlu power-cycle. Identity,
secret, unit, counter, cache dan queue tetap. Wi-Fi kandidat tidak ditulis NVS
sebelum setup berhasil. Mesin kosong kembali `SETUP DIPERLUKAN / #=SETUP HP`.
Jika exchange pairing sudah berlangsung, pembatalan menunggu hasilnya selesai;
identity yang telah diterbitkan tetap disimpan, bukan dibuang/diulang.

## Harian, keypad dan menu

Harian: nyalakan → `ABSENSI SIAP / ONLINE Q:n` (atau OFFLINE) → tap.
Layout **123A / 456B / 789C / *0#D** tidak berubah.

- **#**: menu/OK/halaman berikutnya.
- **D pendek**: kembali/batal; di standby tidak mengubah konfigurasi.
- **D tahan 3 detik terus-menerus**: setup HP, hanya dari standby.
- **\***: ulang/hapus input PIN; **0–9**: input/pilih menu.
- **A/B/C**: reserved, tidak ada aksi V1.

Menu **1 STATUS / 2 WIFI / 3 SYNC / 4 INFO**. STATUS dan INFO hanya membaca:
koneksi, Q pending, cache, validitas waktu; identity device, mode ABSENSI, unit
dari snapshot dan versi firmware. # ganti halaman, D kembali. Setelah 30 detik
tanpa input, menu/status/info kembali standby. RFID berhenti sementara selama
maintenance; setelah keluar kembali aktif otomatis. Background replay/refresh
tidak bergantung browser/menu. Tidak ada factory reset/unpair/hapus data keypad.

**SYNC:** setelah Admin mengubah sesi/peserta/RFID, # → 3 meminta refresh worker
sekarang. `SYNC SELESAI / Q:n` membuktikan cache berhasil diperbarui; pending Q
belum tentu semuanya selesai replay. `SYNC GAGAL / COBA LAGI` tidak menghapus
queue/cache terakhir; coba lagi saat online. Timeout 15 detik, feedback 3 detik
kembali menu; D kembali tanpa membuang pekerjaan. Tap tetap local-first, tidak
menunggu HTTP. Nama/BERHASIL adalah event durable lokal; SUDAH ABSEN duplicate,
BUKAN PESERTA tidak eligible, TIDAK ADA SESI window tidak aktif. Kartu asing:
UID lengkap berpaginasi/BELUM TERDAFTAR (hanya LCD). WAKTU TDK VALID/BUTUH
INTERNET: jangan tap sampai waktu valid. Offline saat masih menyala memakai
waktu tepercaya; cold boot offline tanpa RTC tidak menerima event baru.

## Pindah unit / perangkat lama / recovery credential

- Superadmin tenant: pilih unit asal → RFID → Perangkat EDC → Edit / Pindah Unit
  → pilih unit tujuan → Simpan. Operator hanya boleh unit yang diotorisasi server.
- Tidak perlu Arduino/reflash. Snapshot diperbarui otomatis saat online, maksimal
  interval refresh normal 60 detik; jangan pakai mesin di unit baru sebelum cache
  barunya tersedia. Event antrean tetap direkonsiliasi server, bukan dipindah datanya.
- Perangkat lama belum punya mode: pilih **Perangkat lama belum diklasifikasikan →
  Tetapkan Mode Absensi**, hanya jika benar menjalankan firmware Absensi. Device
  dengan mapping merchant tidak boleh dikonversi melalui flow ini. Credential
  tidak berubah oleh klasifikasi.
- Credential hilang/invalid: Admin buat **Kode Pairing Baru / Recovery**, tahan D,
  masukkan Wi-Fi dan kode baru. Exchange sukses menginvalidasi credential lama.
  Jangan membuat rotasi tambahan hanya untuk mencoba. Jika response tidak pasti,
  generate kode baru secara eksplisit; firmware tidak otomatis mengulang exchange.

## Arti LCD

| Layar | Arti / tindakan |
|---|---|
| ABSENSI SIAP / ONLINE Q:n | Scanner siap; n event menunggu replay. |
| ABSENSI SIAP / OFFLINE Q:n | Boleh memakai cache/waktu tepercaya selagi tetap powered. |
| Nama / BERHASIL | Event diterima lokal dan sudah durable; bukan bukti server ACK. |
| Nama / SUDAH ABSEN | Duplicate lokal pada occurrence yang sama. |
| Nama / BUKAN PESERTA | Kartu dikenal tetapi tidak eligible. |
| Nama / TIDAK ADA SESI | Tidak ada window aktif pada waktu tap. |
| UID / BELUM TERDAFTAR | UID lengkap dipaginasi; salin ke field RFID santri yang benar. |
| WAKTU BELUM VALID | Cold boot memerlukan internet/NTP; jangan mengarang waktu. |
| Q penuh / storage gagal | Jangan mengklaim berhasil. Pulihkan jaringan/review; jangan erase queue. |
| R:n | Penolakan terminal dikarantina, bukan hilang/sukses diam-diam. |
| Akses/config ditolak | Periksa enabled, entitlement pendidikan + rfid dan credential di Admin. |

Pairing kedaluwarsa: generate kode baru di Admin dan kirim ulang formulir HP.
Wi-Fi salah: perbaiki formulir; koneksi dicoba tanpa reconnect storm. Device
nonaktif: Admin berwenang harus mengaktifkan; mesin tidak mengubah entitlement.
Cold boot offline tanpa RTC **tidak menerima absensi baru**. Queue lama tetap
tersimpan dan boleh replay setelah waktu/jaringan kembali valid.

## Aturan absensi dan larangan

Saat jadwal hari ini sudah terbentuk, pilih **Berlaku Hari Ini** atau **Mulai
Jadwal Berikutnya** secara eksplisit. Hari Ini menyesuaikan window sesi yang sama;
sesi yang ditutup auto-Alfa dibuka kembali jika saat ini masuk window baru.
H/I/S dan koreksi manual tetap utuh. Alfa otomatis lama bersifat sementara selama
sesi dibuka dan difinalisasi lagi pada akhir baru. Berikutnya tidak mengubah sesi
atau hasil hari ini. Pembatalan tidak dibuka diam-diam; penghapusan unit hari ini
ditolak untuk menjaga histori, gunakan jadwal berikutnya.
Refresh berjalan di background; tap tidak menunggu HTTP. Device dengan cache lama
900 detik akan menerima interval baru setelah refresh yang sudah dijadwalkan;
tidak perlu reflash/reboot. Kegagalan jaringan mempertahankan cache sah terakhir.

H hanya dalam window; tanpa scan → auto-A server. Admin mengisi I/S/manual H;
device tidak menimpa koreksi terlindungi. Event offline sah dapat mengoreksi
auto-A menjadi H, maksimal 7 hari. Guru manual/auto-A tersedia; RFID guru belum
diaktifkan karena belum ada canonical enrollment RFID guru.

Jangan edit tenant/unit constants, menyalin firmware kasir lama, erase NVS/LittleFS
sembarangan, membagikan credential, merotasi secret sembarangan, atau mendaftarkan
UID duplikat untuk menyembunyikan masalah firmware. EDC02 referensi tidak diubah.
