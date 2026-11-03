import React,{useEffect,useState} from 'react';
import {Modal,View,ScrollView} from 'react-native';
import {AppText as Text} from './typography';
import {Button,Card,Row,Empty,s} from './ui';
const {rupiah}=require('./domain.cjs');
export function PurchaseInvoiceSheet({id,request,onClose}){
 const [detail,setDetail]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let alive=true;if(!id)return;
  Promise.resolve().then(()=>{if(!alive)return;setLoading(true);setError('');setDetail(null);return request(`/purchases/${id}`);}).then(value=>{if(!value)throw Error('INVOICE_UNAVAILABLE');if(alive)setDetail(value);}).catch(()=>{if(alive)setError('Invoice belum dapat dimuat. Coba lagi.');}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};
 // request wraps the current merchant client; id/retry determine this read-only fetch.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[id,attempt]);
 const invoice=detail?.invoice?.id===id?detail.invoice:null;
 return <Modal visible={!!id} transparent animationType="slide" onRequestClose={onClose}><View style={s.sheetOverlay}><View style={s.sheet}><View style={s.sheetHandle}/><Text style={s.sectionTitle}>Detail Invoice Pembelian</Text><ScrollView contentContainerStyle={{gap:10}}>{loading?<Empty loading title="Memuat invoice"/>:error?<Empty title={error} onRetry={()=>setAttempt(v=>v+1)}/>:invoice?<><Card title={invoice.supplier||'Supplier tidak tercatat'}><Row label="Referensi" value={invoice.reference||invoice.id}/><Row label="Tanggal" value={new Date(invoice.created_at).toLocaleString('id-ID')}/><Row label="Status" value={invoice.kind==='PURCHASE_RETURN'?'RETUR TERCATAT':invoice.status}/><Row label="Pembayaran" value={invoice.payment_status==='SETTLED'?'Lunas':'Masih ada utang'}/></Card>{detail.items.length?detail.items.map(item=><Card key={item.product_id} title={item.name}><Row label="Qty / satuan historis" value={`${item.quantity} ${item.uom||'(satuan tidak tercatat)'}`}/><Row label="Harga beli per unit" value={rupiah(item.unit_price)}/>{BigInt(item.discount||0)>0n&&<Row label="Diskon item" value={rupiah(item.discount)}/>}<Row label="Subtotal" value={rupiah(item.total)}/></Card>):<Empty title="Item invoice tidak tersedia"/>}<Card title="Total invoice"><Row label="Total pembelian" value={rupiah(invoice.total)}/><Row label="Dibayar saat pembelian" value={rupiah(invoice.paid)}/>{invoice.kind==='PURCHASE'&&<Row label="Sisa utang saat ini" value={rupiah(invoice.outstanding)}/>}<Text style={s.muted}>Harga berasal dari invoice tersimpan. Diskon/pajak/biaya yang tidak dicatat pada invoice lama tidak ditambahkan.</Text></Card></>:null}</ScrollView><Button title="Tutup Detail" secondary onPress={onClose}/></View></View></Modal>;
}
