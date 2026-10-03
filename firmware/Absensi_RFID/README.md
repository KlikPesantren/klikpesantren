# Absensi RFID universal

Satu sketch untuk perangkat ESP32/RC522 dengan profil hardware yang sama:
`C:\Users\hi\Documents\0Aiki\Administrasi Santri Digital\klikpesantren\firmware\Absensi_RFID\Absensi_RFID.ino`.
EDC adalah konfigurasi NVS, bukan fork source. Alias profil lama `EDC01` tetap
diterima; profil generik bernama `ESP32_RC522_16X2`.

## Hardware dan flash

- ESP32 classic, core 3.3.8, FQBN `esp32:esp32:esp32`.
- RC522 SS=5, RST=4; LCD I2C 0x27, 16x2; buzzer=2.
- Keypad rows=13,14,27,26; columns=25,33,32,15; layout `123A / 456B / 789C / *0#D`.
- **Erase All Flash harus Disabled.** Tidak ada izin flash fisik dari hasil compile ini.
- NVS `offline` serta seluruh kunci provisioning lama dipertahankan.
- Jangan menghapus LittleFS, cache, queue, atau mengganti credential untuk coba-coba.

## Arti layar dan waktu

`ABSENSI SIAP / ONLINE Q:n` atau `OFFLINE Q:n`: jumlah event menunggu replay.
`R:n`: event ditolak terminal oleh server, disimpan untuk review.
Nama + `BERHASIL` berarti event diterima **secara lokal dan sudah ditulis durable**,
bukan acknowledgement server. Nama dipotong hanya untuk layar 16 karakter.
Nama + `SUDAH ABSEN`, `BUKAN PESERTA`, atau `TIDAK ADA SESI` berbeda dari kartu asing.
Kartu asing menampilkan UID lengkap secara berpaginasi dan `BELUM TERDAFTAR`;
UID tidak dicetak ke Serial/log normal.
Kehilangan Wi-Fi saat masih menyala boleh memakai waktu tepercaya yang berjalan.
Cold boot tanpa sinkronisasi waktu tidak boleh menerima event baru.

## UID dan queue

UID hex: lowercase, urutan byte/leading zero tetap, tanpa separator.
Boundary backend, snapshot, serta cache Attendance menormalisasi hex case;
credential legacy non-hex tetap exact. Tidak ada normalisasi massal DB.
Tap valid: lookup cache → cek window/eligibility/duplicate → durable queue → LCD.
Tidak ada HTTP pada jalur foreground. Replay memakai worker jaringan terpisah;
hasil/sync tidak menahan pembacaan kartu berikutnya.

Kapasitas: 128 event, batas JSON 48KiB, arena queue 64KiB. Menampung 100 peserta
dengan margin 28%. Dua slot queue+cache paling banyak sekitar 148KiB dari
partisi default LittleFS 1.375MiB; heap adalah pembatas berikutnya.
Queue penuh/gagal persist tidak boleh menampilkan `BERHASIL`; pending/review
tidak dihapus untuk membuat ruang. Hanya receipt sukses yang lewat window
boleh dipangkas. Uji filesystem host bukan benchmark flash ESP32.
Kapasitas dan peak heap pada hardware ESP32 masih wajib diverifikasi; RAM statis
hasil compile tidak menghitung arena JSON, TLS, atau buffer heap dinamis.

## Setup HP, Admin dan recovery

Panduan operasional lengkap: [Setup mesin Absensi RFID](../../docs/absensi-rfid-setup.md).
Mesin kosong meminta PIN lokal 8–12 digit lewat keypad (dimask), lalu membuka AP
WPA2 menggunakan PIN itu. Tidak ada secret dicetak di LCD. Admin menerbitkan
pairing sekali pakai/15 menit; tenant/device/unit ditentukan server. Tahan D tiga
detik untuk mengganti Wi-Fi tanpa menghapus identity/queue. Jangan mengedit source
untuk menambah EDC02. Arsip firmware tidak dapat dipilih sebagai sketch upload.

ArduinoJson **7.4.3** menggunakan allocator berbatas nyata, bukan asumsi kapasitas
constructor deprecated. Queue/cache masing-masing maksimal 64KiB alokasi JSON;
snapshot envelope 40KiB, validasi candidate 64KiB, dokumen kecil 8KiB. Buffer HTTP
dan envelope dilepas sebelum install cache. Penulisan dual-slot diverifikasi byte
per byte tanpa menduplikasi seluruh queue file. Pengujian host fixture UID fisik
maksimal/counter panjang memuat 128 event: peak JSON queue 52.789 byte pada host
64-bit dan dual-slot 74.315 byte. Angka ini bukan peak total heap ESP32; TLS/Wi-Fi,
fragmentasi dan latency flash tetap diukur saat physical acceptance. Worker stack
12.288 byte; partisi LittleFS default 1.441.792 byte.

Serial provisioning lama tersedia tetapi tidak meng-echo nilai. Setelah pairing,
bundle `att_identity` authoritative; gunakan recovery HP/Admin untuk credential.
Jangan flash sebelum software release gate selesai. Tidak ada physical PASS
hanya berdasarkan compile atau uji host.
