import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Card, Empty, ReviewTools, Row, s } from "./ui";
const { createReviewAdapter } = require("./reviewFixtures.cjs");
const adapter = createReviewAdapter();

export default function ReviewMerchantApp() {
  const [state,setState]=useState("normal"),[data,setData]=useState(null),[busy,setBusy]=useState(true);
  async function refresh(next=state) {
    setBusy(true);
    adapter.setState(next);
    try {
      const [context,summary,catalog,transactions]=await Promise.all([
        adapter.api("/pos/mobile/context"),adapter.api("/pos/mobile/summary"),
        adapter.api("/pos/mobile/catalog"),adapter.api("/pos/mobile/transactions"),
      ]);
      setData({context,summary,catalog,transactions});
    } catch (error) {
      setData({error:error.code||"REVIEW_ERROR"});
    } finally { setBusy(false); }
  }
  useEffect(()=>{
    let active=true;
    Promise.all([
      adapter.api("/pos/mobile/context"),adapter.api("/pos/mobile/summary"),
      adapter.api("/pos/mobile/catalog"),adapter.api("/pos/mobile/transactions"),
    ]).then(([context,summary,catalog,transactions])=>{if(active)setData({context,summary,catalog,transactions});})
      .catch(error=>{if(active)setData({error:error.code||"REVIEW_ERROR"});})
      .finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[]);
  return <SafeAreaView style={s.root}>
    <ReviewTools states={adapter.states} busy={busy} onState={next=>{setState(next);refresh(next);}} onReset={()=>{setState("normal");refresh("normal");}}/>
    <ScrollView contentContainerStyle={s.content}>
      <Text style={s.brand}>POS Review Sintetis</Text>
      <Text style={s.muted}>Development-only, read-only, tanpa jaringan atau data pelanggan.</Text>
      {busy?<Empty loading title="Memuat fixture"/>:data?.error?<Empty title="Contoh kondisi gagal" note={data.error}/>:<>
        <Card title="Usaha"><Row label="Nama" value={data?.context?.merchant?.name||data?.context?.merchant_name}/><Row label="Status shift" value={data?.summary?.shift?.status||"TUTUP"}/></Card>
        <Card title="Ringkasan"><Row label="Produk" value={data?.catalog?.products?.length||0}/><Row label="Transaksi" value={data?.transactions?.rows?.length||data?.transactions?.length||0}/></Card>
        <View><Text style={s.muted}>State: {state}</Text></View>
      </>}
    </ScrollView>
  </SafeAreaView>;
}
