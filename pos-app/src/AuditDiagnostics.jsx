import React,{useEffect,useRef,useState} from 'react';
import {AppText as Text} from './typography';
import Constants from 'expo-constants';
import {Button,Card,Row,s} from './ui';
export function AuditPanel({request}){
 const sequence=useRef(0);
 const [data,setData]=useState({events:[]}),[error,setError]=useState('');
 const load=async cursor=>{const seq=++sequence.current;try{const result=await request('/policy-audit',{query:cursor||{}});if(seq!==sequence.current)return;setData(old=>({events:cursor?[...old.events,...result.events]:result.events,next:result.next}));setError('');}catch{if(seq!==sequence.current)return;setError('Audit belum dapat dimuat. Periksa permission atau status backend.');}};
 useEffect(()=>{let alive=true;Promise.resolve().then(()=>{if(alive)load();});return()=>{alive=false;sequence.current++;};},[request]); // eslint-disable-line react-hooks/exhaustive-deps
 return <Card title="Audit Perubahan Usaha"><Text style={s.muted}>Riwayat immutable: master produk/harga/promo, takeover, identitas, opname dan cutoff. Hanya Owner dapat membaca detail ini.</Text>{!!error&&<Text style={s.error}>{error}</Text>}{data.events.map(e=><Card key={e.id} title={e.kind}><Row label="Waktu / aktor" value={`${new Date(e.created_at).toLocaleString('id-ID')} · ${e.actor_name||'Admin KlikPesantren'}`}/>{e.payload.table&&<Row label="Master" value={e.payload.table}/>}<Text>{e.payload.reason||e.payload.action||'Perubahan tercatat'}</Text>{e.payload.before&&e.payload.after&&Object.keys(e.payload.after).filter(k=>JSON.stringify(e.payload.before[k])!==JSON.stringify(e.payload.after[k])).map(k=><Row key={k} label={k} value={`${String(e.payload.before[k]??'—')} → ${String(e.payload.after[k]??'—')}`}/>)}</Card>)}<Button title="Muat Ulang Audit" secondary onPress={()=>load()}/>{data.next&&<Button title="Audit Sebelumnya" secondary onPress={()=>load(data.next)}/>}</Card>;
}
export function DiagnosticsPanel(){
 const config=Constants.expoConfig,extra=config?.extra||{},observed=globalThis.__suqDiagnostics||{},last=observed.lastRequest||{},error=observed.lastError||{};
 return <Card title="Tentang / Diagnostik"><Row label="Versi / build" value={`${config?.version||'—'} / ${config?.android?.versionCode||Constants.nativeBuildVersion||'—'}`}/><Row label="Lingkungan" value={extra.posEnvironment||'—'}/><Row label="API" value={extra.apiUrl||'—'}/><Row label="Source" value={extra.sourceCommit||'—'}/><Row label="Request terakhir" value={`${last.status??'—'} · ${last.at||'Belum tersedia'}`}/><Row label="Error terakhir" value={error.code||'Tidak tercatat'}/><Row label="Referensi dukungan" value={error.requestId||last.requestId||'—'}/><Text style={s.muted}>Tidak menampilkan password, token atau UID kartu. NFC memerlukan HP NFC yang kompatibel, NFC aktif, dan kartu yang UID-nya terdaftar di Admin. Pemindaian hanya aktif pada tahap pembayaran Dompet; barcode/token sah tetap tersedia sebagai alternatif.</Text></Card>;
}
