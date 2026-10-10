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
Material historis tersebut bukan sumber untuk build/flash. Delapan worktree lama
dan satu edit-copy dipindahkan ke `../archive/workspaces`; HEAD dan dirty work
dipertahankan. Sketch historis diubah ekstensi menjadi `.ino.source.txt`, isi
byte-identik. EDC01/EDC02 referensi canonical berada di `archive/firmware`.
Generated build lama dari C:\Codex dipindahkan ke `../archive/build-artifacts`;
tidak ada file dihapus. C:\Codex hanya menyisakan toolkit compiler/test, bukan
clone KlikPesantren. Root induk tetap arsip historis; jangan mengembangkannya.

## Gate release

Branch implementasi: `codex/absensi-rfid-v1-final`.
Perubahan lokal belum menjadi release end-to-end yang disetujui.
Pairing HP, manajemen perangkat, manual/protected canonical attendance dan
scheduler auto-Alfa telah ditambahkan. Regression PostgreSQL/authenticated
localhost dan release gate harus PASS sebelum merge/deploy. Physical acceptance
selalu terpisah; source/build tidak mengklaim pengujian hardware.
Jangan deploy/flash hanya karena compile atau uji host berhasil.
Tidak ada perubahan production pada tahap ini.
