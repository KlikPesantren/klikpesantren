# Sumber utama KlikPesantren

Repository pengembangan aktif:
`C:\Users\hi\Documents\0Aiki\Administrasi Santri Digital\klikpesantren`

Origin: `https://github.com/KlikPesantren/klikpesantren.git`.
Jangan membuka sketch dari folder deployment atau checkout historis.
Sketch universal: `firmware/Absensi_RFID/Absensi_RFID.ino`.

## Preservasi workspace

Root induk mempunyai 161 entri perubahan historis; tidak di-reset/dihapus.
Seluruh branch lokal root induk disimpan di `refs/archive/original-project/*`.
Branch checkout sementara disimpan di `refs/archive/temporary-attendance/*`.
Commit tooling unik `519b96f` tetap dapat diakses melalui ref archive.
Empat file hybrid belum dikomit dari `attendance-prod-deploy` dipreservasi di
`../archive/attendance-prod-deploy`, dengan ekstensi `.source.txt`, bukan sketch aktif.
Material historis tersebut bukan sumber untuk build/flash.

## Gate release

Branch implementasi: `codex/absensi-rfid-v1-final`.
Perubahan lokal belum menjadi release end-to-end yang disetujui.
Pairing HP, manajemen perangkat, manual/protected canonical attendance, scheduler
auto-Alfa, regresi integration sintetis, dan physical acceptance masih harus selesai.
Jangan deploy/flash hanya karena compile atau uji host berhasil.
Tidak ada perubahan production pada tahap ini.
