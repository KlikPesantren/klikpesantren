import {useState} from "react";
import api from "../services/api";
import {hasPermission} from "../utils/hasPermission";

export default function AttendanceDeviceControls({unitId,units,devices,onSaved}) {
  const [name,setName]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [pairing,setPairing]=useState(null),[edit,setEdit]=useState(null);
  if(!unitId || !hasPermission("rfid.manage")) return null;
  async function action(work) {
    if(busy)return; setBusy(true);setError("");
    try {const response=await work(); if(response.data.data?.pairing_code) setPairing(response.data.data); await onSaved();return true;}
    catch(e){setError(e.response?.data?.error || "Operasi perangkat gagal. Coba kembali.");return false;}
    finally{setBusy(false);}
  }
  return <section aria-label="Kelola Perangkat EDC" style={{marginBottom:24}}>
    <h2>Perangkat EDC — Absensi RFID</h2>
    <p>Pairing berlaku 15 menit dan hanya sekali. Perubahan unit tidak memerlukan flash.</p>
    <form onSubmit={e=>{e.preventDefault();action(()=>api.post("/rfid/device/attendance",{unit_id:unitId,nama_device:name}));}}>
      <label>Nama perangkat <input value={name} maxLength={80} required onChange={e=>setName(e.target.value)} /></label>{" "}
      <button disabled={busy || !name.trim()}>Tambah Perangkat &amp; Generate Kode Pairing</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {pairing && <div role="dialog" aria-label="Kode Pairing" style={{padding:16,border:"1px solid var(--border-color)",overflowWrap:"anywhere"}}>
      <h3>Kode Pairing: {pairing.device.nama_device}</h3>
      <p>Masukkan pada halaman setup lokal perangkat. Jangan bagikan atau simpan di chat.</p>
      <code>{pairing.pairing_code}</code>
      <p>Berlaku sampai {new Date(pairing.expires_at).toLocaleString("id-ID")}</p>
      <button onClick={()=>setPairing(null)}>Tutup dan hapus dari tampilan</button>
    </div>}
    {devices.some(d=>!d.attendance_mode && d.merchant_id==null) && <details><summary>Perangkat lama belum diklasifikasikan</summary>
      <p>Hanya pilih perangkat yang memang menjalankan firmware Absensi. Tidak mengubah credential atau mapping pembayaran.</p>
      {devices.filter(d=>!d.attendance_mode && d.merchant_id==null).map(d=><p key={d.id}>{d.nama_device} <button disabled={busy}
        onClick={()=>{if(window.confirm(`Tetapkan ${d.nama_device} sebagai perangkat Absensi RFID?`))action(()=>api.post(`/rfid/device/attendance/${encodeURIComponent(d.device_id)}/adopt`,{unit_id:unitId,confirmation:"ATTENDANCE"}));}}>Tetapkan Mode Absensi</button></p>)}
    </details>}
    <ul>{devices.filter(d=>d.attendance_mode==="ATTENDANCE").map(d=><li key={d.id}>
      {d.nama_device} — {d.enabled ? "Aktif" : "Nonaktif"}{" "}
      <button disabled={busy} onClick={()=>setEdit({...d,assignment_unit_id:d.unit_id})}>Edit / Pindah Unit</button>{" "}
      <button disabled={busy} onClick={()=>action(()=>api.post(`/rfid/device/attendance/${encodeURIComponent(d.device_id)}/pairing`,{unit_id:unitId}))}>Kode Pairing Baru / Recovery</button>
    </li>)}</ul>
    {edit && <form onSubmit={e=>{e.preventDefault();action(()=>api.patch(`/rfid/device/attendance/${encodeURIComponent(edit.device_id)}`,
      {unit_id:unitId,nama_device:edit.nama_device,assignment_unit_id:Number(edit.assignment_unit_id),enabled:edit.enabled})).then(ok=>{if(ok)setEdit(null);});}}>
      <label>Nama <input required maxLength={80} value={edit.nama_device} onChange={e=>setEdit({...edit,nama_device:e.target.value})} /></label>{" "}
      <label>Unit <select value={edit.assignment_unit_id} onChange={e=>setEdit({...edit,assignment_unit_id:e.target.value})}>
        {units.filter(u=>u.is_active!==false).map(u=><option key={u.id} value={u.id}>{u.nama}</option>)}
      </select></label>{" "}
      <label><input type="checkbox" checked={edit.enabled} onChange={e=>setEdit({...edit,enabled:e.target.checked})}/> Aktif</label>{" "}
      <button disabled={busy}>Simpan</button>{" "}<button type="button" onClick={()=>setEdit(null)}>Batal</button>
    </form>}
  </section>;
}
