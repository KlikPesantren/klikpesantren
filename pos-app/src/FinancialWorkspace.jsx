import React,{memo,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {FlatList,Keyboard,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,StyleSheet,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import {AppText as Text} from './typography';
import {Badge,Button,Card,Empty,Field,Icon,Row,RupiahField,colors,s} from './ui';
import {FinanceDatePicker} from './FinanceDatePicker';
const {rupiah}=require('./domain.cjs');
const {businessToday,displayDate,rankingRows}=require('./financePresentation.cjs');
const money=value=>value==null?'Terbatas akses':rupiah(value);
const labels={OPENING:'Saldo awal',OPENING_ADJUSTMENT:'Koreksi saldo',SALE:'Penjualan',SALE_RETURN:'Refund',PURCHASE:'Pembelian stok',PURCHASE_RETURN:'Retur pembelian',EXPENSE:'Pengeluaran',OTHER_INCOME:'Pemasukan lain-lain',TRANSFER:'Transfer Saldo',AR_COLLECTION:'Pelunasan piutang',AP_PAYMENT:'Pembayaran supplier',CAPITAL:'Setoran modal',WITHDRAWAL:'Prive',WALLET_SETTLEMENT:'Settlement'};
export const FINANCIAL_MODULES=['KEUANGAN','PENGELUARAN','PEMASUKAN','ARUS KAS','LAPORAN','LAPORAN HARIAN','LAPORAN BULANAN','LAPORAN TAHUNAN','LAPORAN SALDO'];
const titles={KEUANGAN:'Kasbox',PENGELUARAN:'Pengeluaran',PEMASUKAN:'Pemasukan Lain-lain','ARUS KAS':'Arus Kas',LAPORAN:'Laporan Bulanan','LAPORAN HARIAN':'Laporan Harian','LAPORAN BULANAN':'Laporan Bulanan','LAPORAN TAHUNAN':'Laporan Tahunan','LAPORAN SALDO':'Laporan Kekayaan Usaha'};
const identity=context=>String(context.business.id||context.business_id)+':'+String(context.user_id||context.user_name)+':'+context.permissions.join('|');
const permitted=(context,key)=>context.permissions.includes(key);
const errorMessage=e=>({
 INVALID_PERIOD:'Periksa urutan tanggal yang dipilih.',INVALID_DUE_DATE:'Tanggal tidak valid.',FUTURE_PERIOD_UNAVAILABLE:'Periode di masa depan belum tersedia.',
 INSUFFICIENT_BUSINESS_FUNDS:'Saldo akun sumber tidak mencukupi.',HISTORICAL_INSUFFICIENT_FUNDS:'Tanggal ini membuat saldo historis negatif.',
 INVALID_ACCOUNTING_DATE:'Tanggal berada di luar periode pembukuan yang diizinkan.',ACTIVE_DRAWER_REQUIRES_CURRENT_DATE:'Laci sedang dipakai shift. Gunakan tanggal hari ini.',
 FINANCE_POST_RETRY:'Shift sedang berubah. Coba kembali.',MERCHANT_PERMISSION_DENIED:'Akun ini belum memiliki izin untuk tindakan tersebut.',
 MERCHANT_SESSION_INVALID:'Sesi berakhir. Silakan masuk ulang.',INVALID_INTEGER:'Masukkan nominal Rupiah utuh yang valid.',
 IDEMPOTENCY_CONFLICT:'Permintaan sebelumnya memiliki isi berbeda. Periksa Arus Kas sebelum membuat transaksi baru.',
MONEY_ALREADY_REVISED:'Transaksi sudah dibatalkan atau dikoreksi. Muat ulang Arus Kas.',DOMAIN_REVERSAL_REQUIRED:'Transaksi ini memerlukan alur retur atau pembayaran asal.',TRANSFER_CORRECTION_REQUIRES_CANCEL:'Batalkan transfer lalu buat transfer yang benar.',
})[e?.code]||(e?.status===401?'Sesi berakhir. Silakan masuk ulang.':e?.status===403?'Akun ini belum memiliki izin.':e?.status>=500?'Server mengalami gangguan. Coba kembali.':e?.status?'Permintaan ditolak ('+(e.code||e.status)+').':'Belum dapat terhubung. Periksa koneksi lalu coba lagi.');

function useFinanceRead(key,enabled,load){
 const fn=useRef(load),[attempt,setAttempt]=useState(0),[state,setState]=useState({key:'',loading:true,value:null,error:''});
 useEffect(()=>{fn.current=load;},[load]);
 useEffect(()=>{
  let alive=true;
  if(!enabled)return()=>{alive=false;};
  Promise.resolve().then(()=>{if(!alive)return;setState({key,loading:true,value:null,error:''});return fn.current();})
   .then(value=>{if(alive)setState({key,loading:false,value,error:''});})
   .catch(e=>{if(alive)setState({key,loading:false,value:null,error:errorMessage(e)});});
  return()=>{alive=false;};
 },[key,enabled,attempt]);
 return {value:state.key===key?state.value:null,loading:enabled&&(state.key!==key||state.loading),error:state.key===key?state.error:'',retry:()=>setAttempt(x=>x+1)};
}
function Header({mode}){return <Text style={s.sectionTitle}>{titles[mode]}</Text>;}
function Restricted(){return <Empty title="Akses terbatas" note="Hubungi Owner untuk pengaturan hak akses."/>;}
function LoadState({resource}){return resource.loading?<View accessibilityLabel="Memuat data keuangan" style={f.skeleton}><View style={f.skeletonLine}/><View style={f.skeletonLine}/></View>:resource.error?<Empty title={resource.error} onRetry={resource.retry}/>:null;}
function Amount({label,value,primary=false,emphasis=false}){
 return <View style={[f.metric,primary&&f.primary,emphasis&&f.emphasis]}>
  <Text style={[f.metricLabel,(primary||emphasis)&&f.light]}>{label}</Text>
  <Text style={[f.amount,(primary||emphasis)&&f.white,!primary&&!emphasis&&value!=null&&BigInt(value)<0n&&f.negative,{fontSize:primary||emphasis?(money(value).length>18?20:29):money(value).length>=18?12:money(value).length>=14?14:money(value).length>=11?16:20}]}>{money(value)}</Text>
 </View>;
}
function Sheet({title,onClose,children}){
 const insets=useSafeAreaInsets();
 return <Modal transparent animationType="slide" visible onRequestClose={onClose}><KeyboardAvoidingView style={s.sheetOverlay} behavior={Platform.OS==='ios'?'padding':'height'}>
  <View style={[s.sheet,{maxHeight:'94%',paddingBottom:Math.max(14,insets.bottom)}]}><View style={s.sheetHandle}/>
   <View style={s.row}><Text style={[s.sectionTitle,s.flex]}>{title}</Text><Pressable accessibilityRole="button" accessibilityLabel="Tutup" style={f.touch} onPress={onClose}><Icon name="x"/></Pressable></View>
   <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={f.sheetContent}>{children}</ScrollView>
  </View>
 </KeyboardAvoidingView></Modal>;
}
function AccountSelect({label,accounts,value,onChange}){
 const [open,setOpen]=useState(false),selected=accounts.find(a=>a.id===value);
 return <View style={f.field}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} style={f.select} onPress={()=>setOpen(true)}><Icon name={selected?.kind==='BANK'?'credit-card':'inbox'} size={18}/><View style={s.flex}><Text style={s.heading}>{selected?.name||'Pilih akun'}</Text>{selected&&<Text style={s.muted}>{selected.kind==='CASH'?'Kas Tunai':'Rekening Bank'}</Text>}</View><Icon name="chevron-down" size={16}/></Pressable>
  {open&&<Sheet title={label} onClose={()=>setOpen(false)}>{accounts.length?accounts.map(a=><Pressable key={a.id} accessibilityRole="button" accessibilityLabel={a.name} style={f.accountOption} onPress={()=>{onChange(a.id);setOpen(false);}}><Icon name={a.kind==='CASH'?'inbox':'credit-card'} size={18}/><View style={s.flex}><Text style={s.heading}>{a.name}</Text><Text style={s.muted}>{a.kind==='CASH'?'Kas Tunai':'Rekening Bank'}</Text></View>{a.id===value&&<Icon name="check"/>}</Pressable>):<Empty title="Belum ada akun kas/bank" note="Owner dapat menambahkan akun melalui Pengaturan Usaha."/>}</Sheet>}
 </View>;
}
// Keep an uncertain submission stable across navigation within the same merchant/user session.
const pendingSubmissions=new Map();
function MoneyForm({kind,context,request,submit,initialAccounts,onSuccess,journalVault}){
 const title=kind==='EXPENSE'?'Simpan Pengeluaran':kind==='OTHER_INCOME'?'Simpan Pemasukan':'Tinjau Transfer';
 const today=businessToday(context.business.timezone),scope=identity(context)+':'+kind;
 const blank=()=>({account_id:'',destination_account_id:'',amount:'',date:today,reason:'',fee:''});
 const saved=pendingSubmissions.get(scope);
 const [form,setForm]=useState(saved?.form||blank),[confirm,setConfirm]=useState(!!saved),[saving,setSaving]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(''),[uncertain,setUncertain]=useState(!!saved);
 const saveLock=useRef(false),requestId=useRef(saved?.requestId||Crypto.randomUUID()),alive=useRef(true),snapshot=useRef(saved?.body||null),post=useRef(submit);
 useEffect(()=>{post.current=submit;},[submit]);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const journalKey='finance.'+context.business.id+'.'+context.user_id+'.'+kind;
 const journal=useRef(null);
 const [journalReady,setJournalReady]=useState(false),[journalError,setJournalError]=useState(''),[bootAttempt,setBootAttempt]=useState(0);
 useEffect(()=>{let mounted=true;const activeJournal=journalVault?require('./saleJournal.cjs').createSaleJournal({vault:journalVault,key:journalKey,retainStatuses:[401,403,408,429],send:payload=>post.current('/money',payload,'')}):null;journal.current=activeJournal;Promise.resolve().then(async()=>{if(!mounted)return;setJournalReady(false);if(!activeJournal)throw Error('JOURNAL_UNAVAILABLE');const pending=await activeJournal.read();if(!mounted)return;if(pending){const payload=pending.payload;snapshot.current=payload;requestId.current=payload.request_id;setForm(payload);setUncertain(true);setConfirm(true);}setJournalReady(true);}).catch(()=>{if(mounted)setJournalError('Catatan transaksi tertunda belum dapat dibaca. Jangan membuat ulang sebelum statusnya dipastikan.');});return()=>{mounted=false;};},[journalVault,journalKey,bootAttempt]);
 const accountsRead=useFinanceRead(scope+':accounts',!initialAccounts,()=>request('/payment-accounts'));
 const accounts=(initialAccounts||accountsRead.value||[]).filter(a=>a.active!==false&&['CASH','BANK'].includes(a.kind));
 const valid=/^[1-9]\d*$/.test(form.amount)&&form.account_id&&form.reason.trim()&&form.reason.length<=500&&(kind!=='TRANSFER'||form.destination_account_id&&form.destination_account_id!==form.account_id&&/^(0|[1-9]\d*)$/.test(form.fee||'0'));
 const change=(name,value)=>{if(!saving&&!uncertain){setForm(x=>({...x,[name]:value}));setSuccess('');setError('');}};
 const review=()=>{Keyboard.dismiss();setConfirm(true);setError('');};
 const save=async()=>{
  if(saveLock.current)return;
  saveLock.current=true;setSaving(true);setError('');
  const body=snapshot.current||{...form,kind,reason:form.reason.trim(),...(kind==='TRANSFER'?{fee:form.fee||'0'}:{}),request_id:requestId.current};
  snapshot.current=body;pendingSubmissions.set(scope,{form:{...form},requestId:requestId.current,body});
  try{
   const pending=await journal.current.read();if(pending&&pending.payload.request_id!==body.request_id)throw Error('PENDING_FINANCE_REQUIRES_RETRY');
   const result=await journal.current.submit(pending?null:body,{business_id:context.business.id,user_id:context.user_id});
   if(!result)throw Error('NO_POST_RESULT');
   if(pendingSubmissions.get(scope)?.requestId===body.request_id)pendingSubmissions.delete(scope);snapshot.current=null;requestId.current=Crypto.randomUUID();
   if(alive.current){setUncertain(false);setConfirm(false);setForm(blank());setSuccess((kind==='EXPENSE'?'Pengeluaran':kind==='OTHER_INCOME'?'Pemasukan':'Transfer')+' '+rupiah(body.amount)+' berhasil disimpan.');onSuccess?.();}
  }catch(e){
   const ambiguous=!e.status||e.status>=500||[401,403,408,429].includes(e.status);
   if(!ambiguous){if(pendingSubmissions.get(scope)?.requestId===body.request_id)pendingSubmissions.delete(scope);snapshot.current=null;}
   if(alive.current){setUncertain(ambiguous);setError(ambiguous?'Hasil belum dapat dipastikan. Coba simpan kembali dengan nomor permintaan yang sama.':errorMessage(e));}
  }finally{saveLock.current=false;if(alive.current)setSaving(false);}
 };
 if(!journalReady)return <Empty loading={!journalError} title={journalError||'Memeriksa transaksi tertunda…'} onRetry={journalError?()=>{setJournalError('');setBootAttempt(x=>x+1);}:undefined}/>;
 if(!initialAccounts&&(accountsRead.loading||accountsRead.error))return <LoadState resource={accountsRead}/>;
 return <View style={f.form} testID="finance-money-form">
  {!!success&&<View style={f.success}><Text style={s.success}>{success}</Text><Text style={s.muted}>Mutasi tersedia di Arus Kas.</Text></View>}
  <View style={f.form} pointerEvents={uncertain||saving?'none':'auto'} accessibilityElementsHidden={uncertain||saving} importantForAccessibility={uncertain||saving?'no-hide-descendants':'auto'}><AccountSelect label={kind==='OTHER_INCOME'?'Akun Penerima':'Dari Akun'} accounts={accounts} value={form.account_id} onChange={v=>change('account_id',v)}/>
  {kind==='TRANSFER'&&<AccountSelect label="Ke Akun" accounts={accounts.filter(a=>a.id!==form.account_id)} value={form.destination_account_id} onChange={v=>change('destination_account_id',v)}/>}
  <RupiahField label="Nominal" value={form.amount} onChangeText={v=>change('amount',v)}/>
  <FinanceDatePicker label="Tanggal" value={form.date} maxDate={today} onChange={v=>change('date',v)}/>
  <Field label="Keterangan" value={form.reason} maxLength={500} placeholder={kind==='EXPENSE'?'Contoh: bayar listrik':kind==='OTHER_INCOME'?'Contoh: hasil penjualan kardus bekas':'Contoh: tambahan uang laci kas'} onChangeText={v=>change('reason',v)}/>
  {kind==='TRANSFER'&&permitted(context,'EXPENSE_CREATE')&&<RupiahField label="Biaya admin (opsional)" value={form.fee} onChangeText={v=>change('fee',v)}/>}
  </View><Button title={title} disabled={!valid||saving||uncertain} disabledHint={uncertain?'Permintaan sebelumnya belum pasti. Gunakan Periksa Permintaan Tertunda.':!accounts.length?'Tambahkan akun kas/bank melalui Pengaturan Usaha.':undefined} onPress={review}/>
  {uncertain&&!confirm&&<Button title="Periksa Permintaan Tertunda" secondary onPress={()=>setConfirm(true)}/>}
  {confirm&&<Sheet title={kind==='TRANSFER'?'Konfirmasi Transfer Saldo':'Konfirmasi '+(kind==='EXPENSE'?'Pengeluaran':'Pemasukan')} onClose={()=>{if(!saving)setConfirm(false);}}>
   <Row label={kind==='OTHER_INCOME'?'Akun penerima':'Dari akun'} value={accounts.find(a=>a.id===form.account_id)?.name}/>
   {kind==='TRANSFER'&&<Row label="Ke akun" value={accounts.find(a=>a.id===form.destination_account_id)?.name}/>}
   <Row label="Nominal" value={rupiah(form.amount)}/><Row label="Tanggal" value={displayDate(form.date)}/><Row label="Keterangan" value={form.reason}/>
   {kind==='TRANSFER'&&BigInt(form.fee||0)>0n&&<Row label="Biaya admin" value={rupiah(form.fee)}/>}
   {!!error&&<Text style={s.error}>{error}</Text>}
   <Button title={saving?'Menyimpan…':uncertain?'Coba Simpan Kembali':'Konfirmasi & Simpan'} disabled={saving} onPress={save}/>
   <Button title="Periksa kembali" secondary disabled={saving||uncertain} onPress={()=>setConfirm(false)}/>
  </Sheet>}
 </View>;
}
function Kasbox({context,request,submit,journalVault}){
 const allowed=permitted(context,'FINANCE_ACCOUNT_VIEW'),resource=useFinanceRead(identity(context)+':books',allowed,()=>request('/books'));
 const [transfer,setTransfer]=useState(false),[notice,setNotice]=useState('');
 return <ScrollView contentContainerStyle={f.list}><Header mode="KEUANGAN"/>{!!notice&&<Text style={s.success}>{notice}</Text>}{!allowed?<Restricted/>:<><LoadState resource={resource}/>{resource.value&&<>
  <View style={f.metrics}><Amount label="Kas Tunai" value={resource.value.cash}/><Amount label="Rekening Bank" value={resource.value.bank}/></View>
  <Amount label="Total Uang Usaha Tersedia" value={resource.value.available_money} primary/>
 </>}</>}
 {permitted(context,'TRANSFER_CREATE')&&<Button title="Transfer Saldo" icon="repeat" onPress={()=>{setNotice('');setTransfer(true);}}/>}
 {transfer&&<Sheet title="Transfer Saldo" onClose={()=>setTransfer(false)}><MoneyForm journalVault={journalVault} kind="TRANSFER" context={context} request={request} submit={submit} initialAccounts={resource.value?.accounts} onSuccess={()=>{setTransfer(false);setNotice('Transfer berhasil disimpan.');resource.retry();}}/></Sheet>}
 </ScrollView>;
}
function EntryPage({mode,context,request,submit,journalVault}){
 const kind=mode==='PENGELUARAN'?'EXPENSE':'OTHER_INCOME',allowed=permitted(context,kind==='EXPENSE'?'EXPENSE_CREATE':'OTHER_INCOME_CREATE'),insets=useSafeAreaInsets();
 return <KeyboardAvoidingView style={s.flex} behavior={Platform.OS==='ios'?'padding':'height'}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={[f.list,{paddingBottom:24+insets.bottom}]}><Header mode={mode}/>{allowed?<MoneyForm journalVault={journalVault} kind={kind} context={context} request={request} submit={submit}/>:<Restricted/>}</ScrollView></KeyboardAvoidingView>;
}
const Movement=memo(function Movement({item,timezone,onOpen}){
 const transfer=item.flow_kind==='TRANSFER'||item.kind==='TRANSFER',incoming=BigInt(item.amount)>0n,amount=transfer?item.transfer_amount:incoming?item.amount:String(-BigInt(item.amount));
 const accounts=transfer?item.from_account+' → '+item.to_account:(item.legs?.[0]?.account_name||item.account_name);
 return <Pressable accessibilityRole="button" accessibilityLabel={'Detail '+(labels[item.kind]||item.kind)} style={f.movement} onPress={()=>onOpen(item)}>
  <View style={[f.flowIcon,{backgroundColor:transfer?'#E8F0FA':incoming?'#E8F5EC':'#FEF2F2'}]}><Icon name={transfer?'repeat':incoming?'arrow-down-left':'arrow-up-right'} color={transfer?colors.navy:incoming?colors.green:colors.red} size={18}/></View>
  <View style={s.flex}><Text style={s.heading}>{item.kind==='MONEY_REVERSAL'?'Pembatalan '+(labels[item.flow_kind]||'Transaksi'):labels[item.kind]||item.kind}</Text>{!!item.reversal_id&&<Text style={s.error}>{item.correction_id?'Dikoreksi':'Dibatalkan'}</Text>}<Text style={s.muted}>{item.reason||item.reference||'Tercatat'}</Text><Text style={s.muted}>{accounts}</Text><Text style={f.timestamp}>{displayDate(item.date)} · {new Intl.DateTimeFormat('id-ID',{timeZone:timezone,hour:'2-digit',minute:'2-digit'}).format(new Date(item.occurred_at))}</Text></View>
  <Text style={[f.rowAmount,{color:transfer?colors.navy:incoming?colors.green:colors.red}]}>{transfer?'':incoming?'+':'−'}{money(amount)}</Text>
 </Pressable>;
});
function FinanceRevisionForm({mode,document,context,request,submit,onClose,onSuccess}){
 const d=document.finance_document,correct=mode==='CORRECT',accountsRead=useFinanceRead(identity(context)+':revise-accounts',correct,()=>request('/payment-accounts'));
 const [reason,setReason]=useState(''),[amount,setAmount]=useState(String(d.total)),[account,setAccount]=useState(d.legs[0]?.account_id||''),[description,setDescription]=useState(d.reason||''),[refundFee,setRefundFee]=useState(false),[review,setReview]=useState(false),[saving,setSaving]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
 const id=useRef(Crypto.randomUUID()),body=useRef(null),lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const valid=reason.trim()&&(!correct||/^[1-9]\d*$/.test(amount)&&account&&description.trim());
 const save=async()=>{if(lock.current)return;lock.current=true;setSaving(true);setError('');
  body.current=body.current||{request_id:id.current,action:mode,reason:reason.trim(),reverse_fee:refundFee,...(correct?{replacement:{account_id:account,amount,reason:description.trim()}}:{})};
  try{const result=await submit('/money/'+d.id+'/revise',body.current,'');if(!result)throw Error('NO_RESULT');if(alive.current)onSuccess();}
  catch(e){if(alive.current){setUncertain(!e.status||e.status>=500||e.status===408);setError(errorMessage(e));if(e.status&&e.status<500&&e.status!==408)body.current=null;}}
  finally{lock.current=false;if(alive.current)setSaving(false);}
 };
 return <Sheet title={correct?'Koreksi Transaksi':'Batalkan Transaksi'} onClose={()=>{if(!saving&&!uncertain)onClose();}}>
  <Row label="Transaksi asal" value={labels[d.kind]||d.kind}/><Row label="Nominal asal" value={money(d.total)}/>
  {review?<><Row label="Alasan" value={reason}/>{correct&&<><Row label="Nominal pengganti" value={money(amount)}/><Row label="Akun pengganti" value={accountsRead.value?.find(a=>a.id===account)?.name}/><Row label="Keterangan" value={description}/></>}<Text style={s.muted}>{refundFee?'Biaya yang telah dikembalikan ikut dibalik pembukuannya.':'Biaya transfer yang tidak dikembalikan tetap tercatat.'}</Text><Text style={s.muted}>Pembukuan ini tidak otomatis mengembalikan uang melalui bank/QRIS.</Text>{!!error&&<Text style={s.error}>{error}</Text>}<Button title={saving?'Menyimpan…':uncertain?'Coba Kembali':'Konfirmasi '+(correct?'Koreksi':'Pembatalan')} disabled={saving} onPress={save}/><Button title="Periksa kembali" secondary disabled={saving||uncertain} onPress={()=>setReview(false)}/></>:
   <><Field label="Alasan koreksi/pembatalan" value={reason} maxLength={500} onChangeText={setReason}/>{correct&&<><LoadState resource={accountsRead}/>{accountsRead.value&&<AccountSelect label="Akun pengganti" accounts={accountsRead.value.filter(a=>['CASH','BANK'].includes(a.kind))} value={account} onChange={setAccount}/>}<RupiahField label="Nominal pengganti" value={amount} onChangeText={setAmount}/><Field label="Keterangan pengganti" value={description} maxLength={500} onChangeText={setDescription}/></>}
   {!!d.fees?.length&&<Button title={refundFee?'✓ Biaya admin telah dikembalikan':'Biaya admin tetap tercatat'} secondary onPress={()=>setRefundFee(x=>!x)}/>}
   <Button title={correct?'Tinjau Koreksi':'Tinjau Pembatalan'} disabled={!valid||correct&&!accountsRead.value} onPress={()=>{Keyboard.dismiss();setReview(true);}}/>
  </>}
 </Sheet>;
}

function CashFlow({context,request,submit,shareReceiptFile}){
 const today=businessToday(context.business.timezone),[from,setFrom]=useState(today.slice(0,7)+'-01'),[to,setTo]=useState(today),[query,setQuery]=useState({from:today.slice(0,7)+'-01',to:today,view:'events'}),[revision,setRevision]=useState(0);
 const key=identity(context)+':flow:'+JSON.stringify(query)+':'+revision,resource=useFinanceRead(key,permitted(context,'FINANCE_TRANSACTION_VIEW'),()=>request('/cash-book?'+new URLSearchParams(query)));
 const [extra,setExtra]=useState({key:'',rows:[],cursor:null}),[pageState,setPageState]=useState({key:'',busy:false,error:''}),[detail,setDetail]=useState(null),generation=useRef(key),lock=useRef(false);
 useEffect(()=>{generation.current=key;return()=>{generation.current=null;};},[key]);
 const busy=pageState.key===key&&pageState.busy,pageError=pageState.key===key?pageState.error:'';
 const base=resource.value,appended=extra.key===key?extra:null,rows=base?[...base.rows,...(appended?.rows||[])]:[],cursor=appended?appended.cursor:base?.next_cursor;
 const more=async()=>{if(lock.current||!cursor)return;lock.current=true;setPageState({key,busy:true,error:''});const expected=key;try{const page=await request('/cash-book?'+new URLSearchParams({...query,cursor}));if(generation.current===expected)setExtra(old=>({key:expected,rows:[...(old.key===expected?old.rows:[]),...page.rows],cursor:page.next_cursor}));}catch(e){if(generation.current===expected)setPageState({key:expected,busy:false,error:errorMessage(e)});}finally{lock.current=false;if(generation.current===expected)setPageState(old=>({...old,busy:false}));}};
 const [document,setDocument]=useState(null),[documentError,setDocumentError]=useState(''),[revise,setRevise]=useState(null),[notice,setNotice]=useState(''),[printing,setPrinting]=useState(false),documentSequence=useRef(0);
 useEffect(()=>()=>{documentSequence.current++;},[]);
 const openDetail=useCallback(row=>{const sequence=++documentSequence.current;setDetail(row);setDocument(null);setDocumentError('');request('/money/'+row.source_id+'/document').then(value=>{if(documentSequence.current===sequence)setDocument(value);}).catch(e=>{if(documentSequence.current===sequence)setDocumentError(errorMessage(e));});},[request]);
 const output=async action=>{if(printing)return;setPrinting(true);setDocumentError('');const expected=documentSequence.current;try{const fresh=await request('/money/'+detail.source_id+'/document');if(expected!==documentSequence.current)return;setDocument(fresh);const value=fresh.sale_id?await request('/sales/'+fresh.sale_id):fresh;if(expected!==documentSequence.current)return;await shareReceiptFile(value,action);}catch(e){if(expected===documentSequence.current)setDocumentError(require('./receiptFile.cjs').receiptActionError(e));}finally{setPrinting(false);}};
 const render=useCallback(({item})=><Movement item={item} timezone={context.business.timezone} onOpen={openDetail}/>,[context.business.timezone,openDetail]);
 const header=<View style={f.header}><Header mode="ARUS KAS"/>{!!notice&&<Text style={s.success}>{notice}</Text>}{!permitted(context,'FINANCE_TRANSACTION_VIEW')?<Restricted/>:<>
  <View style={f.columns}><FinanceDatePicker label="Tanggal awal" value={from} maxDate={today} onChange={setFrom}/><FinanceDatePicker label="Tanggal akhir" value={to} maxDate={today} onChange={setTo}/></View>
  <Button title="Tampilkan" secondary onPress={()=>{setExtra({key:'',rows:[],cursor:null});setQuery({from,to,view:'events'});setRevision(v=>v+1);}}/>
  <LoadState resource={{...resource,retry:()=>setRevision(v=>v+1)}}/>{base&&<><View style={f.metrics}><Amount label="Saldo awal periode" value={base.summary.opening_balance}/><Amount label="Uang masuk eksternal" value={base.summary.money_in}/><Amount label="Uang keluar eksternal" value={base.summary.money_out}/><Amount label="Saldo akhir periode" value={base.summary.ending_balance}/></View><Text style={s.muted}>Transfer internal tidak termasuk total masuk/keluar eksternal.</Text><Text style={s.heading}>Riwayat · {base.total_events} kejadian</Text></>}
 </>}</View>;
 return <View style={s.flex}><FlatList testID="finance-list" data={rows} keyExtractor={x=>x.id} renderItem={render} ListHeaderComponent={header} contentContainerStyle={f.list} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7} onEndReachedThreshold={0.3} onEndReached={()=>{if(!resource.loading)more();}} ListEmptyComponent={base&&!resource.loading?<Empty title="Belum ada mutasi pada periode ini."/>:null} ListFooterComponent={<View style={f.header}>{!!pageError&&<Text style={s.error}>{pageError}</Text>}{cursor&&<Button title={busy?'Memuat…':'Muat berikutnya'} disabled={busy} secondary onPress={more}/>}</View>}/>
 {detail&&!revise&&<Sheet title="Detail Arus Kas" onClose={()=>setDetail(null)}><Badge label={labels[detail.kind]||detail.kind}/><Row label="Tanggal" value={displayDate(detail.date)}/><Row label="Dicatat" value={new Date(detail.occurred_at).toLocaleString('id-ID',{timeZone:context.business.timezone})}/><Row label="Keterangan" value={detail.reason||'—'}/><Row label="Status" value={document?.finance_document?({POSTED:"Tercatat",CANCELLED:"Dibatalkan",CORRECTED:"Dikoreksi"}[document.finance_document.status]):document?.sale_id?"Tercatat":"Memuat…"}/><Row label="Referensi" value={detail.reference||detail.source_id}/>{(detail.flow_kind==='TRANSFER'||detail.kind==='TRANSFER')&&<><Row label="Dari" value={detail.from_account}/><Row label="Ke" value={detail.to_account}/><Row label="Nominal transfer" value={money(detail.transfer_amount)}/></>}
  {(detail.legs||[]).map(leg=><Card key={leg.id} title={leg.account_name}><Row label={BigInt(leg.amount)>0n?'Masuk':'Keluar'} value={money(BigInt(leg.amount)>0n?leg.amount:String(-BigInt(leg.amount)))}/><Row label="Saldo akun setelah mutasi" value={money(leg.running_balance)}/></Card>)}
  {!!documentError&&<Text style={s.error}>{documentError}</Text>}{document&&<><Button title="Cetak Ulang" disabled={printing} secondary onPress={()=>output("print")}/><Button title="Simpan PDF" disabled={printing} secondary onPress={()=>output("save")}/><Button title="Bagikan" disabled={printing} secondary onPress={()=>output("share")}/>{document.finance_document?.can_correct&&<Button title="Koreksi Transaksi" onPress={()=>setRevise("CORRECT")}/>}<Button title="Batalkan Transaksi" danger disabled={!document.finance_document?.can_cancel} disabledHint={document.finance_document?.status==="CANCELLED"||document.finance_document?.status==="CORRECTED"?"Transaksi telah dibatalkan/dikoreksi.":"Gunakan alur retur/pembayaran asal. Saldo tidak dapat dibalik secara generik."} onPress={()=>setRevise("CANCEL")}/></>}
  <Button title="Tutup Detail" secondary onPress={()=>{documentSequence.current++;setDetail(null);}}/>
 </Sheet>}
 {revise&&document&&<FinanceRevisionForm mode={revise} document={document} context={context} request={request} submit={submit} onClose={()=>setRevise(null)} onSuccess={()=>{documentSequence.current++;setRevise(null);setDetail(null);setDocument(null);setExtra({key:"",rows:[],cursor:null});setRevision(v=>v+1);setNotice("Koreksi/pembatalan berhasil dicatat. Catatan asli tetap tersimpan.");}}/>}
 </View>;
}
function Wealth({position}){
 if(!position)return <Empty title="Laporan kekayaan belum tersedia untuk hak akses ini."/>;
 return <View style={f.header}><View style={f.metrics}>
  <Amount label="Persediaan FIFO/HPP" value={position.inventory_value}/><Amount label="Piutang Pelanggan" value={position.receivables}/><Amount label="Kas Tunai" value={position.cash}/><Amount label="Rekening Bank" value={position.bank}/>
  {position.qris_pending!=null&&BigInt(position.qris_pending)!==0n&&<Amount label="QRIS Pending" value={position.qris_pending}/>}
  {position.settlement?.outstanding!=null&&BigInt(position.settlement.outstanding)!==0n&&<Amount label="Settlement Pending" value={position.settlement.outstanding}/>}
 </View><Amount label="Total Aset Terpantau" value={position.assets} primary/><View style={f.metrics}><Amount label="Utang Supplier" value={position.payables}/>{position.settlement?.recovery!=null&&BigInt(position.settlement.recovery)!==0n&&<Amount label="Kewajiban Terpantau Lainnya" value={position.settlement.recovery}/>}</View><Amount label="Aset Bersih Terpantau" value={position.equity_derived} emphasis/><Text style={s.muted}>Posisi dari catatan usaha; belum mencakup seluruh aset dan kewajiban.</Text></View>;
}
function Reports({mode,context,request}){
 const today=businessToday(context.business.timezone),kind=mode==='LAPORAN HARIAN'||mode==='LAPORAN SALDO'?'date':mode==='LAPORAN TAHUNAN'?'year':'month';
 const initial=kind==='date'?today:kind==='month'?today.slice(0,7):today.slice(0,4),[period,setPeriod]=useState(initial),[query,setQuery]=useState({[kind]:initial});
 const allowed=mode==='LAPORAN SALDO'?permitted(context,'REPORT_FINANCE'):['REPORT_SALES','REPORT_PROFIT','REPORT_FINANCE','REPORT_INVENTORY','REPORT_CUSTOMER'].some(p=>permitted(context,p));
 const resource=useFinanceRead(identity(context)+':'+mode+':'+JSON.stringify(query),allowed,()=>request('/reports?'+new URLSearchParams(query)));
 const report=resource.value,wealth=mode==='LAPORAN SALDO',rows=useMemo(()=>wealth?[]:rankingRows(report),[wealth,report]),k=report?.kpi||{};
 const header=<View style={f.header}><Header mode={mode}/>{!allowed?<Restricted/>:<><FinanceDatePicker label={wealth?'Tanggal posisi':kind==='date'?'Tanggal laporan':kind==='month'?'Bulan laporan':'Tahun laporan'} kind={kind} value={period} maxDate={today} onChange={v=>{setPeriod(v);setQuery({[kind]:v});}}/><LoadState resource={resource}/>
  {report&&<><Text testID="report-period" style={s.muted}>{displayDate(report.from)}{report.from!==report.to?' – '+displayDate(report.to):''}</Text>{wealth?<Wealth position={report.financial_position}/>:<>
   <View style={f.metrics}>{[['Omzet Penjualan Bersih','net_sales'],['Laba Kotor','gross_profit'],['Pengeluaran Operasional','expenses'],['Hasil Usaha Operasional','operating_result'],['Omzet Bruto','gross_before_discount'],['Diskon','discounts'],['Retur','returns'],['HPP FIFO','cogs'],['Pendapatan Lain-lain','other_income'],['Kerugian Stok','stock_loss']].filter(([,key])=>k[key]!=null).map(([label,key])=><Amount key={key} label={label} value={k[key]}/>)}</View>
  </>}</>}
 </>}</View>;
 const render=useCallback(({item})=>item.type==='section'?<Text style={f.section}>{item.title}</Text>:item.type==='empty'?<Text style={f.empty}>{item.title}</Text>:<View style={f.ranking}><View style={f.rank}><Text style={s.heading}>{item.rank}</Text></View><View style={s.flex}><Text style={s.heading}>{item.name||'Nama dibatasi izin'}</Text><Text style={s.muted}>{item.type==='product'?item.net_quantity+' '+(item.uom||'unit (satuan historis belum tercatat)'):item.transaction_count+' transaksi'}</Text></View>{(item.type==='product'?item.net_revenue:item.net_spend)!=null&&<Text style={f.rowAmount}>{money(item.type==='product'?item.net_revenue:item.net_spend)}</Text>}</View>,[]);
 return <FlatList testID="finance-list" data={rows} keyExtractor={x=>x.id} renderItem={render} ListHeaderComponent={header} contentContainerStyle={f.list} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={7}/>;
}
export function FinancialWorkspace(props){
 if(props.module==='KEUANGAN')return <Kasbox {...props}/>;
 if(props.module==='PENGELUARAN'||props.module==='PEMASUKAN')return <EntryPage {...props} mode={props.module}/>;
 if(props.module==='ARUS KAS')return <CashFlow {...props}/>;
 return <Reports {...props} mode={props.module}/>;
}
const f=StyleSheet.create({
 list:{padding:12,gap:12,paddingBottom:28},header:{gap:12},form:{gap:14},field:{gap:6},columns:{flexDirection:'row',gap:8},metrics:{flexDirection:'row',flexWrap:'wrap',gap:8},
 metric:{flexGrow:1,flexBasis:'46%',minWidth:138,borderRadius:16,padding:14,gap:8,backgroundColor:'#FFFFFF',borderColor:colors.line,borderWidth:1},
 metricLabel:{fontSize:12,color:colors.muted},amount:{fontSize:20,fontWeight:'700',color:colors.navy,flexShrink:1,maxWidth:'100%'},primary:{flexBasis:'auto',backgroundColor:colors.greenDark,borderColor:colors.greenDark,padding:18},emphasis:{flexBasis:'auto',backgroundColor:'#153E63',borderColor:'#153E63',padding:18},light:{color:'#DDF5EC'},white:{color:'#FFFFFF',fontSize:29},negative:{color:colors.red},
 select:{minHeight:56,padding:12,borderWidth:1,borderColor:colors.line,borderRadius:12,flexDirection:'row',gap:10,alignItems:'center',backgroundColor:'#FFFFFF'},accountOption:{minHeight:58,padding:10,borderBottomWidth:1,borderColor:colors.line,flexDirection:'row',alignItems:'center',gap:10},touch:{minHeight:48,minWidth:48,alignItems:'center',justifyContent:'center'},sheetContent:{gap:12,paddingBottom:16},
 success:{padding:12,gap:6,backgroundColor:'#E8F5EC',borderRadius:12},movement:{minHeight:92,flexDirection:'row',alignItems:'center',gap:8,padding:12,backgroundColor:'#FFFFFF',borderRadius:14,borderWidth:1,borderColor:colors.line},flowIcon:{width:30,height:30,borderRadius:9,alignItems:'center',justifyContent:'center'},rowAmount:{maxWidth:'42%',fontSize:13,fontWeight:'700',color:colors.navy},timestamp:{fontSize:10,color:colors.muted,marginTop:4},ranking:{minHeight:72,flexDirection:'row',alignItems:'center',gap:9,padding:12,borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:'#FFFFFF'},rank:{width:30,height:30,borderRadius:10,backgroundColor:colors.soft,alignItems:'center',justifyContent:'center'},section:{fontSize:16,fontWeight:'700',color:colors.navy,marginTop:10},empty:{padding:14,color:colors.muted,fontSize:13},skeleton:{gap:10,padding:16,borderRadius:14,backgroundColor:'#FFFFFF'},skeletonLine:{height:22,borderRadius:6,backgroundColor:'#E2E8F0'}
});
