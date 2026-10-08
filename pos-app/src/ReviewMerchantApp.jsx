import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Badge, Card, Chip, Empty, Money, ReviewTools, Row, s } from "./ui";
const { createReviewAdapter } = require("./reviewFixtures.cjs");
const adapter = createReviewAdapter();

const ROLE_MODULES = Object.freeze({
  OWNER: ["BERANDA","KASIR","TRANSAKSI","SHIFT","PRODUK","STOK","CUSTOMER","SUPPLIER","PEMBELIAN","UTANG","PIUTANG","KEUANGAN","LAPORAN","TOKO ONLINE","PENGGUNA","PENGATURAN"],
  SUPERVISOR: ["BERANDA","KASIR","TRANSAKSI","SHIFT","PRODUK","STOK","CUSTOMER","SUPPLIER","PEMBELIAN","UTANG","PIUTANG","LAPORAN","TOKO ONLINE"],
  CASHIER: ["BERANDA","KASIR","TRANSAKSI","SHIFT"],
});
const money = value => `Rp${Number(value || 0).toLocaleString("id-ID")}`;
const demoRows = {
  products: [{name:"Beras Premium",sku:"DEMO-001",stock:42,price:68000},{name:"Air Mineral",sku:"DEMO-002",stock:8,price:5000}],
  parties: [{name:"Customer Demo",outstanding:75000},{name:"Supplier Demo",outstanding:125000}],
  permissions: ["Melakukan Penjualan","Melihat Transaksi","Buka/Tutup Shift","Melihat Produk","Retur Penjualan"],
};

function DemoModule({ module, data, role }) {
  if (module === "BERANDA") return <><View style={s.hero}><Text style={s.heroLabel}>OMZET HARI INI · SINTETIS</Text><Money value={money(245000)}/><Row label="Transaksi" value="12"/><Row label="Rata-rata" value={money(20416)}/></View><Card title="Perlu perhatian"><Row label="Stok menipis" value="2"/><Row label="Piutang" value={money(75000)}/><Row label="Pesanan online" value="3"/></Card></>;
  if (module === "KASIR") return <><Card title="Keranjang Demo"><Row label="2 × Beras Premium" value={money(136000)}/><Row label="1 × Air Mineral" value={money(5000)}/><Money label="Total" value={money(141000)}/><Badge label="WRITE DINONAKTIFKAN" tone="amber"/></Card><Card title="Produk">{(data?.catalog?.products||[]).slice(0,3).map(p=><Row key={p.id} label={p.name} value={money(p.price)}/>)}</Card></>;
  if (module === "TRANSAKSI") return <Card title="Riwayat Transaksi">{(data?.transactions?.rows||[]).map(row=><View key={row.id} style={s.cartItem}><Row label={row.receipt} value={money(row.grand_total)}/><Badge label={row.status}/></View>)}</Card>;
  if (module === "SHIFT") return <><Card title="Shift Demo"><Row label="Status" value={data?.summary?.shift?.status||"TUTUP"}/><Row label="Kas awal" value={money(100000)}/><Row label="Kas ekspektasi" value={money(215000)}/></Card></>;
  if (module === "PRODUK") return <><Card title="Produk & Kategori">{demoRows.products.map(p=><View key={p.sku} style={s.cartItem}><Row label={p.name} value={money(p.price)}/><Row label={p.sku} value={`Stok ${p.stock}`}/></View>)}</Card><Badge label="Tambah/Edit Produk · Demo"/></>;
  if (module === "STOK") return <><Card title="Inventory"><Row label="Beras Premium" value="42 tersedia"/><Row label="Air Mineral" value="8 · MENIPIS"/></Card><Card title="Pergerakan & Opname"><Row label="PURCHASE_IN" value="+20"/><Row label="SALE_OUT" value="-3"/><Row label="DAMAGE" value="-1"/></Card></>;
  if (module === "CUSTOMER") return <><Card title="Customer"><Row label={demoRows.parties[0].name} value={money(430000)}/><Row label="Rata-rata transaksi" value={money(86000)}/><Row label="Piutang" value={money(demoRows.parties[0].outstanding)}/></Card></>;
  if (module === "SUPPLIER") return <Card title="Supplier"><Row label={demoRows.parties[1].name} value="Aktif"/><Row label="Total pembelian" value={money(625000)}/><Row label="Utang" value={money(demoRows.parties[1].outstanding)}/></Card>;
  if (module === "PEMBELIAN") return <><Card title="Pembelian"><Row label="PO-DEMO-001" value={money(250000)}/><Row label="Dibayar" value={money(125000)}/><Badge label="PARTIAL" tone="amber"/></Card><Badge label="Retur Pembelian · Demo"/></>;
  if (module === "UTANG") return <Card title="Utang Supplier"><Money value={money(125000)}/><Row label="Jatuh tempo" value="14 Oktober 2026"/><Row label="Cicilan terakhir" value={money(50000)}/></Card>;
  if (module === "PIUTANG") return <Card title="Piutang Customer"><Money value={money(75000)}/><Row label="Jatuh tempo" value="12 Oktober 2026"/><Row label="Penagihan" value="Belum lunas"/></Card>;
  if (module === "KEUANGAN") return <><Card title="Kas & Rekening"><Row label="Kas Utama" value={money(875000)}/><Row label="Bank Demo" value={money(2500000)}/></Card><Card title="Mutasi"><Row label="Biaya operasional" value={money(25000)}/><Row label="Pendapatan lain" value={money(15000)}/><Row label="Modal / Prive" value="Terpisah"/></Card></>;
  if (module === "LAPORAN") return <><Card title="Laporan Bulan Ini"><Row label="Penjualan" value={money(4250000)}/><Row label="Laba kotor" value={role==="OWNER"?money(1375000):"Izin terbatas"}/><Row label="POS / Online" value="82% / 18%"/><Row label="Metode bayar" value="Tunai · QRIS · Dompet"/></Card></>;
  if (module === "TOKO ONLINE") return <><Card title="Toko Online"><Row label="Storefront" value="AKTIF"/><Row label="Pesanan masuk" value="3"/><Row label="Produk online" value="12"/></Card><Card title="Order DEMO-WEB-001"><Row label="Status" value="READY TO SHIP"/><Row label="Kurir" value="Manual"/><Row label="Resi" value="DEMO-RESI"/></Card></>;
  if (module === "PENGGUNA") return <><Card title="Pengguna & Akses"><Row label="Owner Demo" value="OWNER · Aktif"/><Row label="Supervisor Demo" value="SUPERVISOR · Aktif"/><Row label="Kasir Demo" value="CASHIER · Aktif"/></Card><Card title="Hak Akses Kasir">{demoRows.permissions.map((p,i)=><Text key={p} style={s.text}>{i<4?"☑":"☐"} {p}</Text>)}</Card><Badge label="Reset kredensial mencabut sesi"/></>;
  if (module === "PENGATURAN") return <><Card title="Profil Usaha"><Row label="Nama" value="Toko Demo KlikPesantren"/><Row label="Timezone" value="Asia/Jakarta"/><Row label="Struk" value="Powered by KlikPesantren"/></Card><Card title="Kas / Rekening"><Row label="Jenis tersedia" value="Kas · Bank · QRIS"/></Card></>;
  return <Empty title="Modul demo tidak tersedia"/>;
}

export default function ReviewMerchantApp() {
  const [state,setState]=useState("normal"),[data,setData]=useState(null),[busy,setBusy]=useState(true),[role,setRole]=useState("OWNER"),[module,setModule]=useState("BERANDA");
  const modules=useMemo(()=>ROLE_MODULES[role],[role]);
  async function refresh(next=state) {
    setBusy(true);adapter.setState(next);
    try {const [context,summary,catalog,transactions]=await Promise.all([adapter.api("/pos/mobile/context"),adapter.api("/pos/mobile/summary"),adapter.api("/pos/mobile/catalog"),adapter.api("/pos/mobile/transactions")]);setData({context,summary,catalog,transactions});}
    catch(error){setData({error:error.code||"REVIEW_ERROR"});}finally{setBusy(false);}
  }
  useEffect(()=>{let active=true;Promise.all([adapter.api("/pos/mobile/context"),adapter.api("/pos/mobile/summary"),adapter.api("/pos/mobile/catalog"),adapter.api("/pos/mobile/transactions")]).then(([context,summary,catalog,transactions])=>{if(active)setData({context,summary,catalog,transactions});}).catch(error=>{if(active)setData({error:error.code||"REVIEW_ERROR"});}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
  return <SafeAreaView style={s.root}>
    <ReviewTools states={adapter.states} busy={busy} onState={next=>{setState(next);refresh(next);}} onReset={()=>{setState("normal");refresh("normal");}}/>
    <ScrollView contentContainerStyle={s.content}>
      <Badge label="MODE DEMO / REVIEW" tone="amber"/>
      <Text style={s.brand}>POS KlikPesantren</Text><Text style={s.muted}>Seluruh data sintetis. Tanpa jaringan, login nyata, atau financial write.</Text>
      <Card title="Peran Demo"><ScrollView horizontal showsHorizontalScrollIndicator={false}>{Object.keys(ROLE_MODULES).map(item=><Chip key={item} label={item} active={role===item} onPress={()=>{setRole(item);setModule("BERANDA");}}/>)}</ScrollView></Card>
      <Card title="Navigasi"><ScrollView horizontal showsHorizontalScrollIndicator={false}>{modules.map(item=><Chip key={item} label={item} active={module===item} onPress={()=>setModule(item)}/>)}</ScrollView></Card>
      {busy?<Empty loading title="Memuat fixture"/>:data?.error?<Empty title="Contoh kondisi gagal" note={data.error} onRetry={()=>refresh("normal")}/>:<DemoModule module={module} data={data} role={role}/>}<Text style={s.muted}>State review: {state} · Semua tombol transaksi bersifat demonstrasi.</Text>
    </ScrollView>
  </SafeAreaView>;
}
