import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import Constants from "expo-constants";
import { makeApi } from "./api";
import { WalletCredentialScanner } from "./WalletCredentialScanner";
import { Artwork, Badge, Button, Card, Chip, Empty, Field, Icon, Money, Row, RupiahField, colors, s } from "./ui";
import { AppText as Text } from "./typography";
const { createVault } = require("./vault.cjs");
const { GROUPS, DEFAULTS, navigationItems, primaryNavigation, dashboardActions, can } = require("./merchantAccess.cjs");
const { rupiah } = require("./domain.cjs");
const { READINESS_ITEMS, shiftResourceChoice, cashierSetupState } = require("./merchantBootstrap.cjs");
const { addPurchaseLine, updatePurchaseLine, removePurchaseLine, purchaseTotals, purchasePayload } = require("./purchaseDraft.cjs");
const { stockStatus, filterProducts, purchaseAccounts, applyPurchasePaymentMode } = require("./inventoryUx.cjs");
const { externalPayment } = require("./paymentCredential.cjs");
const { cashChange, scannerAvailability, transferMethod } = require("./cashierFlow.cjs");
const { filterCustomers, defaultDueDate, creditAvailability } = require("./cashierCustomer.cjs");
const { createSaleJournal } = require("./saleJournal.cjs");
const { authorityKey, boundedRows, createModuleDataCache } = require("./moduleDataCache.cjs");

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
  KEUANGAN: [["books", "/books", "FINANCE_ACCOUNT_VIEW"], ["settlement", "/wallet-settlement", "FINANCE_ACCOUNT_VIEW"], ["activity", "/activity", "FINANCE_TRANSACTION_VIEW"], ["accounts", "/payment-accounts", ["EXPENSE_CREATE","OTHER_INCOME_CREATE","TRANSFER_CREATE","CAPITAL_MANAGE","PRIVE_MANAGE"]]],
  LAPORAN: [["report", "/reports?period=MONTH", ["REPORT_SALES","REPORT_PROFIT","REPORT_FINANCE"]], ["inventory", "/inventory", "REPORT_INVENTORY"], ["customers", "/customers/metrics", "REPORT_CUSTOMER"], ["online", "/online-report", "REPORT_ONLINE"]],
  "TOKO ONLINE": [["orders", "/orders", "ONLINE_STORE_VIEW"], ["store", "/store", "ONLINE_STORE_VIEW"], ["accounts", "/payment-accounts", "ONLINE_ORDER_MANAGE"]],
  PENGGUNA: [["users", "/users", "USER_VIEW"]],
  PENGATURAN: [["store", "/store", "BUSINESS_SETTINGS_VIEW"], ["initialization", "/initialization", "BUSINESS_SETTINGS_VIEW"], ["terminals", "/terminals", "SHIFT_OPEN"], ["drawers", "/cash-drawers", "SHIFT_OPEN"], ["accounts", "/payment-accounts", "BUSINESS_SETTINGS_MANAGE"], ["products", "/products", "PRODUCT_VIEW"], ["customers", "/parties?kind=CUSTOMER", "CUSTOMER_VIEW"], ["suppliers", "/parties?kind=SUPPLIER", "SUPPLIER_VIEW"]],
};
const NAV_LABELS = { BERANDA:"Beranda", KASIR:"Kasir", TRANSAKSI:"Transaksi", LAPORAN:"Laporan", MENU:"Menu" };
const MENU_GROUPS = [
  ["PRODUK & STOK", ["PRODUK","STOK","PEMBELIAN","SUPPLIER"]],
  ["PELANGGAN & PENJUALAN", ["CUSTOMER","PIUTANG","TRANSAKSI","SHIFT"]],
  ["KEUANGAN & LAPORAN", ["KEUANGAN","UTANG","LAPORAN"]],
  ["PENJUALAN ONLINE", ["TOKO ONLINE"]],
  ["PENGELOLAAN USAHA", ["PENGGUNA","PENGATURAN"]],
];
const ROLE_LABELS = { OWNER: "Owner", SUPERVISOR: "Supervisor", CASHIER: "Kasir" };
const MENU_LABELS = {
  PRODUK: "Produk", STOK: "Stok", PEMBELIAN: "Pembelian Barang", SUPPLIER: "Pemasok",
  CUSTOMER: "Pelanggan", TRANSAKSI: "Transaksi", SHIFT: "Shift Kasir",
  KEUANGAN: "Kas & Rekening", UTANG: "Utang", PIUTANG: "Piutang", LAPORAN: "Laporan",
  "TOKO ONLINE": "Toko Online", PENGGUNA: "Karyawan & Akses", PENGATURAN: "Pengaturan Usaha",
};
const MENU_DESCRIPTIONS = {
  PRODUK: "Katalog, harga, dan publikasi", STOK: "Persediaan dan pergerakan", PEMBELIAN: "Belanja dan retur",
  SUPPLIER: "Daftar pemasok", CUSTOMER: "Data pelanggan dan riwayat", TRANSAKSI: "Penjualan dan retur", SHIFT: "Buka, tutup, dan riwayat shift",
  KEUANGAN: "Biaya, pendapatan, modal, dan prive", UTANG: "Kewajiban ke supplier", PIUTANG: "Tagihan pelanggan", LAPORAN: "Ringkasan kinerja usaha",
  "TOKO ONLINE": "Pesanan, toko, dan publikasi", PENGGUNA: "Tim, peran, dan izin", PENGATURAN: "Identitas usaha dan akun",
};
const errorText = e => ({
  REVIEW_NETWORK_DISABLED: "Aplikasi ini adalah build demo/review dan tidak dapat login ke server. Instal build operasional Suq Shogir.",
  NETWORK: "Tidak dapat terhubung ke server. Periksa internet lalu coba lagi.",
  INVALID_CREDENTIALS: "ID login atau password salah.",
  LOGIN_RATE_LIMITED: "Terlalu banyak percobaan login. Tunggu 15 menit lalu coba lagi.",
  MERCHANT_SESSION_INVALID: "Sesi berakhir. Silakan masuk kembali.",
  MERCHANT_PERMISSION_DENIED: "Akun tidak memiliki izin untuk tindakan ini.",
  MERCHANT_ACCESS_DENIED: "Akses ke usaha ini sudah tidak aktif.",
  INSUFFICIENT_STOCK: "Stok tidak cukup.",
  INSUFFICIENT_BUSINESS_FUNDS: "Saldo akun usaha tidak cukup.",
  INSUFFICIENT_BALANCE: "Saldo Dompet Santri tidak cukup.",
  UNIT_REQUIRED: "Pilih unit santri sebelum membaca credential Dompet.",
  WALLET_INTEGRATION_DENIED: "Merchant belum diizinkan menggunakan Dompet Santri. Minta Tenant Admin mengaktifkan integrasi Wallet merchant.",
  WALLET_UNIT_DENIED: "Unit ini belum terhubung ke merchant. Pilih unit yang diizinkan atau hubungi Tenant Admin.",
  FEATURE_DISABLED: "Fitur Dompet atau RFID belum aktif pada unit ini. Hubungi Tenant Admin.",
  MEMBERSHIP_INACTIVE: "Santri tidak aktif pada unit yang dipilih.",
  WALLET_ACCOUNT_REQUIRED: "Akun Dompet santri belum tersedia pada unit ini.",
  UNKNOWN_CREDENTIAL: "Kartu/kode Dompet tidak dikenal.",
  UNSUPPORTED_NFC_TAG: "Teknologi/UID kartu belum kompatibel dengan pembaca NFC perangkat ini.",
  PAYMENT_CONFIRMATION_REQUIRED: "Transfer/QRIS harus diverifikasi manual dan memiliki referensi bukti.",
  REGISTERED_CREDIT_CUSTOMER_REQUIRED: "Pilih customer terdaftar sebelum mencatat penjualan utang.",
  CREDIT_LIMIT_DENIED: "Fasilitas utang customer tidak aktif atau sisa limit tidak mencukupi.",
  CUSTOMER_DENIED: "Customer tidak aktif atau bukan milik merchant ini.",
  DEBT_OVERPAYMENT: "Nominal pelunasan melebihi sisa piutang invoice.",
  PENDING_SALE_REQUIRES_RETRY: "Ada transaksi dengan hasil belum pasti. Ulangi transaksi yang sama, jangan membuat transaksi baru.",
  PENDING_SALE_AUTHORITY_MISMATCH: "Transaksi tertunda dimiliki konteks akun/usaha lain. Kembali ke konteks asal untuk menyelesaikannya.",
  ACTIVATION_INVALID: "Kode aktivasi tidak valid atau kedaluwarsa.",
  OWNER_REQUIRED: "Hanya Owner yang dapat menyiapkan atau mengoreksi posisi awal.",
  INITIALIZATION_FINALIZED: "Posisi awal sudah difinalisasi. Gunakan koreksi terpisah agar riwayat tidak berubah.",
  BUSINESS_ACTIVITY_ALREADY_STARTED: "Usaha sudah memiliki aktivitas. Posisi awal tidak dapat dibuat ulang.",
  ACCOUNTING_START_DATE_IN_FUTURE: "Tanggal mulai pembukuan tidak boleh di masa depan.",
  OPENING_ITEM_NOT_FOUND: "Data tersebut bukan bagian dari posisi awal yang difinalisasi.",
  FINALIZATION_CONFIRMATION_REQUIRED: "Konfirmasi finalisasi belum lengkap.",
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
  const [loadingModule,setLoadingModule] = useState("");
  const [showingCached,setShowingCached] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [menu, setMenu] = useState(false);
  const [accountMenu, setAccountMenu] = useState(false);
  const [pendingSale, setPendingSale] = useState(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const moduleCache = useRef(createModuleDataCache());
  const inflightModule = useRef("");
  const lastLoaded = useRef(new Map());
  const api = useMemo(() => makeApi(session?.token), [session?.token]);
  const businessId = session?.businessId;
  const saleJournal = useMemo(() => createSaleJournal({
    vault,
    send: payload => api(`/pos-business/${businessId}/sales`, { method: "POST", body: payload }),
  }), [api, businessId]);

  const run = useCallback(async work => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError(""); setNotice("");
    try { return await work(); }
    catch (e) {
      setError(errorText(e));
      if (["MERCHANT_SESSION_INVALID", "AUTH_EXPIRED"].includes(e.code)) {
        await vault.remove("merchant-session").catch(() => {});
        moduleCache.current.clear();
        lastLoaded.current.clear();
        setSession(null); setContext(null); setDirectory(null);
      }
    } finally { lock.current = false; setBusy(false); }
  }, []);

  const refresh = useCallback(async (target = module, active = session) => {
    if (!active?.businessId) return;
    if (inflightModule.current === target) return;
    inflightModule.current = target; setLoadingModule(target);
    const client = makeApi(active.token), g = ++generation.current;
    try {
      // Context is deliberately revalidated on every navigation; cached projections never authorize access.
      const nextContext = await client(`/pos-business/${active.businessId}/context`);
      const visible = navigationItems(nextContext.permissions);
      const selected = visible.some(item => item.id === target) ? target : "BERANDA";
      const authority = authorityKey(nextContext,active.businessId),cached=moduleCache.current.get(authority,selected);
      if(cached&&g===generation.current){setContext(nextContext);setData(cached);setModule(selected);setShowingCached(true);}
      else if(g===generation.current)setShowingCached(false);
      const permissions = new Set(nextContext.permissions);
      const entries = await Promise.all((LOADERS[selected] || [])
        .filter(([, , required]) => !required || (Array.isArray(required) ? required.some(item => permissions.has(item)) : permissions.has(required)))
        .map(async ([key, path]) => [key, await client(`/pos-business/${active.businessId}${path}`)]));
      if (g !== generation.current) return;
      const fresh=Object.fromEntries(entries);
      moduleCache.current.set(authority,selected,fresh);
      lastLoaded.current.set(selected,Date.now());
      setContext(nextContext);setData(fresh);setModule(selected);setShowingCached(false);
    } finally {
      if(inflightModule.current===target)inflightModule.current="";
      if(g===generation.current)setLoadingModule("");
    }
  }, [module, session]);

  const navigate = useCallback(async (target, force=false) => {
    const recentlyLoaded=Date.now()-(lastLoaded.current.get(target)||0)<3_000;
    if(!force&&target===module&&Object.keys(data).length&&recentlyLoaded)return;
    setError("");setNotice("");
    try{await refresh(target);}catch(e){setError(errorText(e));}
  },[data,module,refresh]);

  const selectBusiness = useCallback(async (token, id, all = directory) => {
    const pending = await vault.read("merchant-sale").catch(() => null);
    if (pending && pending.business_id !== id) throw Error("PENDING_SALE_AUTHORITY_MISMATCH");
    const saved = { token, businessId: id };
    await vault.remove("merchant-session").catch(() => {});
    await vault.write("merchant-session", saved);
    moduleCache.current.clear();
    lastLoaded.current.clear();
    inflightModule.current="";
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

  useEffect(() => {
    if (!businessId || !context?.user_id) return;
    let alive = true;
    saleJournal.read().then(pending => {
      if (!alive) return;
      if (pending && (pending.business_id !== businessId || pending.user_id !== context.user_id)) {
        setPendingSale(pending); setError(errorText({ code: "PENDING_SALE_AUTHORITY_MISMATCH" }));
      } else setPendingSale(pending);
    }).catch(() => setError("Jurnal transaksi lokal rusak. Jangan membuat transaksi baru; hubungi admin."));
    return () => { alive = false; };
  }, [businessId, context?.user_id, saleJournal]);

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
  async function activateAccount(payload) {
    return run(async () => {
      await makeApi(null)("/pos-business/activate", { method: "POST", body: payload });
      setNotice("Akun aktif. Silakan masuk dengan password baru.");
      return true;
    });
  }
  async function logout() {
    if (pendingSale) { setError(errorText({ code: "PENDING_SALE_REQUIRES_RETRY" })); return; }
    await run(async () => {
      if (session?.token) await api("/pos-business/logout", { method: "POST", body: {} }).catch(() => {});
      await vault.remove("merchant-session").catch(() => {});
      moduleCache.current.clear();
      lastLoaded.current.clear();
      setSession(null); setDirectory(null); setContext(null); setData({});
    });
  }
  async function submit(path, body, message, next = module) {
    return run(async () => {
      const result = await api(`/pos-business/${businessId}${path}`, { method: "POST", body });
      moduleCache.current.invalidate(authorityKey(context,businessId));
      setNotice(message); await refresh(next); return result;
    });
  }
  async function request(path, options) {
    return run(() => api(`/pos-business/${businessId}${path}`, options));
  }
  async function submitSale(payload) {
    return run(async () => {
      const authority = { business_id: businessId, user_id: context.user_id };
      const result = await saleJournal.submit(payload, authority);
      moduleCache.current.invalidate(authorityKey(context,businessId));
      setPendingSale(null); setNotice("Penjualan tersimpan."); await refresh("KASIR"); return result;
    }).finally(async () => setPendingSale(await saleJournal.read().catch(() => null)));
  }
  async function uploadProductAsset(asset) {
    return run(async () => {
      const body = new FormData();
      body.append("file", { uri: asset.uri, name: asset.fileName || "product.jpg", type: asset.mimeType || "image/jpeg" });
      return api(`/pos-business/${businessId}/product-assets`, { method: "POST", formData: body });
    });
  }

  if (boot) return <SafeAreaView style={s.root}><Empty loading title="Menyiapkan Suq Shogir" /></SafeAreaView>;
  if (!session) return <Login value={login} setValue={setLogin} onSubmit={signIn} onActivate={activateAccount} busy={busy} error={error} notice={notice} />;
  if (!session.businessId) return <BusinessPicker rows={directory?.businesses || []} busy={busy} onSelect={id => run(() => selectBusiness(session.token, id))} onLogout={logout} />;
  if (!context) return <SafeAreaView style={s.root}><Empty loading title="Memuat konteks usaha" /></SafeAreaView>;
  const navigation = navigationItems(context.permissions);
  const primary = primaryNavigation(navigation);
  return (
    <SafeAreaView style={s.root}>
      <View style={s.header}>
        <View style={s.avatar}><Text style={s.avatarText}>{context.business.display_name.slice(0,1).toUpperCase()}</Text></View>
        <View style={s.flex}><Text style={s.brand} numberOfLines={1}>{context.business.display_name}</Text><Text style={s.roleBadge}>Masuk sebagai {ROLE_LABELS[context.role] || "Pengguna"}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Buka menu akun" style={s.headerAccount} onPress={() => setAccountMenu(true)}><Icon name="user" size={18} color={colors.navy}/></Pressable>
      </View>
      {busy && <ActivityIndicator accessibilityLabel="Menyimpan perubahan" color={colors.green} />}
      {!!loadingModule && <View style={s.refreshBanner}><ActivityIndicator size="small" color={colors.green}/><Text style={s.muted}>{showingCached?"Memperbarui data…":"Memuat data…"}</Text></View>}
      {showingCached&&!loadingModule&&<View style={s.staleBanner}><Icon name="wifi-off" size={14} color={colors.amber}/><Text style={s.muted}>Menampilkan data terakhir. Tarik ulang setelah koneksi pulih.</Text></View>}
      {!!error && <View style={s.feedback}><Text style={s.error}>{error}</Text></View>}
      {!!notice && <View style={s.feedback}><Text style={s.success}>{notice}</Text></View>}
      <ModuleView module={module} context={context} data={data} submit={submit} submitSale={submitSale} pendingSale={pendingSale} request={request} uploadProductAsset={uploadProductAsset} refresh={() => navigate(module,true)} navigate={navigate} />
      <View style={s.tabs} accessibilityRole="tablist">
        {primary.map(id => <Tab key={id} id={id} active={module === id} onPress={() => navigate(id)} />)}
        <Tab id="MENU" active={!primary.includes(module)} onPress={() => setMenu(true)} />
      </View>
      <Modal transparent visible={accountMenu} animationType="fade" onRequestClose={() => setAccountMenu(false)}>
        <Pressable style={s.accountOverlay} onPress={() => setAccountMenu(false)}>
          <View style={s.accountPanel} onStartShouldSetResponder={() => true}>
            <View style={s.userRow}><View style={s.avatar}><Text style={s.avatarText}>{context.user_name.slice(0,1).toUpperCase()}</Text></View><View style={s.flex}><Text style={s.heading}>{context.user_name}</Text><Text style={s.muted}>{ROLE_LABELS[context.role] || "Pengguna"} · {context.business.display_name}</Text></View></View>
            {directory?.businesses?.length > 1 && <Button title="Ganti ruang usaha" secondary icon="repeat" onPress={() => { setAccountMenu(false); setSession(x => ({ ...x, businessId: null })); setContext(null); }}/>}
            <Button title="Keluar" danger icon="log-out" onPress={() => { setAccountMenu(false); logout(); }}/>
          </View>
        </Pressable>
      </Modal>
      <Modal visible={menu} animationType="slide" onRequestClose={() => setMenu(false)}>
        <SafeAreaView style={s.root}><View style={s.header}><View style={s.flex}><Text style={s.brand}>Menu Usaha</Text><Text style={s.muted}>Modul sesuai akses akun Anda</Text></View><Pressable accessibilityLabel="Tutup menu" onPress={() => setMenu(false)}><Icon name="x" /></Pressable></View>
          <ScrollView contentContainerStyle={s.content}>{MENU_GROUPS.map(([title,ids])=>{const rows=ids.filter(id=>navigation.some(item=>item.id===id));return rows.length?<View key={title} style={s.menuSection}><Text style={s.eyebrow}>{title}</Text><View style={s.menuGrid}>{rows.map(id=>{const item=navigation.find(x=>x.id===id);return <Pressable accessibilityRole="button" key={id} style={[s.menuItem,module===id&&s.menuItemActive]} onPress={()=>{setMenu(false);navigate(id);}}><View style={s.menuIcon}><Icon name={item.icon} size={17}/></View><View style={s.flex}><Text style={s.menuLabel}>{MENU_LABELS[id] || id}</Text><Text style={s.menuDescription}>{MENU_DESCRIPTIONS[id]}</Text></View><Icon name="chevron-right" size={16} color={colors.muted}/></Pressable>})}</View></View>:null;})}</ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Login({ value, setValue, onSubmit, onActivate, busy, error, notice }) {
  const [mode,setMode]=useState("LOGIN"),[activation,setActivation]=useState({login:"",activation_code:"",password:"",confirm:""});
  const activate=async()=>{const ok=await onActivate({login:activation.login,activation_code:activation.activation_code,password:activation.password});if(ok){setValue({...value,login:activation.login,password:""});setActivation({login:"",activation_code:"",password:"",confirm:""});setMode("LOGIN");}};
  return <SafeAreaView style={s.loginRoot}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==="ios"?"interactive":"on-drag"} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="always" contentContainerStyle={s.loginContent}><View style={s.loginBrand}><View style={s.logoMark}><Icon name="shopping-bag" size={26} color={colors.surface}/></View><Text style={s.loginKicker}>SUQ SHOGIR</Text><Text style={s.loginTitle}>Ruang usaha yang rapi dan aman</Text><Text style={s.loginSubtitle}>Kasir, stok, keuangan, dan toko online dalam satu sumber data. Didukung KlikPesantren.</Text></View>
    <Card title={mode==="LOGIN"?"Masuk ke akun Anda":"Aktivasi akun karyawan"}>{!!error&&<View style={s.alertError}><Text style={s.error}>{error}</Text></View>}{!!notice&&<View style={s.alertSuccess}><Text style={s.success}>{notice}</Text></View>}{mode==="LOGIN"?<><Field label="ID login" value={value.login} onChangeText={login=>setValue({...value,login})}/><Field label="Password" secret value={value.password} onChangeText={password=>setValue({...value,password})}/><Button title={busy?"Memeriksa…":"Masuk"} icon="log-in" disabled={busy||!value.login||!value.password} onPress={onSubmit}/><Button title="Aktivasi akun karyawan" secondary onPress={()=>setMode("ACTIVATE")}/></>:<><Text style={s.muted}>Gunakan kode sekali pakai dari Owner, lalu buat password pribadi Anda.</Text><Field label="ID login" value={activation.login} onChangeText={login=>setActivation({...activation,login})}/><Field label="Kode aktivasi" secret value={activation.activation_code} onChangeText={activation_code=>setActivation({...activation,activation_code})}/><Field label="Password baru (minimal 12 karakter)" secret value={activation.password} onChangeText={password=>setActivation({...activation,password})}/><Field label="Ulangi password" secret value={activation.confirm} onChangeText={confirm=>setActivation({...activation,confirm})}/><Button title={busy?"Mengaktifkan…":"Aktifkan akun"} disabled={busy||!activation.login||!activation.activation_code||activation.password.length<12||activation.password!==activation.confirm} onPress={activate}/><Button title="Kembali ke login" secondary onPress={()=>setMode("LOGIN")}/></>}</Card><Text style={s.loginFoot}>Akun dan hak akses ditentukan oleh Owner usaha. KlikPesantren tidak pernah menampilkan password lama.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
function BusinessPicker({ rows, busy, onSelect, onLogout }) {
  return <SafeAreaView style={s.root}><View style={s.header}><Text style={s.brand}>Pilih Usaha</Text></View><ScrollView contentContainerStyle={s.content}>{rows.map(row => <Pressable key={row.id} style={s.choice} disabled={busy} onPress={() => onSelect(row.id)}><Icon name="briefcase"/><View style={s.flex}><Text style={s.heading}>{row.display_name}</Text><Text style={s.muted}>{row.tenant_slug} · {row.role}</Text></View></Pressable>)}<Button title="Keluar" danger onPress={onLogout}/></ScrollView></SafeAreaView>;
}
function Tab({ id, active, onPress }) {
  const icon = id === "BERANDA" ? "home" : id === "KASIR" ? "shopping-bag" : id === "TRANSAKSI" ? "file-text" : id === "LAPORAN" ? "bar-chart-2" : "grid";
  return <Pressable accessibilityRole="tab" accessibilityState={{selected:active}} style={[s.tab, active && s.tabActive]} onPress={onPress}><Icon name={icon} color={active ? colors.green : colors.muted}/><Text style={[s.tabText, active && s.activeTab]}>{NAV_LABELS[id]||id}</Text></Pressable>;
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
  return <View style={s.flex}>
    {common.can("SALE_CREATE")&&<View style={[s.flex,props.module!=="KASIR"&&s.hidden]}><Cashier {...common}/></View>}
    {props.module!=="KASIR"&&<ScrollView key={props.module} style={s.flex} contentContainerStyle={s.content}>{content || <Empty title="Modul tidak tersedia" />}</ScrollView>}
  </View>;
}
function Dashboard({ data, context, can, refresh, navigate }) {
  const w=data.workspace||{},a=w.attention||{},sales=w.sales_today||{},isCashier=context.role==="CASHIER",actions=dashboardActions(context.role,context.permissions);
  const missing=(w.readiness?READINESS_ITEMS:[]).filter(([key,,,permission])=>!w.readiness[key]&&can(permission));
  const attention=[];
  if(can("AR_VIEW"))attention.push(["Piutang pelanggan",rupiah(a.receivable||0)]);
  if(can("AP_VIEW"))attention.push(["Utang ke pemasok",rupiah(a.payable||0)]);
  if(can("INVENTORY_VIEW"))attention.push(["Stok menipis",String(a.low_stock||0)]);
  if(can("ONLINE_STORE_VIEW"))attention.push(["Pesanan online",String(a.online_orders||0)]);
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>{isCashier?"Siap melayani":"Hari ini di usaha Anda"}</Text><Text style={s.muted}>{isCashier?context.business.display_name:"Ringkasan operasional terbaru."}</Text></View><Pressable style={s.inlineAction} onPress={refresh}><Icon name="refresh-cw" size={14}/><Text style={s.inlineActionText}>Segarkan</Text></Pressable></View>
    {isCashier?<Card title={w.open_shift?"Shift sedang berjalan":"Shift belum dibuka"}><Row label="Akun" value={context.user_name}/><Row label="Usaha" value={context.business.display_name}/><Text style={s.muted}>{w.open_shift?"Lanjutkan penjualan dari Kasir. Keranjang tetap tersimpan saat berpindah tab.":"Buka Kasir untuk memilih terminal dan laci kas yang diizinkan."}</Text></Card>:can("REPORT_SALES")?<><View style={s.kpiGrid}><KpiTile label="Penjualan hari ini" value={rupiah(sales.sales||0)} icon="trending-up"/><KpiTile label="Transaksi" value={String(sales.transactions||0)} icon="file-text"/></View>{Number(sales.transactions||0)===0&&<Text style={s.muted}>Belum ada transaksi hari ini.</Text>}</>:<Card title="Aktivitas usaha"><Text style={s.muted}>Ringkasan penjualan tidak tersedia untuk hak akses akun ini.</Text></Card>}
    {actions.length>0&&<View style={s.sectionCompact}><Text style={s.heading}>Akses Cepat</Text><View style={s.quickGrid}>{actions.map(action=><Pressable accessibilityRole="button" key={action.id} style={s.quickAction} onPress={()=>navigate(action.id)}><Icon name={action.icon} size={18}/><Text style={s.quickActionText}>{action.label}</Text></Pressable>)}</View></View>}
    {!isCashier&&attention.length>0&&<Card title="Perlu diperhatikan">{attention.map(([label,value])=><Row key={label} label={label} value={value}/>)}</Card>}
    {!isCashier&&missing.length>0&&<Card title="Pengaturan yang perlu dilengkapi"><Text style={s.muted}>Hanya langkah yang belum selesai dan dapat Anda atur yang ditampilkan.</Text>{missing.map(([key,label,target])=><View key={key} style={s.readinessRow}><Row label={label} value="BELUM"/><Button title="Lengkapi" secondary onPress={()=>navigate(target)}/></View>)}</Card>}</>;
}
function KpiTile({ label, value, icon, negative=false }) {
  return <View style={s.kpiTile}><View style={s.row}><Text style={s.label}>{label}</Text><Icon name={icon} size={16} color={negative?colors.red:colors.green}/></View><Text style={[s.kpiValue,negative&&s.kpiValueNegative]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}
function Cashier({ data, context, can, submit, submitSale, pendingSale, request, navigate }) {
  const blankPayment=(method="CASH",amount="")=>({method,amount,account_id:"",tendered:"",reference:"",credential:"",credential_method:"",unit_id:context.units.length===1?context.units[0].unit_id:"",wallet_preview:null,manual_confirmed:false});
  const [cart,setCart]=useState([]),[terminal,setTerminal]=useState(""),[drawer,setDrawer]=useState(""),[openingCash,setOpeningCash]=useState("0"),[showOpeningCash,setShowOpeningCash]=useState(false),[receipt,setReceipt]=useState(null),[search,setSearch]=useState(""),[category,setCategory]=useState(""),[customerId,setCustomerId]=useState(""),[customerSearch,setCustomerSearch]=useState(""),[showCustomerCreate,setShowCustomerCreate]=useState(false),[customerDraft,setCustomerDraft]=useState({name:"",phone:"",address:"",credit_limit:"0",due_days:"0"}),[dueDate,setDueDate]=useState(""),[discount,setDiscount]=useState("0"),[discountReason,setDiscountReason]=useState(""),[payments,setPayments]=useState([blankPayment()]),[step,setStep]=useState("PRODUCTS"),[split,setSplit]=useState(false);
  const allProducts=data.products||[],categories=[...new Set(allProducts.map(p=>p.category).filter(Boolean))],products=allProducts.filter(p=>BigInt(p.available??p.on_hand??0)>0n&&(!category||p.category===category)&&(!search||`${p.name} ${p.sku||""} ${p.barcode||""}`.toLowerCase().includes(search.toLowerCase()))),drawers=data.drawers||[],accounts=data.accounts||[],shift=data.workspace?.open_shift;
  const customers=data.customers||[],visibleCustomers=filterCustomers(customers,customerSearch),selectedCustomer=customers.find(customer=>String(customer.id)===String(customerId));
  const setup=cashierSetupState(context.terminals,drawers,can("BUSINESS_SETTINGS_MANAGE"));
  const terminalChoice=shiftResourceChoice(terminal,context.terminals),drawerChoice=shiftResourceChoice(drawer,drawers),selectedTerminal=terminalChoice.selected,selectedDrawer=drawerChoice.selected;
  const discountValue=moneyValue(discount),subtotal=cart.reduce((n,i)=>n+BigInt(i.selling_price)*BigInt(i.quantity),0n),total=subtotal-discountValue,totalText=total>0n?String(total):"",itemCount=cart.reduce((n,i)=>n+i.quantity,0);
  const effectivePayments=payments.map(payment=>!split&&payments.length===1?{...payment,amount:totalText}:payment),paymentTotal=effectivePayments.reduce((n,p)=>n+moneyValue(p.amount),0n);
  // Keep the visible single-payment field synchronized with the server-authoritative cart total.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(!split&&totalText)setPayments(rows=>rows.length===1&&rows[0].amount!==totalText?[{...rows[0],amount:totalText}]:rows);},[split,totalText]);
  const add=p=>setCart(rows=>{const old=rows.find(x=>x.id===p.id);return old?rows.map(x=>x.id===p.id?{...x,quantity:x.quantity+1}:x):[...rows,{...p,quantity:1}]});
  const quantity=(id,delta)=>setCart(rows=>rows.flatMap(x=>x.id!==id?[x]:x.quantity+delta>0?[{...x,quantity:x.quantity+delta}]:[]));
  const updatePayment=(index,patch)=>setPayments(rows=>rows.map((p,i)=>i===index?{...p,...patch}:p));
  const methods=["CASH","TRANSFER","DOMPET_SANTRI",...(customerId?["CREDIT"]:[])];
  const creditState=creditAvailability(selectedCustomer,total);
  const selectCustomer=id=>{const customer=customers.find(row=>String(row.id)===String(id));setCustomerId(id);if(customer?.due_days!=null)setDueDate(defaultDueDate(customer.due_days));};
  const createCustomer=async()=>{const credit=can("CUSTOMER_CREDIT_MANAGE")&&moneyValue(customerDraft.credit_limit)>0n,result=await submit("/parties",{kind:"CUSTOMER",name:customerDraft.name.trim(),phone:customerDraft.phone.trim()||undefined,address:customerDraft.address.trim()||undefined,...(credit?{credit_allowed:true,credit_limit:customerDraft.credit_limit,due_days:customerDraft.due_days||"0"}:{})},"Customer ditambahkan.","KASIR");if(result){setCustomerId(result.id);setDueDate(credit?defaultDueDate(customerDraft.due_days):"");setCustomerDraft({name:"",phone:"",address:"",credit_limit:"0",due_days:"0"});setShowCustomerCreate(false);}};
  const scanWallet=async(index,scan)=>{
    const unit_id=payments[index]?.unit_id;
    if(!unit_id)throw Error("UNIT_REQUIRED");
    const preview=await request("/wallet/preview",{method:"POST",body:{...scan,unit_id}});
    if(!preview)throw Error("WALLET_PREVIEW_FAILED");
    updatePayment(index,{...scan,unit_id,wallet_preview:preview});
  };
  const paymentPayload=p=>p.method==="CASH"?{method:p.method,amount:p.amount,account_id:shift.cash_account_id,tendered:p.tendered||p.amount}:p.method==="DOMPET_SANTRI"?{method:p.method,amount:p.amount,credential_method:p.credential_method,credential:p.credential,unit_id:p.wallet_preview.unit_id}:p.method==="CREDIT"?{method:p.method,amount:p.amount}:{...externalPayment(transferMethod(accounts,p.account_id),p),amount:p.amount,account_id:p.account_id};
  if(!shift)return (
    <ScrollView style={s.flex} contentContainerStyle={s.content}><Card title="Mulai Jualan">
      <Text style={s.muted}>Akun Anda tetap tercatat sebagai kasir. Terminal dan laci dipilih otomatis jika hanya ada satu pilihan yang sah.</Text>
      {setup.missingTerminal&&<Empty title="Terminal belum tersedia" note={setup.canConfigure?"Buat satu terminal di Pengaturan Usaha.":"Minta Owner menyiapkan terminal untuk usaha ini."}/>}
      {terminalChoice.automatic&&<Row label="Terminal" value={context.terminals[0].name}/>}
      {context.terminals.length>1&&<SelectRows title="Pilih terminal" rows={context.terminals} selected={selectedTerminal} label={item=>item.name} onSelect={setTerminal}/>}
      {setup.missingDrawer&&<Empty title="Laci kas belum tersedia" note={setup.canConfigure?"Buat akun berjenis Kas di Pengaturan Usaha.":"Minta Owner menyiapkan akun Kas untuk shift."}/>}
      {drawerChoice.automatic&&<Row label="Laci kas" value={drawers[0].name}/>}
      {drawers.length>1&&<SelectRows title="Pilih laci kas" rows={drawers} selected={selectedDrawer} label={item=>item.name} onSelect={setDrawer}/>}
      {!setup.ready&&setup.canConfigure&&<Button title="Buka Pengaturan Usaha" secondary onPress={()=>navigate("PENGATURAN")}/>}
      {showOpeningCash?<><RupiahField label="Kas awal di laci" value={openingCash} onChangeText={setOpeningCash}/><Button title="Gunakan laci kosong (Rp0)" secondary onPress={()=>{setOpeningCash("0");setShowOpeningCash(false);}}/></>:<><Row label="Kas awal" value={rupiah(openingCash)}/><Button title="Isi / Ubah Kas Awal" secondary onPress={()=>setShowOpeningCash(true)}/></>}
      <Text style={s.muted}>Kas awal adalah uang fisik yang sudah ada di laci sebelum transaksi pertama. Biarkan Rp0 jika laci kosong.</Text>
      <Button title="Mulai Jualan" disabled={!selectedTerminal||!selectedDrawer||!validMoney(openingCash)} disabledHint={!selectedTerminal?"Pilih terminal terlebih dahulu.":!selectedDrawer?"Pilih laci kas terlebih dahulu.":!validMoney(openingCash)?"Kas awal harus berupa Rupiah bulat.":undefined}
        onPress={()=>submit("/shifts/open",{terminal_id:selectedTerminal,cash_account_id:selectedDrawer,opening_cash:openingCash},"Shift dibuka.","KASIR")}/>
    </Card></ScrollView>
  );
  if(receipt)return <ScrollView style={s.flex} contentContainerStyle={s.content}><Receipt value={receipt} onDone={()=>{setReceipt(null);setStep("PRODUCTS");}}/></ScrollView>;
  const invalid=!validMoney(discount)||total<=0n||paymentTotal!==total||effectivePayments.some(p=>!validMoney(p.amount)||moneyValue(p.amount)<=0n||p.method==="CASH"&&p.tendered&&(!validMoney(p.tendered)||moneyValue(p.tendered)<moneyValue(p.amount))||p.method==="DOMPET_SANTRI"&&(!p.credential||!p.wallet_preview||BigInt(p.wallet_preview.available_balance)<moneyValue(p.amount))||p.method==="TRANSFER"&&(!transferMethod(accounts,p.account_id)||!p.reference||p.manual_confirmed!==true)||p.method==="CREDIT"&&(!customerId||!dueDate));
  const scannerState=payment=>scannerAvailability(context.units,payment.unit_id);
  const chooseMethod=method=>{setSplit(false);setPayments([blankPayment(method,totalText)]);};
  const submitCurrent=()=>submitSale({request_id:Crypto.randomUUID(),shift_id:shift.id,customer_id:customerId||undefined,due_date:payments.some(p=>p.method==="CREDIT")?dueDate:undefined,discount,discount_reason:discountValue>0n?discountReason:undefined,items:cart.map(i=>({product_id:i.id,quantity:i.quantity})),payments:effectivePayments.map(paymentPayload)}).then(result=>{if(result){setReceipt(result);setCart([]);setPayments([blankPayment()]);setCustomerId("");setDueDate("");setDiscount("0");setDiscountReason("");setSplit(false);setStep("PRODUCTS");}});
  const paymentLabel=payment=>payment.method==="CASH"?"Tunai":payment.method==="TRANSFER"?`Transfer${transferMethod(accounts,payment.account_id)?` (${transferMethod(accounts,payment.account_id)})`:""}`:payment.method==="DOMPET_SANTRI"?"Dompet Santri":"Piutang";
  return <View style={s.flex}>
    <ScrollView style={s.flex} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Kasir</Text><Text style={s.muted}>{step==="PRODUCTS"?"Pilih produk":step==="CART"?"Periksa keranjang":step==="PAYMENT"?"Pilih pembayaran":"Konfirmasi transaksi"}</Text></View><Badge label={`${itemCount} ITEM`}/></View>
      <View style={s.flowSteps}>{[["PRODUCTS","1 Produk"],["CART","2 Keranjang"],["PAYMENT","3 Bayar"],["CONFIRM","4 Konfirmasi"]].map(([id,label])=><Text key={id} style={[s.flowStep,step===id&&s.flowStepActive]}>{label}</Text>)}</View>
      {pendingSale&&<Card title="Status transaksi belum pasti"><Text style={s.muted}>Permintaan tersimpan aman. Jangan buat transaksi baru; kirim ulang request yang sama agar server mengembalikan hasil asli.</Text><Button title="Periksa / Ulangi Transaksi" onPress={()=>submitSale(null)}/></Card>}
      {step==="PRODUCTS"&&<><Card><Field label="Cari nama, SKU, atau barcode" value={search} onChangeText={setSearch}/>{categories.length>0&&<Choice options={[["","Semua"],...categories.map(value=>[value,value])]} value={category} onChange={setCategory}/>}</Card><Text style={s.heading}>Produk Tersedia</Text><List rows={products} emptyNote="Tidak ada produk tersedia sesuai pencarian." render={product=><Pressable style={s.choice} disabled={!!pendingSale} onPress={()=>add(product)}><View style={s.flex}><Text style={s.heading}>{product.name}</Text><Text style={s.muted}>{product.category||"Tanpa kategori"} · Stok {product.available??product.on_hand}</Text></View><Text style={s.price}>{rupiah(product.selling_price)}</Text><Icon name="plus-circle" size={18}/></Pressable>}/></>}
      {step==="CART"&&<><Card title="Keranjang">{cart.map(item=><View key={item.id} style={s.cartItem}><Row label={item.name} value={rupiah(BigInt(item.selling_price)*BigInt(item.quantity))}/><View style={s.row}><Chip label="−" onPress={()=>quantity(item.id,-1)}/><Text style={s.text}>{item.quantity}</Text><Chip label="+" onPress={()=>quantity(item.id,1)}/><Chip label="Hapus" onPress={()=>quantity(item.id,-item.quantity)}/></View></View>)}{can("SALE_DISCOUNT")&&<><RupiahField label="Diskon" value={discount} onChangeText={setDiscount}/>{discountValue>0n&&<Field label="Alasan diskon" value={discountReason} onChangeText={setDiscountReason}/>}</>}<Row label="Subtotal" value={rupiah(subtotal)}/><Money value={rupiah(total)}/></Card><Card title="Customer (opsional)"><Text style={s.muted}>Transaksi tunai, transfer, dan Dompet dapat dilanjutkan tanpa customer. Customer wajib untuk penjualan utang.</Text><Field label="Cari nama atau nomor HP" value={customerSearch} onChangeText={setCustomerSearch}/><SelectRows title="Hasil customer" rows={visibleCustomers} selected={customerId} label={x=>`${x.name}${x.phone?` · ${x.phone}`:""}`} onSelect={selectCustomer}/>{selectedCustomer&&<><Row label="Customer dipilih" value={selectedCustomer.name}/>{can("CUSTOMER_CREDIT_VIEW")&&<Row label="Piutang berjalan" value={rupiah(selectedCustomer.outstanding||0)}/>}<Button title="Tanpa Customer" secondary onPress={()=>{setCustomerId("");setDueDate("");}}/>{can("AR_VIEW")&&<Button title="Lihat Piutang & Pelunasan" secondary onPress={()=>navigate("PIUTANG")}/>}</>}{can("CUSTOMER_MANAGE")&&<Button title={showCustomerCreate?"Batal tambah customer":"Tambah Customer Baru"} secondary onPress={()=>setShowCustomerCreate(value=>!value)}/>} {showCustomerCreate&&can("CUSTOMER_MANAGE")&&<View><Field label="Nama customer" value={customerDraft.name} onChangeText={name=>setCustomerDraft({...customerDraft,name})}/><Field label="Nomor HP" value={customerDraft.phone} onChangeText={phone=>setCustomerDraft({...customerDraft,phone})}/><Field label="Alamat (opsional)" value={customerDraft.address} onChangeText={address=>setCustomerDraft({...customerDraft,address})}/>{can("CUSTOMER_CREDIT_MANAGE")&&<><RupiahField label="Limit utang (0 = tidak aktif)" value={customerDraft.credit_limit} onChangeText={credit_limit=>setCustomerDraft({...customerDraft,credit_limit})}/><Field label="Termin hari" numeric value={customerDraft.due_days} onChangeText={due_days=>setCustomerDraft({...customerDraft,due_days})}/></>}<Button title="Simpan & Pilih Customer" disabled={!customerDraft.name.trim()} onPress={createCustomer}/></View>}</Card><Card><Button title="Lanjut ke Pembayaran" disabled={!cart.length||total<=0n||discountValue>0n&&!discountReason} disabledHint={!cart.length?"Tambahkan minimal satu produk.":total<=0n?"Total harus lebih dari Rp0.":discountValue>0n&&!discountReason?"Alasan diskon wajib diisi.":undefined} onPress={()=>setStep("PAYMENT")}/><Button title="Tambah Produk" secondary onPress={()=>setStep("PRODUCTS")}/></Card></>}
      {step==="PAYMENT"&&<><Card title="Pilih metode utama"><Text style={s.muted}>Untuk pembayaran normal, nominal otomatis sama dengan total {rupiah(total)}.</Text><Choice options={[["CASH","Tunai"],["TRANSFER","Transfer"],["DOMPET_SANTRI","Dompet Santri"]]} value={!split?payments[0]?.method:""} onChange={chooseMethod}/><Button title="Catat sebagai Utang" secondary disabled={!creditState.enabled} disabledHint={creditState.reason} onPress={()=>chooseMethod("CREDIT")}/><Button title={split?"Batalkan Split Payment":"Gunakan Split Payment (lanjutan)"} secondary onPress={()=>{if(split){setSplit(false);setPayments([blankPayment("CASH",totalText)]);}else setSplit(true);}}/></Card>{payments.map((payment,index)=>{const availability=scannerState(payment),change=payment.method==="CASH"?cashChange(payment.tendered||payment.amount,payment.amount):null;return <Card key={index} title={split?`Pembayaran ${index+1}`:paymentLabel(payment)}>{split&&<Choice options={methods.filter(method=>!payments.some((row,i)=>i!==index&&row.method===method)).map(method=>[method,method==="CASH"?"Tunai":method==="TRANSFER"?"Transfer":method==="DOMPET_SANTRI"?"Dompet Santri":"Piutang"])} value={payment.method} onChange={method=>updatePayment(index,blankPayment(method,""))}/>} {split&&<RupiahField label="Nominal" value={payment.amount} onChangeText={amount=>updatePayment(index,{amount})}/>} {!split&&<Row label="Nominal" value={rupiah(payment.amount)}/>} {payment.method==="CASH"&&<><RupiahField label="Uang diterima (kosong = uang pas)" value={payment.tendered} onChangeText={tendered=>updatePayment(index,{tendered})}/>{change!==null&&<Row label="Kembalian" value={rupiah(change)}/>}</>} {payment.method==="TRANSFER"&&<><Text style={s.muted}>Pilih rekening bank atau QRIS tujuan. Jenis akun tetap dikirim sebagai BANK/QRIS agar pembukuan dan laporan tidak tercampur.</Text><SelectRows title="Akun penerimaan" rows={accounts.filter(account=>["BANK","QRIS"].includes(account.kind))} selected={payment.account_id} label={account=>`${account.name} · ${account.kind}`} onSelect={account_id=>updatePayment(index,{account_id,reference:"",manual_confirmed:false})}/><Field label="Referensi bukti terverifikasi" value={payment.reference} onChangeText={reference=>updatePayment(index,{reference,manual_confirmed:false})}/><Choice options={[[false,"Belum diverifikasi"],[true,"Sudah diverifikasi manual"]]} value={payment.manual_confirmed===true} onChange={manual_confirmed=>updatePayment(index,{manual_confirmed})}/></>} {payment.method==="DOMPET_SANTRI"&&<><SelectRows title="Unit santri" rows={context.units} selected={payment.unit_id} label={unit=>unit.nama_unit||unit.unit_name||unit.name} onSelect={unit_id=>updatePayment(index,{unit_id,credential:"",credential_method:"",wallet_preview:null})}/><WalletCredentialScanner disabled={!availability.enabled} disabledReason={availability.reason} onScan={scan=>scanWallet(index,scan)}/>{payment.wallet_preview&&<Card title="Dompet terverifikasi"><Row label="Santri" value={payment.wallet_preview.name}/><Row label="Unit" value={(context.units.find(unit=>String(unit.unit_id??unit.id)===String(payment.wallet_preview.unit_id))||{}).nama_unit||"Unit terverifikasi"}/><Row label="Saldo tersedia" value={rupiah(payment.wallet_preview.available_balance)}/><Badge label={payment.credential_method==="RFID"?"NFC / RFID":"BARCODE"} tone="green"/><Text style={s.muted}>Periksa identitas dan saldo sebelum melanjutkan. Credential mentah tidak ditampilkan.</Text><Button title="Batalkan credential" secondary onPress={()=>updatePayment(index,{credential:"",credential_method:"",wallet_preview:null})}/></Card>}</>} {payment.method==="CREDIT"&&<><Row label="Customer" value={selectedCustomer?.name||"Belum dipilih"}/><Row label="Nominal piutang" value={rupiah(payment.amount)}/><Field label="Jatuh tempo YYYY-MM-DD" value={dueDate} onChangeText={setDueDate}/><Text style={s.muted}>Piutang dicatat pada invoice customer. Kas/bank tidak bertambah sebelum cicilan benar-benar diterima.</Text></>} {split&&payments.length>1&&<Button title="Hapus Pembayaran" secondary onPress={()=>setPayments(rows=>rows.filter((_,i)=>i!==index))}/>}</Card>})}{split&&payments.length<4&&methods.some(method=>!payments.some(payment=>payment.method===method))&&<Button title="Tambah Metode Pembayaran" secondary onPress={()=>setPayments(rows=>[...rows,blankPayment(methods.find(method=>!rows.some(payment=>payment.method===method)),"")])}/>}<Card><Row label="Total tagihan" value={rupiah(total)}/><Row label="Total pembayaran" value={rupiah(paymentTotal)}/><Button title="Tinjau & Konfirmasi" disabled={!!pendingSale||invalid} disabledHint={pendingSale?"Selesaikan transaksi tertunda terlebih dahulu.":paymentTotal!==total?"Total pembayaran harus sama dengan total tagihan.":invalid?"Lengkapi dan verifikasi metode pembayaran.":undefined} onPress={()=>setStep("CONFIRM")}/><Button title="Kembali ke Keranjang" secondary onPress={()=>setStep("CART")}/></Card></>}
      {step==="CONFIRM"&&<Card title="Konfirmasi Penjualan"><Text style={s.muted}>Pastikan produk, pembayaran, dan identitas Dompet sudah benar. Penjualan hanya dikirim satu kali setelah tombol di bawah ditekan.</Text>{selectedCustomer&&<Row label="Customer" value={selectedCustomer.name}/>} {cart.map(item=><Row key={item.id} label={`${item.quantity} × ${item.name}`} value={rupiah(BigInt(item.selling_price)*BigInt(item.quantity))}/>)}{discountValue>0n&&<Row label="Diskon" value={`− ${rupiah(discountValue)}`}/>}<Money label="Total" value={rupiah(total)}/>{effectivePayments.map((payment,index)=><Row key={index} label={paymentLabel(payment)} value={rupiah(payment.amount)}/>) }{effectivePayments.some(payment=>payment.method==="CREDIT")&&<Row label="Jatuh tempo piutang" value={dueDate}/>}<Button title="Konfirmasi & Simpan" disabled={!!pendingSale||invalid} disabledHint={pendingSale?"Selesaikan transaksi tertunda terlebih dahulu.":invalid?"Data pembayaran berubah. Kembali dan periksa lagi.":undefined} onPress={submitCurrent}/><Button title="Ubah Pembayaran" secondary onPress={()=>setStep("PAYMENT")}/></Card>}
    </ScrollView>
    {step==="PRODUCTS"&&<View style={s.cartBar}><View style={s.row}><View><Text style={s.muted}>{itemCount} item di keranjang</Text><Text style={s.heading}>{rupiah(total)}</Text></View><Button title="Buka Keranjang" icon="shopping-bag" disabled={!cart.length||!!pendingSale} disabledHint={!cart.length?"Pilih produk terlebih dahulu.":undefined} onPress={()=>setStep("CART")}/></View></View>}
  </View>;
}
function Transactions({ data, can, submit, request }) {
  const [source,setSource]=useState(null),[receipt,setReceipt]=useState(null),[form,setForm]=useState({product_id:"",quantity:"1",reason:"",shift_id:""});
  const choose=async row=>{setSource(row);setReceipt(await request(`/sales/${row.id}`));};
  const labels={SALE:"Penjualan",SALE_RETURN:"Retur Penjualan",PURCHASE:"Pembelian",PURCHASE_RETURN:"Retur Pembelian"};
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Transaksi</Text><Text style={s.muted}>Riwayat terbaru yang dapat Anda akses.</Text></View></View><List rows={data.sales} render={row=><Pressable onPress={()=>choose(row)}><Row label={labels[row.kind]||"Transaksi"} value={rupiah(row.total)}/><Row label={row.customer||row.cashier||"Customer umum"} value={new Date(row.created_at).toLocaleString("id-ID")}/><Badge label={row.channel==="ONLINE"?"Online":"Kasir"}/></Pressable>}/>
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
  return <>{open&&<Card title="Shift Aktif"><Row label="Dibuka" value={new Date(open.opened_at).toLocaleString("id-ID")}/><RupiahField label="Kas fisik aktual" value={actual} onChangeText={setActual}/><Button title="Tutup Shift" danger disabled={!actual} disabledHint={!actual?"Hitung dan masukkan kas fisik aktual.":undefined} onPress={()=>submit("/shifts/close",{shift_id:open.id,actual_cash:actual},"Shift ditutup.","SHIFT")}/></Card>}<List rows={data.shifts} render={r=><><Row label={r.cashier} value={r.status}/><Row label={r.terminal} value={rupiah(r.difference||0)}/></>}/></>;
}
function Products({ data, can, submit, uploadProductAsset, navigate }) {
  const empty={sku:"",barcode:"",name:"",category:"",uom:"pcs",image_url:"",selling_price:"",reference_purchase_price:"",minimum_stock:"0",active:true,sellable:true,online_visible:false};
  const [form,setForm]=useState(empty),[editing,setEditing]=useState(null),[showForm,setShowForm]=useState(false),[selected,setSelected]=useState(null),[search,setSearch]=useState(""),[category,setCategory]=useState(""),[stock,setStock]=useState(""),[imageBusy,setImageBusy]=useState(false);
  const categories=[...new Set((data.products||[]).map(p=>p.category).filter(Boolean))];
  const rows=filterProducts(data.products||[],{query:search,category,stock});
  const closeForm=()=>{setEditing(null);setShowForm(false);setForm(empty);};
  const edit=p=>{setSelected(null);setEditing(p.id);setShowForm(true);setForm({...empty,...p,selling_price:String(p.selling_price),reference_purchase_price:String(p.reference_purchase_price||""),minimum_stock:String(p.minimum_stock)});};
  const save=()=>submit(editing?`/products/${editing}`:"/products",form,editing?"Produk diperbarui.":"Produk ditambahkan.","PRODUK").then(result=>{if(result)closeForm();});
  const chooseImage=async camera=>{setImageBusy(true);try{if(camera){const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted){Alert.alert("Izin diperlukan","Izinkan kamera untuk mengambil foto produk.");return;}}const picked=camera?await ImagePicker.launchCameraAsync({mediaTypes:["images"],quality:.8}):await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:.8});if(picked.canceled)return;const resized=await ImageManipulator.manipulateAsync(picked.assets[0].uri,[{resize:{width:1600}}],{compress:.75,format:ImageManipulator.SaveFormat.JPEG});const uploaded=await uploadProductAsset({...resized,fileName:"product.jpg",mimeType:"image/jpeg"});if(uploaded?.url)setForm(current=>({...current,image_url:uploaded.url}));}finally{setImageBusy(false);}};
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Produk</Text><Text style={s.muted}>{rows.length} produk sesuai filter</Text></View>{can("PRODUCT_MANAGE")&&!showForm&&<Pressable style={s.inlineAction} onPress={()=>{setSelected(null);setShowForm(true);}}><Icon name="plus" size={14}/><Text style={s.inlineActionText}>Tambah Produk</Text></Pressable>}</View><Card><Field label="Cari nama, SKU, atau barcode" value={search} onChangeText={setSearch}/><Text style={s.label}>Kategori</Text><Choice options={[["","Semua"],...categories.map(x=>[x,x])]} value={category} onChange={setCategory}/><Text style={s.label}>Status stok</Text><Choice options={[["","Semua"],["AVAILABLE","Tersedia"],["LOW","Menipis"],["OUT","Habis"]]} value={stock} onChange={setStock}/></Card>{showForm&&can("PRODUCT_MANAGE")&&<Card title={editing?"Edit Produk":"Tambah Produk"}><Text style={s.muted}>Produk baru belum memiliki stok. Setelah disimpan, masukkan barang lewat Pembelian atau Posisi Awal Usaha.</Text><Fields value={form} setValue={setForm} fields={[["sku","SKU"],["barcode","Barcode"],["name","Nama produk"],["category","Kategori"],["uom","Satuan"]]}/><Text style={s.muted}>Foto diunggah melalui layanan asset server; credential upload tidak berada di aplikasi.</Text>{form.image_url?<><Artwork url={form.image_url}/><Button title="Hapus Foto" secondary onPress={()=>setForm({...form,image_url:""})}/></>:null}<View style={s.actionRow}><Button title={imageBusy?"Memproses…":"Pilih dari Galeri"} secondary disabled={imageBusy} onPress={()=>chooseImage(false)}/><Button title="Ambil Foto" secondary disabled={imageBusy} onPress={()=>chooseImage(true)}/></View><RupiahField label="Harga jual" value={form.selling_price} onChangeText={selling_price=>setForm({...form,selling_price})}/><RupiahField label="Harga beli referensi (opsional)" value={form.reference_purchase_price} onChangeText={reference_purchase_price=>setForm({...form,reference_purchase_price})}/><Text style={s.muted}>Harga referensi hanya membantu input. Nilai stok dan harga pokok tetap berasal dari pembelian atau posisi awal yang diposting.</Text><Field label="Batas stok menipis" numeric value={String(form.minimum_stock)} onChangeText={minimum_stock=>setForm({...form,minimum_stock})}/><Choice options={[[true,"Aktif"],[false,"Nonaktif"]]} value={form.active} onChange={active=>setForm({...form,active})}/><Choice options={[[true,"Bisa dijual"],[false,"Belum bisa dijual"]]} value={form.sellable} onChange={sellable=>setForm({...form,sellable})}/><Button title={editing?"Simpan Perubahan":"Simpan Produk"} disabled={!form.name||!form.selling_price||!editing&&!form.sku} onPress={save}/><Button title="Batal" secondary onPress={closeForm}/></Card>}<List rows={rows} emptyNote={data.products?.length?"Tidak ada produk yang cocok dengan pencarian atau filter.":"Belum ada produk. Gunakan Tambah Produk untuk membuat produk pertama."} render={p=><Pressable onPress={()=>setSelected(p)}><View style={s.userRow}><Artwork url={p.image_url} compact/><View style={s.flex}><View style={s.row}><Text style={s.heading}>{p.name}</Text><Text style={s.price}>{rupiah(p.selling_price)}</Text></View><Text style={s.muted} numberOfLines={1}>{p.sku||"Tanpa SKU"} · {p.category||"Tanpa kategori"} · Stok tersedia {p.available??p.on_hand??0}</Text><View style={s.actionRow}><Badge label={stockStatus(p)==="OUT"?"HABIS":stockStatus(p)==="LOW"?"MENIPIS":"TERSEDIA"} tone={stockStatus(p)==="OUT"?"red":stockStatus(p)==="LOW"?"amber":"green"}/><Badge label={p.active?"AKTIF":"NONAKTIF"} tone={p.active?"green":"red"}/></View></View><Icon name="chevron-right" size={16}/></View></Pressable>}/>{selected&&<Card title="Detail Produk"><Row label="Produk" value={selected.name}/><Row label="Harga jual" value={rupiah(selected.selling_price)}/><Row label="Stok tersedia" value={String(selected.available??selected.on_hand??0)}/><Row label="Satuan" value={selected.uom||"pcs"}/>{can("PRODUCT_COST_VIEW")&&<Row label="Harga beli referensi" value={selected.reference_purchase_price?rupiah(selected.reference_purchase_price):"Belum diisi"}/>}<Text style={s.muted}>{Number(selected.available??selected.on_hand??0)>0?"Produk siap dijual selama statusnya aktif.":"Produk belum dapat dijual karena stok tersedia habis."}</Text>{can("PRODUCT_MANAGE")&&<Button title="Edit Produk" secondary onPress={()=>edit(selected)}/>} {can("PURCHASE_CREATE")&&<Button title="Tambah Stok lewat Pembelian" onPress={()=>navigate("PEMBELIAN")}/>} {can("INVENTORY_VIEW")&&<Button title="Lihat Riwayat Stok" secondary onPress={()=>navigate("STOK")}/>}<Button title="Tutup" secondary onPress={()=>setSelected(null)}/></Card>}</>;
}
function Inventory({ data, can, submit, navigate }) {
  const [section,setSection]=useState("STOCK"),[mode,setMode]=useState("ADJUST"),[search,setSearch]=useState(""),[form,setForm]=useState({product_id:"",direction:"IN",quantity:"",actual_stock:"",reason:"",unit_cost:""}),inv=data.inventory||{};
  const requestId=useRef(Crypto.randomUUID());
  const selected=inv.products?.find(p=>p.id===form.product_id);
  const rows=(inv.products||[]).filter(p=>!search||`${p.name} ${p.sku||""}`.toLowerCase().includes(search.toLowerCase()));
  const payload=()=>{if(mode!=="OPNAME")return {...form,reason:form.reason,request_id:requestId.current,unit_cost:form.unit_cost||"0"};const delta=BigInt(form.actual_stock||0)-BigInt(selected?.on_hand||0);return {product_id:form.product_id,direction:delta>=0n?"IN":"OUT",quantity:(delta>=0n?delta:-delta).toString(),reason:`OPNAME: ${form.reason}`,unit_cost:form.unit_cost||"0",request_id:requestId.current};};
  const quantity=mode==="OPNAME"?form.actual_stock:form.quantity;
  const save=()=>submit("/stock-adjustments",payload(),mode==="OPNAME"?"Stok opname direkonsiliasi.":"Penyesuaian stok tersimpan.","STOK").then(result=>{if(result){requestId.current=Crypto.randomUUID();setForm({product_id:"",direction:"IN",quantity:"",actual_stock:"",reason:"",unit_cost:""});setSection("STOCK");}});
  const movementLabel={PURCHASE_IN:"Barang masuk · Pembelian",PURCHASE_RETURN_OUT:"Barang keluar · Retur pembelian",SALE_OUT:"Barang keluar · Penjualan",SALE_RETURN_IN:"Barang masuk · Retur penjualan",ADJUSTMENT_IN:"Penyesuaian masuk",ADJUSTMENT_OUT:"Penyesuaian keluar",DAMAGE:"Rusak / Hilang"};
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Stok</Text><Text style={s.muted}>Persediaan, barang masuk, dan riwayat pergerakan.</Text></View></View><Choice options={[["STOCK","Daftar Stok"],["OPENING","Stok Awal"],["ADJUST","Penyesuaian"],["HISTORY","Riwayat"]]} value={section} onChange={setSection}/>{section==="STOCK"&&<><Card><Field label="Cari nama atau SKU produk" value={search} onChangeText={setSearch}/>{can("PURCHASE_VIEW")?<Button title="Barang Masuk dari Pembelian" onPress={()=>navigate("PEMBELIAN")}/>:<Text style={s.muted}>Akun ini tidak memiliki akses Pembelian Barang. Minta Owner bila perlu mencatat barang masuk.</Text>}</Card><List rows={rows} emptyNote="Belum ada produk. Tambahkan produk terlebih dahulu." render={p=><Pressable onPress={()=>setForm(x=>({...x,product_id:p.id}))}><Row label={p.name} value={`${p.available} tersedia`}/><Row label="Stok tercatat" value={p.on_hand}/>{BigInt(p.reserved||0)>0n&&<Row label="Dipesan online" value={p.reserved}/>}<Row label="Batas menipis" value={p.minimum_stock}/><Badge label={stockStatus(p)==="OUT"?"HABIS":stockStatus(p)==="LOW"?"MENIPIS":"TERSEDIA"} tone={stockStatus(p)==="OUT"?"red":stockStatus(p)==="LOW"?"amber":"green"}/></Pressable>}/></>}{section==="OPENING"&&<Card title="Stok Awal Usaha"><Text style={s.muted}>Gunakan ini hanya untuk persediaan yang sudah ada sebelum mulai memakai Suq Shogir. Stok awal bukan pembelian supplier dan tidak membuat utang.</Text><Text style={s.muted}>Posisi awal difinalisasi sekali bersama kas, bank, piutang, utang, dan ekuitas agar pembukuan tetap seimbang.</Text>{can("BUSINESS_SETTINGS_VIEW")?<Button title="Buka Posisi Awal Usaha" onPress={()=>navigate("PENGATURAN")}/>:<Text style={s.muted}>Hanya Owner atau akun berizin Pengaturan Usaha yang dapat membuka posisi awal.</Text>}</Card>}{section==="ADJUST"&&<>{can("INVENTORY_ADJUST")?<Card title="Penyesuaian Stok"><Text style={s.muted}>Gunakan untuk hasil hitung fisik, barang rusak, atau kehilangan. Pembelian normal harus dicatat melalui Pembelian Barang.</Text><Choice options={[["ADJUST","Tambah / Kurangi"],...(can("INVENTORY_OPNAME")?[["OPNAME","Stok Opname"]]:[])]} value={mode} onChange={next=>{setMode(next);setForm(value=>({...value,direction:"IN"}));}}/><SelectRows title="Produk" rows={inv.products} selected={form.product_id} label={x=>x.name} onSelect={product_id=>setForm({...form,product_id})}/>{selected&&<Row label="Stok tercatat saat ini" value={selected.on_hand}/>} {mode==="OPNAME"?<><Field label="Hasil hitung fisik" numeric value={form.actual_stock} onChangeText={actual_stock=>setForm({...form,actual_stock})}/><Field label="Alasan selisih" value={form.reason} onChangeText={reason=>setForm({...form,reason})}/>{selected&&validMoney(form.actual_stock)&&BigInt(form.actual_stock)>BigInt(selected.on_hand||0)&&<RupiahField label="Biaya per unit untuk selisih masuk" value={form.unit_cost} onChangeText={unit_cost=>setForm({...form,unit_cost})}/>}</>:<><Choice options={[["IN","Tambah stok"],["OUT","Kurangi stok"],["DAMAGE","Rusak / Hilang"]]} value={form.direction} onChange={direction=>setForm({...form,direction})}/><Field label="Jumlah" numeric value={form.quantity} onChangeText={quantityValue=>setForm({...form,quantity:quantityValue})}/><Field label="Alasan wajib" value={form.reason} onChangeText={reason=>setForm({...form,reason})}/>{form.direction==="IN"&&<RupiahField label="Biaya per unit" value={form.unit_cost} onChangeText={unit_cost=>setForm({...form,unit_cost})}/>}</>}<Button title={mode==="OPNAME"?"Simpan Hasil Stok Opname":"Simpan Penyesuaian"} disabled={!form.product_id||!quantity||!form.reason||mode==="OPNAME"&&selected&&BigInt(form.actual_stock||0)===BigInt(selected.on_hand||0)||mode!=="OPNAME"&&form.direction==="IN"&&!validMoney(form.unit_cost)} onPress={save}/></Card>:<Empty title="Tidak memiliki izin penyesuaian" note="Minta Owner mengatur akses stok untuk akun Anda."/>}</>}{section==="HISTORY"&&<><Card title="Riwayat Stok"><Text style={s.muted}>Setiap perubahan tercatat berdasarkan pembelian, penjualan, retur, atau penyesuaian. Riwayat tidak dapat diedit dari layar ini.</Text></Card><List rows={inv.movements} emptyNote="Belum ada pergerakan stok." render={m=><><Row label={m.name} value={`${BigInt(m.quantity)>0n?"+":""}${m.quantity}`}/><Row label={movementLabel[m.kind]||m.kind} value={new Date(m.created_at).toLocaleString("id-ID")}/>{m.reason&&<Text style={s.muted}>{m.reason}</Text>}{m.cost!=null&&can("PRODUCT_COST_VIEW")&&<Row label="Nilai persediaan" value={rupiah(m.cost)}/>}</>}/></>}</>;
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
  const empty={supplier_id:"",account_id:"",paid:"0",due_date:"",reference:"",lines:[]};
  const [view,setView]=useState("NEW"),[step,setStep]=useState("SUPPLIER"),[form,setForm]=useState(empty),[paymentMode,setPaymentMode]=useState("DEBT"),[supplierSearch,setSupplierSearch]=useState(""),[showSupplierForm,setShowSupplierForm]=useState(false),[supplierDraft,setSupplierDraft]=useState({name:"",phone:"",address:""}),[selectedProduct,setSelectedProduct]=useState(""),[ret,setRet]=useState({source_id:"",product_id:"",quantity:"1",reason:"",reference:""});
  const requestId=useRef(Crypto.randomUUID());
  const products=data.inventory?.products||[],suppliers=(data.suppliers||[]).filter(item=>!supplierSearch||`${item.name} ${item.phone||""}`.toLowerCase().includes(supplierSearch.toLowerCase())),accounts=data.accounts||data.books?.accounts||[],validLines=form.lines.length>0&&form.lines.every(line=>/^[1-9]\d*$/.test(line.quantity)&&validMoney(line.unit_cost)),total=validLines?BigInt(purchaseTotals(form.lines).total):0n,effectivePaid=["CASH","TRANSFER"].includes(paymentMode)?total:paymentMode==="DEBT"?0n:moneyValue(form.paid),outstanding=total-effectivePaid,allowedAccounts=purchaseAccounts(accounts,paymentMode);
  const addLine=()=>{const product=products.find(item=>item.id===selectedProduct);if(product){setForm(current=>({...current,lines:addPurchaseLine(current.lines,product)}));setSelectedProduct("");}};
  const choosePayment=mode=>{setPaymentMode(mode);setForm(current=>applyPurchasePaymentMode(current,mode,total.toString()));};
  const createSupplier=()=>submit("/parties",{...supplierDraft,kind:"SUPPLIER"},"Supplier ditambahkan.","PEMBELIAN").then(result=>{if(result){setForm(current=>({...current,supplier_id:result.id}));setSupplierDraft({name:"",phone:"",address:""});setShowSupplierForm(false);}});
  const save=()=>{let payload;try{payload=purchasePayload({...form,paid:effectivePaid.toString()},requestId.current);}catch{return Alert.alert("Pembelian belum lengkap","Periksa supplier, produk, jumlah, harga beli, pembayaran, dan jatuh tempo.");}return submit("/purchases",payload,"Pembelian berhasil diposting dan stok telah diperbarui.","PEMBELIAN").then(result=>{if(result){setForm(empty);setPaymentMode("DEBT");setStep("SUPPLIER");requestId.current=Crypto.randomUUID();}});};
  const stepOrder=["SUPPLIER","ITEMS","PAYMENT","CONFIRM"],stepIndex=stepOrder.indexOf(step),selectedSupplier=(data.suppliers||[]).find(item=>item.id===form.supplier_id),selectedAccount=accounts.find(item=>item.id===form.account_id),canContinue=step==="SUPPLIER"?!!form.supplier_id:step==="ITEMS"?validLines&&total>0n:step==="PAYMENT"?effectivePaid<=total&&(effectivePaid===0n||!!form.account_id)&&!(outstanding>0n&&!/^\d{4}-\d{2}-\d{2}$/.test(form.due_date)):true;
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Pembelian Barang</Text><Text style={s.muted}>Catat satu invoice supplier dan tambah stok secara aman.</Text></View></View><Choice options={[["NEW","Pembelian Baru"],["HISTORY","Riwayat"],...(can("PURCHASE_RETURN")?[["RETURN","Retur"]]:[])]} value={view} onChange={setView}/>{view==="NEW"&&can("PURCHASE_CREATE")&&<><View style={s.flowSteps}>{[["SUPPLIER","1 Supplier"],["ITEMS","2 Barang"],["PAYMENT","3 Bayar"],["CONFIRM","4 Konfirmasi"]].map(([id,label])=><Text key={id} style={[s.flowStep,step===id&&s.flowStepActive]}>{label}</Text>)}</View>{step==="SUPPLIER"&&<Card title="Pilih Supplier"><Field label="Cari nama atau telepon supplier" value={supplierSearch} onChangeText={setSupplierSearch}/><SelectRows title="Supplier" rows={suppliers} selected={form.supplier_id} label={x=>x.name} onSelect={supplier_id=>setForm({...form,supplier_id})}/>{!suppliers.length&&<Text style={s.muted}>Supplier belum ditemukan. Tambahkan supplier baru jika Anda memiliki izin.</Text>}{can("SUPPLIER_MANAGE")&&<Button title={showSupplierForm?"Batal Tambah Supplier":"Tambah Supplier Baru"} secondary onPress={()=>setShowSupplierForm(value=>!value)}/>} {showSupplierForm&&can("SUPPLIER_MANAGE")&&<><Fields value={supplierDraft} setValue={setSupplierDraft} fields={[["name","Nama supplier"],["phone","Telepon"],["address","Alamat"]]}/><Button title="Simpan & Pilih Supplier" disabled={!supplierDraft.name.trim()} onPress={createSupplier}/></>}</Card>}{step==="ITEMS"&&<><Card title="Tambah Produk"><Text style={s.muted}>Masukkan jumlah dan harga beli aktual pada invoice ini. Harga referensi hanya membantu pengisian.</Text><SelectRows title="Pilih produk" rows={products.filter(p=>!form.lines.some(line=>line.product_id===p.id))} selected={selectedProduct} label={x=>`${x.name}${x.reference_purchase_price?` · referensi ${rupiah(x.reference_purchase_price)}`:""}`} onSelect={setSelectedProduct}/><Button title="Tambahkan ke Invoice" secondary disabled={!selectedProduct} onPress={addLine}/></Card>{form.lines.map(line=><Card key={line.product_id} title={line.name}><Field label={`Jumlah (${products.find(p=>p.id===line.product_id)?.uom||"unit"})`} numeric value={line.quantity} onChangeText={quantityValue=>setForm(current=>({...current,lines:updatePurchaseLine(current.lines,line.product_id,{quantity:quantityValue})}))}/><RupiahField label="Harga beli aktual per unit" value={line.unit_cost} onChangeText={unit_cost=>setForm(current=>({...current,lines:updatePurchaseLine(current.lines,line.product_id,{unit_cost})}))}/><Row label="Subtotal" value={/^[1-9]\d*$/.test(line.quantity)&&validMoney(line.unit_cost)?rupiah(BigInt(line.quantity)*moneyValue(line.unit_cost)):rupiah(0)}/><Button title="Hapus dari Invoice" secondary onPress={()=>setForm(current=>({...current,lines:removePurchaseLine(current.lines,line.product_id)}))}/></Card>)}<Card><Row label="Total pembelian" value={rupiah(total)}/></Card></>}{step==="PAYMENT"&&<Card title="Cara Pembayaran"><Row label="Total invoice" value={rupiah(total)}/><Choice options={[["CASH","Tunai"],["TRANSFER","Transfer Bank"],["DEBT","Utang Supplier"],["PARTIAL","Bayar Sebagian"]]} value={paymentMode} onChange={choosePayment}/>{["CASH","TRANSFER","PARTIAL"].includes(paymentMode)&&<><SelectRows title={paymentMode==="CASH"?"Pilih kas pembayaran":paymentMode==="TRANSFER"?"Pilih rekening bank":"Pilih kas / bank"} rows={allowedAccounts} selected={form.account_id} label={x=>`${x.name} · ${rupiah(x.balance||0)}`} onSelect={account_id=>setForm({...form,account_id})}/>{!allowedAccounts.length&&<Text style={s.error}>{paymentMode==="CASH"?"Belum ada akun kas aktif.":"Belum ada rekening bank aktif."} Tambahkan melalui Pengaturan Usaha.</Text>}</>}{paymentMode==="PARTIAL"&&<RupiahField label="Nominal dibayar sekarang" value={form.paid} onChangeText={paid=>setForm({...form,paid})}/>}<Row label="Dibayar sekarang" value={rupiah(effectivePaid)}/><Row label="Dicatat sebagai utang" value={rupiah(outstanding>0n?outstanding:0n)}/>{outstanding>0n&&<Field label="Jatuh tempo (YYYY-MM-DD)" value={form.due_date} onChangeText={due_date=>setForm({...form,due_date})}/>}<Field label="Nomor / referensi invoice (opsional)" value={form.reference} onChangeText={reference=>setForm({...form,reference})}/></Card>}{step==="CONFIRM"&&<Card title="Konfirmasi Pembelian"><Text style={s.muted}>Satu invoice, satu posting stok. Pastikan barang, harga, dan sumber pembayaran sudah benar.</Text><Row label="Supplier" value={selectedSupplier?.name}/>{form.lines.map(line=><Row key={line.product_id} label={`${line.quantity} × ${line.name}`} value={rupiah(BigInt(line.quantity)*moneyValue(line.unit_cost))}/>) }<Row label="Total" value={rupiah(total)}/><Row label="Pembayaran" value={paymentMode==="CASH"?"Tunai":paymentMode==="TRANSFER"?"Transfer Bank":paymentMode==="DEBT"?"Utang Supplier":"Bayar Sebagian"}/>{selectedAccount&&<Row label="Sumber dana" value={selectedAccount.name}/>}<Row label="Dibayar" value={rupiah(effectivePaid)}/><Row label="Utang supplier" value={rupiah(outstanding>0n?outstanding:0n)}/><Button title="Posting Pembelian & Tambah Stok" onPress={save}/></Card>}<View style={s.actionRow}>{stepIndex>0&&<Button title="Kembali" secondary onPress={()=>setStep(stepOrder[stepIndex-1])}/>} {stepIndex<stepOrder.length-1&&<Button title="Lanjut" disabled={!canContinue} disabledHint={!canContinue?"Lengkapi data pada tahap ini terlebih dahulu.":undefined} onPress={()=>setStep(stepOrder[stepIndex+1])}/>}</View></>}{view==="NEW"&&!can("PURCHASE_CREATE")&&<Empty title="Tidak memiliki izin pembelian" note="Akun ini hanya dapat melihat pembelian yang sudah ada."/>}{view==="HISTORY"&&<><Card title="Riwayat Pembelian"><Text style={s.muted}>Stok hanya bertambah dari pembelian yang berhasil diposting. Pelunasan utang tidak menambah stok lagi.</Text></Card><List rows={data.purchases} emptyNote="Belum ada pembelian supplier." render={p=><Pressable onPress={()=>p.kind==="PURCHASE"&&setRet(x=>({...x,source_id:p.id}))}><Row label={p.supplier||"Supplier"} value={rupiah(p.total)}/><Row label={p.reference||p.kind} value={p.due_date||new Date(p.created_at).toLocaleDateString("id-ID")}/><Badge label={p.kind==="PURCHASE"?"PEMBELIAN":"RETUR"}/></Pressable>}/></>}{view==="RETURN"&&can("PURCHASE_RETURN")&&<Card title="Retur Pembelian"><Text style={s.muted}>Retur mengurangi stok dan merekonsiliasi utang atau pengembalian dana melalui transaksi canonical.</Text><SelectRows title="Pembelian sumber" rows={(data.purchases||[]).filter(p=>p.kind==="PURCHASE")} selected={ret.source_id} label={x=>`${x.supplier} · ${rupiah(x.total)}`} onSelect={source_id=>setRet({...ret,source_id})}/><SelectRows title="Produk" rows={products} selected={ret.product_id} label={x=>x.name} onSelect={product_id=>setRet({...ret,product_id})}/><Fields value={ret} setValue={setRet} fields={[["quantity","Jumlah",true],["reason","Alasan"],["reference","Referensi pengembalian dana"]]}/><Button danger title="Proses Retur Pembelian" disabled={!ret.source_id||!ret.product_id||!ret.quantity||!ret.reason} onPress={()=>Alert.alert("Konfirmasi retur pembelian","Stok, utang, dan sumber dana direkonsiliasi oleh server.",[{text:"Batal",style:"cancel"},{text:"Lanjut",style:"destructive",onPress:()=>submit("/purchase-returns",{request_id:Crypto.randomUUID(),source_id:ret.source_id,items:[{product_id:ret.product_id,quantity:ret.quantity}],reason:ret.reason,reference:ret.reference||undefined,refund_confirmed:true},"Retur pembelian tersimpan.","PEMBELIAN")}])}/></Card>}</>;
}
function Debts({ data, kind, can, submit }) {
  const [form,setForm]=useState({source_id:"",account_id:"",amount:""}),permission=kind==="AR"?"AR_COLLECT":"AP_PAY";
  const invoices=data.aging?.items||[],selected=invoices.find(item=>item.source_id===form.source_id),amountValue=moneyValue(form.amount);
  return <><Card title={kind==="AR"?"Piutang Customer":"Utang Supplier"}><Money value={rupiah(data.aging?.outstanding||0)}/></Card><List rows={invoices} render={r=><Pressable onPress={()=>setForm(x=>({...x,source_id:r.source_id,amount:""}))}><Row label={r.name} value={rupiah(r.outstanding)}/><Row label={`Invoice ${String(r.source_id).slice(0,8)} · ${r.bucket}`} value={r.due_date}/></Pressable>}/>{can(permission)&&<Card title={kind==="AR"?"Terima Pembayaran":"Bayar Utang"}><SelectRows title="Invoice outstanding" rows={invoices} selected={form.source_id} label={x=>`${x.name} · ${rupiah(x.outstanding)} · ${x.due_date}`} onSelect={source_id=>setForm({...form,source_id,amount:""})}/>{selected&&<><Row label="Sisa invoice" value={rupiah(selected.outstanding)}/><Row label="Jatuh tempo" value={selected.due_date}/></>}<SelectRows title="Akun" rows={data.books?.accounts} selected={form.account_id} label={x=>`${x.name} · ${rupiah(x.balance)}`} onSelect={account_id=>setForm({...form,account_id})}/><RupiahField label="Nominal" value={form.amount} onChangeText={amount=>setForm({...form,amount})}/><Button title="Simpan Pembayaran" disabled={!selected||!form.account_id||!form.amount||amountValue<=0n||amountValue>BigInt(selected?.outstanding||0)} onPress={()=>submit("/debt-payments",{...form,kind,request_id:Crypto.randomUUID()},"Pembayaran utang/piutang tersimpan.",kind==="AR"?"PIUTANG":"UTANG")}/></Card>}</>;
}
function Finance({ data, can, submit }) {
  const [form,setForm]=useState({kind:"EXPENSE",account_id:"",amount:"",reason:""});
  const permitted={EXPENSE:"EXPENSE_CREATE",OTHER_INCOME:"OTHER_INCOME_CREATE",TRANSFER:"TRANSFER_CREATE",CAPITAL:"CAPITAL_MANAGE",WITHDRAWAL:"PRIVE_MANAGE"};
  const kinds=[["EXPENSE","Pengeluaran"],["OTHER_INCOME","Pendapatan lain"],["TRANSFER","Transfer"],["CAPITAL","Modal"],["WITHDRAWAL","Prive"]].filter(([key])=>can(permitted[key]));
  const accounts=data.books?.accounts||[],wallet=accounts.filter(a=>a.kind==="WALLET_CLEARING"),operating=accounts.filter(a=>a.kind!=="WALLET_CLEARING");
  const accountLabels={CASH:"Kas",BANK:"Bank",QRIS:"QRIS",OTHER:"Saldo lain",WALLET_CLEARING:"Dompet Santri — Belum Diselesaikan"};
  const movementLabels={OPENING:"Saldo awal",EXPENSE:"Biaya",OTHER_INCOME:"Pendapatan lain",TRANSFER:"Transfer",CAPITAL:"Modal",WITHDRAWAL:"Prive",SALE:"Penjualan",PURCHASE:"Pembelian"};
  const accountRow=a=><View style={s.financeAccount}><View style={s.financeIcon}><Icon name={a.kind==="CASH"?"inbox":a.kind==="WALLET_CLEARING"?"clock":"credit-card"} size={17}/></View><View style={s.flex}><Text style={s.heading}>{a.name}</Text><Text style={s.muted}>{accountLabels[a.kind]||"Akun usaha"}</Text></View><Text style={s.value}>{rupiah(a.balance)}</Text></View>;
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Keuangan</Text><Text style={s.muted}>Saldo ditampilkan per akun tanpa agregasi yang menyesatkan.</Text></View></View><Text style={s.heading}>Kas & Rekening</Text><List rows={operating} render={accountRow}/>{wallet.length>0&&<><Text style={s.heading}>Dompet Santri — Belum Diselesaikan</Text><Text style={s.muted}>Saldo clearing disajikan terpisah dan bukan kas merchant yang tersedia.</Text><List rows={wallet} render={accountRow}/></>}{data.settlement&&<Card title="Settlement Dompet"><Row label="Penjualan Wallet" value={rupiah(data.settlement.gross_wallet_sales)}/><Row label="Refund" value={rupiah(data.settlement.wallet_refunds)}/><Row label="Sudah dibayar" value={rupiah(data.settlement.payouts)}/><Row label="Belum dibayar" value={rupiah(data.settlement.outstanding)}/>{BigInt(data.settlement.recovery||0)>0n&&<Row label="Recovery / offset" value={rupiah(data.settlement.recovery)}/>}<Text style={s.muted}>Informasi read-only. Settlement disetujui KlikPesantren dan tidak mengubah omzet atau saldo Dompet lagi.</Text></Card>}<Text style={s.heading}>Mutasi Terbaru</Text><List rows={data.activity} render={o=><><Row label={movementLabels[o.kind]||"Mutasi usaha"} value={rupiah(o.total)}/><Row label={o.reason||o.party||"Tanpa keterangan"} value={new Date(o.created_at).toLocaleString("id-ID")}/></>}/>{kinds.length>0&&<Card title="Catat Transaksi"><Choice options={kinds} value={form.kind} onChange={kind=>setForm({...form,kind})}/><SelectRows title="Akun" rows={accounts} selected={form.account_id} label={x=>x.name} onSelect={account_id=>setForm({...form,account_id})}/>{form.kind==="TRANSFER"&&<SelectRows title="Akun tujuan" rows={accounts} selected={form.destination_account_id} label={x=>x.name} onSelect={destination_account_id=>setForm({...form,destination_account_id})}/>}<RupiahField label="Nominal" value={form.amount} onChangeText={amount=>setForm({...form,amount})}/><Field label="Keterangan" value={form.reason} onChangeText={reason=>setForm({...form,reason})}/><Button title="Simpan Mutasi" disabled={!form.account_id||!form.amount||!form.reason||form.kind==="TRANSFER"&&!form.destination_account_id} disabledHint={!form.account_id?"Pilih akun sumber.":!form.amount?"Masukkan nominal Rupiah.":!form.reason?"Keterangan wajib diisi.":form.kind==="TRANSFER"&&!form.destination_account_id?"Pilih akun tujuan.":undefined} onPress={()=>submit("/money",{...form,request_id:Crypto.randomUUID()},"Mutasi tersimpan.","KEUANGAN")}/></Card>}</>;
}
function Reports({ data, context, request }) {
  const sections=[["SALES","Penjualan",context.permissions.includes("REPORT_SALES")],["FINANCE","Keuangan",context.permissions.some(p=>["REPORT_PROFIT","REPORT_FINANCE"].includes(p))],["INVENTORY","Persediaan",context.permissions.includes("REPORT_INVENTORY")]].filter(x=>x[2]).map(([id,label])=>[id,label]);
  const [period,setPeriod]=useState("MONTH"),[section,setSection]=useState(sections[0]?.[0]||"SALES"),[report,setReport]=useState(data.report),[custom,setCustom]=useState({from:"",to:""});
  const load=async value=>{setPeriod(value);const query=value==="CUSTOM"?`from=${custom.from}&to=${custom.to}`:`period=${value}`;const next=await request(`/reports?${query}`);if(next)setReport(next);};
  const k=report?.kpi||{},sales=report?.sales||{},pnl=report?.profit_loss||{},position=report?.financial_position,inventory=report?.inventory;
  const negativeProfit=Number(k.gross_profit||0)<0,negativeOperating=Number(k.operating_result||0)<0;
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Laporan</Text><Text style={s.muted}>Angka berasal dari transaksi, FIFO, utang/piutang, dan settlement canonical.</Text></View></View><Card><Choice options={[["TODAY","Hari Ini"],["MONTH","Bulan Ini"],["YEAR","Tahun Ini"],["CUSTOM","Kustom"]]} value={period} onChange={value=>value==="CUSTOM"?setPeriod(value):load(value)}/>{period==="CUSTOM"&&<><Fields value={custom} setValue={setCustom} fields={[["from","Dari YYYY-MM-DD"],["to","Sampai YYYY-MM-DD"]]}/><Button title="Terapkan" disabled={!custom.from||!custom.to} onPress={()=>load("CUSTOM")}/></>}<Row label={report?.from||"—"} value={report?.to||"—"}/><Choice options={sections} value={section} onChange={setSection}/></Card>
    {section==="SALES"&&<><View style={s.kpiGrid}><KpiTile label="Penjualan Bruto" value={rupiah(k.sales||0)} icon="trending-up"/><KpiTile label="Retur" value={rupiah(k.returns||0)} icon="rotate-ccw"/><KpiTile label="Penjualan Bersih" value={rupiah(k.net_sales||0)} icon="activity"/><KpiTile label="Transaksi" value={String(k.sales_count||0)} icon="file-text"/></View><Card title="Kanal Penjualan"><Row label="Kasir" value={rupiah(k.pos_net_sales||0)}/><Row label="Online" value={rupiah(k.online_net_sales||0)}/><Row label="Rata-rata bruto" value={rupiah(k.average_sale||0)}/></Card><Card title="Metode Pembayaran">{(sales.payment_methods||[]).map(x=><View key={x.method}><Row label={x.method.replaceAll("_"," ")} value={rupiah(x.net_amount)}/><Text style={s.muted}>Bruto {rupiah(x.gross_amount)} · refund {rupiah(x.refunded_amount)}</Text></View>)}</Card><Card title="Produk Terlaris"><List rows={(sales.products||[]).slice(0,20)} render={x=><><Row label={x.name} value={rupiah(x.net_revenue)}/><Text style={s.muted}>{x.net_quantity} unit bersih · {x.category}</Text></>}/></Card><Card title="Kategori"><List rows={sales.categories} render={x=><Row label={x.category} value={rupiah(x.net_revenue)}/>} /><Text style={s.muted}>{sales.category_basis}</Text></Card><Card title="Kasir"><List rows={sales.cashiers} render={x=><><Row label={x.name} value={rupiah(x.net_sales)}/><Text style={s.muted}>{x.transactions} transaksi</Text></>}/></Card></>}
    {section==="FINANCE"&&<><View style={s.kpiGrid}>{context.permissions.includes("REPORT_PROFIT")&&<KpiTile label="Laba Kotor" value={rupiah(k.gross_profit||0)} icon="pie-chart" negative={negativeProfit}/>} {context.permissions.includes("REPORT_FINANCE")&&<KpiTile label="Hasil Operasional" value={rupiah(k.operating_result||0)} icon="activity" negative={negativeOperating}/>}</View>{context.permissions.includes("REPORT_PROFIT")&&<Card title="Laba Rugi Operasional"><Row label="Pendapatan bersih" value={rupiah(pnl.net_revenue||0)}/><Row label="HPP FIFO" value={rupiah(pnl.cogs||0)}/><Row label="Laba kotor" value={rupiah(pnl.gross_profit||0)}/>{pnl.operating_result!=null&&<><Row label="Biaya operasional" value={rupiah(pnl.operating_expenses||0)}/><Row label="Pendapatan operasional lain" value={rupiah(pnl.other_operating_income||0)}/><Row label="Hasil operasional" value={rupiah(pnl.operating_result||0)}/></>}<Text style={s.muted}>{pnl.label}</Text></Card>}{position&&<><Card title="Aset Terpantau"><Row label="Kas, bank & QRIS" value={rupiah(position.physical_account_total)}/><Row label="Persediaan FIFO" value={position.inventory_value==null?"Akses biaya diperlukan":rupiah(position.inventory_value)}/><Row label="Piutang customer" value={rupiah(position.receivables)}/><Row label="Settlement belum dibayar" value={rupiah(position.settlement?.outstanding||0)}/><Row label="Total aset" value={rupiah(position.assets)}/></Card><Card title="Kewajiban & Ekuitas"><Row label="Utang supplier" value={rupiah(position.payables)}/><Row label="Recovery settlement" value={rupiah(position.settlement?.recovery||0)}/><Row label="Ekuitas awal" value={rupiah(position.opening_equity)}/><Row label="Tambahan modal" value={rupiah(position.subsequent_capital)}/><Row label="Prive" value={rupiah(position.withdrawals)}/><Row label="Ekuitas/net aset terpantau" value={rupiah(position.equity_derived)}/><Text style={s.muted}>{position.label}</Text></Card>{!position.complete&&<Card title="Batas Kelengkapan"><Text style={s.muted}>{(position.exclusions||[]).join(" ")}</Text></Card>}<Card title="Saldo per Akun"><List rows={(position.accounts||[]).filter(x=>x.kind!=="WALLET_CLEARING")} render={x=><Row label={`${x.name} · ${x.kind}`} value={rupiah(x.balance)}/>} /></Card></>}</>}
    {section==="INVENTORY"&&inventory&&<><View style={s.kpiGrid}><KpiTile label="Nilai Persediaan" value={inventory.valuation_visible?rupiah(inventory.valuation):"Terbatas"} icon="package"/><KpiTile label="Stok Menipis" value={String(inventory.low_stock||0)} icon="alert-circle"/></View><Card title="Posisi Produk"><List rows={inventory.products} render={x=><><Row label={x.name} value={`${x.available_current} tersedia`}/><Text style={s.muted}>Stok {x.on_hand_as_of} · reservasi {x.reserved_current}{inventory.valuation_visible?` · ${rupiah(x.value_as_of)}`:""}</Text></>}/></Card><Card title="Pergerakan Periode"><List rows={inventory.movements} render={x=><><Row label={x.kind.replaceAll("_"," ")} value={x.quantity}/>{inventory.valuation_visible&&<Text style={s.muted}>Perubahan nilai {rupiah(x.value_change)}</Text>}</>}/></Card></>}
    <Text style={s.muted}>{report?.completeness}</Text></>;
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
  const initial={login:"",name:"",role:"CASHIER",permissions:[...DEFAULTS.CASHIER]};
  const [form,setForm]=useState(initial),[editing,setEditing]=useState(null),[activation,setActivation]=useState(null);
  const toggle=key=>setForm(value=>({...value,permissions:value.permissions.includes(key)?value.permissions.filter(item=>item!==key):[...value.permissions,key]}));
  const save=async()=>{const result=await submit(editing?`/users/${editing}`:"/users",editing?{name:form.name,role:form.role,permissions:form.permissions,active:form.active!==false}:form,editing?"Akses pengguna diperbarui.":"Akun dibuat. Bagikan kode aktivasi secara aman.","PENGGUNA");if(result?.activation_code)setActivation({login:result.login,code:result.activation_code});setEditing(null);setForm(initial);};
  const reissue=id=>Alert.alert("Terbitkan kode aktivasi baru?","Kode sebelumnya dan seluruh sesi akun akan langsung tidak berlaku.",[{text:"Batal",style:"cancel"},{text:"Terbitkan",style:"destructive",onPress:async()=>{const result=await submit(`/users/${id}/reissue-activation`,{},"Kode aktivasi baru diterbitkan.","PENGGUNA");if(result?.activation_code)setActivation({code:result.activation_code});}}]);
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Pengguna & Akses</Text><Text style={s.muted}>Satu akun pribadi untuk setiap anggota tim.</Text></View></View>{activation&&<Card title="Kode aktivasi sekali pakai"><Text style={s.muted}>Bagikan langsung kepada karyawan. Kode tidak disimpan dalam bentuk terbaca dan kedaluwarsa dalam 48 jam.</Text>{activation.login&&<Row label="ID login" value={activation.login}/>}<Text selectable style={s.activationCode}>{activation.code}</Text><Button title="Tutup kode" secondary onPress={()=>setActivation(null)}/></Card>}<List rows={data.users} render={user=><><View style={s.userRow}><View style={s.avatar}><Text style={s.avatarText}>{user.name.slice(0,1).toUpperCase()}</Text></View><View style={s.flex}><Text style={s.heading}>{user.name}</Text><Text style={s.muted}>{user.login} · {ROLE_LABELS[user.role]||"Pengguna"}</Text></View><Badge label={!user.membership_active?"NONAKTIF":user.activation_pending?"MENUNGGU AKTIVASI":"AKTIF"} tone={!user.membership_active?"red":user.activation_pending?"amber":"green"}/></View><Text style={s.muted}>{user.permissions.length} hak akses</Text>{user.role!=="OWNER"&&can("PERMISSION_MANAGE")&&<View style={s.actionRow}><Button title="Edit akses" secondary onPress={()=>{setEditing(user.id);setForm({name:user.name,role:user.role,permissions:user.permissions,active:user.membership_active});}}/><Button title="Reissue aktivasi" secondary onPress={()=>reissue(user.id)}/></View>}</>}/>{can("USER_MANAGE")&&<Card title={editing?"Edit anggota tim":"Tambah karyawan"}>{!editing&&<><Text style={s.muted}>Owner menentukan identitas dan akses. Karyawan membuat password sendiri saat aktivasi.</Text><Field label="ID login unik" value={form.login} onChangeText={login=>setForm({...form,login})}/></>}<Field label="Nama lengkap" value={form.name} onChangeText={name=>setForm({...form,name})}/><Choice options={[["CASHIER","Kasir"],["SUPERVISOR","Supervisor"]]} value={form.role} onChange={role=>setForm({...form,role,permissions:[...DEFAULTS[role]]})}/>{editing&&<Choice options={[["ACTIVE","Aktif"],["INACTIVE","Nonaktif"]]} value={form.active===false?"INACTIVE":"ACTIVE"} onChange={state=>setForm({...form,active:state==="ACTIVE"})}/>}<PermissionEditor selected={form.permissions} onToggle={toggle}/><Button title={editing?"Simpan perubahan":"Buat akun karyawan"} disabled={!form.name||!form.role||!editing&&!form.login} onPress={save}/>{editing&&<Button title="Batal" secondary onPress={()=>{setEditing(null);setForm(initial);}}/>}</Card>}</>;
}
function PermissionEditor({ selected, onToggle }) {
  return <View style={s.listSurface}>{Object.entries(GROUPS).map(([group,items],index)=><View key={group} style={[s.permissionSection,index>0&&s.listRowDivider]}><Text style={[s.eyebrow,{paddingHorizontal:12}]}>{group.replaceAll("_"," ")}</Text>{items.map(([key,label])=><Pressable key={key} style={[s.row,{paddingHorizontal:12,paddingVertical:5}]} onPress={()=>onToggle(key)}><Text style={s.text}>{label}</Text><Icon name={selected.includes(key)?"check-square":"square"}/></Pressable>)}</View>)}</View>;
}
function Settings({ data, context, can, submit }) {
  const store=data.store?.store||{},[form,setForm]=useState({...context.business,...store}),[account,setAccount]=useState({name:"",kind:"CASH"}),[terminalName,setTerminalName]=useState("");
  const terminals=data.terminals||context.terminals||[],drawers=data.drawers||[];
  const saveAccount=async()=>{const result=await submit("/accounts",account,"Akun usaha siap digunakan.","PENGATURAN");if(result)setAccount({name:"",kind:"CASH"});};
  const saveTerminal=async()=>{const result=await submit("/terminals",{name:terminalName},"Terminal usaha siap digunakan.","PENGATURAN");if(result)setTerminalName("");};
  return <><Card title="Profil Usaha"><Row label="Nama" value={context.business.display_name}/><Row label="Timezone" value={context.business.timezone}/><Row label="Kepemilikan" value={context.business.ownership}/><Row label="Mulai pembukuan" value={context.business.accounting_start_date||"Belum ditentukan"}/></Card>{context.role==="OWNER"&&<OpeningInitialization data={data} submit={submit}/>} {can("BUSINESS_SETTINGS_MANAGE")&&<><Card title="Kesiapan Kasir"><Text style={s.muted}>Satu terminal dan satu akun Kas diperlukan untuk membuka shift. Konfigurasi yang sudah ada akan digunakan kembali.</Text><Row label="Terminal aktif" value={String(terminals.length)}/><Row label="Laci kas aktif" value={String(drawers.length)}/>{terminals.map(item=><Badge key={item.id} label={`TERMINAL · ${item.name}`} tone="green"/>)}{drawers.map(item=><Badge key={item.id} label={`KAS · ${item.name}`} tone="green"/>)}</Card><Card title="Tambah Terminal"><Text style={s.muted}>Gunakan nama lokasi yang mudah dikenali, misalnya Kasir Utama. Nama yang sama akan memakai terminal yang sudah ada.</Text><Field label="Nama terminal" value={terminalName} onChangeText={setTerminalName}/><Button title="Tambah Terminal" disabled={!terminalName.trim()} onPress={saveTerminal}/></Card><Card title="Tambah Kas / Rekening"><Choice options={[["CASH","Kas / Laci Kas"],["BANK","Bank"],["QRIS","QRIS"]]} value={account.kind} onChange={kind=>setAccount({...account,kind})}/><Field label="Nama akun" value={account.name} onChangeText={name=>setAccount({...account,name})}/><Button title="Tambah Akun" disabled={!account.name.trim()} onPress={saveAccount}/></Card><Card title="Ubah Profil & Struk"><Text style={s.muted}>Tanggal mulai pembukuan ditetapkan melalui Posisi Awal Usaha dan tidak dapat ditimpa dari profil.</Text><Fields value={form} setValue={setForm} fields={[["display_name","Nama usaha"],["legal_name","Nama legal"],["address","Alamat"],["phone","Kontak"],["receipt_name","Nama di struk"],["receipt_header","Header struk"],["receipt_footer","Footer struk"],["receipt_prefix","Prefix struk"],["timezone","Timezone"]]}/><Button title="Simpan Pengaturan" onPress={()=>submit("/profile",{...form,accounting_start_date:undefined,receipt_logo:false},"Pengaturan usaha tersimpan.","PENGATURAN")}/></Card></>}</>;
}

function OpeningInitialization({ data, submit }) {
  const existing=data.initialization||{},accounts=(data.accounts||[]).filter(x=>["CASH","BANK"].includes(x.kind));
  const [openingDate,setOpeningDate]=useState("");
  const [accountValues,setAccountValues]=useState({}),[stockValues,setStockValues]=useState({}),[arValues,setArValues]=useState({}),[apValues,setApValues]=useState({});
  if(existing.finalized)return <><Card title="Posisi Awal Usaha"><Badge label="SUDAH DIFINALISASI" tone="green"/><Row label="Tanggal mulai" value={existing.initialization?.accounting_start_date}/><Row label="Kas & bank" value={rupiah(existing.initialization?.cash_bank_total||0)}/><Row label="Persediaan" value={rupiah(existing.initialization?.inventory_total||0)}/><Row label="Piutang" value={rupiah(existing.initialization?.receivable_total||0)}/><Row label="Utang" value={rupiah(existing.initialization?.payable_total||0)}/><Row label="Ekuitas awal" value={rupiah(existing.initialization?.opening_equity||0)}/><Text style={s.muted}>Posisi awal asli terkunci sebagai riwayat. Koreksi dilakukan sebagai penyesuaian baru dengan alasan audit, bukan menimpa angka ini.</Text><Row label="Koreksi tercatat" value={String(existing.corrections?.length||0)}/></Card><OpeningCorrection initialization={existing} submit={submit}/></>;
  const setNested=(setter,id,key,value)=>setter(current=>({...current,[id]:{...(current[id]||{}),[key]:value}}));
  const rows=(source,values,kind)=>source.map(item=>kind==="INVENTORY"?{product_id:item.id,quantity:values[item.id]?.quantity||"0",unit_cost:values[item.id]?.unit_cost||"0"}:{party_id:item.id,amount:values[item.id]?.amount||"0",due_date:values[item.id]?.due_date||openingDate}).filter(item=>kind==="INVENTORY"?moneyValue(item.quantity)>0n:moneyValue(item.amount)>0n);
  const accountRows=accounts.map(item=>({account_id:item.id,amount:accountValues[item.id]||"0"})).filter(item=>moneyValue(item.amount)>0n);
  const stockRows=rows(data.products||[],stockValues,"INVENTORY"),receivableRows=rows(data.customers||[],arValues,"RECEIVABLE"),payableRows=rows(data.suppliers||[],apValues,"PAYABLE");
  const cash=accountRows.reduce((sum,x)=>sum+moneyValue(x.amount),0n),inventory=stockRows.reduce((sum,x)=>sum+moneyValue(x.quantity)*moneyValue(x.unit_cost),0n),receivable=receivableRows.reduce((sum,x)=>sum+moneyValue(x.amount),0n),payable=payableRows.reduce((sum,x)=>sum+moneyValue(x.amount),0n),assets=cash+inventory+receivable,equity=assets-payable;
  const invalid=!/^\d{4}-\d{2}-\d{2}$/.test(openingDate)||stockRows.some(x=>!validMoney(x.quantity)||!validMoney(x.unit_cost))||[...receivableRows,...payableRows].some(x=>!/^\d{4}-\d{2}-\d{2}$/.test(x.due_date));
  const finalize=()=>Alert.alert("Finalisasi posisi awal?","Angka ini akan diposting sekali dan tidak dapat ditimpa. Pastikan ringkasan sudah benar.",[{text:"Periksa lagi",style:"cancel"},{text:"Finalisasi",style:"destructive",onPress:()=>submit("/initialization/finalize",{request_id:`opening-${Crypto.randomUUID()}`,accounting_start_date:openingDate,accounts:accountRows,inventory:stockRows,receivables:receivableRows,payables:payableRows,confirmation:"FINALIZE"},"Posisi awal berhasil difinalisasi.","PENGATURAN")}]);
  return <Card title="Posisi Awal Usaha"><Text style={s.muted}>Masukkan kondisi nyata saat mulai memakai Suq Shogir. Ini bukan penjualan atau pembelian historis.</Text><Field label="Tanggal mulai pembukuan (YYYY-MM-DD)" value={openingDate} onChangeText={setOpeningDate}/><Text style={s.heading}>Kas & Bank</Text>{accounts.length?accounts.map(item=><RupiahField key={item.id} label={`${item.name} · saldo awal`} value={accountValues[item.id]||""} onChangeText={value=>setAccountValues(current=>({...current,[item.id]:value}))}/>):<Text style={s.muted}>Buat akun Kas atau Bank terlebih dahulu.</Text>}<Text style={s.heading}>Persediaan Awal</Text>{(data.products||[]).map(item=><View key={item.id}><Text style={s.label}>{item.name}</Text><Field label="Jumlah" numeric value={stockValues[item.id]?.quantity||""} onChangeText={v=>setNested(setStockValues,item.id,"quantity",v)}/><RupiahField label="Biaya per unit" value={stockValues[item.id]?.unit_cost||""} onChangeText={v=>setNested(setStockValues,item.id,"unit_cost",v)}/></View>)}<Text style={s.heading}>Piutang Pelanggan</Text>{(data.customers||[]).map(item=><View key={item.id}><Text style={s.label}>{item.name}</Text><RupiahField label="Nilai piutang" value={arValues[item.id]?.amount||""} onChangeText={v=>setNested(setArValues,item.id,"amount",v)}/><Field label="Jatuh tempo (YYYY-MM-DD)" value={arValues[item.id]?.due_date||""} onChangeText={v=>setNested(setArValues,item.id,"due_date",v)}/></View>)}<Text style={s.heading}>Utang Supplier</Text>{(data.suppliers||[]).map(item=><View key={item.id}><Text style={s.label}>{item.name}</Text><RupiahField label="Nilai utang" value={apValues[item.id]?.amount||""} onChangeText={v=>setNested(setApValues,item.id,"amount",v)}/><Field label="Jatuh tempo (YYYY-MM-DD)" value={apValues[item.id]?.due_date||""} onChangeText={v=>setNested(setApValues,item.id,"due_date",v)}/></View>)}<Text style={s.heading}>Ringkasan Posisi Awal</Text><Row label="Aset (kas + bank + stok + piutang)" value={rupiah(assets)}/><Row label="Kewajiban" value={rupiah(payable)}/><Row label="Ekuitas penyeimbang" value={rupiah(equity)}/><Text style={s.muted}>Aset = Kewajiban + Ekuitas. Ekuitas dihitung otomatis dan bukan pendapatan atau setoran modal fiktif.</Text><Button title="Tinjau & Finalisasi" disabled={invalid||accounts.length===0} onPress={finalize}/></Card>;
}

function OpeningCorrection({ initialization, submit }) {
  const [kind,setKind]=useState("ACCOUNT"),[target,setTarget]=useState(""),[delta,setDelta]=useState(""),[unitCost,setUnitCost]=useState(""),[reason,setReason]=useState("");
  const items=(initialization.items||[]).filter(item=>item.kind===kind),signed=/^-?(0|[1-9]\d*)$/;
  const save=()=>Alert.alert("Catat koreksi posisi awal?","Riwayat awal tidak berubah. Sistem akan menambahkan penyesuaian baru yang dapat diaudit.",[{text:"Batal",style:"cancel"},{text:"Catat Koreksi",style:"destructive",onPress:()=>submit("/initialization/corrections",{request_id:`opening-correction-${Crypto.randomUUID()}`,kind,target_id:target,...(kind==="INVENTORY"?{quantity_delta:delta,unit_cost:unitCost||"0"}:{amount_delta:delta}),reason,confirmation:"CORRECT"},"Koreksi posisi awal tercatat.","PENGATURAN")}]);
  return <Card title="Koreksi Posisi Awal"><Text style={s.muted}>Gunakan hanya untuk memperbaiki angka awal. Nilai minus mengurangi posisi; alasan wajib diisi.</Text><Choice options={[["ACCOUNT","Kas/Bank"],["INVENTORY","Stok"],["RECEIVABLE","Piutang"],["PAYABLE","Utang"]]} value={kind} onChange={value=>{setKind(value);setTarget("");setDelta("");setUnitCost("");}}/><SelectRows title="Pilih data awal" rows={items} selected={target} label={x=>x.name} onSelect={setTarget}/><Field label={kind==="INVENTORY"?"Perubahan jumlah (+/-)":"Perubahan nilai Rupiah (+/-)"} value={delta} onChangeText={setDelta}/>{kind==="INVENTORY"&&<Field label="Biaya per unit (untuk penambahan)" numeric value={unitCost} onChangeText={setUnitCost}/>}<Field label="Alasan koreksi" value={reason} onChangeText={setReason}/><Button title="Tinjau Koreksi" disabled={!target||!signed.test(delta)||delta==="0"||reason.trim().length<3||kind==="INVENTORY"&&BigInt(delta)>0n&&!validMoney(unitCost)} onPress={save}/></Card>;
}
function List({ rows=[], render, emptyNote="Data akan tampil setelah transaksi pertama." }) {
  const PAGE_SIZE=30,signature=`${rows.length}:${rows[0]?.id||""}:${rows.at(-1)?.id||""}`,[pagination,setPagination]=useState({signature,limit:PAGE_SIZE});
  const limit=pagination.signature===signature?pagination.limit:PAGE_SIZE,page=boundedRows(rows,limit);
  return rows?.length ? <><View style={s.listSurface}>{page.visible.map((row,index)=><View key={row.id||index} style={[s.listRow,index>0&&s.listRowDivider]}>{render(row)}</View>)}</View>{page.hasMore&&<View style={s.listFooter}><Text style={s.muted}>Menampilkan {page.visible.length} dari {page.total}</Text><Button title={`Tampilkan ${Math.min(PAGE_SIZE,page.total-page.visible.length)} berikutnya`} secondary onPress={()=>setPagination({signature,limit:limit+PAGE_SIZE})}/></View>}</> : <View style={s.listSurface}><Empty title="Belum ada data" note={emptyNote}/></View>;
}
function Fields({ value, setValue, fields }) {
  return fields.map(([key,label,numeric])=><Field key={key} label={label} numeric={numeric} value={String(value[key]??"")} onChangeText={next=>setValue({...value,[key]:next})}/>);
}
function Choice({ options, value, onChange }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false}>{options.map(([id,label])=><Chip key={id} label={label} active={value===id} onPress={()=>onChange(id)}/>)}</ScrollView>;
}
function SelectRows({ title, rows=[], selected, label, onSelect }) {
  return <View><Text style={s.label}>{title}</Text><ScrollView horizontal showsHorizontalScrollIndicator={false}>{rows.map(row=>{const id=row.id??row.unit_id;return <Chip key={id} label={label(row)} active={String(selected)===String(id)} onPress={()=>onSelect(id)}/>;})}</ScrollView></View>;
}
