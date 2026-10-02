# Checkpoint Absensi RFID V1 — 3 Oktober 2026

Status keseluruhan PARTIAL, bukan izin release/flash.
Baseline protected main `c2f5e5b53d3f5e479a2ea2f71c3f8691a7fa3b7e`.
Branch lokal `codex/absensi-rfid-v1-final`. Tidak ada push/PR/deploy/DB write.

## Selesai di checkpoint ini

- Repository canonical dipindahkan ke child `klikpesantren` pada project home asli.
- Semua branch dari repo root dan temporary disimpan dalam refs archive; 232
  commit reachable/reflog temporary terbukti tersedia dalam repo canonical.
- Commit unik tooling `519b96f` dipreservasi, tidak dicampur ke feature branch.
- Empat file dirty/untracked lama dari attendance-prod-deploy disalin secara
  content-equivalent ke archive `.source.txt`; tidak ada secret pattern ditemukan.
- Tiga checkout Attendance sementara dibuang setelah verifikasi preservasi.
  Root historis dengan 161 perubahan lama dan worktree lain tetap tidak disentuh.
- Hanya satu sketch aktif Attendance pada lokasi yang dicari: firmware/Absensi_RFID.
- UID hex case dinormalisasi di firmware/cache/backend/snapshot serta input Admin
  yang diedit; tidak ada mass update UID. Nonhex legacy tetap exact, collision
  identitas tetap ambiguous/fail-closed.
- Snapshot bounded menambah display_name; membership/tenant/unit tetap di SQL.
- Tap selalu local cache → durable append → BERHASIL; tidak ada jalur TAP HTTP.
- Lifetime LCD tidak memblokir scanner; sync tidak mengambil alih LCD.
- Queue 128/48KiB, arena64KiB: host menerima 100 kartu berbeda saat network busy,
  termasuk reboot/durable-write failure/duplicate/time-invalid checks.
- Admin GET absensi, Wali dashboard ringkasan, Wali absensi ringkasan+riwayat
  memakai proyeksi shared attendance_results + legacy yang tidak bersinggungan.
  Tidak membuat row kedua. Canonical shadows legacy hanya tenant/person/session/
  tanggal/unit yang sama. Semua child/unit guard API lama tetap ada.
- PostgreSQL read-only rehearsal memverifikasi query aktual; synthetic SELECT-only
  CTE membuktikan H, riwayat I, dedup, sibling/unit/tenant isolation tanpa DML.

## Evidence

ESP32 core3.3.8 esp32:esp32:esp32 compile: flash1,182,619/1,310,720 (90%),
RAM statis51,724/327,680 (15%). BUKAN bukti peak heap/LCD fisik.
Host actual queuePendingTap (filesystem/LCD/network mock): median1.346ms,
p95 3.017ms, next-ready100/100, pending100 saat networkBusy=true.
Host append saja median0.945ms,p95 2.178ms,total96.653ms. BUKAN benchmark ESP32.

PASS: hybrid backend+host, UID boundary, shared read contract+real PostgreSQL CTE,
Phase1, Phase2A44checks, sessions, multi-unit10, guru scope, Wallet separation,
RFID policy, WaliJWT, device secret rotation, SahriyahKPI, frontend wiring,
Vite build, backend syntax/diff checks. Targeted ESLint dijalankan dari frontend.
Cash dashboard reconciliation belum PASS: percobaan awal memakai dummy env untuk
suite isolated, tetapi test tersebut membutuhkan DB nyata; gagal autentikasi.
Ini bukan bukti regresi finansial production. Production finance belum diuji ulang.

## Urutan pekerjaan yang masih harus dilanjutkan (jangan mulai ulang)

1. Secure pairing one-time tenant/unit-scoped dan Admin device-management yang
   memakai existing device secret hashing/rotation; AP/HP setup dan keypad recovery.
2. Selesaikan canonical manual writes/protected I/S/admin corrections. Saat ini
   Admin POST/batch masih legacy. JANGAN DEPLOY proyeksi read ini sebelum protection
   bridge tersebut diuji: hasil canonical bisa shadow manual legacy di logical key sama.
3. Jadwalkan auto-Alfa dengan existing closeOccurrence, recurring/multi-unit config,
   cancellation, dan guru credential enrollment sesuai schema yang diaudit.
4. Validasi peak heap/durable filesystem untuk target100 kartu, delayed replay dan
   snapshot refresh; jumlah slot128 baru terbukti pada host, bukan device fisik.
5. Full isolated integration/regression + migration UP/DOWN/UP jika pairing butuh
   additive schema. Production health/financial reconciliation belum gate PASS.
6. Review security/diff → protected PR/CI/merge → exact SHA deploy komponen berubah
   → production-safe smoke → ONE manual physical acceptance. Tidak ada Android build.
7. Selesaikan klasifikasi/arsip root historis sebelum menyatakan workspace fully closed.

Tidak mengubah EDC02, firmware cashier reference, Wallet/POS/payment source,
production UID, NVS provisioning, atau production schema/data/credentials.
