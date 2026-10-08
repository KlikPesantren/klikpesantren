import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { makeApi } from "./api";
import { Badge, Button, Card, Chip, Empty, Field, Icon, Money, Row, colors, s } from "./ui";
const { createVault } = require("./vault.cjs");
const { GROUPS, DEFAULTS, navigationItems, can } = require("./merchantAccess.cjs");
const { rupiah } = require("./domain.cjs");

const validMoney = value => /^(0|[1-9]\d*)$/.test(String(value ?? ""));
const moneyValue = value => validMoney(value) ? BigInt(String(value)) : 0n;

const devWebItems = new Map();
const devWebStore = {
  getItemAsync: async key => devWebItems.get(key) ?? null,
  setItemAsync: async (key, value) => { devWebItems.set(key, value); },
  deleteItemAsync: async key => { devWebItems.delete(key); },
};
const vaultStore = Platform.OS === "web" && Constants.expoConfig.extra.posEnvironment === "development" ? devWebStore : SecureStore;
const vault = createVault(vaultStore);
const LOADERS = {
  BERANDA: [["workspace", "/workspace"]],
  KASIR: [["workspace", "/workspace"], ["products", "/products", "PRODUCT_VIEW"], ["drawers", "/cash-drawers", "SHIFT_OPEN"], ["accounts", "/payment-accounts", "SALE_CREATE"], ["customers", "/parties?kind=CUSTOMER", "CUSTOMER_VIEW"]],
  TRANSAKSI: [["sales", "/sales", "SALE_VIEW"], ["products", "/products", "PRODUCT_VIEW"]],
  SHIFT: [["workspace", "/workspace"], ["shifts", "/shifts", "SHIFT_VIEW_HISTORY"], ["drawers", "/cash-drawers", "SHIFT_OPEN"], ["terminals", "/terminals", "SHIFT_OPEN"]],
  PRODUK: [["products", "/products", "PRODUCT_VIEW"]],
  STOK: [["inventory", "/inventory", "INVENTORY_VIEW"]],
  CUSTOMER: [["customers", "/parties?kind=CUSTOMER", "CUSTOMER_VIEW"], ["metrics", "/customers/metrics", "REPORT_CUSTOMER"]],
  SUPPLIER: [["suppliers", "/parties?kind=SUPPLIER", "SUPPLIER_VIEW"], ["purchases", "/purchases", "PURCHASE_VIEW"]],
  PEMBELIAN: [["purchases", "/purchases", "PURCHASE_VIEW"], ["inventory", "/inventory", "INVENTORY_VIEW"], ["suppliers", "/parties?kind=SUPPLIER", "SUPPLIER_VIEW"], ["accounts", "/payment-accounts", "PURCHASE_CREATE"]],
  PIUTANG: [["aging", "/debts/aging?kind=AR", "AR_VIEW"], ["accounts", "/payment-accounts", "AR_COLLECT"]],
  UTANG: [["aging", "/debts/aging?kind=AP", "AP_VIEW"], ["accounts", "/payment-accounts", "AP_PAY"]],
  KEUANGAN: [["books", "/books", "FINANCE_ACCOUNT_VIEW"], ["activity", "/activity", "FINANCE_TRANSACTION_VIEW"], ["accounts", "/payment-accounts", ["EXPENSE_CREATE","OTHER_INCOME_CREATE","TRANSFER_CREATE","CAPITAL_MANAGE","PRIVE_MANAGE"]]],
  LAPORAN: [["report", "/reports?period=MONTH", ["REPORT_SALES","REPORT_PROFIT","REPORT_FINANCE"]], ["inventory", "/inventory", "REPORT_INVENTORY"], ["customers", "/customers/metrics", "REPORT_CUSTOMER"], ["online", "/online-report", "REPORT_ONLINE"]],
  "TOKO ONLINE": [["orders", "/orders", "ONLINE_STORE_VIEW"], ["store", "/store", "ONLINE_STORE_VIEW"], ["accounts", "/payment-accounts", "ONLINE_ORDER_MANAGE"]],
  PENGGUNA: [["users", "/users", "USER_VIEW"]],
  PENGATURAN: [["store", "/store", "BUSINESS_SETTINGS_VIEW"]],
};
const primary = ["BERANDA", "KASIR", "TRANSAKSI"];
const errorText = e => ({
  MERCHANT_SESSION_INVALID: "Sesi berakhir. Silakan masuk kembali.",
  MERCHANT_PERMISSION_DENIED: "Akun tidak memiliki izin untuk tindakan ini.",
  MERCHANT_ACCESS_DENIED: "Akses ke usaha ini sudah tidak aktif.",
  INSUFFICIENT_STOCK: "Stok tidak cukup.",
  INSUFFICIENT_BUSINESS_FUNDS: "Saldo akun usaha tidak cukup.",
  INSUFFICIENT_BALANCE: "Saldo Dompet Santri tidak cukup.",
  UNKNOWN_CREDENTIAL: "Kartu/kode Dompet tidak dikenal.",
}[e?.code] || "Permintaan gagal. Periksa data dan coba lagi.");

export default function MerchantBusinessApp() {
  const [boot, setBoot] = useState(true);
  const [session, setSession] = useState(null);
  const [directory, setDirectory] = useState(null);
  const [context, setContext] = useState(null);
  const [module, setModule] = useState("BERANDA");
  const [data, setData] = useState({});
  const [login, setLogin] = useState({ login: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const lock = useRef(false);
  const generation = useRef(0);
  const api = useMemo(() => makeApi(session?.token), [session?.token]);
  const businessId = session?.businessId;

  const run = useCallback(async work => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setNotice("");
    try { return await work(); }
    catch (e) {
      setError(errorText(e));
      if (["MERCHANT_SESSION_INVALID", "AUTH_EXPIRED"].includes(e.code)) {
        await vault.remove("merchant-session").catch(() => {});
        setSession(null); setContext(null); setDirectory(null);
      }
    } finally { lock.current = false; setBusy(false); }
  }, []);

  const refresh = useCallback(async (target = module, active = session) => {
    if (!active?.businessId) return;
    const client = makeApi(active.token), g = ++generation.current;
    const nextContext = await client(`/pos-business/${active.businessId}/context`);
    const visible = navigationItems(nextContext.permissions);
    const selected = visible.some(item => item.id === target) ? target : "BERANDA";
    const permissions = new Set(nextContext.permissions);
    const entries = await Promise.all((LOADERS[selected] || [])
      .filter(([, , required]) => !required || (Array.isArray(required) ? required.some(item => permissions.has(item)) : permissions.has(required)))
      .map(async ([key, path]) => [key, await client(`/pos-business/${active.businessId}${path}`)]));
    if (g !== generation.current) return;
    setContext(nextContext); setData(Object.fromEntries(entries)); setModule(selected);
  }, [module, session]);

  const selectBusiness = useCallback(async (token, id, all = directory) => {
    const saved = { token, businessId: id };
    await vault.remove("merchant-session").catch(() => {});
    await vault.write("merchant-session", saved);
    setSession(saved); setDirectory(all);
    await refresh("BERANDA", saved);
  }, [directory, refresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = await vault.read("merchant-session");
        if (!saved) return;
        const client = makeApi(saved.token), found = await client("/pos-business/memberships");
        if (!found.businesses.some(item => item.id === saved.businessId)) throw Object.assign(Error("DENIED"), { code: "MERCHANT_ACCESS_DENIED" });
        if (alive) { setDirectory(found); setSession(saved); await refresh("BERANDA", saved); }
      } catch {
        await vault.remove("merchant-session").catch(() => {});
      } finally { if (alive) setBoot(false); }
    })();
    return () => { alive = false; };
  // Bootstrap runs once; subsequent permission refreshes are explicit on every module request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn() {
    await run(async () => {
      const client = makeApi(null);
      const auth = await client("/pos-business/login", { method: "POST", body: login });
      const found = await makeApi(auth.token)("/pos-business/memberships");
      if (!found.businesses.length) throw Object.assign(Error("DENIED"), { code: "MERCHANT_ACCESS_DENIED" });
      setLogin(value => ({ ...value, password: "" })); setDirectory(found);
      if (found.businesses.length === 1) await selectBusiness(auth.token, found.businesses[0].id, found);
      else setSession({ token: auth.token, businessId: null });
    });
  }
  async function logout() {
    await run(async () => {
      if (session?.token) await api("/pos-business/logout", { method: "POST", body: {} }).catch(() => {});
      await vault.remove("merchant-session").catch(() => {});
      setSession(null); setDirectory(null); setContext(null); setData({});
    });
  }
  async function submit(path, body, message, next = module) {
    return run(async () => {
      const result = await api(`/pos-business/${businessId}${path}`, { method: "POST", body });
      setNotice(message); await refresh(next); return result;
    });
  }
  async function request(path) {
    return run(() => api(`/pos-business/${businessId}${path}`));
  }

  if (boot) return <SafeAreaView style={s.root}><Empty loading title="Menyiapkan POS" /></SafeAreaView>;
  if (!session) return <Login value={login} setValue={setLogin} onSubmit={signIn} busy={busy} error={error} />;
  if (!session.businessId) return <BusinessPicker rows={directory?.businesses || []} busy={busy} onSelect={id => run(() => selectBusiness(session.token, id))} onLogout={logout} />;
  if (!context) return <SafeAreaView style={s.root}><Empty loading title="Memuat konteks usaha" /></SafeAreaView>;
  const navigation = navigationItems(context.permissions);
  const selected = navigation.find(item => item.id === module);
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <View style={s.flex}><Text style={s.brand}>{context.business.display_name}</Text><Text style={s.muted}>{context.role} · {selected?.id || module}</Text></View>
        {directory?.businesses?.length > 1 && <Pressable onPress={() => { setSession(x => ({ ...x, businessId: null })); setContext(null); }}><Icon name="repeat" /></Pressable>}
        <Pressable onPress={logout}><Icon name="log-out" color={colors.red} /></Pressable>
      </View>
      {busy && <ActivityIndicator color={colors.green} />}
      {!!error && <View style={s.feedback}><Text style={s.error}>{error}</Text></View>}
      {!!notice && <View style={s.feedback}><Text style={s.success}>{notice}</Text></View>}
      <ModuleView module={module} context={context} data={data} submit={submit} request={request} refresh={() => run(() => refresh(module))} />
      <View style={s.tabs}>
        {primary.filter(id => navigation.some(item => item.id === id)).map(id => <Tab key={id} id={id} active={module === id} onPress={() => run(() => refresh(id))} />)}
        <Tab id="MENU" active={!primary.includes(module)} onPress={() => setMenu(true)} />
      </View>
      <Modal visible={menu} animationType="slide" onRequestClose={() => setMenu(false)}>
        <SafeAreaView style={s.root}><View style={s.header}><Text style={s.brand}>Semua Modul</Text><Pressable onPress={() => setMenu(false)}><Icon name="x" /></Pressable></View>
          <ScrollView contentContainerStyle={s.content}>{navigation.map(item => <Button key={item.id} title={item.id} secondary={item.id !== module} icon={item.icon} onPress={() => { setMenu(false); run(() => refresh(item.id)); }} />)}</ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Login({ value, setValue, onSubmit, busy, error }) {
  return <SafeAreaView style={s.root}><ScrollView contentContainerStyle={s.content}><View style={s.hero}><Text style={s.heroLabel}>KLIKPESANTREN</Text><Text style={s.heroMoney}>POS Merchant</Text><Text style={{ color: colors.surface }}>Satu akun untuk Owner, Supervisor, dan Kasir.</Text></View>
    {!!error && <Text style={s.error}>{error}</Text>}<Card title="Masuk"><Field label="Login merchant" value={value.login} onChangeText={login => setValue({ ...value, login })}/><Field label="Password" secret value={value.password} onChangeText={password => setValue({ ...value, password })}/><Button title="Masuk" disabled={busy || !value.login || !value.password} onPress={onSubmit}/></Card></ScrollView></SafeAreaView>;
}
function BusinessPicker({ rows, busy, onSelect, onLogout }) {
  return <SafeAreaView style={s.root}><View style={s.header}><Text style={s.brand}>Pilih Usaha</Text></View><ScrollView contentContainerStyle={s.content}>{rows.map(row => <Pressable key={row.id} style={s.choice} disabled={busy} onPress={() => onSelect(row.id)}><Icon name="briefcase"/><View style={s.flex}><Text style={s.heading}>{row.display_name}</Text><Text style={s.muted}>{row.tenant_slug} · {row.role}</Text></View></Pressable>)}<Button title="Keluar" danger onPress={onLogout}/></ScrollView></SafeAreaView>;
}
function Tab({ id, active, onPress }) {
  const icon = id === "BERANDA" ? "home" : id === "KASIR" ? "shopping-bag" : id === "TRANSAKSI" ? "file-text" : "menu";
  return <Pressable style={[s.tab, active && s.tabActive]} onPress={onPress}><Icon name={icon} color={active ? colors.green : colors.muted}/><Text style={[s.tabText, active && s.activeTab]}>{id}</Text></Pressable>;
}
function ModuleView(props) {
  const safeData = props.data.books ? props.data : { ...props.data, books: { accounts: (props.data.accounts || []).map(account => ({ ...account, balance: "0" })) } };
  const common = { ...props, data: safeData, can: key => can(props.context.permissions, key) };
  const content = {
    BERANDA: <Dashboard {...common}/>, KASIR: <Cashier {...common}/>, TRANSAKSI: <Transactions {...common}/>,
    SHIFT: <Shifts {...common}/>, PRODUK: <Products {...common}/>, STOK: <Inventory {...common}/>,
    CUSTOMER: <Parties {...common} kind="CUSTOMER"/>, SUPPLIER: <Parties {...common} kind="SUPPLIER"/>,
    PEMBELIAN: <Purchases {...common}/>, PIUTANG: <Debts {...common} kind="AR"/>, UTANG: <Debts {...common} kind="AP"/>,
    KEUANGAN: <Finance {...common}/>, LAPORAN: <Reports {...common}/>, "TOKO ONLINE": <Online {...common}/>,
    PENGGUNA: <Users {...common}/>, PENGATURAN: <Settings {...common}/>,
  }[props.module];
  return <ScrollView style={s.flex} contentContainerStyle={s.content}>{content || <Empty title="Modul tidak tersedia" />}</ScrollView>;
}
function Dashboard({ data, context, refresh, request }) {
  const w=data.workspace||{},a=w.attention,sales=w.sales_today,[period,setPeriod]=useState("TODAY"),[summary,setSummary]=useState(null),periodic=context.permissions.some(p=>["REPORT_SALES","REPORT_PROFIT","REPORT_FINANCE"].includes(p)),canSales=context.permissions.includes("REPORT_SALES");
  const changePeriod=async value=>{setPeriod(value);if(value==="TODAY"){setSummary(null);return;}const result=await request(`/reports?period=${value}`);if(result)setSummary(result.kpi);};
  const current=summary||{net_sales:sales?.sales||0,sales_count:sales?.transactions||0,average_sale:sales?.average_ticket||0,gross_profit:w.profit?.gross_profit};
  return <>{periodic&&<Card title="Periode Dashboard"><Choice options={[["TODAY","Hari Ini"],["MONTH","Bulan Ini"],["YEAR","Tahun Ini"]]} value={period} onChange={changePeriod}/></Card>}{canSales&&<View style={s.hero}><Text style={s.heroLabel}>OMZET</Text><Money value={rupiah(current.net_sales||0)}/><Row label="Transaksi" value={current.sales_count||0}/><Row label="Rata-rata" value={rupiah(current.average_sale||0)}/></View>}
    {context.permissions.includes("REPORT_PROFIT")&&<Card title="Laba kotor"><Money value={rupiah(current.gross_profit||0)}/></Card>}
    <Card title="Perlu perhatian">{context.permissions.includes("AR_VIEW")&&<Row label="Piutang" value={rupiah(a?.receivable||0)}/>}
      {context.permissions.includes("AP_VIEW")&&<Row label="Utang" value={rupiah(a?.payable||0)}/>}
      {context.permissions.includes("INVENTORY_VIEW")&&<Row label="Stok menipis" value={a?.low_stock||0}/>}
      {context.permissions.includes("ONLINE_STORE_VIEW")&&<Row label="Pesanan online" value={a?.online_orders||0}/>}</Card>
    <Button title="Segarkan" secondary onPress={refresh}/></>;
}
function Cashier({ data, context, can, submit }) {
  const blankPayment=()=>({method:"CASH",amount:"",account_id:"",tendered:"",reference:"",credential:""});
  const [cart,setCart]=useState([]),[terminal,setTerminal]=useState(""),[openingCash,setOpeningCash]=useState("0"),[receipt,setReceipt]=useState(null),[search,setSearch]=useState(""),[customerId,setCustomerId]=useState(""),[dueDate,setDueDate]=useState(""),[discount,setDiscount]=useState("0"),[discountReason,setDiscountReason]=useState(""),[payments,setPayments]=useState([blankPayment()]);
  const products=(data.products||[]).filter(p=>BigInt(p.available??p.on_hand??0)>0n&&(!search||`${p.name} ${p.sku||""} ${p.barcode||""}`.toLowerCase().includes(search.toLowerCase()))),drawers=data.drawers||[],accounts=data.accounts||[],shift=data.workspace?.open_shift;
  const discountValue=moneyValue(discount),subtotal=cart.reduce((n,i)=>n+BigInt(i.selling_price)*BigInt(i.quantity),0n),total=subtotal-discountValue,paymentTotal=payments.reduce((n,p)=>n+moneyValue(p.amount),0n);
  const add=p=>setCart(rows=>{const old=rows.find(x=>x.id===p.id);return old?rows.map(x=>x.id===p.id?{...x,quantity:x.quantity+1}:x):[...rows,{...p,quantity:1}]});
  const quantity=(id,delta)=>setCart(rows=>rows.flatMap(x=>x.id!==id?[x]:x.quantity+delta>0?[{...x,quantity:x.quantity+delta}]:[]));
  const updatePayment=(index,patch)=>setPayments(rows=>rows.map((p,i)=>i===index?{...p,...patch}:p));
  const methods=["CASH","BANK","QRIS","DOMPET_SANTRI",...(customerId?["CREDIT"]:[])];
  const paymentPayload=p=>p.method==="CASH"?{method:p.method,amount:p.amount,account_id:shift.cash_account_id,tendered:p.tendered||p.amount}:p.method==="DOMPET_SANTRI"?{method:p.method,amount:p.amount,credential_method:"RFID",credential:p.credential,unit_id:context.units[0]?.unit_id}:p.method==="CREDIT"?{method:p.method,amount:p.amount}:{method:p.method,amount:p.amount,account_id:p.account_id,reference:p.reference};
  if(!shift)return <Card title="Buka Shift"><Text style={s.muted}>Pilih terminal dan laci kas. Server memvalidasi hubungan keduanya.</Text>{context.terminals.map(t=><Chip key={t.id} label={t.name} active={terminal===t.id} onPress={()=>setTerminal(t.id)}/>)}<Field label="Kas awal" numeric value={openingCash} onChangeText={setOpeningCash}/>
    {drawers.map(a=><Button key={a.id} title={`Buka dengan ${a.name}`} disabled={!terminal||!validMoney(openingCash)} onPress={()=>submit("/shifts/open",{terminal_id:terminal,cash_account_id:a.id,opening_cash:openingCash},"Shift dibuka.","KASIR")}/>)}</Card>;
  if(receipt)return <Receipt value={receipt} onDone={()=>setReceipt(null)}/>;
  const invalid=!validMoney(discount)||total<=0n||paymentTotal!==total||payments.some(p=>!validMoney(p.amount)||moneyValue(p.amount)<=0n||p.method==="CASH"&&p.tendered&&!validMoney(p.tendered)||p.method==="DOMPET_SANTRI"&&(!p.credential||!context.units.length)||["BANK","QRIS"].includes(p.method)&&(!p.account_id||!p.reference)||p.method==="CREDIT"&&(!customerId||!dueDate));
  return <><Card title="Keranjang"><Row label="Item" value={cart.reduce((n,i)=>n+i.quantity,0)}/>{cart.map(i=><View key={i.id} style={s.cartItem}><Row label={i.name} value={rupiah(BigInt(i.selling_price)*BigInt(i.quantity))}/><View style={s.row}><Chip label="−" onPress={()=>quantity(i.id,-1)}/><Text style={s.text}>{i.quantity}</Text><Chip label="+" onPress={()=>quantity(i.id,1)}/><Chip label="Hapus" onPress={()=>quantity(i.id,-i.quantity)}/></View></View>)}
    {can("SALE_DISCOUNT")&&<><Field label="Diskon" numeric value={discount} onChangeText={setDiscount}/>{discountValue>0n&&<Field label="Alasan diskon" value={discountReason} onChangeText={setDiscountReason}/>}</>}<Row label="Subtotal" value={rupiah(subtotal)}/><Money value={rupiah(total)}/><SelectRows title="Customer opsional" rows={data.customers||[]} selected={customerId} label={x=>x.name} onSelect={setCustomerId}/>
    {customerId&&<Button title="Tanpa Customer" secondary onPress={()=>setCustomerId("")}/>}<Text style={s.heading}>Pembayaran</Text>{payments.map((payment,index)=><Card key={index} title={payments.length>1?`Pembayaran ${index+1}`:undefined}><Choice options={methods.filter(m=>!payments.some((p,i)=>i!==index&&p.method===m)).map(m=>[m,m.replaceAll("_"," ")])} value={payment.method} onChange={method=>updatePayment(index,{...blankPayment(),method})}/><Field label="Nominal" numeric value={payment.amount} onChangeText={amount=>updatePayment(index,{amount})}/>{payment.method==="CASH"&&<Field label="Uang diterima" numeric value={payment.tendered} onChangeText={tendered=>updatePayment(index,{tendered})}/>}{["BANK","QRIS"].includes(payment.method)&&<><SelectRows title="Akun penerimaan" rows={accounts.filter(a=>a.kind===payment.method)} selected={payment.account_id} label={x=>x.name} onSelect={account_id=>updatePayment(index,{account_id})}/><Field label="Referensi pembayaran" value={payment.reference} onChangeText={reference=>updatePayment(index,{reference})}/></>}{payment.method==="DOMPET_SANTRI"&&<><Text style={s.muted}>Pembaca fisik belum terhubung ke aplikasi ini. Masukkan credential Dompet yang diberikan operator secara online.</Text><Field label="Kode credential Dompet" value={payment.credential} onChangeText={credential=>updatePayment(index,{credential})}/></>}{payment.method==="CREDIT"&&<Field label="Jatuh tempo YYYY-MM-DD" value={dueDate} onChangeText={setDueDate}/>}{payments.length>1&&<Button title="Hapus Pembayaran" secondary onPress={()=>setPayments(rows=>rows.filter((_,i)=>i!==index))}/>}</Card>)}
    {payments.length<5&&methods.some(m=>!payments.some(p=>p.method===m))&&<Button title="Tambah Split Payment" secondary onPress={()=>setPayments(rows=>[...rows,{...blankPayment(),method:methods.find(m=>!rows.some(p=>p.method===m))}])}/>}<Row label="Total pembayaran" value={rupiah(paymentTotal)}/>
    <Button title="Simpan Penjualan" disabled={!cart.length||invalid||discountValue>0n&&!discountReason} onPress={()=>submit("/sales",{request_id:Crypto.randomUUID(),shift_id:shift.id,customer_id:customerId||undefined,due_date:payments.some(p=>p.method==="CREDIT")?dueDate:undefined,discount,discount_reason:discountValue>0n?discountReason:undefined,items:cart.map(i=>({product_id:i.id,quantity:i.quantity})),payments:payments.map(paymentPayload)},"Penjualan tersimpan.","KASIR").then(result=>{if(result){setReceipt(result);setCart([]);setPayments([blankPayment()]);setCustomerId("");setDueDate("");setDiscount("0");setDiscountReason("");}})}/></Card>
    <Card title="Cari Produk"><Field label="Nama, SKU, atau barcode" value={search} onChangeText={setSearch}/></Card><Text style={s.heading}>Produk</Text>{products.map(p=><Pressable key={p.id} style={s.choice} onPress={()=>add(p)}><View style={s.flex}><Text style={s.heading}>{p.name}</Text><Text style={s.muted}>Tersedia {p.available??p.on_hand}</Text></View><Text style={s.price}>{rupiah(p.selling_price)}</Text></Pressable>)}</>;
}
function Transactions({ data, can, submit, request }) {
  const [source,setSource]=useState(null),[receipt,setReceipt]=useState(null),[form,setForm]=useState({product_id:"",quantity:"1",reason:"",shift_id:""});
  const choose=async row=>{setSource(row);setReceipt(await request(`/sales/${row.id}`));};
  return <><List rows={data.sales} render={row=><Pressable onPress={()=>choose(row)}><Row label={row.kind} value={rupiah(row.total)}/><Row label={row.customer||row.cashier} value={new Date(row.created_at).toLocaleString("id-ID")}/><Badge label={row.channel}/></Pressable>}/>
    {source&&receipt&&can("SALE_REFUND")&&source.kind==="SALE"&&<Card title="Retur Penjualan"><Text style={s.muted}>Sumber {source.reference||source.id}</Text><SelectRows title="Item yang diretur" rows={receipt.items} selected={form.product_id} label={x=>`${x.name} · maks ${x.quantity}`} onSelect={product_id=>setForm({...form,product_id})}/><Fields value={form} setValue={setForm} fields={[["quantity","Jumlah retur",true],["reason","Alasan"],["shift_id","ID shift bila refund tunai"]]}/><Button danger title="Proses Retur" disabled={!form.product_id||!form.quantity||!form.reason} onPress={()=>Alert.alert("Konfirmasi retur","Stok dan sumber dana akan direkonsiliasi oleh server.",[{text:"Batal",style:"cancel"},{text:"Lanjut",style:"destructive",onPress:()=>submit("/sale-returns",{request_id:Crypto.randomUUID(),source_id:source.id,items:[{product_id:form.product_id,quantity:form.quantity}],reason:form.reason,shift_id:form.shift_id||undefined},"Retur penjualan tersimpan.","TRANSAKSI").then(()=>{setSource(null);setReceipt(null);})}])}/></Card>}</>;
}
function Receipt({ value, onDone }) {
  const brand=value.branding||value.sale?.receipt_snapshot||{};
  return <><View style={s.receiptHero}><Icon name="check-circle" size={42}/><Text style={s.sectionTitle}>Pembayaran berhasil</Text><Money value={rupiah(value.sale?.total||0)}/></View>
    <Card title={brand.name||"Struk Penjualan"}><Row label="Nomor struk" value={brand.receipt||value.sale?.id}/><Row label="Waktu" value={new Date(value.sale?.created_at).toLocaleString("id-ID")}/><Row label="Kasir" value={brand.cashier_name}/><Row label="Customer" value={value.sale?.party_id||"Customer Umum"}/>
      {(value.items||[]).map(item=><View key={item.product_id} style={s.cartItem}><Row label={`${item.quantity} × ${item.name}`} value={rupiah(item.total)}/>{BigInt(item.discount||0)>0n&&<Row label="Diskon" value={rupiah(item.discount)}/>}</View>)}
      {(value.payments||[]).map(payment=><Row key={payment.method} label={payment.label||payment.method} value={rupiah(payment.amount)}/>)}
      <Text style={s.muted}>{brand.footer || "Powered by KlikPesantren"}</Text></Card><Button title="Transaksi Baru" onPress={onDone}/></>;
}
function Shifts({ data, submit }) {
  const [actual,setActual]=useState(""),open=data.workspace?.open_shift;
  return <>{open&&<Card title="Shift Aktif"><Row label="Dibuka" value={new Date(open.opened_at).toLocaleString("id-ID")}/><Field label="Kas fisik aktual" numeric value={actual} onChangeText={setActual}/><Button title="Tutup Shift" danger disabled={!actual} onPress={()=>submit("/shifts/close",{shift_id:open.id,actual_cash:actual},"Shift ditutup.","SHIFT")}/></Card>}<List rows={data.shifts} render={r=><><Row label={r.cashier} value={r.status}/><Row label={r.terminal} value={rupiah(r.difference||0)}/></>}/></>;
}
function Products({ data, can, submit }) {
  const empty={sku:"",barcode:"",name:"",category:"",uom:"pcs",image_url:"",selling_price:"",minimum_stock:"0",active:true,sellable:true,online_visible:false};
  const [form,setForm]=useState(empty),[editing,setEditing]=useState(null),[search,setSearch]=useState(""),[category,setCategory]=useState("");
  const categories=[...new Set((data.products||[]).map(p=>p.category).filter(Boolean))];
  const rows=(data.products||[]).filter(p=>(!search||`${p.name} ${p.sku||""} ${p.barcode||""}`.toLowerCase().includes(search.toLowerCase()))&&(!category||p.category===category));
  const edit=p=>{setEditing(p.id);setForm({...empty,...p,selling_price:String(p.selling_price),minimum_stock:String(p.minimum_stock)});};
  const save=()=>submit(editing?`/products/${editing}`:"/products",form,editing?"Produk diperbarui.":"Produk ditambahkan.","PRODUK").then(()=>{setEditing(null);setForm(empty);});
  return <><Card title="Cari Produk"><Field label="Nama, SKU, atau barcode" value={search} onChangeText={setSearch}/><Choice options={[["","Semua"],...categories.map(x=>[x,x])]} value={category} onChange={setCategory}/></Card><List rows={rows} render={p=><><Row label={p.name} value={rupiah(p.selling_price)}/><Row label={`${p.sku||"Tanpa SKU"} · ${p.category||"Tanpa kategori"}`} value={`Stok ${p.available??p.on_hand??0}`}/><Badge label={p.active?"AKTIF":"NONAKTIF"}/><Badge label={p.online_visible?"ONLINE":"OFFLINE"}/>{can("PRODUCT_COST_VIEW")&&<Row label="HPP" value={p.unit_cost?rupiah(p.unit_cost):"Lihat pergerakan"}/>} {can("PRODUCT_MANAGE")&&<Button title="Edit" secondary onPress={()=>edit(p)}/>}</>}/>{can("PRODUCT_MANAGE")&&<Card title={editing?"Edit Produk":"Tambah Produk"}><Fields value={form} setValue={setForm} fields={[["sku","SKU"],["barcode","Barcode"],["name","Nama"],["category","Kategori"],["uom","Satuan"],["image_url","URL gambar"],["selling_price","Harga jual",true],["minimum_stock","Stok minimum",true]]}/><Choice options={[[true,"Aktif"],[false,"Nonaktif"]]} value={form.active} onChange={active=>setForm({...form,active})}/><Choice options={[[true,"Dijual"],[false,"Tidak dijual"]]} value={form.sellable} onChange={sellable=>setForm({...form,sellable})}/><Button title={editing?"Simpan Perubahan":"Tambah Produk"} disabled={!form.name||!form.selling_price||!editing&&!form.sku} onPress={save}/>{editing&&<Button title="Batal" secondary onPress={()=>{setEditing(null);setForm(empty);}}/>}</Card>}</>;
}
function Inventory({ data, can, submit }) {
  const [mode,setMode]=useState("ADJUST"),[form,setForm]=useState({product_id:"",direction:"OUT",quantity:"",actual_stock:"",reason:"",unit_cost:""}),inv=data.inventory||{};
  const selected=inv.products?.find(p=>p.id===form.product_id);
  const payload=()=>{if(mode==="ADJUST")return {...form,request_id:Crypto.randomUUID(),unit_cost:form.unit_cost||"0"};const delta=BigInt(form.actual_stock||0)-BigInt(selected?.on_hand||0);return {product_id:form.product_id,direction:delta>=0n?"IN":"OUT",quantity:(delta>=0n?delta:-delta).toString(),reason:`OPNAME: ${form.reason}`,unit_cost:form.unit_cost||"0",request_id:Crypto.randomUUID()};};
  return <><List rows={inv.products} render={p=><Pressable onPress={()=>setForm(x=>({...x,product_id:p.id}))}><Row label={p.name} value={`${p.available} tersedia`}/><Row label="Stok fisik sistem" value={p.on_hand}/><Row label="Minimum" value={p.minimum_stock}/>{BigInt(p.available||0)<=BigInt(p.minimum_stock||0)&&<Badge label="STOK MENIPIS"/>}</Pressable>}/><Text style={s.heading}>Pergerakan</Text><List rows={inv.movements} render={m=><><Row label={m.name} value={m.quantity}/><Row label={m.kind} value={m.reason}/>{m.cost!=null&&<Row label="Nilai HPP" value={rupiah(m.cost)}/>}</>}/>{can("INVENTORY_ADJUST")&&<Card title="Penyesuaian / Opname"><Choice options={[["ADJUST","Penyesuaian"],...(can("INVENTORY_OPNAME")?[["OPNAME","Stok Opname"]]:[])]} value={mode} onChange={setMode}/><SelectRows title="Produk" rows={inv.products} selected={form.product_id} label={x=>x.name} onSelect={product_id=>setForm({...form,product_id})}/>{mode==="ADJUST"?<><Choice options={[["IN","Masuk"],["OUT","Keluar"],["DAMAGE","Rusak/Hilang"]]} value={form.direction} onChange={direction=>setForm({...form,direction})}/><Fields value={form} setValue={setForm} fields={[["quantity","Jumlah",true],["reason","Alasan"],["unit_cost","HPP per unit (masuk)",true]]}/></>:<Fields value={form} setValue={setForm} fields={[["actual_stock","Hasil hitung fisik",true],["reason","Catatan opname"],["unit_cost","HPP bila stok bertambah",true]]}/>}<Button title="Simpan Movement" disabled={!form.product_id||!(mode==="ADJUST"?form.quantity:form.actual_stock)||!form.reason||mode==="OPNAME"&&selected&&BigInt(form.actual_stock||0)===BigInt(selected.on_hand||0)} onPress={()=>submit("/stock-adjustments",payload(),mode==="OPNAME"?"Stok opname direkonsiliasi.":"Stok diperbarui.","STOK")}/></Card>}</>;
}
function Parties({ data, kind, can, submit }) {
  const rows=kind==="CUSTOMER"?data.customers:data.suppliers;
  const empty={name:"",phone:"",address:"",notes:"",credit_limit:"0",due_days:"0",active:true};
  const [form,setForm]=useState(empty),[search,setSearch]=useState(""),[selected,setSelected]=useState(null),[editing,setEditing]=useState(null);
  const permission=kind==="CUSTOMER"?"CUSTOMER_MANAGE":"SUPPLIER_MANAGE";
  const filtered=(rows||[]).filter(p=>!search||`${p.name} ${p.phone||""}`.toLowerCase().includes(search.toLowerCase()));
  return <><Card title={kind==="CUSTOMER"?"Cari Customer":"Cari Supplier"}><Field label="Nama atau telepon" value={search} onChangeText={setSearch}/></Card>{kind==="CUSTOMER"&&data.metrics&&<Card title="Ringkasan Customer"><Row label="Customer aktif" value={data.metrics.active_customers||0}/><Row label="Total belanja" value={rupiah(data.metrics.net_spend||0)}/><Row label="Rata-rata transaksi" value={rupiah(data.metrics.average_ticket||0)}/></Card>}<List rows={filtered} render={p=><Pressable onPress={()=>setSelected(p)}><Row label={p.name} value={p.phone}/><Row label={kind==="CUSTOMER"?"Piutang":"Utang"} value={rupiah(p.outstanding)}/>{kind==="CUSTOMER"&&can("CUSTOMER_CREDIT_VIEW")&&<><Row label="Limit kredit" value={rupiah(p.credit_limit)}/><Row label="Termin" value={`${p.due_days||0} hari`}/></>}<Badge label={p.active?"AKTIF":"NONAKTIF"}/></Pressable>}/>{selected&&<Card title="Profil & Riwayat"><Row label="Nama" value={selected.name}/><Row label="Telepon" value={selected.phone}/><Row label="Alamat" value={selected.address}/><Row label="Outstanding" value={rupiah(selected.outstanding)}/><Row label={kind==="CUSTOMER"?"Total belanja":"Total pembelian"} value={rupiah(selected.total_spend||0)}/><Row label="Jumlah transaksi" value={selected.transaction_count||0}/><Row label="Rata-rata" value={rupiah(selected.average_ticket||0)}/><Row label="Terakhir" value={selected.last_purchase?new Date(selected.last_purchase).toLocaleString("id-ID"):"Belum ada"}/>{kind==="CUSTOMER"&&<><Row label="POS" value={rupiah(selected.pos_spend||0)}/><Row label="ONLINE" value={rupiah(selected.online_spend||0)}/></>}{can(permission)&&<Button title="Edit Profil" secondary onPress={()=>{setEditing(selected.id);setForm({...empty,...selected,credit_limit:String(selected.credit_limit||0),due_days:String(selected.due_days||0)});setSelected(null);}}/>}<Button title="Tutup" secondary onPress={()=>setSelected(null)}/></Card>}{can(permission)&&<Card title={editing?`Edit ${kind==="CUSTOMER"?"Customer":"Supplier"}`:kind==="CUSTOMER"?"Tambah Customer":"Tambah Supplier"}><Fields value={form} setValue={setForm} fields={[["name","Nama"],["phone","Telepon"],["address","Alamat"],["notes","Catatan"],["credit_limit","Limit kredit",true],["due_days","Termin hari",true]]}/>{editing&&<Choice options={[[true,"Aktif"],[false,"Nonaktif"]]} value={form.active!==false} onChange={active=>setForm({...form,active})}/>}<Button title="Simpan" disabled={!form.name} onPress={()=>submit(editing?`/parties/${editing}`:"/parties",{...form,kind,credit_allowed:kind==="CUSTOMER"&&BigInt(form.credit_limit||0)>0n},"Data pihak tersimpan.",kind==="CUSTOMER"?"CUSTOMER":"SUPPLIER").then(()=>{setEditing(null);setForm(empty);})}/>{editing&&<Button title="Batal" secondary onPress={()=>{setEditing(null);setForm(empty);}}/>}</Card>}</>;
}
function Purchases({ data, can, submit }) {
  const [form,setForm]=useState({product_id:"",supplier_id:"",account_id:"",quantity:"1",unit_cost:"",paid:"0",due_date:""}),[ret,setRet]=useState({source_id:"",product_id:"",quantity:"1",reason:"",reference:""});
  const paid=BigInt(form.paid||0);
  return <><List rows={data.purchases} render={p=><Pressable onPress={()=>p.kind==="PURCHASE"&&setRet(x=>({...x,source_id:p.id}))}><Row label={p.supplier} value={rupiah(p.total)}/><Row label={p.reference||p.kind} value={p.due_date}/><Badge label={p.kind}/></Pressable>}/>{can("PURCHASE_CREATE")&&<Card title="Buat Pembelian"><SelectRows title="Produk" rows={data.inventory?.products} selected={form.product_id} label={x=>x.name} onSelect={product_id=>setForm({...form,product_id})}/><SelectRows title="Supplier" rows={data.suppliers} selected={form.supplier_id} label={x=>x.name} onSelect={supplier_id=>setForm({...form,supplier_id})}/>{paid>0n&&<SelectRows title="Akun Bayar" rows={data.books?.accounts} selected={form.account_id} label={x=>x.name} onSelect={account_id=>setForm({...form,account_id})}/>}<Fields value={form} setValue={setForm} fields={[["quantity","Jumlah",true],["unit_cost","Harga beli",true],["paid","Dibayar",true],["due_date","Jatuh tempo YYYY-MM-DD"]]}/><Button title="Simpan Pembelian" disabled={!form.product_id||!form.supplier_id||!form.quantity||!form.unit_cost||paid>0n&&!form.account_id} onPress={()=>submit("/purchases",{request_id:Crypto.randomUUID(),supplier_id:form.supplier_id,account_id:paid>0n?form.account_id:undefined,paid:form.paid,items:[{product_id:form.product_id,quantity:form.quantity,unit_cost:form.unit_cost}],due_date:form.due_date||undefined},"Pembelian dan stok tersimpan.","PEMBELIAN")}/></Card>}{can("PURCHASE_RETURN")&&<Card title="Retur Pembelian"><SelectRows title="Pembelian sumber" rows={(data.purchases||[]).filter(p=>p.kind==="PURCHASE")} selected={ret.source_id} label={x=>`${x.supplier} · ${rupiah(x.total)}`} onSelect={source_id=>setRet({...ret,source_id})}/><SelectRows title="Produk" rows={data.inventory?.products} selected={ret.product_id} label={x=>x.name} onSelect={product_id=>setRet({...ret,product_id})}/><Fields value={ret} setValue={setRet} fields={[["quantity","Jumlah",true],["reason","Alasan"],["reference","Referensi pengembalian dana"]]}/><Button danger title="Proses Retur Pembelian" disabled={!ret.source_id||!ret.product_id||!ret.quantity||!ret.reason} onPress={()=>Alert.alert("Konfirmasi retur pembelian","Stok, utang, dan sumber dana direkonsiliasi oleh server.",[{text:"Batal",style:"cancel"},{text:"Lanjut",style:"destructive",onPress:()=>submit("/purchase-returns",{request_id:Crypto.randomUUID(),source_id:ret.source_id,items:[{product_id:ret.product_id,quantity:ret.quantity}],reason:ret.reason,reference:ret.reference||undefined,refund_confirmed:true},"Retur pembelian tersimpan.","PEMBELIAN")}])}/></Card>}</>;
}
function Debts({ data, kind, can, submit }) {
  const [form,setForm]=useState({source_id:"",account_id:"",amount:""}),permission=kind==="AR"?"AR_COLLECT":"AP_PAY";
  return <><Card title={kind==="AR"?"Piutang Customer":"Utang Supplier"}><Money value={rupiah(data.aging?.outstanding||0)}/></Card><List rows={data.aging?.items} render={r=><Pressable onPress={()=>setForm(x=>({...x,source_id:r.source_id}))}><Row label={r.name} value={rupiah(r.outstanding)}/><Row label={r.bucket} value={r.due_date}/></Pressable>}/>{can(permission)&&<Card title={kind==="AR"?"Terima Pembayaran":"Bayar Utang"}><SelectRows title="Akun" rows={data.books?.accounts} selected={form.account_id} label={x=>`${x.name} · ${rupiah(x.balance)}`} onSelect={account_id=>setForm({...form,account_id})}/><Fields value={form} setValue={setForm} fields={[["source_id","ID transaksi sumber"],["amount","Nominal",true]]}/><Button title="Simpan Pembayaran" disabled={!form.source_id||!form.account_id||!form.amount} onPress={()=>submit("/debt-payments",{...form,kind,request_id:Crypto.randomUUID()},"Pembayaran utang/piutang tersimpan.",kind==="AR"?"PIUTANG":"UTANG")}/></Card>}</>;
}
function Finance({ data, can, submit }) {
  const [form,setForm]=useState({kind:"EXPENSE",account_id:"",amount:"",reason:""});
  const permitted={EXPENSE:"EXPENSE_CREATE",OTHER_INCOME:"OTHER_INCOME_CREATE",TRANSFER:"TRANSFER_CREATE",CAPITAL:"CAPITAL_MANAGE",WITHDRAWAL:"PRIVE_MANAGE"};
  const kinds=[["EXPENSE","Pengeluaran"],["OTHER_INCOME","Pendapatan lain"],["TRANSFER","Transfer"],["CAPITAL","Modal"],["WITHDRAWAL","Prive"]].filter(([key])=>can(permitted[key]));
  return <><Text style={s.heading}>Kas & Rekening</Text><List rows={data.books?.accounts} render={a=><><Row label={a.name} value={rupiah(a.balance)}/><Badge label={a.kind}/></>}/><Text style={s.heading}>Mutasi</Text><List rows={data.activity} render={o=><><Row label={o.kind} value={rupiah(o.total)}/><Row label={o.reason||o.party} value={new Date(o.created_at).toLocaleString("id-ID")}/></>}/>{kinds.length>0&&<Card title="Catat Transaksi"><Choice options={kinds} value={form.kind} onChange={kind=>setForm({...form,kind})}/><SelectRows title="Akun" rows={data.books?.accounts} selected={form.account_id} label={x=>x.name} onSelect={account_id=>setForm({...form,account_id})}/>{form.kind==="TRANSFER"&&<SelectRows title="Akun tujuan" rows={data.books?.accounts} selected={form.destination_account_id} label={x=>x.name} onSelect={destination_account_id=>setForm({...form,destination_account_id})}/>}<Fields value={form} setValue={setForm} fields={[["amount","Nominal",true],["reason","Keterangan"]]}/><Button title="Simpan Mutasi" disabled={!form.account_id||!form.amount||!form.reason||form.kind==="TRANSFER"&&!form.destination_account_id} onPress={()=>submit("/money",{...form,request_id:Crypto.randomUUID()},"Mutasi tersimpan.","KEUANGAN")}/></Card>}</>;
}
function Reports({ data, context, request }) {
  const [period,setPeriod]=useState("MONTH"),[report,setReport]=useState(data.report),[custom,setCustom]=useState({from:"",to:""});
  const load=async value=>{setPeriod(value);const query=value==="CUSTOM"?`from=${custom.from}&to=${custom.to}`:`period=${value}`;const next=await request(`/reports?${query}`);if(next)setReport(next);};
  const k=report?.kpi||{};
  return <><Card title="Periode Laporan"><Choice options={[["TODAY","Hari Ini"],["MONTH","Bulan Ini"],["YEAR","Tahun Ini"],["CUSTOM","Kustom"]]} value={period} onChange={value=>value==="CUSTOM"?setPeriod(value):load(value)}/>{period==="CUSTOM"&&<><Fields value={custom} setValue={setCustom} fields={[["from","Dari YYYY-MM-DD"],["to","Sampai YYYY-MM-DD"]]}/><Button title="Terapkan" disabled={!custom.from||!custom.to} onPress={()=>load("CUSTOM")}/></>}<Row label={report?.from} value={report?.to}/></Card>{context.permissions.includes("REPORT_SALES")&&<Card title="Penjualan"><Money value={rupiah(k.net_sales||0)}/><Row label="Transaksi" value={k.sales_count||0}/><Row label="Rata-rata" value={rupiah(k.average_sale||0)}/><Row label="POS" value={rupiah(k.pos_net_sales||0)}/><Row label="Online" value={rupiah(k.online_net_sales||0)}/>{(report?.payment_methods||[]).map(x=><Row key={x.method} label={x.method} value={rupiah(x.sale_amount)}/>)}</Card>}{context.permissions.includes("REPORT_PROFIT")&&<Card title="Laba Kotor"><Money value={rupiah(k.gross_profit||0)}/><Row label="HPP FIFO" value={rupiah(k.cogs||0)}/></Card>}{context.permissions.includes("REPORT_FINANCE")&&<Card title="Hasil Operasional"><Money value={rupiah(k.operating_result||0)}/><Row label="Biaya" value={rupiah(k.expenses||0)}/><Row label="Pendapatan lain" value={rupiah(k.other_income||0)}/></Card>}{context.permissions.includes("REPORT_INVENTORY")&&<Card title="Persediaan"><Row label="Stok menipis" value={data.inventory?.products?.filter(p=>BigInt(p.available||0)<=BigInt(p.minimum_stock||0)).length||0}/></Card>}{context.permissions.includes("REPORT_CUSTOMER")&&<Card title="Customer"><Row label="Customer aktif" value={data.customers?.active_customers||0}/><Row label="Nilai belanja" value={rupiah(data.customers?.net_spend||0)}/></Card>}{context.permissions.includes("REPORT_ONLINE")&&<Card title="Toko Online"><Row label="Omzet online" value={rupiah(data.online?.net_online_sales||0)}/><Row label="Rata-rata pesanan" value={rupiah(data.online?.average_online_order_value||0)}/></Card>}</>;
}
function Online({ data, can, submit }) {
  const store=data.store?.store||{},products=data.store?.products||[];
  const [courier,setCourier]=useState(""),[resi,setResi]=useState(""),[reason,setReason]=useState(""),[reference,setReference]=useState(""),[shiftId,setShiftId]=useState(""),[accountId,setAccountId]=useState("");
  const [storeForm,setStoreForm]=useState({...store}),[productForm,setProductForm]=useState({id:"",online_price:"",online_visible:false,online_featured:false,online_description:"",online_long_description:"",online_sort:"0",image_url:"",category:""});
  const nextStatus=status=>({ORDERED:"CONFIRMED",CONFIRMED:"PROCESSING",PROCESSING:"READY_TO_SHIP",READY_TO_SHIP:"SHIPPED",SHIPPED:"COMPLETED"}[status]);
  const confirm=(title,action)=>Alert.alert(title,"Tindakan ini mengubah status pesanan dan tidak boleh dilakukan tanpa verifikasi operator.",[{text:"Batal",style:"cancel"},{text:"Lanjut",style:"destructive",onPress:action}]);
  const advance=o=>submit(`/orders/${o.id}/transition`,o.status==="ORDERED"?{status:"CONFIRMED",account_id:o.payment_method==="CREDIT"?undefined:accountId,payment_confirmed:o.payment_method==="CREDIT"?undefined:true,reference:o.payment_method==="CREDIT"?undefined:reference,shift_id:shiftId||undefined}:{status:nextStatus(o.status),courier,tracking:resi},"Status pesanan diperbarui.","TOKO ONLINE");
  return <><Card title="Toko Online"><Row label="Status" value={store.storefront_enabled?"AKTIF":"NONAKTIF"}/><Row label="Slug" value={store.storefront_slug}/>{data.store?.public_url&&<Button title="Buka Toko" secondary onPress={()=>Linking.openURL(data.store.public_url)}/>}</Card>
    {can("ONLINE_STORE_MANAGE")&&<Card title="Pengaturan Toko"><Choice options={[[true,"Aktif"],[false,"Nonaktif"]]} value={storeForm.storefront_enabled===true} onChange={storefront_enabled=>setStoreForm({...storeForm,storefront_enabled})}/><Choice options={[[true,"Tampilkan telepon"],[false,"Sembunyikan telepon"]]} value={storeForm.public_phone===true} onChange={public_phone=>setStoreForm({...storeForm,public_phone})}/><Fields value={storeForm} setValue={setStoreForm} fields={[["display_name","Nama toko"],["storefront_slug","Slug publik"],["description","Deskripsi"],["logo_url","URL logo"],["banner_url","URL banner"],["brand_color","Warna brand (#RRGGBB)"],["address","Alamat"],["phone","Telepon"],["hours_text","Jam buka"],["storefront_footer","Footer"],["shipping_charge","Ongkir",true],["reservation_minutes","Reservasi menit",true],["payment_instructions","Instruksi pembayaran"]]}/><Button title="Simpan Toko" onPress={()=>submit("/store",storeForm,"Pengaturan toko tersimpan.","TOKO ONLINE")}/></Card>}
    {can("ONLINE_STORE_MANAGE")&&can("PRODUCT_MANAGE")&&<Card title="Produk Online"><SelectRows title="Pilih produk" rows={products} selected={productForm.id} label={x=>x.name} onSelect={id=>{const p=products.find(x=>x.id===id);setProductForm({...p,id,online_price:String(p.online_price||p.selling_price||""),online_sort:String(p.online_sort||0)});}}/><Choice options={[[true,"Tampil"],[false,"Sembunyi"]]} value={productForm.online_visible===true} onChange={online_visible=>setProductForm({...productForm,online_visible})}/><Choice options={[[true,"Unggulan"],[false,"Biasa"]]} value={productForm.online_featured===true} onChange={online_featured=>setProductForm({...productForm,online_featured})}/><Fields value={productForm} setValue={setProductForm} fields={[["online_price","Harga online",true],["category","Kategori"],["image_url","URL gambar"],["online_description","Deskripsi singkat"],["online_long_description","Deskripsi lengkap"],["online_sort","Urutan",true]]}/><Button title="Simpan Publikasi" disabled={!productForm.id||productForm.online_visible&&!productForm.online_price} onPress={()=>submit(`/products/${productForm.id}/online`,productForm,"Produk online diperbarui.","TOKO ONLINE")}/></Card>}
    <Text style={s.heading}>Pesanan</Text><List rows={data.orders} render={o=><><Row label={o.order_number} value={rupiah(o.total)}/><Row label={o.recipient} value={o.status}/>{can("ONLINE_ORDER_MANAGE")&&nextStatus(o.status)&&<>{o.status==="ORDERED"&&o.payment_method!=="CREDIT"&&<><SelectRows title="Akun penerimaan" rows={data.accounts} selected={accountId} label={x=>x.name} onSelect={setAccountId}/><Fields value={{reference,shift_id:shiftId}} setValue={v=>{setReference(v.reference||"");setShiftId(v.shift_id||"");}} fields={[["reference","Bukti/referensi pembayaran"],["shift_id","ID shift (khusus tunai)"]]}/></>}<Fields value={{courier,resi}} setValue={v=>{setCourier(v.courier||"");setResi(v.resi||"");}} fields={[["courier","Kurir"],["resi","Resi"]]}/><Button title={`Ubah ke ${nextStatus(o.status)}`} disabled={o.status==="ORDERED"&&o.payment_method!=="CREDIT"&&(!accountId||!reference||o.payment_method==="CASH"&&!shiftId)} onPress={()=>advance(o)}/></>}{can("ONLINE_ORDER_MANAGE")&&o.status==="ORDERED"&&<><Field label="Alasan pembatalan" value={reason} onChangeText={setReason}/><Button title="Batalkan Pesanan" danger disabled={!reason} onPress={()=>confirm("Batalkan pesanan?",()=>submit(`/orders/${o.id}/transition`,{status:"CANCELLED",reason},"Pesanan dibatalkan.","TOKO ONLINE"))}/></>}{can("ONLINE_ORDER_MANAGE")&&can("SALE_REFUND")&&!["ORDERED","CANCELLED","REFUNDED","EXPIRED"].includes(o.status)&&<><Fields value={{reason,reference,shift_id:shiftId}} setValue={v=>{setReason(v.reason||"");setReference(v.reference||"");setShiftId(v.shift_id||"");}} fields={[["reason","Alasan refund"],["reference","Bukti/referensi"],["shift_id","ID shift (khusus tunai)"]]}/><Button title="Refund Pesanan" danger disabled={!reason||!reference} onPress={()=>confirm("Refund pesanan?",()=>submit(`/orders/${o.id}/transition`,{status:"REFUNDED",reason,reference,shift_id:shiftId||undefined,refund_confirmed:true},"Pesanan direfund.","TOKO ONLINE"))}/></>}</>}/></>;
}
function Users({ data, can, submit }) {
  const initial={login:"",name:"",password:"",role:"CASHIER",permissions:[...DEFAULTS.CASHIER]};
  const [form,setForm]=useState(initial),[editing,setEditing]=useState(null),[resetPassword,setResetPassword]=useState("");
  const toggle=key=>setForm(value=>({...value,permissions:value.permissions.includes(key)?value.permissions.filter(item=>item!==key):[...value.permissions,key]}));
  return <><List rows={data.users} render={user=><><Row label={user.name} value={user.role}/><Row label={user.login} value={user.membership_active?"AKTIF":"NONAKTIF"}/><Text style={s.muted}>{user.permissions.length} hak akses</Text>{user.role!=="OWNER"&&can("PERMISSION_MANAGE")&&<Button title="Edit Akses" secondary onPress={()=>{setEditing(user.id);setResetPassword("");setForm({name:user.name,role:user.role,permissions:user.permissions,active:user.membership_active});}}/>}</>}/>{can("USER_MANAGE")&&<Card title={editing?"Edit Pengguna":"Tambah Pengguna"}>{!editing&&<><Field label="Login" value={form.login} onChangeText={login=>setForm({...form,login})}/><Field label="Password minimal 12 karakter" secret value={form.password} onChangeText={password=>setForm({...form,password})}/></>}<Field label="Nama" value={form.name} onChangeText={name=>setForm({...form,name})}/><Choice options={[["CASHIER","Kasir"],["SUPERVISOR","Supervisor"]]} value={form.role} onChange={role=>setForm({...form,role,permissions:[...DEFAULTS[role]]})}/>{editing&&<Choice options={[["ACTIVE","Aktif"],["INACTIVE","Nonaktif"]]} value={form.active===false?"INACTIVE":"ACTIVE"} onChange={state=>setForm({...form,active:state==="ACTIVE"})}/>}<PermissionEditor selected={form.permissions} onToggle={toggle}/><Button title="Simpan Pengguna" disabled={!form.name||!form.role||!editing&&(!form.login||form.password.length<12)} onPress={()=>submit(editing?`/users/${editing}`:"/users",editing?{name:form.name,role:form.role,permissions:form.permissions,active:form.active!==false}:form,editing?"Akses pengguna diperbarui.":"Pengguna dibuat.","PENGGUNA").then(()=>{setEditing(null);setForm(initial);})}/>{editing&&<><Field label="Password baru minimal 12 karakter" secret value={resetPassword} onChangeText={setResetPassword}/><Button danger title="Reset Kredensial & Cabut Sesi" disabled={resetPassword.length<12} onPress={()=>Alert.alert("Reset kredensial?","Semua sesi pengguna ini akan dicabut.",[{text:"Batal",style:"cancel"},{text:"Reset",style:"destructive",onPress:()=>submit(`/users/${editing}/reset-credential`,{password:resetPassword},"Kredensial direset dan sesi lama dicabut.","PENGGUNA").then(()=>setResetPassword(""))}])}/><Button title="Batal" secondary onPress={()=>{setEditing(null);setResetPassword("");setForm(initial);}}/></>}</Card>}</>;
}
function PermissionEditor({ selected, onToggle }) {
  return <>{Object.entries(GROUPS).map(([group,items])=><Card key={group} title={group.replaceAll("_"," ")}>{items.map(([key,label])=><Pressable key={key} style={s.row} onPress={()=>onToggle(key)}><Text style={s.text}>{label}</Text><Icon name={selected.includes(key)?"check-square":"square"}/></Pressable>)}</Card>)}</>;
}
function Settings({ data, context, can, submit }) {
  const store=data.store?.store||{},[form,setForm]=useState({...context.business,...store}),[account,setAccount]=useState({name:"",kind:"CASH"});
  return <><Card title="Profil Usaha"><Row label="Nama" value={context.business.display_name}/><Row label="Timezone" value={context.business.timezone}/><Row label="Kepemilikan" value={context.business.ownership}/></Card>{can("BUSINESS_SETTINGS_MANAGE")&&<><Card title="Ubah Profil & Struk"><Fields value={form} setValue={setForm} fields={[["display_name","Nama usaha"],["legal_name","Nama legal"],["address","Alamat"],["phone","Kontak"],["receipt_name","Nama di struk"],["receipt_header","Header struk"],["receipt_footer","Footer struk"],["receipt_prefix","Prefix struk"],["timezone","Timezone"]]}/><Button title="Simpan Pengaturan" onPress={()=>submit("/profile",{...form,receipt_logo:false},"Pengaturan usaha tersimpan.","PENGATURAN")}/></Card><Card title="Tambah Kas / Rekening"><Choice options={[["CASH","Kas"],["BANK","Bank"],["QRIS","QRIS"]]} value={account.kind} onChange={kind=>setAccount({...account,kind})}/><Field label="Nama akun" value={account.name} onChangeText={name=>setAccount({...account,name})}/><Button title="Tambah Akun" disabled={!account.name} onPress={()=>submit("/accounts",account,"Akun usaha ditambahkan.","PENGATURAN").then(()=>setAccount({name:"",kind:"CASH"}))}/></Card></>}</>;
}
function List({ rows=[], render }) {
  return rows?.length ? rows.map((row,index)=><Card key={row.id||index}>{render(row)}</Card>) : <Empty title="Belum ada data" note="Data akan tampil setelah transaksi pertama."/>;
}
function Fields({ value, setValue, fields }) {
  return fields.map(([key,label,numeric])=><Field key={key} label={label} numeric={numeric} value={String(value[key]??"")} onChangeText={next=>setValue({...value,[key]:next})}/>);
}
function Choice({ options, value, onChange }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false}>{options.map(([id,label])=><Chip key={id} label={label} active={value===id} onPress={()=>onChange(id)}/>)}</ScrollView>;
}
function SelectRows({ title, rows=[], selected, label, onSelect }) {
  return <View><Text style={s.label}>{title}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{rows.map(row=><Chip key={row.id} label={label(row)} active={selected===row.id} onPress={()=>onSelect(row.id)}/>)}</ScrollView></View>;
}
