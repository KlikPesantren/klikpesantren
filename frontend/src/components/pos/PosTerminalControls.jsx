import {useState} from 'react';
import {hasPermission} from '../../utils/hasPermission';
import {usePosResource,usePosMutation} from '../../hooks/usePosResource';
import {Feedback,PosTable,Pager,Choice,Check} from './PosWidgets';
import '../../styles/posAdmin.css';
export default function PosTerminalControls({unitId}){
 return hasPermission('pos.view')?<div className="pos-admin"><section className="pos-panel"><h3>Terminal POS · registry Perangkat existing</h3>{unitId?<Terminals key={unitId} unitId={unitId}/>:<p>Pilih satu unit untuk mengonfigurasi terminal POS.</p>}</section></div>:null;
}
function Terminals({unitId}){
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[target,setTarget]=useState(null),[merchant,setMerchant]=useState(''),[enabled,setEnabled]=useState(false);
 const scope={unit_id:unitId},state=usePosResource('/pos/admin/management/terminals',{...scope,page,page_size:25},revision),merchants=usePosResource('/pos/admin/management/merchants',{...scope,page_size:100},revision);
 const mutation=usePosMutation(()=>setRevision(r=>r+1));
 const time=value=>value?new Date(value).toLocaleString('id-ID'):'—';
 return <><Feedback {...state}/><PosTable rows={state.data?.rows} columns={[{key:'name',label:'Perangkat'},{key:'device_id',label:'ID'},{key:'capability',label:'Capability',render:r=>r.attendance_mode?'Absensi — frozen':r.pos_enabled?'POS':'Belum aktif POS'},{key:'unit_id',label:'Unit'},{key:'merchant_id',label:'Merchant'},{key:'enabled',label:'Enabled'},{key:'status',label:'Koneksi tercatat'},{key:'last_ping',label:'Last ping',render:r=>time(r.last_ping)},{key:'last_sync',label:'Last sync',render:r=>time(r.last_sync)},{key:'firmware_version',label:'Versi'}]} action={r=><button disabled={!hasPermission('pos.config.manage')||Boolean(r.attendance_mode)||mutation.busy} onClick={()=>{setTarget(r);setMerchant(r.merchant_id||'');setEnabled(r.pos_enabled);}}>Konfigurasi POS</button>}/><Pager data={state.data} page={page} setPage={setPage}/>
  {target&&<form className="pos-form" onSubmit={e=>{e.preventDefault();mutation.mutate('patch',`/pos/admin/terminals/${target.id}`,{unit_id:unitId,merchant_id:merchant,pos_enabled:enabled});}}><p>Perangkat {target.name} · Unit {unitId}. Tidak mengubah credential atau pairing.</p><Choice label="Merchant POS" value={merchant} onChange={setMerchant} required options={(merchants.data?.rows||[]).filter(m=>m.active&&m.pos_enabled&&Number(m.unit_id)===Number(unitId))}/><Check label="POS enabled" value={enabled} onChange={setEnabled}/><div className="pos-toolbar"><button className="pos-primary" disabled={mutation.busy||!hasPermission('pos.config.manage')}>Simpan</button><button type="button" onClick={()=>setTarget(null)} disabled={mutation.busy}>Tutup</button></div></form>}
  <Feedback {...mutation} error={mutation.error||merchants.error}/><p className="pos-note">Status koneksi adalah observasi heartbeat existing; last ping ditampilkan agar stale status tidak dianggap bukti perangkat online. Device Absensi tidak memperoleh capability POS.</p>
 </>;
}
