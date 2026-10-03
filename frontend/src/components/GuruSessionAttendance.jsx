import {useEffect,useState} from "react";
import api from "../services/api";
import {hasPermission} from "../utils/hasPermission";
export default function GuruSessionAttendance({unitId,month,year,guru}){
  const [sessions,setSessions]=useState([]),[rows,setRows]=useState([]),[feedback,setFeedback]=useState("");
  const [busy,setBusy]=useState(false),[form,setForm]=useState({guru_id:"",session_id:"",tanggal:"",status:"H"});
  useEffect(()=>{
    let active=true;
    Promise.all([api.get("/attendance-sessions",{params:{unit_id:unitId}}),
      api.get("/attendance/admin/guru/results",{params:{unit_id:unitId,bulan:month,tahun:year}})])
      .then(([a,b])=>{if(active){setSessions(a.data.data.filter(s=>s.start_time&&s.end_time));setRows(b.data.data);}})
      .catch(e=>{if(active)setFeedback(e.response?.data?.error||"Gagal memuat absensi sesi guru");});
    return ()=>{active=false;};
  },[unitId,month,year]);
  async function save(e){
    e.preventDefault();if(busy)return;setBusy(true);setFeedback("");
    try{
      await api.post("/attendance/admin/guru/results",{...form,unit_id:unitId});
      setFeedback("Absensi guru berhasil disimpan.");
      const result=await api.get("/attendance/admin/guru/results",{params:{unit_id:unitId,bulan:month,tahun:year}});
      setRows(result.data.data);
    }catch(error){setFeedback(error.response?.data?.error||"Simpan/muat ulang gagal. Periksa data server sebelum mengulang.");}
    finally{setBusy(false);}
  }
  return <section style={{marginTop:24}}><h2>Absensi Guru per Sesi</h2>
    <p>Hasil canonical H/I/S/A dan Alfa otomatis. Rekap bulanan legacy di bawah tetap historis terpisah; RFID guru belum diaktifkan.</p>
    {hasPermission("absensi_guru.manage") && <form onSubmit={save}>
      <select aria-label="Guru" required value={form.guru_id} onChange={e=>setForm({...form,guru_id:e.target.value})}>
        <option value="">Pilih guru</option>{guru.map(g=><option key={g.id} value={g.id}>{g.nama}</option>)}
      </select>{" "}<select aria-label="Sesi guru" required value={form.session_id} onChange={e=>setForm({...form,session_id:e.target.value})}>
        <option value="">Pilih sesi</option>{sessions.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}
      </select>{" "}<input type="date" required aria-label="Tanggal absensi guru" value={form.tanggal} onChange={e=>setForm({...form,tanggal:e.target.value})}/>{" "}
      <select aria-label="Status guru" value={form.status} onChange={e=>setForm({...form,status:e.target.value})}>
        {["H","I","S","A"].map(s=><option key={s}>{s}</option>)}
      </select>{" "}<button disabled={busy}>{busy?"Menyimpan…":"Simpan Absensi Sesi"}</button>
    </form>}
    {feedback&&<p role="status">{feedback}</p>}
    <div style={{overflowX:"auto"}}><table><thead><tr><th>Tanggal</th><th>Guru</th><th>Sesi</th><th>Status</th><th>Sumber</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td>{r.tanggal}</td><td>{r.guru_nama}</td><td>{r.display_name}</td><td>{r.status}</td><td>{r.source}</td></tr>)}</tbody></table></div>
  </section>;
}
