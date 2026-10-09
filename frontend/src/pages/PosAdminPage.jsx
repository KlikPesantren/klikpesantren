import {useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useActiveUnit} from '../context/ActiveUnitContext';
import {getUser,hasPermission} from '../utils/hasPermission';
import {rupiah,moneyInput} from '../utils/posMoney.mjs';
import {usePosResource,usePosMutation} from '../hooks/usePosResource';
import {Feedback,PosTable,Pager,Choice,Text,Check,Lookup} from '../components/pos/PosWidgets';
import AppShell from '../layouts/AppShell';
import KpiCard from '../components/ui/KpiCard';
import KpiGrid from '../components/ui/KpiGrid';
import '../styles/posAdmin.css';
const titles={dashboard:'Dashboard',transactions:'Transaksi',products:'Produk',categories:'Kategori',merchants:'Merchant','business-v2':'Toko & Kantin',cashiers:'Kasir',shifts:'Shift',refunds:'Refund / Void',reconciliation:'Rekonsiliasi',settings:'Pengaturan'};
const col=(key,label,money=false)=>({key,label,money});
const date=value=>value?new Date(value).toLocaleString('id-ID'):'—';
const readable=(key,label)=>({key,label,render:row=>date(row[key])});
const managementSections=['products','categories','merchants','cashiers'];
export default function PosAdminPage(){
 const {section='dashboard'}=useParams(),{activeUnitId,allUnitsAllowed,loading,error}=useActiveUnit();
 return <AppShell title={`Suq Shogir · ${titles[section]||'Halaman tidak ditemukan'}`} breadcrumb="Suq Shogir" description="Pengelolaan toko dan kantin dalam platform KlikPesantren.">
  <div className="pos-admin"><Feedback loading={loading} error={error}/>{!loading&&!error&&titles[section]&&(activeUnitId||allUnitsAllowed)?<Workspace key={`${section}:${activeUnitId||'all'}`} section={section} unitId={activeUnitId}/>:!loading&&!error&&<p>Pilih unit yang valid untuk membuka POS.</p>}</div>
 </AppShell>;
}
function Workspace({section,unitId}){
 const [filters,setFilters]=useState({from:'',to:'',search:'',merchant_id:'',cashier_id:'',terminal_id:'',shift_id:'',method:'',payment_status:'',sale_status:'',category_id:'',active:'',available:'',status:''});
 const [page,setPage]=useState(1),[revision,setRevision]=useState(0),[edit,setEdit]=useState(null),[detail,setDetail]=useState(null);
 const scope=unitId?{unit_id:unitId}:{scope:'all'},params={...scope,...Object.fromEntries(Object.entries(filters).filter(([,v])=>v!=='')),page,page_size:25};
 const path=managementSections.includes(section)?`management/${section}`:section==='settings'?'management/merchants':section;
 const state=usePosResource(`/pos/admin/${path}`,params,revision);
 const merchants=usePosResource('/pos/admin/management/merchants',{...scope,page_size:100},revision);
 const setFilter=(key,value)=>{setFilters({...filters,[key]:value});setPage(1);};
 return <>
  {!unitId&&<p className="pos-note">Semua unit: laporan read-only. Pilih satu unit di workspace sebelum mengubah konfigurasi.</p>}
  {section==='business-v2'?<BusinessV2 data={state.data} unitId={unitId} onSaved={()=>setRevision(r=>r+1)}/>:section==='settings'?<section className="pos-panel"><h3>Kesiapan POS</h3><p>Konfigurasi memakai merchant, pengguna dan perangkat existing. RFID selalu online-authoritative, Wallet satu unit, tanpa posting otomatis ke Buku Kas.</p><nav className="pos-toolbar"><Link to="/pos/merchants">Merchant</Link><Link to="/pos/cashiers">Kasir</Link><Link to="/rfid-devices">Sistem → Perangkat</Link><Link to="/roles">Permission POS pada Roles</Link></nav><p>Aktifkan POS pada merchant ber-unit pasti, tetapkan kasir yang berwenang, lalu konfigurasi terminal POS. Perangkat Absensi tidak dapat diubah menjadi POS melalui kontrol ini.</p><p>Capability: pos.view, pos.sell, pos.products.manage, pos.shifts.manage, pos.refund, pos.discount, pos.reconcile, pos.config.manage. Tidak ada grant wallet.manage otomatis.</p></section>:<>
   <form className="pos-filters" onSubmit={e=>e.preventDefault()}>
    {!managementSections.includes(section)&&<><Text label="Dari" type="date" value={filters.from} onChange={v=>setFilter('from',v)}/><Text label="Sampai" type="date" value={filters.to} onChange={v=>setFilter('to',v)}/></>}
    {section!=='merchants'&&<Choice label="Merchant" value={filters.merchant_id} onChange={v=>setFilter('merchant_id',v)} options={merchants.data?.rows||[]}/>}
    {['transactions','refunds',...managementSections].includes(section)&&<Text label="Cari" value={filters.search} onChange={v=>setFilter('search',v)}/>}
    {['transactions','shifts','refunds','reconciliation'].includes(section)&&<><Text label="ID Kasir" value={filters.cashier_id} onChange={v=>setFilter('cashier_id',v)}/><Text label="ID Terminal" value={filters.terminal_id} onChange={v=>setFilter('terminal_id',v)}/></>}
    {section==='reconciliation'&&<Text label="ID Shift" value={filters.shift_id} onChange={v=>setFilter('shift_id',v)}/>}
    {['transactions','refunds'].includes(section)&&<><Choice label="Metode" value={filters.method} onChange={v=>setFilter('method',v)} options={['RFID','CASH','TRANSFER_QRIS'].map(id=>({id}))}/><Choice label="Status pembayaran" value={filters.payment_status} onChange={v=>setFilter('payment_status',v)} options={['PENDING','CONFIRMED'].map(id=>({id}))}/><Choice label="Status penjualan" value={filters.sale_status} onChange={v=>setFilter('sale_status',v)} options={['DRAFT','PAID','VOID'].map(id=>({id}))}/></>}
    {section==='shifts'&&<Choice label="Status shift" value={filters.status} onChange={v=>setFilter('status',v)} options={['OPEN','CLOSED'].map(id=>({id}))}/>}
    {managementSections.includes(section)&&<Choice label="Aktif" value={filters.active} onChange={v=>setFilter('active',v)} options={[{id:'true',name:'Aktif'},{id:'false',name:'Nonaktif'}]}/>}
    {section==='products'&&<><Text label="ID Kategori" value={filters.category_id} onChange={v=>setFilter('category_id',v)}/><Choice label="Tersedia" value={filters.available} onChange={v=>setFilter('available',v)} options={[{id:'true',name:'Tersedia'},{id:'false',name:'Tidak tersedia'}]}/></>}
   </form>
   <Feedback {...state}/>
   {managementSections.includes(section)&&<><button className="pos-primary" disabled={!unitId||!hasPermission(section==='products'||section==='categories'?'pos.products.manage':'pos.config.manage')} onClick={()=>setEdit({})}>Tambah {titles[section]}</button>{edit&&<MasterForm key={edit.id||'new'} kind={section} row={edit} unitId={unitId} onClose={()=>setEdit(null)} onSaved={()=>setRevision(r=>r+1)}/>}</>}
   {state.data&&(['dashboard','reconciliation'].includes(section)?<Dashboard data={state.data}/>:<><PosTable rows={state.data.rows} columns={columns(section)} action={row=>managementSections.includes(section)?<button disabled={!unitId||!hasPermission(['products','categories'].includes(section)?'pos.products.manage':'pos.config.manage')} onClick={()=>setEdit(row)}>Edit</button>:section==='transactions'?<button onClick={()=>setDetail(row.id)}>Detail</button>:section==='refunds'&&row.status==='PENDING'?<RefundConfirm row={row} unitId={unitId} onSaved={()=>setRevision(r=>r+1)}/>:null}/><Pager data={state.data} page={page} setPage={setPage}/></>)}
   {section==='reconciliation'&&<CashReport params={params} revision={revision}/>}
   {section==='refunds'&&<VoidMonitor params={params} revision={revision} onSelect={setDetail}/>}
   {detail&&<SaleDetail key={detail} id={detail} scope={scope} unitId={unitId} onClose={()=>setDetail(null)} onSaved={()=>setRevision(r=>r+1)}/>}
  </>}
 </>;
}
function BusinessV2({data,unitId,onSaved}){
 const empty=()=>({ownership:'INTERNAL',timezone:'Asia/Jakarta',receipt_prefix:'SUQ',unit_ids:unitId?[Number(unitId)]:[],request_id:crypto.randomUUID()});
 const [show,setShow]=useState(false),[selected,setSelected]=useState(null),[activation,setActivation]=useState(null),[form,setForm]=useState(empty),mutation=usePosMutation(()=>onSaved());
 const set=(k,v)=>setForm({...form,[k]:v}),toggleUnit=id=>set('unit_ids',form.unit_ids.includes(Number(id))?form.unit_ids.filter(x=>x!==Number(id)):[...form.unit_ids,Number(id)]);
 async function create(e){e.preventDefault();const result=await mutation.mutate('post','/pos/admin/businesses-v2',{...form,unit_id:unitId});if(result?.activation_code)setActivation({login:form.owner_login,code:result.activation_code});if(result){setShow(false);setForm(empty());}}
 return <>
  <section className="pos-panel"><div className="pos-toolbar"><div><h3>Toko & Kantin</h3><p className="pos-note">Buat usaha internal atau merchant eksternal, tetapkan Owner pertama, dan batasi unit yang dilayani.</p></div><button className="pos-primary" disabled={!unitId||!hasPermission('pos.config.manage')} onClick={()=>setShow(!show)}>Tambah merchant</button></div><p className="pos-note">{data?.privacy}</p>
   {activation&&<div className="pos-activation" role="status"><strong>Kode aktivasi Owner - tampil sekali</strong><p>ID login: {activation.login}</p><code>{activation.code}</code><p>Bagikan melalui kanal aman. Owner membuat password sendiri; kode kedaluwarsa dalam 48 jam.</p><button type="button" onClick={()=>setActivation(null)}>Saya sudah menyimpan dengan aman</button></div>}
   {show&&<form className="pos-form pos-merchant-form" onSubmit={create}>
    <Text label="Nama usaha" value={form.display_name||''} onChange={v=>set('display_name',v)} required/><Choice label="Jenis merchant" value={form.ownership} onChange={v=>set('ownership',v)} options={[{id:'INTERNAL',name:'Internal pesantren'},{id:'EXTERNAL',name:'Eksternal / pihak ketiga'}]}/><Text label="Nama legal (opsional)" value={form.legal_name||''} onChange={v=>set('legal_name',v)}/><Text label="Kontak usaha" value={form.phone||''} onChange={v=>set('phone',v)}/><Text label="Alamat usaha" value={form.address||''} onChange={v=>set('address',v)}/><Text label="Nama Owner pertama" value={form.owner_name||''} onChange={v=>set('owner_name',v)} required/><Text label="ID login Owner" value={form.owner_login||''} onChange={v=>set('owner_login',v)} required/><Text label="Prefix struk" value={form.receipt_prefix||''} onChange={v=>set('receipt_prefix',v)} required/>
    <fieldset className="pos-unit-grid"><legend>Unit yang dilayani</legend>{(data?.available_units||[]).map(unit=><Check key={unit.id} label={unit.nama} value={form.unit_ids.includes(Number(unit.id))} onChange={()=>toggleUnit(unit.id)}/>)}</fieldset>
    <div className="pos-toolbar"><button className="pos-primary" disabled={mutation.busy||!form.display_name||!form.owner_name||!form.owner_login||!form.unit_ids.length}>Buat merchant & Owner</button><button type="button" onClick={()=>setShow(false)}>Batal</button></div>
   </form>}<Feedback {...mutation}/>
  </section>
  <PosTable rows={data?.rows} columns={[["display_name","Merchant"],["ownership","Jenis"],["units","Unit layanan"],["activation_pending","Aktivasi Owner"],["active","Status"],["integration_enabled","Integrasi"],["wallet_enabled","Dompet"],["storefront_enabled","Toko online"]].map(([key,label])=>col(key,label))} action={row=><button onClick={()=>setSelected(row.id)}>Detail</button>}/>
  {selected&&<BusinessDetail id={selected} unitId={unitId} onClose={()=>setSelected(null)} onSaved={onSaved}/>}
 </>;
}
function BusinessDetail({id,unitId,onClose,onSaved}){
 const [revision,setRevision]=useState(0),state=usePosResource(`/pos/admin/businesses-v2/${id}`,{unit_id:unitId},revision),mutation=usePosMutation(()=>{setRevision(x=>x+1);onSaved();}),b=state.data?.business;
 return <section className="pos-panel"><div className="pos-toolbar"><h3>Detail merchant</h3><button onClick={onClose}>Tutup</button></div><Feedback {...state}/>{b&&<BusinessDetailEditor key={`${b.id}:${revision}`} business={b} audit={state.data.audit} privacy={state.data.privacy} busy={mutation.busy} onSave={form=>mutation.mutate('patch',`/pos/admin/businesses-v2/${id}`,{...form,unit_id:unitId})}/>}<Feedback {...mutation}/></section>;
}
function BusinessDetailEditor({business,audit,privacy,busy,onSave}){
 const [form,setForm]=useState({active:business.active,integration_enabled:business.integration_enabled,wallet_enabled:business.wallet_enabled,storefront_enabled:business.storefront_enabled});
 return <><dl className="pos-detail"><div><dt>Nama</dt><dd>{business.display_name}</dd></div><div><dt>Jenis</dt><dd>{business.ownership}</dd></div><div><dt>Unit layanan</dt><dd>{business.units}</dd></div><div><dt>Owner</dt><dd>{business.owner_name} ({business.owner_login})</dd></div><div><dt>Aktivasi</dt><dd>{business.activation_pending?'MENUNGGU AKTIVASI':'AKTIF / TIDAK MENUNGGU'}</dd></div></dl><fieldset className="pos-unit-grid"><legend>Status & integrasi</legend>{[['active','Merchant aktif'],['integration_enabled','Integrasi institusi'],['wallet_enabled','Dompet Santri'],['storefront_enabled','Toko online']].map(([key,label])=><Check key={key} label={label} value={form[key]} onChange={value=>setForm({...form,[key]:value})}/>)}</fieldset><button className="pos-primary" disabled={busy} onClick={()=>onSave(form)}>Simpan status</button><h4>Audit</h4><PosTable rows={audit} columns={[col('action','Aksi'),readable('created_at','Waktu')]}/><p className="pos-note">{privacy}</p></>;
}
function columns(kind){
 if(kind==='transactions')return [col('receipt','Receipt'),readable('created_at','Waktu'),col('merchant_name','Merchant'),col('unit_name','Unit'),col('cashier_name','Kasir'),col('grand_total','Total',true),col('method','Metode'),col('payment_status','Pembayaran'),col('status','Penjualan')];
 if(kind==='products')return [col('sku','SKU'),col('name','Produk'),col('merchant','Merchant'),col('category_id','Kategori'),col('price','Harga',true),col('active','Aktif'),col('available','Tersedia')];
 if(kind==='categories')return [col('name','Kategori'),col('merchant','Merchant'),col('active','Aktif')];
 if(kind==='merchants')return [col('name','Merchant'),col('unit_id','Unit'),col('active','Aktif'),{key:'ready',label:'POS',render:r=>r.unit_id&&r.location_resolution_status==='resolved'?(r.pos_enabled?'SIAP':'BELUM AKTIF'):'PERLU KONFIGURASI'},col('terminals','Terminal POS'),col('cashiers','Kasir')];
 if(kind==='cashiers')return [col('name','Kasir'),col('role','Role'),col('unit_id','Unit'),col('merchant','Merchant'),col('active','Assignment aktif'),col('user_status','Akun')];
 if(kind==='shifts')return [col('merchant','Merchant'),col('cashier','Kasir'),col('terminal','Terminal'),col('status','Status'),readable('opened_at','Dibuka'),col('opening_cash','Kas awal',true),col('cash_sales','Penjualan tunai',true),col('cash_refunds','Refund tunai',true),col('calculated_expected','Kas expected',true),col('actual_cash','Kas aktual',true),col('difference','Selisih',true),readable('closed_at','Ditutup')];
 return [col('receipt','Receipt'),col('merchant_name','Merchant'),col('cashier_name','Kasir asal'),col('method','Metode'),col('original_amount','Asal',true),col('amount','Refund',true),col('cumulative_refunded','Kumulatif',true),col('reason','Alasan'),col('actor','Actor'),readable('created_at','Waktu'),col('status','Status')];
}
function Dashboard({data}){
 const walletMismatch=data.wallet&&(data.wallet.debit_difference!=='0'||data.wallet.credit_difference!=='0'||data.wallet.invalid_debit_links!=='0'||data.wallet.invalid_credit_links!=='0');
 const k=data.kpi,w=data.wallet,rate=k.paid_transactions==='0'?'0':((BigInt(k.refunded_transactions)*10000n)/BigInt(k.paid_transactions)).toString();
 return <><KpiGrid>{[['gross_sales','Penjualan bruto'],['net_sales','Penjualan neto'],['paid_transactions','Transaksi paid'],['average_paid','Rata-rata bruto (dibulatkan)'],['gross_items','Item bruto'],['refunds','Refund terkonfirmasi']].map(([key,label])=><KpiCard key={key} label={label} value={['paid_transactions','gross_items'].includes(key)?k[key]:rupiah(k[key])}/>)}</KpiGrid><p className="pos-note">Bruto = total PAID. Neto = bruto − refund CONFIRMED terkait penjualan terfilter. Item bruto tidak dikurangi refund berbasis nominal. Rata-rata = bruto ÷ transaksi PAID (pembulatan ke bawah). Refund rate: {`${rate.padStart(3,'0').slice(0,-2)},${rate.padStart(3,'0').slice(-2)}`}%. Shift OPEN: {data.open_shifts}. Transfer/QRIS pending: {rupiah(k.pending_external)} (bukan pendapatan).</p>
  {w&&<section className={`pos-panel ${walletMismatch?'pos-mismatch':''}`} role="status"><h3>Rekonsiliasi Wallet · {walletMismatch?'MISMATCH — perlu investigasi':'Rp0 — cocok'}</h3><p>POS RFID: {rupiah(w.pos_debit)} · Wallet debit: {rupiah(w.wallet_debit)} · Selisih: {rupiah(w.debit_difference)}</p><p>POS refund: {rupiah(w.pos_credit)} · Wallet credit: {rupiah(w.wallet_credit)} · Selisih: {rupiah(w.credit_difference)}</p><p>Hanya ledger linked, tenant/unit/account/type/direction/reference cocok. Link debit tidak cocok: {w.invalid_debit_links}; link credit tidak cocok: {w.invalid_credit_links}. Selisih antar-row tidak boleh saling menutupi.</p></section>}
  <div className="pos-grid"><section className="pos-panel"><h3>Pembayaran terkonfirmasi</h3><PosTable rows={data.methods} columns={[col('method','Metode'),col('transactions','Transaksi'),col('amount','Nominal',true)]}/></section><section className="pos-panel"><h3>Merchant (20 teratas)</h3><PosTable rows={data.merchants} columns={[col('merchant_name','Merchant'),col('gross','Bruto',true),col('refunds','Refund',true)]}/></section><section className="pos-panel"><h3>Produk (10 teratas)</h3><PosTable rows={data.products} columns={[col('name','Produk'),col('quantity','Qty bruto'),col('amount','Nominal item',true)]}/></section><section className="pos-panel"><h3>Jam transaksi</h3><PosTable rows={data.hours} columns={[col('hour','Jam lokal'),col('transactions','Transaksi')]}/></section></div>
 </>;
}
function CashReport({params,revision}){const state=usePosResource('/pos/admin/shifts',params,revision);return <section className="pos-panel"><h3>Kas fisik per shift (halaman terfilter)</h3><p>Expected = kas awal + CASH confirmed − CASH refund confirmed. RFID/QRIS tidak masuk kas fisik. Shift tertutup tidak dapat diedit.</p><Feedback {...state}/><PosTable rows={state.data?.rows} columns={columns('shifts')}/></section>;}
function VoidMonitor({params,revision,onSelect}){
 const [page,setPage]=useState(1),[status,setStatus]=useState('VOID'),state=usePosResource('/pos/admin/transactions',{...params,page,sale_status:status},revision);
 return <section className="pos-panel"><h3>Void / draft belum dibayar</h3><Choice label="Lifecycle" value={status} onChange={v=>{setStatus(v||'VOID');setPage(1);}} options={[{id:'VOID',name:'Riwayat void'},{id:'DRAFT',name:'Draft — kontrol void / konfirmasi'}]}/><Feedback {...state}/><PosTable rows={state.data?.rows} columns={[...columns('transactions'),col('void_reason','Alasan void'),col('void_by','Actor void'),readable('void_at','Waktu void')]} action={r=><button onClick={()=>onSelect(r.id)}>Detail / kontrol</button>}/><Pager data={state.data} page={page} setPage={setPage}/></section>;
}
function MasterForm({kind,row,unitId,onClose,onSaved}){
 const [form,setForm]=useState({name:row.name||'',sku:row.sku||'',image_url:row.image_url||'',price:String(row.price??''),merchant_id:row.merchant_id||'',category_id:row.category_id||'',user_id:row.id||'',active:row.active??true,available:row.available??true,pos_enabled:row.pos_enabled??true});
 const [inputError,setInputError]=useState(''),scope={unit_id:unitId};
 const mutation=usePosMutation(onSaved),set=(key,value)=>setForm({...form,[key]:value});
 async function save(e){e.preventDefault();setInputError('');try{
  let body={...form,unit_id:unitId},url,method='post';
  if(kind==='products'){body.price=moneyInput(form.price);body.category_id=body.category_id||null;url=row.id?`/pos/products/${row.id}`:'/pos/products';if(row.id)method='patch';}
  if(kind==='categories'){url=row.id?`/pos/admin/categories/${row.id}`:'/pos/categories';if(row.id)method='patch';}
  if(kind==='merchants'){url=row.id?`/pos/admin/merchants/${row.id}`:'/pos/merchants';if(row.id)method='patch';}
  if(kind==='cashiers'){body.user_id=form.user_id;url=`/pos/merchants/${form.merchant_id}/cashiers`;}
  await mutation.mutate(method,url,body);
 }catch(err){setInputError(err.message);}}
 return <section className="pos-panel"><h3>{row.id?'Edit':'Tambah'} {titles[kind]} · Unit {unitId}</h3><form onSubmit={save} className="pos-form">
  {kind==='cashiers'?<Lookup label="Pengguna existing" kind="users" scope={scope} value={form.user_id} onChange={v=>set('user_id',v)} required disabled={Boolean(row.id)}/>:<Text label="Nama" value={form.name} onChange={v=>set('name',v)} required/>}
  {kind!=='merchants'&&<Lookup label="Merchant" kind="merchants" scope={scope} value={form.merchant_id} required disabled={Boolean(row.id)} onChange={v=>setForm({...form,merchant_id:v,category_id:''})}/>}
  {kind==='products'&&<><Text label="URL foto HTTPS (opsional)" value={form.image_url} onChange={v=>set('image_url',v)}/><Text label="SKU" value={form.sku} onChange={v=>set('sku',v)} required/><Text label="Harga (Rupiah bulat)" value={form.price} onChange={v=>set('price',v)} required/><Lookup key={form.merchant_id} label="Kategori" kind="categories" scope={scope} merchantId={form.merchant_id} value={form.category_id} onChange={v=>set('category_id',v)}/><Check label="Tersedia" value={form.available} onChange={v=>set('available',v)}/></>}
  {(row.id||['products','cashiers'].includes(kind))&&<Check label="Aktif" value={form.active} onChange={v=>set('active',v)}/>} {kind==='merchants'&&row.id&&<Check label="POS aktif" value={form.pos_enabled} onChange={v=>set('pos_enabled',v)}/>}
  <div className="pos-toolbar"><button className="pos-primary" disabled={!unitId||mutation.busy}>Simpan</button><button type="button" disabled={mutation.busy} onClick={onClose}>Tutup</button></div>
 </form><Feedback {...mutation} error={mutation.error||inputError}/><p className="pos-note">Tidak ada hard-delete master. Nonaktifkan untuk arsip; snapshot transaksi lama tidak berubah. Pilihan master memakai pencarian dan pagination server.</p></section>;
}
function SaleDetail({id,scope,unitId,onClose,onSaved}){
 const [revision,setRevision]=useState(0),state=usePosResource(`/pos/admin/transactions/${id}`,scope,revision),sale=state.data?.sale;
 const [form,setForm]=useState({terminal_id:'',shift_id:'',amount:'',reason:'',external_reference:''}),mutation=usePosMutation(()=>{setRevision(r=>r+1);onSaved();});
 const terminals=usePosResource('/pos/admin/management/terminals',{...scope,merchant_id:sale?.merchant_id,page_size:100}),shifts=usePosResource('/pos/admin/shifts',{...scope,merchant_id:sale?.merchant_id,cashier_id:getUser()?.id,status:'OPEN',page_size:100});
 const [validation,setValidation]=useState(''),set=(key,value)=>setForm({...form,[key]:value});
 async function action(operation){setValidation('');try{
  const body={...form,unit_id:unitId,merchant_id:sale.merchant_id};
  if(operation==='refund'){body.payment_id=sale.payment_id;body.amount=moneyInput(form.amount);if(sale.method!=='CASH')delete body.shift_id;}
  if(operation==='confirm-payment'){body.confirmed=true;body.reference=form.external_reference;}
  await mutation.mutate('post',operation==='refund'?'/pos/refunds':`/pos/sales/${id}/${operation}`,body);
 }catch(e){setValidation(e.message);}}
 return <section className="pos-panel"><div className="pos-toolbar"><h3>Detail transaksi</h3><button onClick={onClose} disabled={mutation.busy}>Tutup</button></div><Feedback {...state}/>{sale&&<><dl className="pos-detail">{Object.entries(sale).map(([key,v])=><div key={key}><dt>{key}</dt><dd>{v==null?'—':String(v)}</dd></div>)}</dl><h4>Snapshot item</h4><PosTable rows={state.data.items} columns={[col('sku','SKU'),col('name','Nama'),col('category_name','Kategori'),col('quantity','Qty'),col('unit_price','Harga',true),col('discount','Diskon',true),col('total','Total',true)]}/><h4>Riwayat koreksi</h4><PosTable rows={state.data.corrections} columns={[col('actor','Actor'),col('reason','Alasan'),col('amount','Nominal',true),col('status','Status'),readable('created_at','Waktu'),col('wallet_transaction_id','Ledger'),col('external_reference','Referensi')]}/>
  {unitId&&(hasPermission('pos.refund')||hasPermission('pos.sell'))&&<><p className="pos-note">Aksi tunduk assignment kasir/merchant/terminal Phase 1. CASH refund harus memakai shift OPEN milik actor. Void hanya DRAFT pada shift asal. Transfer/QRIS perlu konfirmasi bukti eksternal, bukan pembayaran otomatis.</p><div className="pos-form"><Choice label="Terminal berwenang" required value={form.terminal_id} onChange={v=>set('terminal_id',v)} options={(terminals.data?.rows||[]).filter(t=>t.enabled&&t.pos_enabled&&!t.attendance_mode)}/><Choice label="Shift OPEN actor" value={form.shift_id} onChange={v=>set('shift_id',v)} options={(shifts.data?.rows||[]).map(s=>({id:s.id,name:s.id}))}/><Text label="Nominal refund" value={form.amount} onChange={v=>set('amount',v)}/><Text label="Alasan" value={form.reason} onChange={v=>set('reason',v)}/><Text label="Referensi eksternal" value={form.external_reference} onChange={v=>set('external_reference',v)}/></div><div className="pos-toolbar">{sale.status==='PAID'&&hasPermission('pos.refund')&&<button disabled={mutation.busy||!form.reason||!form.terminal_id} onClick={()=>action('refund')}>Buat refund {sale.method==='TRANSFER_QRIS'?'pending':''}</button>}{sale.status==='DRAFT'&&hasPermission('pos.sell')&&<><button disabled={mutation.busy||!form.reason||!form.terminal_id} onClick={()=>action('void')}>Void draft</button><button disabled={mutation.busy||!form.external_reference||!form.terminal_id} onClick={()=>action('confirm-payment')}>Konfirmasi penerimaan eksternal</button></>}</div></>}
 </>}<Feedback {...mutation} error={mutation.error||validation}/></section>;
}
function RefundConfirm({row,unitId,onSaved}){
 const [show,setShow]=useState(false),[terminal,setTerminal]=useState(''),[reference,setReference]=useState(''),mutation=usePosMutation(onSaved);
 if(!unitId||!hasPermission('pos.refund'))return null;
 return <><button onClick={()=>setShow(!show)}>Konfirmasi return</button>{show&&<form onSubmit={e=>{e.preventDefault();mutation.mutate('post',`/pos/refunds/${row.id}/confirm`,{unit_id:unitId,merchant_id:row.merchant_id,terminal_id:terminal,reference,confirmed:true});}}><Text label="ID terminal berwenang" required value={terminal} onChange={setTerminal}/><Text label="Referensi dana dikembalikan" required value={reference} onChange={setReference}/><button disabled={mutation.busy}>Dana eksternal sudah dikembalikan</button><Feedback {...mutation}/></form>}</>;
}
