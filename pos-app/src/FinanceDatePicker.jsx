import React,{useState} from 'react';
import {Modal,Pressable,StyleSheet,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {AppText as Text} from './typography';
import {Button,Icon,colors,s} from './ui';
const {MONTHS,isoDate,calendarDays,displayPeriod,moveMonth}=require('./financePresentation.cjs');
export function FinanceDatePicker({label,value,onChange,kind='date',maxDate}){
 const [open,setOpen]=useState(false),[cursor,setCursor]=useState({year:2000,month:1}),[panel,setPanel]=useState('days');
 const selected=String(value||maxDate||'2000-01-01'),maxYear=Number((maxDate||'2199-12-31').slice(0,4));
 const launch=()=>{const [year,month=1]=selected.split('-').map(Number);setCursor({year,month});setPanel(kind==='year'?'years':kind==='month'?'months':'days');setOpen(true);};
 const choose=(y,m,d=1)=>{const v=kind==='year'?String(y):kind==='month'?isoDate(y,m,1).slice(0,7):isoDate(y,m,d);onChange(v);setOpen(false);};
 const shift=delta=>setCursor(c=>panel==='days'?moveMonth(c.year,c.month,delta):({...c,year:c.year+delta*(panel==='years'?12:1)}));
 const startYear=Math.floor(cursor.year/12)*12;
 return <View style={c.field}><Text style={s.label}>{label}</Text><Pressable accessibilityRole="button" accessibilityLabel={label} style={c.input} onPress={launch}><Icon name="calendar" size={18}/><Text style={[s.flex,c.value]}>{displayPeriod(value,kind)}</Text><Icon name="chevron-down" size={16}/></Pressable>
  <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
   <View style={c.overlay}><SafeAreaView style={c.calendar} edges={['bottom']}><Text style={s.sectionTitle}>{label}</Text>
    <View style={c.nav}><Pressable accessibilityRole="button" accessibilityLabel="Periode sebelumnya" style={c.arrow} onPress={()=>shift(-1)}><Icon name="chevron-left"/></Pressable>
     <Pressable accessibilityRole="button" accessibilityLabel={panel==='days'?'Pilih bulan':panel==='months'?'Pilih tahun':'Daftar tahun'} style={c.heading} onPress={()=>setPanel(panel==='days'?'months':'years')}><Text style={s.heading}>{panel==='days'?MONTHS[cursor.month-1]+' '+cursor.year:panel==='months'?cursor.year:startYear+'–'+(startYear+11)}</Text></Pressable>
     <Pressable accessibilityRole="button" accessibilityLabel="Periode berikutnya" style={c.arrow} onPress={()=>shift(1)}><Icon name="chevron-right"/></Pressable>
    </View>
    {panel==='days'?<><View style={c.week}>{['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(x=><Text key={x} style={c.weekday}>{x}</Text>)}</View><View style={c.days}>{calendarDays(cursor.year,cursor.month).map((date,i)=>{const disabled=!date||date<'1900-01-01'||date>maxDate,active=date===value;return <Pressable key={date||'blank-'+i} accessibilityRole={date?'button':undefined} accessibilityLabel={date?displayPeriod(date):undefined} disabled={disabled} style={[c.day,active&&c.active]} onPress={()=>choose(cursor.year,cursor.month,Number(date.slice(-2)))}>{date&&<Text style={[c.dayText,disabled&&c.disabled,active&&c.selected]}>{Number(date.slice(-2))}</Text>}</Pressable>;})}</View></>:
     panel==='months'?<View style={c.grid}>{MONTHS.map((name,i)=>{const disabled=isoDate(cursor.year,i+1,1).slice(0,7)>String(maxDate).slice(0,7);return <Pressable accessibilityRole="button" accessibilityLabel={name+' '+cursor.year} disabled={disabled} key={name} style={c.cell} onPress={()=>{if(kind==='month')choose(cursor.year,i+1);else{setCursor(v=>({...v,month:i+1}));setPanel('days');}}}><Text style={[s.heading,disabled&&c.disabled]}>{name}</Text></Pressable>;})}</View>:
     <View style={c.grid}>{Array.from({length:12},(_,i)=>startYear+i).map(year=><Pressable accessibilityRole="button" accessibilityLabel={'Tahun '+year} disabled={year>maxYear||year<1900} key={year} style={c.cell} onPress={()=>{if(kind==='year')choose(year,1);else{setCursor(v=>({...v,year}));setPanel('months');}}}><Text style={[s.heading,(year>maxYear||year<1900)&&c.disabled]}>{year}</Text></Pressable>)}</View>}
    <Button title="Batal" secondary onPress={()=>setOpen(false)}/>
   </SafeAreaView></View>
  </Modal>
 </View>;
}
const c=StyleSheet.create({field:{gap:6,flex:1},input:{minHeight:48,padding:12,gap:9,flexDirection:'row',alignItems:'center',borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:'#FFFFFF'},value:{color:colors.navy,fontSize:14},overlay:{flex:1,justifyContent:'center',padding:8,backgroundColor:'rgba(15,23,42,0.45)'},calendar:{backgroundColor:'#FFFFFF',borderRadius:20,padding:12,gap:10,width:'100%',maxWidth:420,alignSelf:'center'},nav:{flexDirection:'row',alignItems:'center'},arrow:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center'},heading:{flex:1,minHeight:48,alignItems:'center',justifyContent:'center'},week:{flexDirection:'row'},weekday:{width:'14.285714%',textAlign:'center',fontSize:11,color:colors.muted},days:{flexDirection:'row',flexWrap:'wrap'},day:{width:'14.285714%',height:44,alignItems:'center',justifyContent:'center',borderRadius:10},dayText:{fontSize:14,color:colors.navy},active:{backgroundColor:colors.green},selected:{color:'#FFFFFF'},disabled:{color:'#CBD5E1'},grid:{flexDirection:'row',flexWrap:'wrap'},cell:{width:'33.333333%',minHeight:50,alignItems:'center',justifyContent:'center'}});
