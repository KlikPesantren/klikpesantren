import {useEffect,useRef,useState} from "react";
import api from "../services/api";
import {hasPermission} from "../utils/hasPermission";
import Button from "./ui/Button";
import DataTableCard from "./ui/DataTableCard";
import SearchInput from "./ui/SearchInput";
import StatusBadge from "./ui/StatusBadge";
import {Table,TableScroll,TablePagination,useClientPagination} from "./ui/table";
import "./DeviceManagement.css";

const date=value=>value ? new Date(value).toLocaleString("id-ID") : "—";
export default function AttendanceDeviceControls({unitId,units,devices,onSaved}) {
  const [name,setName]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [notice,setNotice]=useState(""),[pairing,setPairing]=useState(null),[dialog,setDialog]=useState(null);
  const [search,setSearch]=useState(""),[copied,setCopied]=useState(false);
  const inFlight=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    if(!pairing)return;
    const timer=setTimeout(()=>{setPairing(null);setCopied(false);},Math.max(0,new Date(pairing.expires_at).getTime()-Date.now()));
    return()=>clearTimeout(timer);
  },[pairing]);
  const canManage=Boolean(unitId)&&hasPermission("rfid.manage");
  const filtered=devices.filter(d=>[d.nama_device,d.device_id,d.attendance_mode,d.status].some(v=>String(v||"").toLowerCase().includes(search.toLowerCase().trim())));
  const {page,setPage,paginatedItems,totalItems,pageSize}=useClientPagination(filtered);
  async function action(work,message) {
    if(inFlight.current || !canManage)return false;
    inFlight.current=true;setBusy(true);setError("");setNotice("");
    try {
      const response=await work();
      if(!alive.current)return false;
      if(response.data.data?.pairing_code){setPairing(response.data.data);setCopied(false);setName("");}
      setNotice(message);setDialog(null);
      // Feedback does not wait for the list refresh.
      await onSaved();return true;
    } catch(e){if(alive.current)setError(e.response?.data?.error || "Operasi perangkat gagal. Coba kembali.");return false;}
    finally{inFlight.current=false;if(alive.current)setBusy(false);}
  }
  const endpoint=d=>`/rfid/device/attendance/${encodeURIComponent(d.device_id)}`;
  function submitDialog(e) {
    e.preventDefault();const d=dialog.device;
    if(dialog.kind==="rename")return action(()=>api.patch(`/rfid/device/${encodeURIComponent(d.device_id)}/name`,{unit_id:unitId,nama_device:dialog.name.trim()}),"Nama perangkat diperbarui.");
    if(dialog.kind==="delete")return action(()=>api.delete(`/rfid/device/${encodeURIComponent(d.device_id)}`,{data:{unit_id:unitId,confirmation:"DELETE",confirmation_device_id:d.device_id}}),"Perangkat belum digunakan berhasil dihapus.");
    return action(()=>api.patch(endpoint(d),{unit_id:unitId,nama_device:d.nama_device,assignment_unit_id:Number(dialog.unit),enabled:d.enabled}),"Unit perangkat diperbarui.");
  }
  return <div className="device-management">
    {canManage && <section className="device-provision" aria-label="Tambah Perangkat Absensi">
      <h2>Tambah Perangkat Absensi</h2>
      <p>Daftarkan perangkat baru dan dapatkan kode pairing sekali pakai.</p>
      <form onSubmit={e=>{e.preventDefault();action(()=>api.post("/rfid/device/attendance",{unit_id:unitId,nama_device:name.trim()}),"Perangkat berhasil dibuat.");}}>
        <label>Nama perangkat<input value={name} maxLength={80} required disabled={busy} onChange={e=>setName(e.target.value)} /></label>
        <Button type="submit" loading={busy} disabled={!name.trim()}>+ Tambah Perangkat</Button>
      </form>
      <p className="device-helper">Kode pairing berlaku 15 menit dan hanya dapat digunakan satu kali.</p>
    </section>}
    {error && <p role="alert" className="device-error">{error}</p>}
    {notice && <p role="status" className="device-notice">{notice}</p>}
    <DataTableCard title="Daftar Perangkat" subtitle="Perangkat pada unit aktif">
      <div className="device-search"><SearchInput value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} placeholder="Cari nama, ID, tipe atau status..." /></div>
      <TableScroll><Table><thead><tr><th>Perangkat</th><th>Tipe</th><th>Unit</th><th>Status</th><th>Last Ping</th><th>Last Sync</th><th>Versi</th><th>Aksi</th></tr></thead>
        <tbody>{paginatedItems.map(d=><tr key={d.id}>
          <td><strong>{d.nama_device||d.device_id}</strong><small className="device-subtext">{d.device_id}</small></td>
          <td>{d.attendance_mode==="ATTENDANCE" ? "Absensi RFID" : d.attendance_mode || "Legacy / mode belum ditentukan"}</td>
          <td>{units.find(u=>Number(u.id)===Number(d.unit_id))?.nama || "—"}</td>
          <td><StatusBadge status={d.status}/><small className="device-subtext">{d.enabled ? "Aktif" : "Nonaktif"}</small></td>
          <td>{date(d.last_ping)}</td><td>{date(d.last_sync)}</td><td>{d.firmware_version||"—"}</td>
          <td>{canManage ? <details className="device-actions"><summary aria-label={`Aksi ${d.nama_device||d.device_id}`}>⋮</summary>
            <div className="device-action-list">
              <button disabled={busy} onClick={e=>{e.currentTarget.closest("details").open=false;setDialog({kind:"rename",device:d,name:d.nama_device||d.device_id});}}>Ubah Nama</button>
              {d.attendance_mode==="ATTENDANCE" && <>
                <button disabled={busy} onClick={e=>{e.currentTarget.closest("details").open=false;setDialog({kind:"unit",device:d,unit:d.unit_id});}}>Edit / Pindah Unit</button>
                <button disabled={busy} onClick={()=>action(()=>api.post(`${endpoint(d)}/pairing`,{unit_id:unitId}),"Kode pairing baru tersedia.")}>Kode Pairing Baru / Recovery</button>
                <button disabled={busy} onClick={()=>action(()=>api.patch(endpoint(d),{unit_id:unitId,enabled:!d.enabled}),d.enabled ? "Perangkat dinonaktifkan. Histori tetap ada." : "Status perangkat diperbarui; pairing diperlukan sebelum aktif.")}>{d.enabled ? "Nonaktifkan" : "Aktifkan"}</button>
                <button className="device-danger" title="Backend memverifikasi perangkat belum digunakan" disabled={busy || d.enabled || Boolean(d.last_ping || d.last_sync)} onClick={e=>{e.currentTarget.closest("details").open=false;setDialog({kind:"delete",device:d});}}>Hapus Perangkat</button>
              </>}
            </div>
          </details> : "—"}</td>
        </tr>)}{!paginatedItems.length && <tr><td colSpan={8}>Belum ada perangkat yang sesuai.</td></tr>}</tbody>
      </Table></TableScroll>
      <TablePagination page={page} pageSize={pageSize} totalItems={totalItems} onPageChange={setPage}/>
    </DataTableCard>
    {pairing && <div className="device-overlay"><section role="dialog" aria-modal="true" aria-label="Kode Pairing" className="device-dialog">
      <h2>✓ Perangkat berhasil dibuat / kode pairing siap</h2><p>Nama perangkat: <strong>{pairing.device.nama_device}</strong></p>
      <label>KODE PAIRING</label><div className="device-pairing"><code>{pairing.pairing_code}</code><Button variant="secondary" onClick={async()=>{try{await navigator.clipboard.writeText(pairing.pairing_code);setCopied(true);}catch{setError("Salin gagal. Pilih kode secara manual.");}}}>{copied ? "Tersalin" : "Salin"}</Button></div>
      <p>Berlaku 15 menit. Hanya dapat digunakan satu kali.</p><p>Berlaku sampai {date(pairing.expires_at)}.</p>
      <p>Masukkan kode ini pada halaman setup lokal perangkat.</p>
      <Button onClick={()=>{setPairing(null);setCopied(false);}}>Tutup</Button>
    </section></div>}
    {dialog && <div className="device-overlay"><section role="dialog" aria-modal="true" aria-label={dialog.kind==="rename" ? "Ubah Nama" : dialog.kind==="delete" ? "Hapus Perangkat" : "Edit / Pindah Unit"} className="device-dialog">
      <h2>{dialog.kind==="rename" ? "Ubah Nama" : dialog.kind==="delete" ? "Hapus perangkat ini?" : "Edit / Pindah Unit"}</h2>
      <p><strong>{dialog.device.nama_device}</strong><small className="device-subtext">{dialog.device.device_id}</small></p>
      <form onSubmit={submitDialog}>
        {dialog.kind==="rename" && <label>Nama perangkat<input autoFocus required maxLength={80} value={dialog.name} onChange={e=>setDialog({...dialog,name:e.target.value})}/></label>}
        {dialog.kind==="unit" && <label>Unit<select value={dialog.unit} onChange={e=>setDialog({...dialog,unit:e.target.value})}>{units.filter(u=>u.is_active!==false).map(u=><option key={u.id} value={u.id}>{u.nama}</option>)}</select></label>}
        {dialog.kind==="delete" && <p>Perangkat belum digunakan akan dihapus permanen. Tindakan ini tidak dapat dibatalkan. Backend akan menolak penghapusan perangkat yang memiliki histori; gunakan Nonaktifkan untuk mempertahankannya.</p>}
        <div className="device-dialog-footer"><Button variant="secondary" disabled={busy} onClick={()=>setDialog(null)}>Batal</Button><Button type="submit" loading={busy} variant={dialog.kind==="delete" ? "danger" : "primary"} disabled={dialog.kind==="rename" && !dialog.name.trim()}>{dialog.kind==="delete" ? "Hapus Perangkat" : "Simpan"}</Button></div>
      </form>
    </section></div>}
  </div>;
}
