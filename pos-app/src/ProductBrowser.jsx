import React,{useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,KeyboardAvoidingView,Modal,Platform,Pressable,ScrollView,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppText as Text} from './typography';
import {Button,Card,Field,Row,s,colors} from './ui';
const {createProductSearch,productSearchError}=require('./productSearch.cjs');
const {rupiah}=require('./domain.cjs');
export function FocusedEditor({visible,title,onClose,error,notice,children,backLabel='Kembali ke Daftar'}){
 const scroll=useRef(null),positions=useRef(new Map()),page=useRef(title);
 useEffect(()=>{page.current=title;if(visible)scroll.current?.scrollTo({y:positions.current.get(title)||0,animated:false});else positions.current.clear();},[visible,title]);
 return <Modal visible={!!visible} animationType="slide" onRequestClose={onClose} accessibilityViewIsModal><SafeAreaView style={s.root}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS==='ios'?'padding':'height'}><View style={[s.content,{paddingBottom:0}]}><Button title={backLabel} secondary onPress={onClose}/><Text accessibilityRole="header" style={s.sectionTitle}>{title}</Text></View><ScrollView ref={scroll} onScroll={event=>positions.current.set(page.current,event.nativeEvent.contentOffset.y)} scrollEventThrottle={100} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets contentContainerStyle={[s.content,{paddingBottom:40}]}>{!!error&&<Text style={s.error}>{error}</Text>}{!!notice&&<Text style={s.success}>{notice}</Text>}{children}</ScrollView></KeyboardAvoidingView></SafeAreaView></Modal>;
}
export function useProductRecord(request,id,fallback){const [record,setRecord]=useState(null);useEffect(()=>{let alive=true;if(id&&request)request('/products?paged=1&page_size=1&product_id='+encodeURIComponent(id)).then(r=>{if(alive)setRecord(r.items?.[0]||null);}).catch(()=>{});return()=>{alive=false;};},[request,id]);return record?.id===id?record:(fallback||[]).find(p=>p.id===id);}
export function ProductSearch({request,inventory=false,onSelect,revision,title='Cari Produk',filters=false,renderRow,onFiltersChange}){
 const [state,setState]=useState({items:[],history:[],busy:true}),[q,setQ]=useState(''),[category,setCategory]=useState('');
 const browser=useMemo(()=>createProductSearch({request,inventory,onChange:setState}),[request,inventory]);
 useEffect(()=>{browser.activate();return()=>browser.dispose();},[browser]);
 const lastRevision=useRef(revision);
 useEffect(()=>{if(lastRevision.current!==revision){lastRevision.current=revision;browser.load();}},[browser,revision]);
 const search=patch=>{const filters={q,category,status:browser.get().status,stock:browser.get().stock,...patch};onFiltersChange?.(filters);return browser.search(filters);};
 return <Card title={title}><Field label="Cari nama, SKU, atau barcode" placeholder="Ketik lalu tekan Cari" maxLength={160} value={q} onChangeText={setQ} onSubmitEditing={()=>search({})} returnKeyType="search"/>{filters&&<Field label="Kategori (nama persis; kosong untuk semua)" maxLength={120} value={category} onChangeText={setCategory} onSubmitEditing={()=>search({})}/>}<Button title="Cari" secondary onPress={()=>search({})}/>{filters&&<><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{[['ALL','Semua status'],['ACTIVE','Aktif'],['INACTIVE','Nonaktif']].map(([status,label])=><Button key={status} title={(state.status===status?'✓ ':'')+label} secondary onPress={()=>search({status})}/>)}</View><View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>{[['','Semua stok'],['AVAILABLE','Tersedia'],['LOW','Menipis'],['OUT','Habis']].map(([stock,label])=><Button key={label} title={(state.stock===stock?'✓ ':'')+label} secondary onPress={()=>search({stock})}/>)}</View></>}
 {state.busy&&<><ActivityIndicator color={colors.green}/><Text style={s.muted}>Mencari di seluruh katalog server…</Text></>}{state.error&&<><Text style={s.error}>{productSearchError(state.error)}</Text><Button title="Coba Muat Ulang" secondary onPress={()=>browser.load()}/></>}
 {!state.busy&&!state.error&&!state.items.length&&<Text style={s.muted}>Tidak ada produk yang cocok. Ubah pencarian atau filter.</Text>}
 {state.items.map(p=><Pressable key={p.id} accessibilityRole="button" accessibilityLabel={'Pilih '+p.name} disabled={state.busy} onPress={()=>onSelect(p)} style={{borderBottomWidth:1,borderColor:colors.line,paddingVertical:12}}>{renderRow?renderRow(p):<><Row label={p.name} value={rupiah(p.selling_price)}/><Text style={s.muted}>{p.sku} · {p.category||'Tanpa kategori'}</Text>{p.on_hand!=null&&<Text style={s.muted}>Stok {p.on_hand} · Tersedia {p.available??p.on_hand}</Text>}</>}</Pressable>)}
 <Text style={s.muted}>Halaman {(state.history?.length||0)+1} · {state.items.length} produk · pencarian seluruh katalog</Text><View style={s.actionRow}><Button title="Sebelumnya" secondary disabled={state.busy||!state.history?.length} onPress={()=>browser.previous()}/><Button title="Berikutnya" secondary disabled={state.busy||!state.next_cursor} onPress={()=>browser.next()}/></View></Card>;
}
