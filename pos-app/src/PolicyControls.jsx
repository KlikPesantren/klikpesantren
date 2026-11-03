import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'react-native';
import * as Crypto from 'expo-crypto';
import { Button, Card, Field, Row, RupiahField, s } from './ui';

export function TakeoverControls({data,context,submit}) {
 const [selected,setSelected]=useState(null),[actual,setActual]=useState(''),[reason,setReason]=useState('');
 const request=useRef(Crypto.randomUUID());
 if(context?.role!=='OWNER')return null;
 const choose=row=>{setSelected(row);setActual('');setReason('');request.current=Crypto.randomUUID();};
 const save=async()=>{const result=await submit('/shifts/takeover',{request_id:request.current,shift_id:selected.id,actual_cash:actual,reason,confirmation:'TAKEOVER'},'Shift diambil alih; kas fisik dan selisih dicatat.','SHIFT');if(result)setSelected(null);};
 return <Card title="Ambil Alih Shift — Owner"><Text style={s.muted}>Hitung kas fisik bersama operator bila tersedia. Shift lama ditutup dengan selisih yang nyata; shift Owner dibuka dengan kas yang sama. Tidak membuat penerimaan kas baru.</Text>{(data.workspace?.active_shifts||[]).filter(row=>!row.is_own).map(row=><Card key={row.id} title={row.operator_name}><Row label="Terminal / laci" value={`${row.terminal_name} / ${row.drawer_name}`}/><Row label="Dibuka" value={new Date(row.opened_at).toLocaleString('id-ID')}/><Button title="Rekonsiliasi dan Ambil Alih" secondary disabled={!!data.workspace?.open_shift} onPress={()=>choose(row)}/></Card>)}{selected&&<><Row label="Operator lama" value={selected.operator_name}/><RupiahField label="Kas fisik yang diserahterimakan" value={actual} onChangeText={setActual}/><Field label="Alasan takeover wajib" value={reason} onChangeText={setReason}/><Button title="Konfirmasi Takeover dengan Kas Aktual" disabled={!/^(0|[1-9]\d*)$/.test(actual)||!reason.trim()} onPress={save}/><Button title="Batal Takeover" secondary onPress={()=>setSelected(null)}/></>}</Card>;
}

export function IdentityControls({product,context,submit,onSaved}) {
 const [sku,setSku]=useState(product.sku||''),[barcode,setBarcode]=useState(product.barcode||''),[reason,setReason]=useState('');
 const request=useRef(Crypto.randomUUID());
 if(context?.role!=='OWNER')return null;
 const save=async()=>{const result=await submit(`/products/${product.id}/identity`,{request_id:request.current,sku,barcode,reason},'SKU/barcode diperbarui; snapshot transaksi lama tetap.','PRODUK');if(result){setReason('');request.current=Crypto.randomUUID();onSaved?.(result);}};
 return <Card title="Ubah SKU / Barcode — Owner"><Text style={s.muted}>Perubahan identitas memerlukan alasan. Nilai lama/baru dan aktor dicatat; SKU pada struk historis tetap utuh. Import tidak dapat melewati editor ini.</Text><Field label="SKU baru" value={sku} onChangeText={setSku}/><Field label="Barcode baru (kosong = hapus)" value={barcode} onChangeText={setBarcode}/><Field label="Alasan perubahan identitas" value={reason} onChangeText={setReason}/><Button title="Simpan Identitas dengan Audit" disabled={!sku.trim()||!reason.trim()} onPress={save}/></Card>;
}

export function OpnameApproval({context,request,submit,revision}) {
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[selected,setSelected]=useState(null),[cost,setCost]=useState(''),[reason,setReason]=useState('');
 const intent=useRef(Crypto.randomUUID());
 useEffect(()=>{let live=true;request('/stock-opname-drafts').then(data=>{if(live){setRows(data.drafts||[]);setError('');}}).catch(()=>{if(live)setError('Daftar hitungan belum dapat dimuat. Buka ulang halaman stok.');});return()=>{live=false;};},[request,revision]);
 const choose=row=>{setSelected(row);setReason('');setCost('');intent.current=Crypto.randomUUID();};
 const save=async()=>{const result=await submit('/stock-opnames',{draft_id:selected.id,unit_cost:cost||'0',reason,request_id:intent.current,confirmation:'APPROVE'},'Hitungan disetujui; koreksi FIFO dicatat satu kali.','STOK');if(result){setRows(old=>old.filter(row=>row.id!==selected.id));setSelected(null);}};
 const positive=selected&&BigInt(selected.payload.actual_stock)>BigInt(selected.payload.expected_stock);
 return <Card title="Persetujuan Stok Opname"><Text style={s.muted}>Maksimal 100 hitungan terbaru. Draft belum mengubah stok. Owner harus menyetujui; bila stok bergerak, lakukan hitung ulang.</Text>{!!error&&<Text style={s.error}>{error}</Text>}{rows.filter(row=>!row.approval_id).map(row=><Card key={row.id} title={row.name}><Row label="Snapshot / hitungan fisik" value={`${row.payload.expected_stock} / ${row.payload.actual_stock}`}/><Text style={s.muted}>{row.payload.reason}</Text>{context?.role==='OWNER'&&<Button title="Tinjau Hitungan" secondary onPress={()=>choose(row)}/>}</Card>)}{selected&&context?.role==='OWNER'&&<><Row label="Produk" value={selected.name}/>{positive&&<RupiahField label="HPP per unit untuk selisih masuk" value={cost} onChangeText={setCost}/>}<Field label="Alasan persetujuan" value={reason} onChangeText={setReason}/><Button title="Setujui dan Bukukan Opname" disabled={!reason.trim()||(positive&&!/^(0|[1-9]\d*)$/.test(cost))} onPress={save}/><Button title="Kembali tanpa Approval" secondary onPress={()=>setSelected(null)}/></>}</Card>;
}

export function PricingPolicyNote(){return <Text style={s.muted}>Harga khusus final tanpa promo tambahan. Harga Umum memakai satu promo eligible: prioritas terbesar, lalu ID promo sebagai tie-break existing. Paket memakai harga final. Diskon manual ditolak pada keranjang berisi harga khusus/promo/paket; alokasi keranjang campuran belum ditetapkan.</Text>;}
