export default function AttendanceEffectiveScopeChoice({value,onChange,disabled=false}){
  return <section className="attendance-effective-choice" aria-label="Perubahan Jadwal Hari Ini">
    <strong>Perubahan Jadwal Hari Ini</strong>
    <label>Jadwal hari ini sudah terbentuk. Perubahan ini mau berlaku kapan?
    <select className="form-control-v3" value={value||""} onChange={e=>onChange(e.target.value)} disabled={disabled}>
      <option value="">Pilih waktu berlaku</option>
      <option value="TODAY">Berlaku Hari Ini</option>
      <option value="NEXT">Mulai Jadwal Berikutnya</option>
    </select>
    </label>
    <small>{value==="TODAY"?"Jadwal dan sesi hari ini akan disesuaikan. H/I/S dan koreksi manual tetap tersimpan.":
      value==="NEXT"?"Sesi dan hasil hari ini tidak berubah.":"Pilihan ini wajib; tidak ada perubahan otomatis."}</small>
  </section>;
}
