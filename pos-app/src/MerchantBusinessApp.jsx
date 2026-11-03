import {AuditPanel,DiagnosticsPanel} from './AuditDiagnostics';
import {CutoffPanel} from './CutoffPanel';
import {FocusedEditor,ProductSearch} from './ProductBrowser';
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, ScrollView, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import Constants from "expo-constants";
import { makeApi } from "./api";
import { FinancialWorkspace, FINANCIAL_MODULES } from "./FinancialWorkspace";
import { PriceLevels, Promotions, CashierPricePicker } from "./PricingScreens";
import { PurchaseInvoiceSheet } from "./PurchaseInvoiceSheet";
import { TakeoverControls, IdentityControls, OpnameApproval, PricingPolicyNote } from './PolicyControls';
import { WalletCredentialScanner } from "./WalletCredentialScanner";
import { Artwork, Badge, Button, Card, Chip, Empty, Field, Icon, Money, Row, RupiahField, colors, s } from "./ui";
import { AppText as Text } from "./typography";
const { appendNativeUpload } = require("./nativeUpload.cjs");
const {loadProductPages}=require('./productPages.cjs');
const {createMutationJournal}=require('./mutationJournal.cjs');
const { createVault } = require("./vault.cjs");
const { GROUPS, DEFAULTS, navigationItems, primaryNavigation, dashboardActions, can } = require("./merchantAccess.cjs");
const { rupiah } = require("./domain.cjs");
const { shiftResourceChoice, cashierSetupState } = require("./merchantBootstrap.cjs");
const { addPurchaseLine, updatePurchaseLine, removePurchaseLine, purchaseTotals, purchasePayload } = require("./purchaseDraft.cjs");
const { purchaseAccounts, applyPurchasePaymentMode } = require("./inventoryUx.cjs");
const { externalPayment } = require("./paymentCredential.cjs");
const { cashChange, scannerAvailability, transferMethod } = require("./cashierFlow.cjs");
const { filterCustomers, defaultDueDate, creditAvailability } = require("./cashierCustomer.cjs");
const { createSaleJournal } = require("./saleJournal.cjs");
const { authorityKey, boundedRows, createModuleDataCache } = require("./moduleDataCache.cjs");
const { receiptPresentation } = require("./receiptPresentation.cjs");
const { normalizeDevicePreferences, printerCapability } = require("./receiptOutput.cjs");
const { createReceiptActions, receiptActionError } = require("./receiptFile.cjs");
const { homeLayout } = require("./homeLayout.cjs");
const { pricingInput } = require("./pricingCart.cjs");
const outputReceipt = createReceiptActions({ Print, FileSystem, Sharing, platform: Platform.OS });
const { loadTestingServerAddress, saveTestingServerAddress, verifyTestingServer } = require("./testingServer.cjs");

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
const TESTING_BUILD = Constants.expoConfig.extra.posEnvironment === "development";
const DEFAULT_API_BASE = Constants.expoConfig.extra.apiUrl.replace(/\/$/, "");
const SESSION_INVALID_CODES = new Set(["MERCHANT_SESSION_INVALID", "AUTH_EXPIRED"]);
const shouldDiscardMerchantSession = error => SESSION_INVALID_CODES.has(error?.code);
const LOADERS = {
  "LEVEL HARGA": [["pricing","/pricing"],["products","/products"]],
  "PAKET & PROMO": [["pricing","/pricing"],["products","/products"]],
  BERANDA: [["workspace", "/workspace"], ["report", "/reports?period=MONTH", ["REPORT_SALES","REPORT_PROFIT"]]],
  KASIR: [["pricing", "/pricing", "PRODUCT_VIEW"], ["workspace", "/workspace"], ["products", "/products", "PRODUCT_VIEW"], ["drawers", "/cash-drawers", "SHIFT_OPEN"], ["accounts", "/payment-accounts", "SALE_CREATE"], ["customers", "/parties?kind=CUSTOMER", "CUSTOMER_VIEW"]],
  TRANSAKSI: [["sales", "/sales", "SALE_VIEW"], ["products", "/products", "PRODUCT_VIEW"], ["workspace","/workspace","SALE_REFUND"]],
  SHIFT: [["workspace", "/workspace"], ["shifts", "/shifts", "SHIFT_VIEW_HISTORY"], ["drawers", "/cash-drawers", "SHIFT_OPEN"], ["terminals", "/terminals", "SHIFT_OPEN"]],
  PRODUK: [["products", "/products", "PRODUCT_VIEW"]],
  STOK: [["inventory", "/inventory", "INVENTORY_VIEW"]],
  CUSTOMER: [["customers", "/parties?kind=CUSTOMER", "CUSTOMER_VIEW"], ["metrics", "/customers/metrics", "REPORT_CUSTOMER"]],
  SUPPLIER: [["suppliers", "/parties?kind=SUPPLIER", "SUPPLIER_VIEW"], ["purchases", "/purchases", "PURCHASE_VIEW"]],
  PEMBELIAN: [["purchases", "/purchases", "PURCHASE_VIEW"], ["inventory", "/inventory", "INVENTORY_VIEW"], ["suppliers", "/parties?kind=SUPPLIER", "SUPPLIER_VIEW"], ["accounts", "/payment-accounts", "PURCHASE_CREATE"]],
  PIUTANG: [["aging", "/debts/aging?kind=AR", "AR_VIEW"], ["accounts", "/payment-accounts", "AR_COLLECT"]],
  UTANG: [["aging", "/debts/aging?kind=AP", "AP_VIEW"], ["accounts", "/payment-accounts", "AP_PAY"]],
  ...Object.fromEntries(FINANCIAL_MODULES.map(id=>[id,[]])),
  "TOKO ONLINE": [["orders", "/orders", "ONLINE_STORE_VIEW"], ["store", "/store", "ONLINE_STORE_VIEW"], ["accounts", "/payment-accounts", "ONLINE_ORDER_MANAGE"]],
  PENGGUNA: [["users", "/users", "USER_VIEW"]],
  PENGATURAN: [["store", "/store", "BUSINESS_SETTINGS_VIEW"], ["initialization", "/initialization", "BUSINESS_SETTINGS_VIEW"], ["terminals", "/terminals", "SHIFT_OPEN"], ["drawers", "/cash-drawers", "SHIFT_OPEN"], ["accounts", "/payment-accounts", "BUSINESS_SETTINGS_MANAGE"], ["products", "/products", "PRODUCT_VIEW"], ["customers", "/parties?kind=CUSTOMER", "CUSTOMER_VIEW"], ["suppliers", "/parties?kind=SUPPLIER", "SUPPLIER_VIEW"]],
};
const NAV_LABELS = { BERANDA:"Beranda", KASIR:"Kasir", TRANSAKSI:"Penjualan", "ARUS KAS":"Arus Kas", LAPORAN:"Laporan", MENU:"Menu" };
const MENU_GROUPS = [
  ["PRODUK & PERSEDIAAN", ["LEVEL HARGA","PAKET & PROMO","PRODUK","STOK"]],
  ["KONTAK", ["CUSTOMER","SUPPLIER"]],
  ["TRANSAKSI BARANG", ["TRANSAKSI","PEMBELIAN"]],
  ["KEUANGAN", ["KEUANGAN","PENGELUARAN","PEMASUKAN","ARUS KAS","UTANG","PIUTANG"]],
  ["LAPORAN", ["LAPORAN HARIAN","LAPORAN BULANAN","LAPORAN TAHUNAN","LAPORAN SALDO"]],
  ["OPERASIONAL & PENGATURAN", ["SHIFT","PENGGUNA","TOKO ONLINE","PENGATURAN"]],
];
const ROLE_LABELS = { OWNER: "Owner", SUPERVISOR: "Supervisor", CASHIER: "Kasir" };
const MENU_LABELS = { "ARUS KAS":"Arus Kas",PENGELUARAN:"Pengeluaran",PEMASUKAN:"Pemasukan Lain-lain","LAPORAN HARIAN":"Laporan Harian","LAPORAN BULANAN":"Laporan Bulanan","LAPORAN TAHUNAN":"Laporan Tahunan","LAPORAN SALDO":"Laporan Kekayaan Usaha", "LEVEL HARGA":"Level Harga", "PAKET & PROMO":"Paket & Promo",
  PRODUK: "Daftar Produk", STOK: "Stok Barang", PEMBELIAN: "Pembelian Barang", SUPPLIER: "Supplier",
  CUSTOMER: "Pelanggan", TRANSAKSI: "Penjualan", SHIFT: "Shift Kasir",
  KEUANGAN: "Kasbox", UTANG: "Utang", PIUTANG: "Piutang", LAPORAN: "Laporan Usaha",
  "TOKO ONLINE": "Toko Online", PENGGUNA: "Karyawan & Akses", PENGATURAN: "Pengaturan Usaha",
};
const MENU_DESCRIPTIONS = { PENGELUARAN:"Biaya operasional yang diakui",PEMASUKAN:"Pendapatan non-produk","ARUS KAS":"Seluruh pergerakan uang usaha","LAPORAN HARIAN":"Kinerja tanggal terpilih","LAPORAN BULANAN":"Kinerja bulan terpilih","LAPORAN TAHUNAN":"Kinerja tahun terpilih","LAPORAN SALDO":"Aset dan kewajiban terpantau",
  PRODUK: "Katalog, harga, dan publikasi", STOK: "Persediaan dan pergerakan", PEMBELIAN: "Belanja dan retur",
  SUPPLIER: "Daftar supplier", CUSTOMER: "Data pelanggan dan riwayat", TRANSAKSI: "Penjualan dan retur", SHIFT: "Buka, tutup, dan riwayat shift",
  KEUANGAN: "Biaya, pendapatan, modal, dan prive", UTANG: "Kewajiban ke supplier", PIUTANG: "Tagihan pelanggan", LAPORAN: "Ringkasan kinerja usaha",
  "TOKO ONLINE": "Pesanan, toko, dan publikasi", PENGGUNA: "Tim, peran, dan izin", PENGATURAN: "Identitas usaha dan akun",
};
const errorText = e => ({
  REFUND_CASH_SHIFT_REQUIRED:"Refund tunai memerlukan shift Anda pada laci sumber. Periksa Kasir; jangan menutup shift orang lain.",
  REFUND_CONFIRMATION_REQUIRED:"Konfirmasikan pengembalian eksternal dan isi referensi bukti sah.",
  OVER_RETURN:"Jumlah melebihi sisa barang yang dapat diretur. Muat ulang struk.",
  HISTORICAL_INSUFFICIENT_FUNDS:"Tanggal tersebut membuat saldo historis negatif. Periksa tanggal dan sumber dana.",
  ACTIVE_DRAWER_REQUIRES_CURRENT_DATE:"Laci sedang dipakai shift. Gunakan tanggal hari ini atau akun lain.",
  FINANCE_CATEGORY_DENIED:"Kategori tidak sesuai jenis transaksi atau usaha.",
  CASH_BOOK_EXPORT_TOO_LARGE:"Hasil melebihi 25.000 mutasi. Persempit tanggal/filter untuk export lengkap.",
  INVALID_PERIOD:"Periksa periode yang dipilih.",
  INVALID_ACCOUNTING_DATE:"Tanggal harus berada dalam periode pembukuan dan tidak boleh di masa depan.",
  REVIEW_NETWORK_DISABLED: "Aplikasi ini adalah build demo/review dan tidak dapat login ke server. Instal build operasional Suq Shogir.",
  NETWORK_TIMEOUT: "Server melewati batas waktu. Sesi dan permintaan tertunda tetap disimpan; periksa status transaksi sebelum mengulang.",
  DATABASE_UNAVAILABLE: "Layanan database sedang tidak tersedia. Transaksi belum dapat diproses; periksa permintaan tertunda.",
  SERVER_REQUEST_TIMEOUT: "Server membatalkan permintaan karena batas waktu. Periksa status transaksi sebelum mengulang.",
  FINANCE_POST_RETRY: "Permintaan bersaing dengan transaksi lain dan dibatalkan server. Muat ulang data lalu ulangi dengan referensi yang sama.",
  VALIDATION_REJECTED: "Data ditolak validasi server. Periksa isian terbaru; gunakan referensi diagnostik bila tetap gagal.",
  NETWORK: "Tidak dapat terhubung ke server. Periksa internet lalu coba lagi.",
  PRICING_MIGRATION_REQUIRED: "Backend belum kompatibel dengan Level Harga/Paket. Hubungi Admin KlikPesantren.",
  PROMO_PRICE_EXCEEDS_BASE: "Harga paket melebihi total Harga Umum komponennya. Periksa kembali harga paket.",
  PROMOTION_UNAVAILABLE: "Paket tidak aktif, perlu ditinjau, atau berada di luar tanggal berlaku.",
  INVALID_PROMOTION_PERIOD: "Periksa Tanggal Mulai dan Tanggal Berakhir. Tanggal berakhir tidak boleh sebelum tanggal mulai.",
  INVALID_PROMOTION_PRIORITY: "Prioritas promo harus berupa angka antara -100.000 dan 100.000.",
  DISCOUNT_STACKING_DENIED: "Diskon manual melebihi bagian Harga Umum yang eligible; item promo/harga khusus/paket tidak dipotong lagi.",
  LEGACY_PROMOTION_REQUIRES_REVIEW: "Edit dan simpan promo lama untuk menerapkan aturan Harga Umum tanpa target level.",
  INVALID_PROMOTION: "Lengkapi jenis promo dan aturan penerapannya.",
  INVALID_BUNDLE: "Paket kombinasi harus berisi minimal dua produk berbeda dengan jumlah yang valid.",
  PRODUCT_DENIED: "Produk tidak aktif atau bukan milik usaha ini.",
  PROMOTION_DENIED: "Promo tidak tersedia untuk usaha ini.",
  CONFLICT: "Data yang sama sudah tersedia. Perbarui daftar lalu periksa kembali.",
  PRICE_LEVEL_PRICE_UNAVAILABLE: "Harga khusus produk belum diatur. Pilih Harga Umum atau level yang tersedia.",
  PRICE_LEVEL_DENIED: "Level harga tidak tersedia untuk usaha ini.",
  INVALID_PRICING_INTEGER: "Harga harus Rupiah utuh non-negatif dan kuantitas harus bilangan bulat positif.",
  PAYMENT_TOTAL_MISMATCH: "Harga berubah atau pembayaran belum cocok. Perbarui quote sebelum membayar.",
  SERVER_ERROR: "Server mengalami gangguan. Coba lagi setelah backend pulih.",
  INVALID_RESPONSE: "Respons server tidak valid. Periksa alamat dan layanan backend.",
  POS_INTERNAL_ERROR: "Data usaha belum dapat dimuat. Coba lagi; jika tetap gagal, hubungi admin pengujian.",
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
  STOCK_SNAPSHOT_STALE: "Stok berubah. Muat ulang dan hitung ulang sebelum mengirim opname baru.",
  STOCK_COUNT_UNCHANGED: "Tidak ada selisih stok untuk disimpan.",
  OPNAME_CLIENT_UPDATE_REQUIRED: "Stok opname memerlukan pembaruan aplikasi.",
  IDENTIFIER_CHANGE_REQUIRES_AUDIT: "Gunakan Ubah SKU / Barcode di detail produk dengan alasan perubahan.",
  PRODUCT_IDENTIFIER_CHANGE_USE_EDITOR: "Import mengubah SKU/barcode existing. Gunakan editor identitas Owner terlebih dahulu.",
  CUTOFF_SNAPSHOT_STALE: "Ledger berubah sejak pratinjau. Muat ulang snapshot sebelum finalisasi.",
  CUTOFF_CLOSE_SHIFTS_FIRST: "Tutup seluruh shift dengan rekonsiliasi kas sebelum cutoff.",
  CUTOFF_ALREADY_FINALIZED: "Pembukuan sudah memiliki cutoff. Gunakan jurnal koreksi, bukan opening kedua.",
  CUTOFF_CURRENT_DAY_REQUIRED: "Cutoff memakai hari usaha saat ini agar periode historis tidak ditimpa.",
  MANUAL_DISCOUNT_EXCEEDS_ELIGIBLE: "Diskon melebihi item Harga Umum tanpa promo yang eligible.",
  PRODUCT_IDENTIFIER_DUPLICATE: "SKU atau barcode sudah dipakai produk lain.",
  OPNAME_APPROVAL_REQUIRED: "Ajukan hitungan, lalu minta persetujuan Owner.",
  OPNAME_ALREADY_APPROVED: "Hitungan ini sudah disetujui; stok tidak dibukukan ulang.",
  WALLET_CREDENTIAL_ADMIN_ONLY: "Aktivasi, penggantian dan pencabutan credential hanya melalui Admin KlikPesantren.",
  SHIFT_ALREADY_OPEN: "Shift Anda masih aktif. Muat ulang konteks Kasir.",
  SHIFT_RESOURCE_IN_USE: "Terminal/laci masih dipakai. Lihat operator shift aktif; minta operator menutup shift atau pilih sumber daya lain.",
  PENDING_MUTATION_SERVER_MISMATCH: "Server berbeda dari permintaan tertunda. Kembali ke server asal.",
  PENDING_SALE_REQUIRES_RETRY: "Ada transaksi dengan hasil belum pasti. Ulangi transaksi yang sama, jangan membuat transaksi baru.",
  PENDING_SALE_AUTHORITY_MISMATCH: "Transaksi tertunda dimiliki konteks akun/usaha lain. Kembali ke konteks asal untuk menyelesaikannya.",
  ACTIVATION_INVALID: "Kode aktivasi tidak valid atau kedaluwarsa.",
  OWNER_REQUIRED: "Tindakan ini hanya dapat dilakukan Owner.",
  INITIALIZATION_FINALIZED: "Posisi awal sudah difinalisasi. Gunakan koreksi terpisah agar riwayat tidak berubah.",
  BUSINESS_ACTIVITY_ALREADY_STARTED: "Usaha sudah memiliki histori. Gunakan Rekonsiliasi Cutoff, bukan opening baru.",
  ACCOUNTING_START_DATE_IN_FUTURE: "Tanggal mulai pembukuan tidak boleh di masa depan.",
  OPENING_ITEM_NOT_FOUND: "Data tersebut bukan bagian dari posisi awal yang difinalisasi.",
  FINALIZATION_CONFIRMATION_REQUIRED: "Konfirmasi finalisasi belum lengkap.",
  INVALID_PRODUCT_WORKBOOK: "File harus berupa workbook Excel .xlsx yang valid.",
  INVALID_PRODUCT_WORKBOOK_HEADERS: "Kolom file tidak sesuai template Suq Shogir. Unduh dan gunakan template terbaru.",
  EMPTY_PRODUCT_WORKBOOK: "File Excel belum berisi data produk.",
  PRODUCT_WORKBOOK_TOO_MANY_ROWS: "File melebihi batas 1.000 produk. Pecah menjadi beberapa file.",
  PRODUCT_WORKBOOK_REQUIRED: "Pilih file Excel produk terlebih dahulu.",
  PRODUCT_IMPORT_VALIDATION_FAILED: "Masih ada baris invalid atau duplikat. Perbaiki file lalu pratinjau ulang.",
  INVALID_PRODUCT_EXPORT_FILTER: "Filter export produk tidak valid.",
  CASH_BOOK_EXCEL_AMOUNT_TOO_LARGE: "Ada nominal Buku Kas yang melampaui batas angka aman Excel.",
  FILE_STORAGE_UNAVAILABLE: "Penyimpanan sementara perangkat tidak tersedia.",
  FILE_READ_FAILED: "File tidak dapat dibaca dari perangkat. Pilih ulang file lalu coba lagi.",
  FILE_SHARING_UNAVAILABLE: "Perangkat tidak menyediakan tujuan simpan/bagikan file.",
}[e?.code] || `Permintaan ditolak (${e?.status||"—"} / ${/^[A-Z0-9_]{1,80}$/.test(String(e?.code))?e.code:"UNKNOWN_REQUEST"}). Lihat referensi dukungan pada Diagnostik.`);

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
  const [pendingMutation,setPendingMutation]=useState(null);
  const [mutationEpoch,setMutationEpoch]=useState(0);
  const [serverBase, setServerBase] = useState(DEFAULT_API_BASE);
  const [serverDraft, setServerDraft] = useState(DEFAULT_API_BASE);
  const [serverReady, setServerReady] = useState(!TESTING_BUILD);
  const [serverTesting, setServerTesting] = useState(false);
  const [serverFeedback, setServerFeedback] = useState(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const moduleCache = useRef(createModuleDataCache());
  const inflightModule = useRef("");
  const lastLoaded = useRef(new Map());
  const api = useMemo(() => makeApi(session?.token, undefined, serverBase), [session?.token, serverBase]);
  const businessId = session?.businessId;
  const mutationJournal=useMemo(()=>createMutationJournal({vault,server:serverBase,send:(path,body)=>api(`/pos-business/${businessId}${path}`,{method:'POST',body})}),[api,businessId,serverBase]);
  useEffect(()=>{let alive=true;mutationJournal.read().then(p=>{if(alive)setPendingMutation(p);}).catch(()=>setError('Jurnal mutasi tidak dapat dibaca; jangan ulangi transaksi.'));return()=>{alive=false;};},[mutationJournal]);
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
      if (shouldDiscardMerchantSession(e)) {
        await vault.remove("merchant-session").catch(() => {});
        moduleCache.current.clear();
        lastLoaded.current.clear();
        setSession(null); setContext(null); setDirectory(null);
      }
    } finally { lock.current = false; setBusy(false); }
  }, []);

  const refresh = useCallback(async (target = module, active = session, { background = false } = {}) => {
    if (!active?.businessId) return;
    if (inflightModule.current === target) return;
    inflightModule.current = target;
    if (!background) setLoadingModule(target);
    const client = makeApi(active.token, undefined, serverBase), g = ++generation.current;
    try {
      // Context is deliberately revalidated on every navigation; cached projections never authorize access.
      const nextContext = await client(`/pos-business/${active.businessId}/context`);
      const visible = navigationItems(nextContext.permissions);
      const selected = visible.some(item => item.id === target) ? target : "BERANDA";
      if (g !== generation.current) return;
      // Context is authoritative on its own. A secondary dashboard projection
      // must not trap an authenticated user behind the bootstrap spinner.
      setContext(nextContext);setModule(selected);
      const authority = authorityKey(nextContext,active.businessId),cached=moduleCache.current.get(authority,selected);
      if(cached){setData(cached);setShowingCached(true);}
      else if(g===generation.current)setShowingCached(false);
      const permissions = new Set(nextContext.permissions);
      const entries = await Promise.all((LOADERS[selected] || [])
        .filter(([, , required]) => !required || (Array.isArray(required) ? required.some(item => permissions.has(item)) : permissions.has(required)))
        .map(async ([key, path]) => [key, await (['/products','/inventory'].includes(path)?loadProductPages(p=>client(`/pos-business/${active.businessId}${p}`),path):client(`/pos-business/${active.businessId}${path}`))]));
      if (g !== generation.current) return;
      const fresh=Object.fromEntries(entries);
      moduleCache.current.set(authority,selected,fresh);
      lastLoaded.current.set(selected,Date.now());
      setData(fresh);setShowingCached(false);
    } finally {
      if(inflightModule.current===target)inflightModule.current="";
      if(!background&&g===generation.current)setLoadingModule("");
    }
  }, [module, serverBase, session]);

  const navigate = useCallback(async (target, force=false) => {
    const age=Date.now()-(lastLoaded.current.get(target)||0),recentlyLoaded=age<15_000;
    if(!force&&target===module&&Object.keys(data).length&&recentlyLoaded)return;
    setError("");setNotice("");
    const authority=authorityKey(context,businessId),cached=!force&&moduleCache.current.get(authority,target);
    if(cached){setData(cached);setModule(target);setShowingCached(age>=15_000);if(recentlyLoaded)return;}
    try{await refresh(target,session,{background:!!cached});}catch(e){setError(errorText(e));}
  },[businessId,context,data,module,refresh,session]);

  const selectBusiness = useCallback(async (token, id, all = directory) => {
    const pending = await vault.read("merchant-sale").catch(() => null);
    if (pending && pending.business_id !== id) throw Error("PENDING_SALE_AUTHORITY_MISMATCH");
    const mutation=await vault.read('merchant-mutation-v1');
    if(mutation && mutation.business_id!==id)throw Object.assign(Error('PENDING_SALE_AUTHORITY_MISMATCH'),{code:'PENDING_SALE_AUTHORITY_MISMATCH'});
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
    if (!TESTING_BUILD) return;
    let alive = true;
    loadTestingServerAddress(vaultStore, DEFAULT_API_BASE)
      .then(address => { if (alive) { setServerBase(address); setServerDraft(address); } })
      .catch(() => { if (alive) setError("Alamat server tersimpan belum dapat dibaca. Masukkan ulang alamat pengujian."); })
      .finally(() => { if (alive) setServerReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!serverReady) return undefined;
    let alive = true;
    (async () => {
      let saved = null;
      try {
        saved = await vault.read("merchant-session");
        if (!saved) return;
        const client = makeApi(saved.token, undefined, serverBase), found = await client("/pos-business/memberships");
        if (!found.businesses.some(item => item.id === saved.businessId)) {
          const fallback = { token: saved.token, businessId: null };
          await vault.remove("merchant-session").catch(() => {});
          await vault.write("merchant-session", fallback);
          if (alive) { setDirectory(found); setSession(fallback); }
          return;
        }
        if (alive) { setDirectory(found); setSession(saved); await refresh("BERANDA", saved); }
      } catch (restoreError) {
        if (shouldDiscardMerchantSession(restoreError)) {
          await vault.remove("merchant-session").catch(() => {});
          if (alive) { setSession(null); setContext(null); setDirectory(null); }
        } else if (alive) {
          setError(errorText(restoreError));
        }
      } finally { if (alive) setBoot(false); }
    })();
    return () => { alive = false; };
  // Bootstrap runs once; subsequent permission refreshes are explicit on every module request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverBase, serverReady]);

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
      const client = makeApi(null, undefined, serverBase);
      const auth = await client("/pos-business/login", { method: "POST", body: login });
      const found = await makeApi(auth.token, undefined, serverBase)("/pos-business/memberships");
      if (!found.businesses.length) throw Object.assign(Error("DENIED"), { code: "MERCHANT_ACCESS_DENIED" });
      setLogin(value => ({ ...value, password: "" })); setDirectory(found);
      if (found.businesses.length === 1) await selectBusiness(auth.token, found.businesses[0].id, found);
      else setSession({ token: auth.token, businessId: null });
    });
  }
  async function activateAccount(payload) {
    return run(async () => {
      await makeApi(null, undefined, serverBase)("/pos-business/activate", { method: "POST", body: payload });
      setNotice("Akun aktif. Silakan masuk dengan password baru.");
      return true;
    });
  }
  async function testAndUseServer() {
    if (!TESTING_BUILD || serverTesting) return;
    setServerTesting(true); setServerFeedback(null);
    try {
      const result = await verifyTestingServer(serverDraft, fetch);
      const address = await saveTestingServerAddress(vaultStore, result.address);
      if (address !== serverBase) {
        moduleCache.current.clear(); lastLoaded.current.clear();
        setDirectory(null); setContext(null); setData({});
      }
      setServerBase(address); setServerDraft(address);
      setServerFeedback({ ok: true, message: `Terhubung ke server testing${result.fixture ? ` (${result.fixture})` : ""}. Alamat disimpan.` });
    } catch (serverError) {
      setServerFeedback({ ok: false, message: serverError.message || "Server testing tidak dapat dijangkau." });
    } finally { setServerTesting(false); }
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
      let result;
      try{result=mutationJournal.accepts(path)
        ?await mutationJournal.submit(path,body,{business_id:businessId,user_id:context.user_id})
        :await api(`/pos-business/${businessId}${path}`, { method: "POST", body });}
      finally{setPendingMutation(await mutationJournal.read());}
      moduleCache.current.invalidate(authorityKey(context,businessId));
      setNotice(message);
      try{await refresh(next);}catch{setError('Transaksi sudah tersimpan. Gagal memperbarui daftar; muat ulang tanpa mengirim transaksi baru.');}
      return result;
    });
  }
  async function retryMutation(){return run(async()=>{
    try{await mutationJournal.submit(null,null,{business_id:businessId,user_id:context.user_id});setNotice('Permintaan asli berhasil dikonfirmasi. Form dikosongkan; jangan kirim ulang.');setMutationEpoch(n=>n+1);moduleCache.current.invalidate(authorityKey(context,businessId));try{await refresh(module);}catch{setError('Transaksi tersimpan; daftar belum diperbarui.');}}
    finally{setPendingMutation(await mutationJournal.read());}
  });}
  const readFinancial = useCallback((path,options)=>api(`/pos-business/${businessId}${path}`,options),[api,businessId]);
  const postFinancial = useCallback(async(path,body,message)=>{let result;try{result=mutationJournal.accepts(path)?await mutationJournal.submit(path,body,{business_id:businessId,user_id:context.user_id}):await api('/pos-business/'+businessId+path,{method:'POST',body});}finally{setPendingMutation(await mutationJournal.read());}moduleCache.current.invalidate(authorityKey(context,businessId));setNotice(message);return result;},[api,businessId,context,mutationJournal]);
  const quoteCart = useCallback(body => api(`/pos-business/${businessId}/pricing/quote`, {method:"POST",body}), [api,businessId]);
  async function request(path, options) {
    return run(() => api(`/pos-business/${businessId}${path}`, options));
  }
  async function submitSale(payload) {
    return run(async () => {
      const authority = { business_id: businessId, user_id: context.user_id };
      const result = await saleJournal.submit(payload, authority);
      moduleCache.current.invalidate(authorityKey(context,businessId));
      setPendingSale(null); setNotice("Penjualan tersimpan.");
      try { await refresh("KASIR"); } catch (refreshError) { setError(errorText(refreshError)); }
      return result;
    }).finally(async () => setPendingSale(await saleJournal.read().catch(() => null)));
  }
  async function uploadProductAsset(asset) {
    return run(async () => {
      const body = new FormData();
      appendNativeUpload(body, asset, File, { name: "product.jpg", mimeType: "image/jpeg", maxBytes: 5 * 1024 * 1024, tooLargeCode: "PRODUCT_IMAGE_TOO_LARGE" });
      return api(`/pos-business/${businessId}/product-assets`, { method: "POST", formData: body });
    });
  }
  async function importProductWorkbook(asset, commit = false) {
    return run(async () => {
      asset=require("./productSearch.cjs").normalizeWorkbookAsset(asset);
      const body = new FormData();
      appendNativeUpload(body, asset, File, { mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", maxBytes: 2 * 1024 * 1024, tooLargeCode: "PRODUCT_WORKBOOK_TOO_LARGE" });
      const result = await api(`/pos-business/${businessId}/products/import/${commit ? "commit" : "preview"}`, { method: "POST", formData: body });
      if (commit) {
        moduleCache.current.invalidate(authorityKey(context,businessId));
        setNotice("Import produk berhasil disimpan.");
        try{await refresh("PRODUK");}catch{setError("Import sudah tersimpan. Daftar belum diperbarui; muat ulang tanpa membuat import baru.");}
      }
      return result;
    });
  }
  async function shareWorkbookFile(path, filename, query, onProgress) {
    return run(async () => {
      if (!FileSystem.cacheDirectory) throw Object.assign(Error("FILE_STORAGE_UNAVAILABLE"), { code: "FILE_STORAGE_UNAVAILABLE" });
      const destination = FileSystem.cacheDirectory + filename.replace(/[^a-zA-Z0-9._-]/g, "-");
      const result = await api.download(`/pos-business/${businessId}${path}`, destination, { query, onProgress });
      if (!await Sharing.isAvailableAsync()) throw Object.assign(Error("FILE_SHARING_UNAVAILABLE"), { code: "FILE_SHARING_UNAVAILABLE" });
      await Sharing.shareAsync(result.uri, {
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        dialogTitle: "Simpan atau bagikan file Excel produk",
        UTI: "org.openxmlformats.spreadsheetml.sheet",
      });
      return result;
    });
  }
  async function loadReceiptPreferences() {
    if (!businessId) return normalizeDevicePreferences();
    return normalizeDevicePreferences(await vault.read(`merchant-receipt-device.${businessId}`).catch(() => null));
  }
  async function saveReceiptPreferences(preferences) {
    if (!businessId) throw Error("MERCHANT_ACCESS_DENIED");
    const normalized = normalizeDevicePreferences(preferences);
    const key = `merchant-receipt-device.${businessId}`;
    await vault.remove(key).catch(() => {});
    await vault.write(key, normalized);
    return normalized;
  }
  async function shareReceiptFile(value, action = "share") {
    return outputReceipt(value, action, await loadReceiptPreferences());
  }

  if (boot) return <SafeAreaView style={s.root}><Empty loading title="Menyiapkan Suq Shogir" /></SafeAreaView>;
  if (!session) return <Login value={login} setValue={setLogin} onSubmit={signIn} onActivate={activateAccount} busy={busy} error={error} notice={notice} testingBuild={TESTING_BUILD} serverDraft={serverDraft} onServerDraftChange={value=>{setServerDraft(value);setServerFeedback(null);}} serverTesting={serverTesting} serverFeedback={serverFeedback} onTestServer={testAndUseServer} />;
  if (!session.businessId) return <BusinessPicker rows={directory?.businesses || []} busy={busy} onSelect={id => run(() => selectBusiness(session.token, id))} onLogout={logout} />;
  if (!context) return <SafeAreaView style={s.root}><Empty loading={!error} title={error?"Usaha belum dapat dimuat":"Memuat konteks usaha"} note={error||undefined} onRetry={error?()=>run(()=>refresh("BERANDA",session)):undefined} /></SafeAreaView>;
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
      {pendingMutation&&<View style={s.feedback}><Text style={s.error}>Ada mutasi dengan hasil belum pasti. Kirim ulang permintaan asli dari akun dan usaha yang sama.</Text><Button title="Periksa / Ulangi Permintaan Asli" disabled={busy} onPress={retryMutation}/></View>}
      <ModuleView feedbackError={error} feedbackNotice={notice} busy={busy} key={mutationEpoch} module={module} context={context} data={data} submit={submit} submitSale={submitSale} pendingSale={pendingSale} request={request} readFinancial={readFinancial} postFinancial={postFinancial} uploadProductAsset={uploadProductAsset} importProductWorkbook={importProductWorkbook} shareWorkbookFile={shareWorkbookFile} shareReceiptFile={shareReceiptFile} quoteCart={quoteCart} loadReceiptPreferences={loadReceiptPreferences} saveReceiptPreferences={saveReceiptPreferences} refresh={() => navigate(module,true)} navigate={navigate} />
      <View style={s.tabs} accessibilityRole="tablist">
        {primary.map(id => <Tab key={id} id={id} active={module === id} onPress={() => navigate(id)} />)}
        <Tab id="MENU" active={!primary.includes(module)} onPress={() => setMenu(true)} />
      </View>
      <Modal transparent visible={accountMenu} animationType="fade" onRequestClose={() => setAccountMenu(false)}>
        <Pressable style={s.accountOverlay} onPress={() => setAccountMenu(false)}>
          <View style={s.accountPanel} onStartShouldSetResponder={() => true}>
            <View style={s.userRow}><View style={s.avatar}><Text style={s.avatarText}>{context.user_name.slice(0,1).toUpperCase()}</Text></View><View style={s.flex}><Text style={s.heading}>{context.user_name}</Text><Text style={s.muted}>{ROLE_LABELS[context.role] || "Pengguna"} · {context.business.display_name}</Text></View></View>
            {TESTING_BUILD&&<><Text style={s.muted}>Server aktif: {serverBase}. Jika jaringan berubah, isi alamat laptop yang baru dan uji kembali.</Text><Field label="Alamat Server Pengujian" value={serverDraft} onChangeText={setServerDraft}/><Button title={serverTesting?"Menguji…":"Tes & Gunakan Server"} disabled={serverTesting} onPress={async()=>{await testAndUseServer();setAccountMenu(false);}}/>{serverFeedback&&<Text style={serverFeedback.ok?s.success:s.error}>{serverFeedback.message}</Text>}</>}
            {directory?.businesses?.length > 1 && <Button title="Ganti ruang usaha" secondary icon="repeat" onPress={() => { setAccountMenu(false); setSession(x => ({ ...x, businessId: null })); setContext(null); }}/>}
            <Button title="Keluar" danger icon="log-out" onPress={() => { setAccountMenu(false); logout(); }}/>
          </View>
        </Pressable>
      </Modal>
      <Modal visible={menu} animationType="slide" onRequestClose={() => setMenu(false)}>
        <SafeAreaView style={s.root}><View style={s.header}><View style={s.flex}><Text style={s.brand}>Menu Usaha</Text><Text style={s.muted}>Modul sesuai akses akun Anda</Text></View><Pressable accessibilityLabel="Tutup menu" onPress={() => setMenu(false)}><Icon name="x" /></Pressable></View>
          <ScrollView contentContainerStyle={s.content}>{MENU_GROUPS.map(([title,ids])=>{const rows=ids.filter(id=>navigation.some(item=>item.id===id));return rows.length?<View key={title} style={s.menuSection}><View style={s.menuGroupHeader}><Text style={s.eyebrow}>{title}</Text></View><View style={s.menuGrid}>{rows.map(id=>{const item=navigation.find(x=>x.id===id);return <Pressable accessibilityRole="button" key={id} style={[s.menuItem,module===id&&s.menuItemActive]} onPress={()=>{setMenu(false);navigate(id);}}><View style={s.menuIcon}><Icon name={item.icon} size={17}/></View><View style={s.flex}><Text style={s.menuLabel}>{MENU_LABELS[id] || id}</Text><Text style={s.menuDescription}>{MENU_DESCRIPTIONS[id] || (id==="LEVEL HARGA"?"Harga pelanggan dan fallback Harga Umum":"Promo kuantitas dan paket produk")}</Text></View><Icon name="chevron-right" size={16} color={colors.muted}/></Pressable>})}</View></View>:null;})}</ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function Login({ value, setValue, onSubmit, onActivate, busy, error, notice, testingBuild, serverDraft, onServerDraftChange, serverTesting, serverFeedback, onTestServer }) {
  const [mode,setMode]=useState("LOGIN"),[activation,setActivation]=useState({login:"",activation_code:"",password:"",confirm:""});
  const activate=async()=>{const ok=await onActivate({login:activation.login,activation_code:activation.activation_code,password:activation.password});if(ok){setValue({...value,login:activation.login,password:""});setActivation({login:"",activation_code:"",password:"",confirm:""});setMode("LOGIN");}};
  return <SafeAreaView style={s.loginRoot}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==="ios"?"interactive":"on-drag"} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="always" contentContainerStyle={s.loginContent}><View style={s.loginBrand}><View style={s.logoMark}><Icon name="shopping-bag" size={26} color={colors.surface}/></View><Text style={s.loginKicker}>SUQ SHOGIR</Text><Text style={s.loginTitle}>Ruang usaha yang rapi dan aman</Text><Text style={s.loginSubtitle}>Kasir, stok, keuangan, dan toko online dalam satu sumber data. Didukung KlikPesantren.</Text></View>
    {testingBuild&&<Card title="Alamat Server Pengujian"><Text style={s.muted}>Jika IP laptop berubah, masukkan alamat backend lokal yang baru. Pengaturan ini hanya tersedia pada APK testing.</Text><Field label="Alamat server" value={serverDraft} autoCapitalize="none" autoCorrect={false} onChangeText={onServerDraftChange} placeholder="http://IP-laptop:55440"/><Button title={serverTesting?"Menguji koneksi…":"Tes Koneksi"} secondary disabled={serverTesting||!serverDraft.trim()} onPress={onTestServer}/>{serverFeedback&&<View style={serverFeedback.ok?s.alertSuccess:s.alertError}><Text style={serverFeedback.ok?s.success:s.error}>{serverFeedback.message}</Text></View>}</Card>}
    <Card title={mode==="LOGIN"?"Masuk ke akun Anda":"Aktivasi akun karyawan"}>{!!error&&<View style={s.alertError}><Text style={s.error}>{error}</Text></View>}{!!notice&&<View style={s.alertSuccess}><Text style={s.success}>{notice}</Text></View>}{mode==="LOGIN"?<><Field label="ID login" value={value.login} onChangeText={login=>setValue({...value,login})}/><Field label="Password" secret value={value.password} onChangeText={password=>setValue({...value,password})}/><Button title={busy?"Memeriksa…":"Masuk"} icon="log-in" disabled={busy||!value.login||!value.password} onPress={onSubmit}/><Button title="Aktivasi akun karyawan" secondary onPress={()=>setMode("ACTIVATE")}/></>:<><Text style={s.muted}>Gunakan kode sekali pakai dari Owner, lalu buat password pribadi Anda.</Text><Field label="ID login" value={activation.login} onChangeText={login=>setActivation({...activation,login})}/><Field label="Kode aktivasi" secret value={activation.activation_code} onChangeText={activation_code=>setActivation({...activation,activation_code})}/><Field label="Password baru (minimal 12 karakter)" secret value={activation.password} onChangeText={password=>setActivation({...activation,password})}/><Field label="Ulangi password" secret value={activation.confirm} onChangeText={confirm=>setActivation({...activation,confirm})}/><Button title={busy?"Mengaktifkan…":"Aktifkan akun"} disabled={busy||!activation.login||!activation.activation_code||activation.password.length<12||activation.password!==activation.confirm} onPress={activate}/><Button title="Kembali ke login" secondary onPress={()=>setMode("LOGIN")}/></>}</Card><Text style={s.loginFoot}>Akun dan hak akses ditentukan oleh Owner usaha. KlikPesantren tidak pernah menampilkan password lama.</Text></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
function BusinessPicker({ rows, busy, onSelect, onLogout }) {
  return <SafeAreaView style={s.root}><View style={s.header}><Text style={s.brand}>Pilih Usaha</Text></View><ScrollView contentContainerStyle={s.content}>{rows.map(row => <Pressable key={row.id} style={s.choice} disabled={busy} onPress={() => onSelect(row.id)}><Icon name="briefcase"/><View style={s.flex}><Text style={s.heading}>{row.display_name}</Text><Text style={s.muted}>{row.tenant_slug} · {row.role}</Text></View></Pressable>)}<Button title="Keluar" danger onPress={onLogout}/></ScrollView></SafeAreaView>;
}
function Tab({ id, active, onPress }) {
  const icon = id === "BERANDA" ? "home" : id === "KASIR" ? "shopping-bag" : id === "ARUS KAS" ? "activity" : id === "TRANSAKSI" ? "file-text" : id === "LAPORAN" ? "bar-chart-2" : "grid";
  return <Pressable accessibilityRole="tab" accessibilityState={{selected:active}} style={[s.tab, active && s.tabActive]} onPress={onPress}><Icon name={icon} color={active ? colors.green : colors.muted}/><Text style={[s.tabText, active && s.activeTab]}>{NAV_LABELS[id]||id}</Text></Pressable>;
}
function ModuleView(props) {
  const safeData = props.data.books ? props.data : { ...props.data, books: { accounts: (props.data.accounts || []).map(account => ({ ...account, balance: "0" })) } };
  const common = { ...props, data: safeData, can: key => can(props.context.permissions, key) };
  const content = {
    "LEVEL HARGA": <PriceLevels {...common}/>, "PAKET & PROMO": <Promotions {...common}/>,
    BERANDA: <Dashboard {...common}/>, KASIR: <Cashier {...common}/>, TRANSAKSI: <Transactions {...common}/>,
    SHIFT: <Shifts {...common}/>, PRODUK: <Products {...common}/>, STOK: <Inventory {...common}/>,
    CUSTOMER: <Parties {...common} kind="CUSTOMER"/>, SUPPLIER: <Parties {...common} kind="SUPPLIER"/>,
    PEMBELIAN: <Purchases {...common}/>, PIUTANG: <Debts {...common} kind="AR"/>, UTANG: <Debts {...common} kind="AP"/>,
    "TOKO ONLINE": <Online {...common}/>,
    PENGGUNA: <Users {...common}/>, PENGATURAN: <Settings {...common}/>,
  }[props.module];
  return <View style={s.flex}>
    {common.can("SALE_CREATE")&&<View style={[s.flex,props.module!=="KASIR"&&s.hidden]}><Cashier {...common}/></View>}
    {FINANCIAL_MODULES.includes(props.module)?<FinancialWorkspace key={(props.context.business.id||props.context.business_id||"")+props.module} {...common} module={props.module} journalVault={vault} request={props.readFinancial} submit={props.postFinancial}/>:props.module==="BERANDA"?<HomeViewport {...common}/>:props.module!=="KASIR"&&<ScrollView key={props.module} style={s.flex} keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>{content || <Empty title="Modul tidak tersedia" />}</ScrollView>}
  </View>;
}
function HomeViewport(props) {
  const dimensions=useWindowDimensions(),[frame,setFrame]=useState({height:0,width:dimensions.width}),[contentHeight,setContentHeight]=useState(0);
  const layout=homeLayout({...frame,fontScale:dimensions.fontScale,contentHeight});
  return <View testID="home-viewport" style={s.flex} onLayout={event=>setFrame(event.nativeEvent.layout)}><ScrollView testID="home-scroll" style={s.flex} scrollEnabled={layout.scroll} contentContainerStyle={[s.content,layout.compact&&{padding:8,paddingBottom:8,gap:layout.gap}]} onContentSizeChange={(_width,height)=>setContentHeight(height)}><Dashboard {...props} compact={layout.compact} chartHeight={Math.max(48,Math.min(125,frame.height-530))}/></ScrollView></View>;
}
function Dashboard({ data, context, can, refresh, navigate, compact=false, chartHeight=64 }) {
  const w=data.workspace||{},a=w.attention||{},sales=w.sales_today||{},report=data.report||{},month=report.kpi||{},isCashier=context.role==="CASHIER";
  const actions=dashboardActions(context.role,context.permissions).filter(action=>isCashier?action.id==="KASIR":["KASIR","PRODUK","STOK"].includes(action.id)).slice(0,2);
  const attention=[];
  if(can("AR_VIEW"))attention.push(["Piutang pelanggan",rupiah(a.receivable||0)]);
  if(can("AP_VIEW"))attention.push(["Utang ke pemasok",rupiah(a.payable||0)]);
  if(can("INVENTORY_VIEW"))attention.push(["Stok menipis",String(a.low_stock||0)]);
  if(can("ONLINE_STORE_VIEW"))attention.push(["Pesanan online",String(a.online_orders||0)]);
  return <><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>{isCashier?"Siap melayani":"Ringkasan Usaha"}</Text><Text style={s.muted}>{isCashier?context.business.display_name:"Kinerja hari ini dan bulan berjalan."}</Text></View><Pressable style={s.inlineAction} onPress={refresh}><Icon name="refresh-cw" size={14}/><Text style={s.inlineActionText}>Segarkan</Text></Pressable></View>
    {isCashier?<Card title={w.open_shift?"Shift sedang berjalan":"Shift belum dibuka"}><Row label="Akun" value={context.user_name}/><Row label="Usaha" value={context.business.display_name}/><Text style={s.muted}>{w.open_shift?"Lanjutkan penjualan dari Kasir. Keranjang tetap tersimpan saat berpindah tab.":"Buka Kasir untuk memilih terminal dan laci kas yang diizinkan."}</Text></Card>:can("REPORT_SALES")?<><View style={[s.kpiGrid,compact&&{gap:6}]}><KpiTile compact={compact} label="Penjualan hari ini" value={rupiah(sales.sales||0)} icon="trending-up"/><KpiTile compact={compact} label="Transaksi hari ini" value={String(sales.transactions||0)} icon="file-text"/><KpiTile compact={compact} label="Penjualan bulan ini" value={rupiah(month.net_sales||0)} icon="calendar"/>{can("REPORT_PROFIT")&&<KpiTile compact={compact} label="Laba kotor bulan ini" value={rupiah(month.gross_profit||0)} icon="bar-chart-2" negative={BigInt(month.gross_profit||0)<0n}/>}</View>{Number(sales.transactions||0)===0&&<Text style={s.muted}>Belum ada transaksi hari ini.</Text>}<SalesMonthChart rows={report.sales?.daily} compact={compact} chartHeight={chartHeight}/></>:<Card title="Aktivitas usaha"><Text style={s.muted}>Ringkasan penjualan tidak tersedia untuk hak akses akun ini.</Text></Card>}
    {actions.length>0&&<View style={[s.sectionCompact,compact&&{gap:4}]}><Text style={s.heading}>Akses Cepat</Text><View style={s.quickGrid}>{actions.map(action=><Pressable accessibilityRole="button" key={action.id} style={[s.quickAction,compact&&{minHeight:44,paddingVertical:6}]} onPress={()=>navigate(action.id)}><Icon name={action.icon} size={18}/><Text style={s.quickActionText}>{action.label}</Text></Pressable>)}</View></View>}
    {!isCashier&&attention.length>0&&<View style={[s.attentionStrip,compact&&{gap:4}]}>{attention.map(([label,value])=><View key={label} style={[s.attentionItem,compact&&{minWidth:"46%",flexBasis:"46%",padding:5}]}><Text style={s.muted}>{label}</Text><Text style={s.heading}>{value}</Text></View>)}</View>}
  </>;
}
function SalesMonthChart({ rows=[], compact=false, chartHeight=64 }) {
  const values=rows.map(row=>Number(row.net_sales||0)),max=Math.max(1,...values);
  if(!rows.length)return null;
  return <View style={[s.salesChart,compact&&{padding:7,gap:4}]}><View style={s.row}><Text style={s.heading}>Penjualan harian bulan ini</Text><Text style={s.muted}>{rows.length} hari</Text></View><View style={[s.salesBars,compact&&{height:chartHeight+16}]}>{rows.map((row,index)=><View key={row.day} style={[s.salesBarSlot,compact&&{height:chartHeight}]}><View accessibilityLabel={`${row.day}: ${rupiah(row.net_sales)}`} style={[s.salesBar,{height:Math.max(2,Math.round((compact?chartHeight-2:44)*Math.max(0,Number(row.net_sales||0))/max))}]}/>{(index===0||index===rows.length-1)&&<Text style={s.salesBarLabel}>{new Date(`${row.day}T00:00:00`).getDate()}</Text>}</View>)}</View><Text style={s.muted}>Hari tanpa penjualan tetap ditampilkan sebagai nol.</Text></View>;
}
function KpiTile({ label, value, icon, negative=false, compact=false }) {
  return <View style={[s.kpiTile,compact&&{minHeight:64,padding:7,gap:3}]}><View style={s.row}><Text style={s.label}>{label}</Text><Icon name={icon} size={16} color={negative?colors.red:colors.green}/></View><Text style={[s.kpiValue,negative&&s.kpiValueNegative,compact&&{fontSize:22,lineHeight:28}]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}
function Cashier({ data, context, can, submit, submitSale, pendingSale, request, navigate, shareReceiptFile, quoteCart, readFinancial, module }) {
  const blankPayment=(method="CASH",amount="")=>({method,amount,account_id:"",tendered:"",reference:"",credential:"",credential_method:"",unit_id:context.units.length===1?context.units[0].unit_id:"",wallet_preview:null,manual_confirmed:false});
  const [cart,setCart]=useState([]),[terminal,setTerminal]=useState(""),[drawer,setDrawer]=useState(""),[openingCash,setOpeningCash]=useState("0"),[showOpeningCash,setShowOpeningCash]=useState(false),[receipt,setReceipt]=useState(null),[search,setSearch]=useState(""),[category,setCategory]=useState(""),[productScannerOpen,setProductScannerOpen]=useState(false),[customerId,setCustomerId]=useState(""),[customerSearch,setCustomerSearch]=useState(""),[showCustomerCreate,setShowCustomerCreate]=useState(false),[customerDraft,setCustomerDraft]=useState({name:"",phone:"",address:"",credit_limit:"0",due_days:"0"}),[dueDate,setDueDate]=useState(""),[discount,setDiscount]=useState("0"),[discountReason,setDiscountReason]=useState(""),[payments,setPaymentRows]=useState([blankPayment()]),[cartOpen,setCartOpen]=useState(false),[paymentOpen,setPaymentOpen]=useState(false),[split,setSplit]=useState(false);
  const walletScanEpoch=useRef(0);
  const setPayments=useCallback(value=>{walletScanEpoch.current+=1;setPaymentRows(value);},[]);
  const [pricingQuote,setPricingQuote]=useState(null),[pricingError,setPricingError]=useState(""),[quoteAttempt,setQuoteAttempt]=useState(0);
  const pricingRequest=JSON.stringify(pricingInput(cart,customerId));
  const policyKey=JSON.stringify(data.pricing||null);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{let alive=true;const body=JSON.parse(pricingRequest);setPricingQuote(null);setPricingError("");if(body.items.length||body.packages.length)quoteCart(body).then(value=>{if(alive)setPricingQuote({...value,key:pricingRequest,policyKey});}).catch(error=>{if(alive)setPricingError(errorText(error));});return()=>{alive=false;};},[pricingRequest,policyKey,quoteAttempt,quoteCart]);
  const quoteReady=pricingQuote?.key===pricingRequest&&pricingQuote?.policyKey===policyKey;
  const allProducts=(data.products||[]).filter(require("./operationalQa.cjs").sellableProduct),categories=[...new Set(allProducts.map(p=>p.category).filter(Boolean))],products=allProducts.filter(p=>BigInt(p.available??p.on_hand??0)>0n&&(!category||p.category===category)&&(!search||`${p.name} ${p.sku||""} ${p.barcode||""}`.toLowerCase().includes(search.toLowerCase()))),drawers=data.drawers||[],accounts=data.accounts||[],shift=data.workspace?.open_shift;
  const customers=data.customers||[],visibleCustomers=filterCustomers(customers,customerSearch),selectedCustomer=customers.find(customer=>String(customer.id)===String(customerId));
  const setup=cashierSetupState(context.terminals,drawers,can("BUSINESS_SETTINGS_MANAGE"));
  const terminalChoice=shiftResourceChoice(terminal,context.terminals),drawerChoice=shiftResourceChoice(drawer,drawers),selectedTerminal=terminalChoice.selected,selectedDrawer=drawerChoice.selected;
  const protectedPricing=quoteReady&&BigInt(pricingQuote.manual_discount_eligible_total||0)===0n;
  const discountValue=moneyValue(discount),subtotal=quoteReady?BigInt(pricingQuote.subtotal):cart.reduce((n,i)=>n+BigInt(i.selling_price)*BigInt(i.quantity),0n),total=(quoteReady?BigInt(pricingQuote.total):subtotal)-discountValue,totalText=total>0n?String(total):"",itemCount=cart.reduce((n,i)=>n+i.quantity,0);
  const effectivePayments=payments.map(payment=>!split&&payments.length===1?{...payment,amount:totalText}:payment),paymentTotal=effectivePayments.reduce((n,p)=>n+moneyValue(p.amount),0n);
  // Keep the visible single-payment field synchronized with the server-authoritative cart total.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{if(!split&&totalText)setPayments(rows=>rows.length===1&&rows[0].amount!==totalText?[{...rows[0],amount:totalText}]:rows);},[split,totalText,setPayments]);
  const add=p=>setCart(rows=>{const old=rows.find(x=>x.id===p.id);return old?rows.map(x=>x.id===p.id?{...x,quantity:x.quantity+1}:x):[...rows,{...p,quantity:1}]});
  const quantity=(id,delta)=>setCart(rows=>rows.flatMap(x=>x.id!==id?[x]:x.quantity+delta>0?[{...x,quantity:x.quantity+delta}]:[]));
  const updatePayment=(index,patch)=>setPayments(rows=>rows.map((p,i)=>i===index?{...p,...patch}:p));
  const methods=["CASH","TRANSFER","DOMPET_SANTRI",...(customerId?["CREDIT"]:[])];
  const creditState=creditAvailability(selectedCustomer,total);
  const selectCustomer=id=>{const customer=customers.find(row=>String(row.id)===String(id));setCustomerId(id);if(customer?.due_days!=null)setDueDate(defaultDueDate(customer.due_days));};
  const createCustomer=async()=>{const credit=can("CUSTOMER_CREDIT_MANAGE")&&moneyValue(customerDraft.credit_limit)>0n,result=await submit("/parties",{kind:"CUSTOMER",name:customerDraft.name.trim(),phone:customerDraft.phone.trim()||undefined,address:customerDraft.address.trim()||undefined,...(credit?{credit_allowed:true,credit_limit:customerDraft.credit_limit,due_days:customerDraft.due_days||"0"}:{})},"Customer ditambahkan.","KASIR");if(result){setCustomerId(result.id);setDueDate(credit?defaultDueDate(customerDraft.due_days):"");setCustomerDraft({name:"",phone:"",address:"",credit_limit:"0",due_days:"0"});setShowCustomerCreate(false);}};
  const scanWallet=async(index,scan,readerCurrent=()=>true)=>{
    const unit_id=payments[index]?.unit_id,epoch=walletScanEpoch.current;
    return require('./walletPreview.cjs').verifyWalletPreview({request:readFinancial,scan,unit_id,
      isCurrent:()=>readerCurrent()&&walletScanEpoch.current===epoch,
      commit:patch=>updatePayment(index,patch)});
  };
  const paymentPayload=p=>p.method==="CASH"?{method:p.method,amount:p.amount,account_id:shift.cash_account_id,tendered:p.tendered||p.amount}:p.method==="DOMPET_SANTRI"?{method:p.method,amount:p.amount,credential_method:p.credential_method,credential:p.credential,unit_id:p.wallet_preview.unit_id}:p.method==="CREDIT"?{method:p.method,amount:p.amount}:{...externalPayment(transferMethod(accounts,p.account_id),p),amount:p.amount,account_id:p.account_id};
  if(!shift)return (
    <ScrollView style={s.flex} contentContainerStyle={s.content}><Card title="Mulai Jualan">{(data.workspace?.active_shifts||[]).map(active=><View key={active.id}><Row label="Operator shift aktif" value={active.operator_name}/><Row label="Terminal" value={active.terminal_name}/><Row label="Laci" value={active.drawer_name}/><Row label="Dibuka" value={new Date(active.opened_at).toLocaleString("id-ID")}/><Text style={s.muted}>{active.is_own?"Shift Anda masih aktif. Muat ulang konteks sebelum melanjutkan.":"Terminal/laci ini masih digunakan. Minta operator menutup shift melalui Tutup Shift dengan hitung kas; Owner tidak mengambil alih otomatis."}</Text></View>)}
      <Row label="Pengguna" value={context.user_name}/>
      <Row label="Peran di usaha ini" value={ROLE_LABELS[context.role]||"Pengguna"}/>
      <Text style={s.muted}>{context.role==="OWNER"?"Owner tetap tercatat sebagai operator transaksi dengan akun sendiri. Hak Owner hanya berlaku pada usaha ini.":"Akun ini memakai hak Kasir yang diberikan Owner. Akses Owner tidak dibuat atau ditiru oleh aplikasi."}</Text>
      <Text style={s.muted}>Terminal dan laci dipilih otomatis jika hanya ada satu pilihan yang sah.</Text>
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
  if(receipt)return <ScrollView style={s.flex} contentContainerStyle={s.content}><Receipt value={receipt} onDone={()=>{setReceipt(null);setCartOpen(false);setPaymentOpen(false);setProductScannerOpen(false);setCart([]);setSearch("");setCategory("");}} onShare={action=>shareReceiptFile(receipt,action)}/></ScrollView>;
  const invalid=!quoteReady||!validMoney(discount)||discountValue>BigInt(pricingQuote?.manual_discount_eligible_total||0)||total<=0n||paymentTotal!==total||effectivePayments.some(p=>!validMoney(p.amount)||moneyValue(p.amount)<=0n||p.method==="CASH"&&p.tendered&&(!validMoney(p.tendered)||moneyValue(p.tendered)<moneyValue(p.amount))||p.method==="DOMPET_SANTRI"&&(!p.credential||!p.wallet_preview||BigInt(p.wallet_preview.available_balance)<moneyValue(p.amount))||p.method==="TRANSFER"&&(!transferMethod(accounts,p.account_id)||!p.reference||p.manual_confirmed!==true)||p.method==="CREDIT"&&(!customerId||!dueDate));
  const scannerState=payment=>scannerAvailability(context.units,payment.unit_id);
  const chooseMethod=method=>{setSplit(false);setPayments([blankPayment(method,totalText)]);};
  const submitCurrent=()=>submitSale({request_id:Crypto.randomUUID(),shift_id:shift.id,customer_id:customerId||undefined,due_date:payments.some(p=>p.method==="CREDIT")?dueDate:undefined,discount:String(discountValue),discount_reason:discountValue>0n?discountReason:undefined,...pricingInput(cart,customerId),payments:effectivePayments.map(paymentPayload)}).then(result=>{if(result){setReceipt(result);setCart([]);setPayments([blankPayment()]);setCustomerId("");setCustomerSearch("");setDueDate("");setDiscount("0");setDiscountReason("");setSplit(false);setCartOpen(false);setPaymentOpen(false);}});
  const paymentLabel=payment=>payment.method==="CASH"?"Tunai":payment.method==="TRANSFER"?`Transfer${transferMethod(accounts,payment.account_id)?` (${transferMethod(accounts,payment.account_id)})`:""}`:payment.method==="DOMPET_SANTRI"?"Dompet Santri":"Piutang";
  const canPay=quoteReady&&cart.length>0&&total>0n&&!(discountValue>0n&&!discountReason)&&!pendingSale;
  const closePayment=()=>setPaymentOpen(false);
  const backToTransaction=()=>{setPaymentOpen(false);setCartOpen(true);};
  const acceptProductBarcode=value=>{const product=allProducts.find(row=>String(row.barcode||"")===String(value||"")&&BigInt(row.available??row.on_hand??0)>0n);setProductScannerOpen(false);if(product)add(product);else{setSearch(String(value||""));Alert.alert("Produk tidak ditemukan","Barcode belum terhubung ke produk yang tersedia.");}};
  return <View style={s.flex}>
    <ScrollView style={s.flex} contentContainerStyle={s.cashierContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Penjualan</Text><Text style={s.muted}>Pilih barang, periksa transaksi, lalu bayar.</Text></View></View>
      {pendingSale&&<Card title="Status transaksi belum pasti"><Text style={s.muted}>Jangan membuat transaksi baru. Periksa request yang sama agar Wallet atau pembayaran lain tidak diproses dua kali.</Text><Button title="Periksa Transaksi Tertunda" onPress={()=>submitSale(null)}/></Card>}
      <View style={s.cashierSearchRow}><View style={s.flex}><Field label="Cari nama, SKU, atau barcode" value={search} onChangeText={setSearch}/></View><Pressable accessibilityRole="button" accessibilityLabel="Pindai barcode produk" style={s.scanProductButton} disabled={!!pendingSale} onPress={()=>setProductScannerOpen(true)}><Icon name="maximize" size={22}/></Pressable></View>
      {categories.length>0&&<Choice options={[["","Semua"],...categories.map(value=>[value,value])]} value={category} onChange={setCategory}/>}
      {cart.length>0&&<Card title="Harga Final dari Server"><Text style={pricingError?s.error:s.muted}>{pricingError || (quoteReady?`Level: ${pricingQuote.level.name}`:"Menghitung harga dan promo…")}</Text>{!!pricingError&&<Button title="Hitung Ulang Harga" secondary onPress={()=>setQuoteAttempt(v=>v+1)}/>}{quoteReady&&<><Row label="Subtotal level" value={rupiah(pricingQuote.subtotal)}/><Row label="Diskon promo/paket" value={rupiah(pricingQuote.discount)}/>{pricingQuote.offers.map((offer,index)=><Text key={index} style={s.muted}>{offer.name}{offer.groups?" · "+offer.groups+" kelompok":""}</Text>)}<Row label="Setelah promo" value={rupiah(pricingQuote.total)}/></>}</Card>}
      {(data.pricing?.promotions||[]).filter(p=>p.kind==="BUNDLE"&&require("./operationalQa.cjs").eligiblePromotion(p)&&p.components.every(c=>BigInt(allProducts.find(x=>x.id===c.product_id)?.available??allProducts.find(x=>x.id===c.product_id)?.on_hand??0)>=BigInt(c.quantity))).map(p=><Button key={p.id} title={`${p.name} · ${rupiah(p.group_price)}`} secondary icon="package" onPress={()=>add({id:`bundle:${p.id}`,promotion_id:p.id,name:p.name,selling_price:p.group_price})}/>)}
      <View style={s.row}><Text style={s.heading}>Produk Tersedia</Text><Text style={s.muted}>{products.length} produk</Text></View>
      <List rows={products} emptyNote="Tidak ada produk tersedia sesuai pencarian." render={product=><Pressable style={s.cashierProduct} disabled={!!pendingSale} onPress={()=>add(product)}><Artwork url={product.image_url} compact/><View style={s.flex}><Text style={s.heading} numberOfLines={1}>{product.name}</Text><Text style={s.muted} numberOfLines={1}>{product.category||"Tanpa kategori"} · Stok {product.available??product.on_hand}</Text></View><Text style={s.price}>{rupiah(product.selling_price)}</Text><View style={s.productAddButton}><Icon name="plus" size={20}/></View></Pressable>}/>
    </ScrollView>
    <View style={s.cashierBar}><Pressable accessibilityRole="button" style={s.cartSummaryButton} onPress={()=>cart.length&&setCartOpen(true)}><Icon name="shopping-bag"/><View><Text style={s.muted}>{itemCount} item</Text><Text style={s.heading}>{rupiah(total)}</Text></View></Pressable><View style={s.flex}><Button title="Lanjut Transaksi" disabled={!canPay} disabledHint={!cart.length?"Pilih produk terlebih dahulu.":discountValue>0n&&!discountReason?"Isi alasan diskon.":pendingSale?"Selesaikan transaksi tertunda.":undefined} onPress={()=>setCartOpen(true)}/></View></View>

    <ProductBarcodeScanner visible={productScannerOpen} onClose={()=>setProductScannerOpen(false)} onScan={acceptProductBarcode}/>

    <Modal visible={cartOpen} transparent animationType="slide" onRequestClose={()=>setCartOpen(false)}>
      <KeyboardAvoidingView style={s.sheetOverlay} behavior={Platform.OS==="ios"?"padding":undefined}><View style={s.sheet}><View style={s.sheetHandle}/><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Atur Transaksi</Text><Text style={s.muted}>Atur barang, pelanggan, dan diskon.</Text></View><Pressable onPress={()=>setCartOpen(false)}><Icon name="x"/></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {cart.length===0?<Empty title="Belum ada barang" note="Tutup panel lalu pilih produk."/>:<Card title="Keranjang"><PricingPolicyNote/>{cart.map(item=><View key={item.id} style={s.cartItem}><Row label={item.name} value={quoteReady?rupiah(item.promotion_id?pricingQuote.offers.find(o=>o.promotion_id===item.promotion_id)?.total:pricingQuote.lines.find(l=>l.product_id===item.id)?.pricing_snapshot.parts.filter(p=>p.kind!=="BUNDLE").reduce((sum,p)=>sum+BigInt(p.total),0n)):"Menghitung…"}/>{item.promotion_id?<Text style={s.muted}>Harga paket final</Text>:can("PRICE_LEVEL_SELECT")&&<CashierPricePicker product={item} policy={data.pricing} value={item.price_level_id} onChange={price_level_id=>{setCart(rows=>rows.map(p=>p.id===item.id?{...p,price_level_id}:p));setDiscount("0");setDiscountReason("");}}/>}<View style={s.quantityRow}><Chip label="−" onPress={()=>quantity(item.id,-1)}/><Text style={s.quantityValue}>{item.quantity}</Text><Chip label="+" onPress={()=>quantity(item.id,1)}/><Chip label="Hapus" onPress={()=>quantity(item.id,-item.quantity)}/></View></View>)}{can("SALE_DISCOUNT")&&<><RupiahField label="Diskon (opsional)" value={discount} onChangeText={setDiscount}/>{discountValue>BigInt(pricingQuote?.manual_discount_eligible_total||0)&&<Text style={s.error}>Diskon melebihi bagian Harga Umum tanpa promo yang eligible.</Text>}{discountValue>0n&&<Field label="Alasan diskon" value={discountReason} onChangeText={setDiscountReason}/>}</>}<Row label="Subtotal level" value={rupiah(subtotal)}/>{quoteReady&&<Row label="Promo/paket" value={rupiah(pricingQuote.discount)}/>}<Text style={s.muted}>{protectedPricing?"Harga khusus/promo/paket tidak menerima diskon tambahan.":"Harga final mengikuti pilihan per item."}</Text>{discountValue>0n&&<Row label="Diskon manual" value={`− ${rupiah(discountValue)}`}/>}<Money label="Total" value={rupiah(total>0n?total:0n)}/></Card>}
        <Card title="Pelanggan"><Text style={s.muted}>Opsional untuk tunai, transfer, dan Dompet; wajib untuk Catat Utang.</Text><Field label="Cari nama atau nomor HP" value={customerSearch} onChangeText={setCustomerSearch}/><SelectRows title="Hasil pelanggan" rows={visibleCustomers} selected={customerId} label={x=>`${x.name}${x.phone?` · ${x.phone}`:""}`} onSelect={selectCustomer}/>{selectedCustomer&&<><Row label="Dipilih" value={selectedCustomer.name}/>{can("CUSTOMER_CREDIT_VIEW")&&<Row label="Piutang berjalan" value={rupiah(selectedCustomer.outstanding||0)}/>}<Button title="Lepas Pelanggan" secondary onPress={()=>{setCustomerId("");setDueDate("");}}/>{can("AR_VIEW")&&<Button title="Lihat Piutang & Pelunasan" secondary onPress={()=>{setCartOpen(false);navigate("PIUTANG");}}/>}</>}{can("CUSTOMER_MANAGE")&&<Button title={showCustomerCreate?"Batal Tambah":"Tambah Pelanggan Baru"} secondary onPress={()=>setShowCustomerCreate(value=>!value)}/>}{showCustomerCreate&&can("CUSTOMER_MANAGE")&&<View><Field label="Nama pelanggan" value={customerDraft.name} onChangeText={name=>setCustomerDraft({...customerDraft,name})}/><Field label="Nomor HP" value={customerDraft.phone} onChangeText={phone=>setCustomerDraft({...customerDraft,phone})}/><Field label="Alamat (opsional)" value={customerDraft.address} onChangeText={address=>setCustomerDraft({...customerDraft,address})}/>{can("CUSTOMER_CREDIT_MANAGE")&&<><RupiahField label="Limit utang (0 = tidak aktif)" value={customerDraft.credit_limit} onChangeText={credit_limit=>setCustomerDraft({...customerDraft,credit_limit})}/><Field label="Termin hari" numeric value={customerDraft.due_days} onChangeText={due_days=>setCustomerDraft({...customerDraft,due_days})}/></>}<Button title="Simpan & Pilih Customer" disabled={!customerDraft.name.trim()} onPress={createCustomer}/></View>}</Card>
      </ScrollView><View style={s.sheetActions}><Button title="Lanjut Pembayaran" disabled={!canPay} onPress={()=>{setCartOpen(false);setPaymentOpen(true);}}/><Button title="Lanjut Pilih Barang" secondary onPress={()=>setCartOpen(false)}/></View></View></KeyboardAvoidingView>
    </Modal>

    {paymentOpen&&<Modal visible transparent animationType="slide" onRequestClose={closePayment}>
      <KeyboardAvoidingView style={s.sheetOverlay} behavior={Platform.OS==="ios"?"padding":undefined}><View style={[s.sheet,s.paymentSheet]}><View style={s.sheetHandle}/><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Pembayaran</Text><Text style={s.muted}>{itemCount} item · {selectedCustomer?.name||"Pelanggan umum"}</Text></View><Pressable onPress={closePayment}><Icon name="x"/></Pressable></View><ScrollView keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        <Card title="Pilih metode"><Choice options={[["CASH","Tunai"],["TRANSFER","Transfer"],["DOMPET_SANTRI","Dompet Santri"]]} value={!split?payments[0]?.method:""} onChange={chooseMethod}/><Button title="Catat sebagai Utang" secondary disabled={!creditState.enabled} disabledHint={creditState.reason} onPress={()=>chooseMethod("CREDIT")}/><Button title={split?"Batalkan Split Payment":"Split Payment (opsi lanjutan)"} secondary onPress={()=>{if(split){setSplit(false);setPayments([blankPayment("CASH",totalText)]);}else setSplit(true);}}/></Card>
        {payments.map((payment,index)=>{const availability=scannerState(payment),change=payment.method==="CASH"?cashChange(payment.tendered||payment.amount,payment.amount):null;return <Card key={index} title={split?`Pembayaran ${index+1}`:paymentLabel(payment)}>{split&&<Choice options={methods.filter(method=>!payments.some((row,i)=>i!==index&&row.method===method)).map(method=>[method,method==="CASH"?"Tunai":method==="TRANSFER"?"Transfer":method==="DOMPET_SANTRI"?"Dompet Santri":"Piutang"])} value={payment.method} onChange={method=>updatePayment(index,blankPayment(method,""))}/>}{split?<RupiahField label="Nominal" value={payment.amount} onChangeText={amount=>updatePayment(index,{amount})}/>:<Row label="Total tagihan" value={rupiah(payment.amount)}/>}{payment.method==="CASH"&&<><RupiahField label="Uang diterima (kosong = uang pas)" value={payment.tendered} onChangeText={tendered=>updatePayment(index,{tendered})}/>{change!==null&&<Row label="Kembalian" value={rupiah(change)}/>}</>}{payment.method==="TRANSFER"&&<><Text style={s.muted}>Pilih rekening Bank/QRIS tujuan yang sah; kas fisik tidak bertambah.</Text><SelectRows title="Akun penerimaan" rows={accounts.filter(account=>["BANK","QRIS"].includes(account.kind))} selected={payment.account_id} label={account=>`${account.name} · ${account.kind}`} onSelect={account_id=>updatePayment(index,{account_id,reference:"",manual_confirmed:false})}/><Field label="Referensi bukti terverifikasi" value={payment.reference} onChangeText={reference=>updatePayment(index,{reference,manual_confirmed:false})}/><Choice options={[[false,"Belum diverifikasi"],[true,"Sudah diverifikasi manual"]]} value={payment.manual_confirmed===true} onChange={manual_confirmed=>updatePayment(index,{manual_confirmed})}/></>}{payment.method==="DOMPET_SANTRI"&&<><SelectRows title="Unit santri" rows={context.units} selected={payment.unit_id} label={unit=>unit.nama_unit||unit.unit_name||unit.name} onSelect={unit_id=>updatePayment(index,{unit_id,credential:"",credential_method:"",wallet_preview:null})}/><WalletCredentialScanner scanContext={(context.business.id||context.business_id||"")+":"+context.user_id+":"+payment.unit_id+":"+payment.method+":"+String(module==="KASIR")} disabled={!availability.enabled||module!=="KASIR"} disabledReason={availability.reason} onScan={(scan,isCurrent)=>scanWallet(index,scan,isCurrent)}/>{payment.wallet_preview&&<View style={s.alertSuccess}><Text style={s.heading}>Santri terverifikasi</Text><Row label="Nama" value={payment.wallet_preview.name}/><Row label="Unit" value={(context.units.find(unit=>String(unit.unit_id??unit.id)===String(payment.wallet_preview.unit_id))||{}).nama_unit||"Unit terverifikasi"}/><Row label="Saldo" value={rupiah(payment.wallet_preview.available_balance)}/><Text style={s.muted}>Periksa identitas dan saldo sebelum konfirmasi. Credential mentah tidak ditampilkan.</Text><Button title="Batalkan Credential" secondary onPress={()=>updatePayment(index,{credential:"",credential_method:"",wallet_preview:null})}/></View>}</>}{payment.method==="CREDIT"&&<><Row label="Pelanggan" value={selectedCustomer?.name||"Belum dipilih"}/><Row label="Piutang baru" value={rupiah(payment.amount)}/>{selectedCustomer&&can("CUSTOMER_CREDIT_VIEW")&&<><Row label="Piutang berjalan" value={rupiah(selectedCustomer.outstanding||0)}/><Row label="Limit kredit" value={rupiah(selectedCustomer.credit_limit||0)}/></>}<Field label="Jatuh tempo YYYY-MM-DD" value={dueDate} onChangeText={setDueDate}/><Text style={s.muted}>Tidak ada kas/bank masuk sampai cicilan benar-benar diterima.</Text></>}{split&&payments.length>1&&<Button title="Hapus Pembayaran" secondary onPress={()=>setPayments(rows=>rows.filter((_,i)=>i!==index))}/>}</Card>})}
        {split&&payments.length<4&&methods.some(method=>!payments.some(payment=>payment.method===method))&&<Button title="Tambah Metode Pembayaran" secondary onPress={()=>setPayments(rows=>[...rows,blankPayment(methods.find(method=>!rows.some(payment=>payment.method===method)),"")])}/>}<Card title="Ringkasan"><Row label="Subtotal" value={rupiah(subtotal)}/>{discountValue>0n&&<Row label="Diskon" value={`− ${rupiah(discountValue)}`}/>}<Money label="Total" value={rupiah(total)}/><Row label="Pembayaran" value={rupiah(paymentTotal)}/>{effectivePayments.map((payment,index)=><Row key={index} label={paymentLabel(payment)} value={rupiah(payment.amount)}/>)}</Card>
      </ScrollView><View style={s.sheetActions}><Button title="Konfirmasi & Bayar" disabled={!!pendingSale||invalid} disabledHint={pendingSale?"Periksa transaksi tertunda terlebih dahulu.":paymentTotal!==total?"Total pembayaran harus sama dengan tagihan.":invalid?"Lengkapi dan verifikasi metode pembayaran.":undefined} onPress={submitCurrent}/><Button title="Kembali ke Atur Transaksi" secondary onPress={backToTransaction}/></View></View></KeyboardAvoidingView>
    </Modal>}
  </View>;
}
function ProductBarcodeScanner({ visible, onClose, onScan }) {
  const [permission,requestPermission]=useCameraPermissions(),scanLock=useRef(false);
  const close=()=>{scanLock.current=false;onClose();};
  const accept=event=>{if(scanLock.current)return;scanLock.current=true;onScan(event.data);};
  return <Modal visible={visible} transparent animationType="slide" onShow={()=>{scanLock.current=false;}} onRequestClose={close}><View style={s.scannerOverlay}>{permission?.granted?<CameraView style={s.productScannerCamera} facing="back" barcodeScannerSettings={{barcodeTypes:["ean13","ean8","code128","code39","upc_a","upc_e","qr"]}} onBarcodeScanned={accept}/>:<View style={s.scannerPermission}><Icon name="camera" size={30}/><Text style={s.heading}>Izin kamera diperlukan</Text><Text style={s.muted}>Izinkan kamera untuk memindai barcode produk.</Text><Button title="Izinkan Kamera" onPress={requestPermission}/></View>}<View style={s.productScannerPanel}><Text style={s.scannerText}>Arahkan kamera ke barcode produk.</Text><Button title="Batal" secondary onPress={close}/></View></View></Modal>;
}
function Transactions({data,can,submit,request,shareReceiptFile,navigate,feedbackError,feedbackNotice,busy}){
 const [source,setSource]=useState(null),[receipt,setReceipt]=useState(null),[loadError,setLoadError]=useState(''),[form,setForm]=useState({product_id:'',quantity:'1',reason:'',reference:'',refund_confirmed:false}),loadSequence=useRef(0);
 const close=()=>{loadSequence.current++;setSource(null);setReceipt(null);};
 const open=async row=>{const sequence=++loadSequence.current;setSource(row);setReceipt(null);setLoadError('');setForm({product_id:'',quantity:'1',reason:'',reference:'',refund_confirmed:false});const result=await request('/sales/'+row.id);if(sequence!==loadSequence.current)return;if(result?.sale?.id===row.id)setReceipt(result);else setLoadError('Struk belum dapat dimuat. Coba lagi sebelum melakukan retur.');};
 const ownShift=data.workspace?.open_shift,context=receipt?.refund_context;
 const matchingShift=ownShift&&context?.cash_accounts?.some(account=>account.id===ownShift.cash_account_id)?ownShift:null;
 const validReturn=require('./operationalQa.cjs').returnQuantityAllowed(receipt,form.product_id,form.quantity)&&form.reason.trim();
 const save=()=>Alert.alert('Konfirmasi retur','Server merekonsiliasi stok dan sumber dana asli. Catatan ini tidak otomatis mengembalikan uang bank/QRIS.',[{text:'Batal',style:'cancel'},{text:'Lanjut',style:'destructive',onPress:async()=>{const result=await submit('/sale-returns',{request_id:Crypto.randomUUID(),source_id:source.id,items:[{product_id:form.product_id,quantity:form.quantity}],reason:form.reason,shift_id:matchingShift?.id,reference:form.reference||undefined,refund_confirmed:form.refund_confirmed},'Retur penjualan tersimpan.','TRANSAKSI');if(result)close();}}]);
 return <><Card title="Penjualan"><Text style={s.muted}>Pilih struk untuk rincian, cetak ulang atau retur sesuai izin.</Text></Card><List rows={data.sales} render={row=><Pressable onPress={()=>row.kind==='SALE'&&open(row)}><Row label={row.reference||row.id.slice(0,8)} value={rupiah(row.total)}/><Text style={s.muted}>{row.kind==='SALE_RETURN'?'Retur':row.channel==='ONLINE'?'Online':'Kasir'}</Text></Pressable>}/>
 <FocusedEditor visible={!!source} title="Detail Penjualan dan Retur" onClose={close} error={feedbackError||loadError} notice={feedbackNotice}>
 {!receipt&&!loadError&&<Text style={s.muted}>Memuat struk…</Text>}{loadError&&<Button title="Muat Ulang Struk" secondary onPress={()=>open(source)}/>}
 {receipt&&can('SALE_REFUND')&&<Card title="Retur Penjualan"><Text style={s.muted}>Pilih barang dari struk asli. Jumlah tersisa diperiksa ulang server saat penyimpanan.</Text>{context?.items?.map(item=><Pressable key={item.product_id} disabled={BigInt(item.remaining_quantity)<=0n} onPress={()=>setForm({...form,product_id:item.product_id,quantity:'1'})}><Row label={(form.product_id===item.product_id?'✓ ':'')+item.name} value={'Sisa '+item.remaining_quantity}/></Pressable>)}{!context&&<Text style={s.error}>Backend belum menyediakan konteks retur untuk versi aplikasi ini.</Text>}<Field label="Jumlah retur" numeric value={form.quantity} onChangeText={quantity=>setForm({...form,quantity})}/><Field label="Alasan retur" value={form.reason} onChangeText={reason=>setForm({...form,reason})}/>
 {context?.cash_accounts?.length>0&&<><Row label="Laci sumber tunai" value={context.cash_accounts.map(p=>p.name).join(', ')}/><Text style={s.muted}>{matchingShift?'Shift Anda pada laci sumber akan digunakan; ID shift tidak perlu diisi.':'Jika refund memerlukan uang tunai, buka shift milik Anda pada laci sumber melalui Kasir. Backend tetap memeriksa laci dan nominal.'}</Text>{!matchingShift&&<Button title="Buka Kasir untuk Memeriksa Shift" secondary onPress={()=>{close();navigate('KASIR');}}/>}</>}
 {context?.external_source&&<><Text style={s.muted}>Bila ada pengembalian Bank/QRIS, isi bukti pengembalian yang benar-benar dilakukan. Ini bukan refund otomatis provider.</Text><Field label="Referensi bukti pengembalian" value={form.reference} onChangeText={reference=>setForm({...form,reference,refund_confirmed:false})}/><Choice options={[[false,'Belum dikonfirmasi'],[true,'Pengembalian sudah dikonfirmasi']]} value={form.refund_confirmed} onChange={refund_confirmed=>setForm({...form,refund_confirmed})}/></>}
 <Button title="Proses Retur" danger disabled={busy||!validReturn} onPress={save}/></Card>}
 {receipt&&<Receipt value={receipt} mode="history" onDone={close} onShare={action=>shareReceiptFile(receipt,action)}/>}
 </FocusedEditor></>;
}
function Receipt({ value, onDone, onShare, mode="success" }) {
  const receipt=receiptPresentation(value),{brand,sale}=receipt;
  const [outputBusy,setOutputBusy]=useState(false),[outputError,setOutputError]=useState(""),[outputNotice,setOutputNotice]=useState("");
  const output=async action=>{if(outputBusy)return;setOutputBusy(true);setOutputError("");setOutputNotice("");try{const result=await onShare(action);setOutputNotice(result?.cancelled?"Dibatalkan. Transaksi tetap tersimpan.":result?.saved?"PDF struk berhasil disimpan.":"");}catch(error){setOutputError(receiptActionError(error));}finally{setOutputBusy(false);}};
  const [detailsOpen,setDetailsOpen]=useState(mode==="history");
  const credit=receipt.payments.filter(payment=>payment.method==="CREDIT").reduce((sum,payment)=>sum+payment.amountValue,0n);
  const cashTendered=receipt.payments.filter(payment=>payment.method==="CASH").reduce((sum,payment)=>sum+(payment.tenderedValue??payment.amountValue),0n),cashChange=receipt.payments.filter(payment=>payment.method==="CASH").reduce((sum,payment)=>sum+(payment.changeValue??0n),0n);
  return <><View style={s.receiptHero}><View style={s.receiptSuccessIcon}><Icon name={mode==="success"?"check":"file-text"} size={26} color={colors.surface}/></View><Text style={s.sectionTitle}>{mode==="success"?"Pembayaran berhasil":"Struk tersimpan"}</Text><Text style={s.muted}>{mode==="success"?"Transaksi sudah tersimpan dan siap dilayani berikutnya.":"Struk dimuat dari transaksi canonical; cetak ulang tidak membuat penjualan baru."}</Text><Money value={rupiah(receipt.total)}/></View>
    <Card title="Ringkasan Pembayaran"><Row label="Total belanja" value={rupiah(receipt.total)}/>{cashTendered>0n&&<><Row label="Uang diterima" value={rupiah(cashTendered)}/><Row label="Kembalian" value={rupiah(cashChange)}/></>}<Button title={detailsOpen?"Sembunyikan Rincian":"Lihat Rincian Struk"} secondary onPress={()=>setDetailsOpen(value=>!value)}/></Card>
    {detailsOpen&&<Card title={brand.name||"Struk Penjualan"}>
      {!!brand.header&&<Text style={s.receiptCenter}>{brand.header}</Text>}
      {!!brand.address&&<Text style={s.receiptCenter}>{brand.address}</Text>}
      {!!brand.phone&&<Text style={s.receiptCenter}>{brand.phone}</Text>}
      {brand.pricing&&<><Row label="Level harga" value={brand.pricing.level.name}/>{brand.pricing.offers.map((offer,index)=><Row key={index} label={offer.kind==="BUNDLE"?"Paket":"Promo"} value={offer.name}/>)}</>}<View style={s.receiptMeta}><Row label="Nomor transaksi" value={brand.receipt||sale.id}/><Row label="Waktu" value={new Date(sale.created_at).toLocaleString("id-ID",{dateStyle:"medium",timeStyle:"short"})}/><Row label="Kasir" value={brand.cashier_name||"—"}/><Row label="Pelanggan" value={receipt.customerLabel}/></View>
      <View style={s.receiptDivider}/><Text style={s.receiptSectionTitle}>Rincian produk</Text>
      {receipt.items.map(item=><View key={item.product_id} style={s.receiptItem}><View style={s.flex}><Text style={s.heading}>{item.name}</Text><Text style={s.muted}>{item.pricing_snapshot?.parts.some(p=>p.unit_price!=null&&String(p.unit_price)!==String(item.unit_price))?"Harga per bagian tercatat":item.quantity+" × "+rupiah(item.unit_price)}</Text>{item.pricing_snapshot?.parts.filter(p=>p.unit_price!=null).map((part,index)=><Text key={index} style={s.muted}>{part.quantity} × {rupiah(part.unit_price)} · {part.level_name}{part.name?" · "+part.name:""}</Text>)}</View><Text style={s.value}>{rupiah(item.lineTotal)}</Text></View>)}
      <View style={s.receiptDivider}/><Row label="Subtotal" value={rupiah(receipt.subtotal)}/>{receipt.discount>0n&&<Row label="Diskon" value={`− ${rupiah(receipt.discount)}`}/>}<View style={s.receiptTotal}><Text style={s.heading}>Total tagihan</Text><Text style={s.receiptTotalValue}>{rupiah(receipt.total)}</Text></View>
      <View style={s.receiptDivider}/><Text style={s.receiptSectionTitle}>Pembayaran</Text>
      {receipt.payments.map((payment,index)=><View key={`${payment.method}-${index}`} style={s.receiptPayment}><Row label={payment.displayLabel} value={rupiah(payment.amountValue)}/>{payment.method==="CASH"&&<><Row label="Uang diterima" value={rupiah(payment.tenderedValue??payment.amountValue)}/><Row label="Kembalian" value={rupiah(payment.changeValue??0n)}/></>}{payment.reference&&<Row label="Referensi" value={payment.reference}/>}</View>)}
      <View style={s.receiptTotal}><Text style={s.heading}>Total pembayaran</Text><Text style={s.receiptTotalValue}>{rupiah(receipt.paymentTotal)}</Text></View>
      {credit>0n&&<Row label="Status" value={`Piutang ${rupiah(credit)}`}/>}<Text style={s.receiptFooter}>{brand.footer || "Powered by KlikPesantren"}</Text>
    </Card>}{!!outputError&&<Text style={s.error}>{outputError}</Text>}{!!outputNotice&&<Text style={s.success}>{outputNotice}</Text>}<View style={s.actionRow}><Button title="Simpan PDF" secondary icon="download" disabled={outputBusy} onPress={()=>output("save")}/><Button title="Bagikan Struk" secondary icon="share-2" disabled={outputBusy} onPress={()=>output("share")}/><Button title={mode==="history"?"Cetak Ulang":"Cetak Struk"} secondary icon="printer" disabled={outputBusy} onPress={()=>output("print")}/></View><Text style={s.muted}>Cetak melalui layanan cetak Android. Printer Bluetooth thermal belum diverifikasi.</Text><Button title={mode==="success"?"Selesai":"Tutup Struk"} icon={mode==="success"?"shopping-bag":"x"} onPress={onDone}/></>;
}
function Shifts({ data, submit, context }) {
  const [actual,setActual]=useState(""),open=data.workspace?.open_shift;
  return <>{open&&<Card title="Shift Aktif">{(data.workspace?.active_shifts||[]).filter(active=>active.id===open.id).map(active=><View key={active.id}><Row label="Operator" value={active.operator_name}/><Row label="Terminal" value={active.terminal_name}/><Row label="Laci" value={active.drawer_name}/></View>)}<Text style={s.muted}>Penutupan mencatat operator, waktu, kas aktual dan selisih. Owner dapat mengambil alih melalui rekonsiliasi kas dan audit di bawah.</Text><Row label="Dibuka" value={new Date(open.opened_at).toLocaleString("id-ID")}/><RupiahField label="Kas fisik aktual" value={actual} onChangeText={setActual}/><Button title="Tutup Shift" danger disabled={!actual} disabledHint={!actual?"Hitung dan masukkan kas fisik aktual.":undefined} onPress={()=>submit("/shifts/close",{shift_id:open.id,actual_cash:actual},"Shift ditutup.","SHIFT")}/></Card>}<TakeoverControls data={data} context={context} submit={submit}/><List rows={data.shifts} render={r=><><Row label={r.cashier} value={r.status}/><Row label={r.terminal} value={rupiah(r.difference||0)}/></>}/></>;
}
function Products({ data, context, can, submit, uploadProductAsset, importProductWorkbook, shareWorkbookFile, navigate, readFinancial, busy, feedbackError, feedbackNotice }) {
  const empty={sku:"",barcode:"",name:"",category:"",uom:"pcs",image_url:"",selling_price:"",reference_purchase_price:"",minimum_stock:"0",active:true,sellable:true,online_visible:false};
  const [localError,setLocalError]=useState(""),[exportQuery,setExportQuery]=useState({q:"",stock:""});
  const [form,setForm]=useState(empty),[editing,setEditing]=useState(null),[showForm,setShowForm]=useState(false),[selected,setSelected]=useState(null),[category,setCategory]=useState(""),[activeFilter,setActiveFilter]=useState("ALL"),[imageBusy,setImageBusy]=useState(false);
  const [importOpen,setImportOpen]=useState(false),[importAsset,setImportAsset]=useState(null),[importPreview,setImportPreview]=useState(null),[importResult,setImportResult]=useState(null),[fileProgress,setFileProgress]=useState(null);
  const formIssue=require("./productSearch.cjs").productFormIssue(form,{editing:!!editing,costVisible:can("PRODUCT_COST_VIEW")});
  const closeForm=()=>{setEditing(null);setShowForm(false);setForm(empty);};
  const edit=p=>{setLocalError("");setSelected(null);setEditing(p.id);setShowForm(true);setForm({...empty,...p,selling_price:String(p.selling_price),reference_purchase_price:String(p.reference_purchase_price||""),minimum_stock:String(p.minimum_stock)});};
  const save=()=>submit(editing?`/products/${editing}`:"/products",Object.fromEntries(Object.entries(form).filter(([key])=>key!=="reference_purchase_price"||can("PRODUCT_COST_VIEW"))),editing?"Produk diperbarui.":"Produk ditambahkan.","PRODUK").then(result=>{if(result)closeForm();});
  const chooseImage=async camera=>{setImageBusy(true);try{if(camera){const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted){Alert.alert("Izin diperlukan","Izinkan kamera untuk mengambil foto produk.");return;}}const picked=camera?await ImagePicker.launchCameraAsync({mediaTypes:["images"],quality:.8}):await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:.8});if(picked.canceled)return;const resized=await ImageManipulator.manipulateAsync(picked.assets[0].uri,[{resize:{width:1600}}],{compress:.75,format:ImageManipulator.SaveFormat.JPEG});const uploaded=await uploadProductAsset({...resized,fileName:"product.jpg",mimeType:"image/jpeg"});if(uploaded?.url)setForm(current=>({...current,image_url:uploaded.url}));}catch{setLocalError("Foto belum berhasil diproses. Periksa izin kamera/galeri dan koneksi, lalu coba lagi.");}finally{setImageBusy(false);}};
  const pickWorkbook=async()=>{setLocalError("");try{const picked=await DocumentPicker.getDocumentAsync({type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",multiple:false,copyToCacheDirectory:true});if(picked.canceled)return;const asset=picked.assets[0];if(!asset.name?.toLowerCase().endsWith(".xlsx")||asset.size>2*1024*1024){Alert.alert("File tidak didukung","Pilih file .xlsx dengan ukuran maksimal 2 MB.");return;}setImportAsset(asset);setImportPreview(null);setImportResult(null);const preview=await importProductWorkbook(asset,false);if(preview)setImportPreview(preview);}catch{setLocalError("Pemilih file tidak tersedia atau file gagal dibaca. Pilih ulang file .xlsx.");}};
  const commitWorkbook=()=>Alert.alert("Import produk?","Seluruh baris sudah divalidasi server. Import mengubah master produk saja dan tidak mengubah stok atau FIFO.",[{text:"Batal",style:"cancel"},{text:"Import",onPress:async()=>{const result=await importProductWorkbook(importAsset,true);if(result){setImportResult(result);setImportPreview(result);}}}]);
  const shareWorkbook=async(kind)=>{setFileProgress(0);try{const today=new Date().toISOString().slice(0,10),merchant=String(context.business.display_name).normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").toLowerCase()||"merchant";await shareWorkbookFile(kind==="template"?"/products/template.xlsx":"/products/export.xlsx",kind==="template"?"template-import-produk-suq-shogir.xlsx":`produk-${merchant}-${today}.xlsx`,kind==="export"?{category:category||undefined,status:activeFilter,q:exportQuery.q||undefined,stock:exportQuery.stock||undefined}:undefined,setFileProgress);}finally{setFileProgress(null);}};
  return <><View style={s.sectionHeader}><Text style={s.sectionTitle}>Daftar Produk</Text></View><View style={s.actionRow}>{can("PRODUCT_MANAGE")&&can("PRODUCT_PRICE_MANAGE")&&<Button title="Tambah Produk" icon="plus" onPress={()=>{setSelected(null);setLocalError("");setForm(empty);setShowForm(true);}}/>}{can("PRODUCT_MANAGE")&&can("PRODUCT_PRICE_MANAGE")&&can("PRODUCT_COST_VIEW")&&<Button title="Import Excel" secondary onPress={()=>{setImportOpen(true);setLocalError("");}}/>}<Button title="Export Excel" secondary onPress={()=>shareWorkbook("export")}/></View>{fileProgress!=null&&<Text style={s.muted}>Menyiapkan file… {Math.round(fileProgress*100)}%</Text>}
  <Text style={s.muted}>Export mengikuti pencarian dan filter terakhir yang diterapkan, termasuk seluruh halaman hasilnya.</Text><ProductSearch request={readFinancial} revision={data.products} filters title="Cari Produk" onFiltersChange={value=>{setCategory(value.category);setActiveFilter(value.status);setExportQuery({q:value.q,stock:value.stock});}} onSelect={setSelected}/>
  <FocusedEditor error={feedbackError} notice={feedbackNotice} visible={!!selected} title="Detail Produk" onClose={()=>setSelected(null)}>{selected&&<Card title="Detail Produk"><Row label="Produk" value={selected.name}/><Row label="Harga jual" value={rupiah(selected.selling_price)}/><Row label="Stok tersedia" value={String(selected.available??selected.on_hand??0)}/><Row label="Satuan" value={selected.uom||"pcs"}/>{can("PRODUCT_COST_VIEW")&&<Row label="Harga beli referensi" value={selected.reference_purchase_price?rupiah(selected.reference_purchase_price):"Belum diisi"}/>}<Text style={s.muted}>{Number(selected.available??selected.on_hand??0)>0?"Produk siap dijual selama statusnya aktif.":"Produk belum dapat dijual karena stok tersedia habis."}</Text>{can("PRODUCT_MANAGE")&&<Button title="Edit Produk" secondary onPress={()=>edit(selected)}/>} {can("PURCHASE_CREATE")&&<Button title="Tambah Stok lewat Pembelian" onPress={()=>navigate("PEMBELIAN")}/>} {can("INVENTORY_VIEW")&&<Button title="Lihat Riwayat Stok" secondary onPress={()=>navigate("STOK")}/>}<IdentityControls key={selected.id} product={selected} context={context} submit={submit} onSaved={()=>setSelected(null)}/><Button title="Tutup" secondary onPress={()=>setSelected(null)}/></Card>}</FocusedEditor>
  <FocusedEditor error={feedbackError} notice={feedbackNotice} visible={showForm} title={editing?"Edit Produk":"Tambah Produk"} onClose={closeForm}>{!!localError&&<Text style={s.error}>{localError}</Text>}<Card title={editing?"Edit Produk":"Tambah Produk"}><Text style={s.muted}>Produk baru belum memiliki stok. Setelah disimpan, masukkan barang lewat Pembelian atau Posisi Awal Usaha.</Text><Text style={s.formSectionTitle}>Informasi Barang</Text>{editing?<><Row label="SKU" value={form.sku}/><Row label="Barcode" value={form.barcode||"Belum diisi"}/><Text style={s.muted}>Owner mengubah SKU/barcode melalui Ubah SKU / Barcode pada detail produk, dengan alasan dan audit.</Text></>:<><Field label="SKU" value={form.sku} onChangeText={sku=>setForm({...form,sku})}/><Field label="Barcode" value={form.barcode} onChangeText={barcode=>setForm({...form,barcode})}/></>}<Fields value={form} setValue={setForm} fields={[["name","Nama produk"],["category","Kategori"],["uom","Satuan"]]}/><Text style={s.formSectionTitle}>Foto Produk</Text><Text style={s.muted}>Pilih foto yang jelas dari galeri atau kamera.</Text>{form.image_url?<><Artwork url={form.image_url}/><Button title="Hapus Foto" secondary onPress={()=>setForm({...form,image_url:""})}/></>:null}<View style={s.actionRow}><Button title={imageBusy?"Memproses…":"Pilih dari Galeri"} secondary disabled={imageBusy} onPress={()=>chooseImage(false)}/><Button title="Ambil Foto" secondary disabled={imageBusy} onPress={()=>chooseImage(true)}/></View><Text style={s.formSectionTitle}>Harga</Text>{can("PRODUCT_PRICE_MANAGE")?<RupiahField label="Harga jual" value={form.selling_price} onChangeText={selling_price=>setForm({...form,selling_price})}/>:<Row label="Harga jual (hanya lihat)" value={rupiah(form.selling_price)}/>}<Text style={s.muted}>Harga Umum menjadi dasar transaksi kasir; harga khusus dipilih kasir per item. Produk baru belum memiliki stok.</Text>{can("PRODUCT_COST_VIEW")&&<RupiahField label="Harga beli referensi (opsional)" value={form.reference_purchase_price} onChangeText={reference_purchase_price=>setForm({...form,reference_purchase_price})}/>}<Text style={s.muted}>Harga referensi hanya membantu input. Nilai stok dan harga pokok tetap berasal dari pembelian atau posisi awal yang diposting.</Text><Text style={s.formSectionTitle}>Persediaan</Text><Field label="Batas stok menipis" numeric value={String(form.minimum_stock)} onChangeText={minimum_stock=>setForm({...form,minimum_stock})}/><Text style={s.formSectionTitle}>Status</Text><Choice options={[[true,"Aktif"],[false,"Nonaktif"]]} value={form.active} onChange={active=>setForm({...form,active})}/><Choice options={[[true,"Bisa dijual"],[false,"Belum bisa dijual"]]} value={form.sellable} onChange={sellable=>setForm({...form,sellable})}/><Button title={editing?"Simpan Perubahan":"Simpan Produk"} disabled={busy||!!formIssue} disabledHint={formIssue||undefined} onPress={save}/><Button title="Batal" secondary onPress={closeForm}/></Card></FocusedEditor>
  <FocusedEditor error={feedbackError} notice={feedbackNotice} visible={importOpen} title="Import Produk Excel" onClose={()=>setImportOpen(false)}>{!!localError&&<Text style={s.error}>{localError}</Text>}<ProductWorkbookImport asset={importAsset} preview={importPreview} result={importResult} busy={busy} onTemplate={()=>shareWorkbook("template")} onPick={pickWorkbook} onCommit={commitWorkbook} onRetryPreview={async()=>{const preview=await importProductWorkbook(importAsset,false);if(preview)setImportPreview(preview);}} onClose={()=>setImportOpen(false)}/></FocusedEditor></>;
}
function workbookError(value){const [field,code]=String(value).includes(':')?String(value).split(':'):['',value],names={sku:'SKU',barcode:'Barcode',name:'Nama produk',category:'Kategori',uom:'Satuan',selling_price:'Harga jual',reference_purchase_price:'Harga beli',active:'Status',identity:'Identitas'},labels={REQUIRED:'Kolom wajib belum diisi',IDENTIFIER_MUST_BE_TEXT:'SKU/barcode harus berformat Text',FORMULA_NOT_ALLOWED:'Formula tidak boleh dipakai',INVALID_RUPIAH:'Harga harus Rupiah bulat dan tidak negatif',INVALID_STATUS:'Status harus AKTIF atau NONAKTIF',INVALID_TEXT:'Teks tidak valid atau terlalu panjang',SKU_BARCODE_CONFLICT:'SKU dan barcode menunjuk produk berbeda'};return (names[field]?names[field]+': ':'')+(labels[code]||(/DUPLICATE/.test(code)?'Duplikat; periksa baris terkait':'Data tidak valid ('+code+')'));}
function ProductWorkbookImport({asset,preview,result,busy,onTemplate,onPick,onCommit,onRetryPreview,onClose}) {
  const summary=preview?.summary;
  return <Card title="Import Produk Excel"><Text style={s.muted}>Unduh template, isi maksimal 1.000 produk, lalu pratinjau. SKU dan barcode harus berformat Text agar nol di depan tetap utuh.</Text><View style={s.actionRow}><Button title="Unduh Template" secondary icon="download" onPress={onTemplate}/><Button title={asset?"Pilih File Lain":"Pilih File .xlsx"} disabled={busy} secondary icon="upload" onPress={onPick}/></View>{busy&&<Text style={s.muted}>Mengunggah dan memvalidasi workbook…</Text>}{asset&&<Row label="File" value={asset.name}/>} {asset&&!preview&&!busy&&<Button title="Ulangi Pratinjau File" secondary onPress={onRetryPreview}/>} {summary&&<><Text style={s.heading}>Hasil validasi server</Text><Row label="Produk baru" value={String(summary.create)}/><Row label="Produk diperbarui" value={String(summary.update)}/><Row label="Tidak berubah / dilewati" value={String(summary.unchanged)}/><Row label="Duplikat" value={String(summary.duplicate)}/><Row label="Baris invalid" value={String(summary.invalid)}/><List rows={preview.rows.filter(row=>row.status!=="UNCHANGED")} emptyNote="Semua baris tidak berubah." render={row=><><Row label={`Baris ${row.row} · ${row.sku||"SKU invalid"}`} value={({CREATE:"Baru",UPDATE:"Diperbarui",DUPLICATE:"Duplikat",INVALID:"Perlu diperbaiki"})[row.status]||row.status}/><Text style={s.heading}>{row.name||'Nama belum valid'}</Text><Row label="Barcode" value={row.barcode||'—'}/><Row label="Harga jual" value={rupiah(row.selling_price)}/>{row.identity_changes?.map(change=><Text key={change.field} style={s.error}>Perubahan {change.field}: {change.before||'kosong'} → {change.after||'kosong'}. Periksa identitas sebelum konfirmasi.</Text>)}{row.errors?.length>0&&<Text style={s.error}>{row.errors.map(workbookError).join(" · ")}</Text>}</>}/>{result?.committed?<View style={s.alertSuccess}><Text style={s.success}>Import tersimpan atomik: {summary.create} baru, {summary.update} diperbarui, {summary.unchanged} dilewati.</Text></View>:<Button title="Konfirmasi Import" disabled={busy||!preview.can_commit} disabledHint={!preview.can_commit?"Perbaiki seluruh baris invalid atau duplikat sebelum import.":undefined} onPress={onCommit}/>}</>}<Button title="Tutup" secondary onPress={onClose}/></Card>;
}
function Inventory({data,context,can,submit,navigate,readFinancial,busy,feedbackError,feedbackNotice}){
 const [section,setSection]=useState('STOCK'),[mode,setMode]=useState(can('INVENTORY_ADJUST')?'ADJUST':'OPNAME'),[selected,setSelected]=useState(null),[countSnapshot,setCountSnapshot]=useState(null);
 const blank={product_id:'',direction:can('PRODUCT_COST_VIEW')?'IN':'OUT',quantity:'',actual_stock:'',reason:'',unit_cost:''};
 const [form,setForm]=useState(blank),requestId=useRef(Crypto.randomUUID()),inv=data.inventory||{};
 const choose=p=>{setSelected(p);setCountSnapshot({on_hand:String(p.on_hand),stock_version:String(p.stock_version)});setForm({...blank,product_id:p.id});requestId.current=Crypto.randomUUID();setSection('ADJUST');};
 const preview=require('./productSearch.cjs').stockPreview({mode,direction:form.direction,current:countSnapshot?.on_hand,quantity:form.quantity,actual:form.actual_stock});
 const needsCost=preview&&BigInt(preview.delta)>0n;
 const valid=selected&&selected.active!==false&&preview?.valid&&(mode==='OPNAME'||preview.delta!=='0')&&form.reason.trim()&&(mode==='OPNAME'||!needsCost||can('PRODUCT_COST_VIEW')&&validMoney(form.unit_cost))&&(mode!=='OPNAME'||can('INVENTORY_OPNAME'));
 const save=async()=>{const payload=mode==='OPNAME'?{product_id:form.product_id,actual_stock:form.actual_stock,expected_stock:countSnapshot.on_hand,expected_version:countSnapshot.stock_version,reason:form.reason,unit_cost:form.unit_cost||'0',request_id:requestId.current}:{...form,request_id:requestId.current,unit_cost:form.unit_cost||'0'};const result=await submit(mode==='OPNAME'?'/stock-opname-drafts':'/stock-adjustments',payload,mode==='OPNAME'?'Hitungan disimpan sebagai draft; stok menunggu persetujuan Owner.':'Penyesuaian stok tersimpan.','STOK');if(result){setSection('STOCK');setSelected(null);setCountSnapshot(null);setForm(blank);requestId.current=Crypto.randomUUID();}};
 return <><Text style={s.sectionTitle}>Stok Barang</Text><View style={s.actionRow}>{(can('INVENTORY_ADJUST')||can('INVENTORY_OPNAME'))&&<Button title="Pilih Produk untuk Penyesuaian" onPress={()=>{setSelected(null);setSection('STOCK');}}/>}<Button title={section==='HISTORY'?'Kembali ke Stok':'Riwayat Stok'} secondary onPress={()=>setSection(section==='HISTORY'?'STOCK':'HISTORY')}/>{can('PURCHASE_VIEW')&&<Button title="Barang Masuk dari Pembelian" secondary onPress={()=>navigate('PEMBELIAN')}/>}</View>
 <View style={section==='HISTORY'?s.hidden:undefined}><Text style={s.muted}>Cari lalu pilih produk untuk membuka detail, penyesuaian, atau stok opname.</Text><ProductSearch request={readFinancial} inventory filters revision={data.inventory} title="Cari Stok Produk" onSelect={choose}/></View>
 {section==='HISTORY'&&<><Text style={s.muted}>Menampilkan hingga 200 pergerakan stok terbaru. Riwayat canonical tidak dapat diedit; koreksi membuat movement baru.</Text><List rows={inv.movements} emptyNote="Belum ada pergerakan stok." render={m=><><Row label={m.name} value={m.quantity}/><Row label={m.kind} value={new Date(m.created_at).toLocaleString('id-ID')}/><Text style={s.muted}>{m.reason}</Text>{m.cost!=null&&can('PRODUCT_COST_VIEW')&&<Row label="Nilai persediaan" value={rupiah(m.cost)}/>}</>}/></>}
 <FocusedEditor error={feedbackError} notice={feedbackNotice} visible={section==='ADJUST'&&!!selected} title="Penyesuaian Stok / Stok Opname" onClose={()=>setSection('STOCK')}>
 {!selected?<ProductSearch request={readFinancial} inventory title="Pilih Produk untuk Penyesuaian" onSelect={choose}/>:<Card title={selected.name}><Row label="SKU" value={selected.sku}/><Row label="Stok saat dipilih" value={countSnapshot?.on_hand}/><Row label="Dipesan online" value={selected.reserved||'0'}/><Button title="Ganti Produk" secondary disabled={busy} onPress={()=>{setSelected(null);setSection('STOCK');}}/>{selected.active===false&&<Text style={s.error}>Produk nonaktif. Aktifkan melalui Data Produk sebelum membuat penyesuaian.</Text>}{(can('INVENTORY_ADJUST')||can('INVENTORY_OPNAME'))?<><Text style={s.muted}>Pembelian normal dicatat lewat Pembelian. Hitungan opname menjadi draft tanpa mutasi stok. Owner menyetujui dan menetapkan HPP selisih masuk. Jika stok berubah, wajib hitung ulang.</Text><Choice options={[...(can("INVENTORY_ADJUST")?[["ADJUST","Koreksi Stok"]]:[]),...(can('INVENTORY_OPNAME')?[["OPNAME","Stok Opname"]]:[])]} value={mode} onChange={value=>{setMode(value);setForm({...form,quantity:'',actual_stock:''});}}/>
 {mode==='OPNAME'?<Field label="Hasil hitung fisik" numeric value={form.actual_stock} onChangeText={actual_stock=>setForm({...form,actual_stock})}/>:<><Choice options={[...(can('PRODUCT_COST_VIEW')?[["IN","Tambah stok"]]:[]),["OUT","Kurangi stok"],["DAMAGE","Rusak / Hilang"]]} value={form.direction} onChange={direction=>setForm({...form,direction})}/><Field label="Jumlah perubahan" numeric value={form.quantity} onChangeText={quantity=>setForm({...form,quantity})}/></>}
 <Field label="Alasan wajib" value={form.reason} onChangeText={reason=>setForm({...form,reason})}/>{mode!=='OPNAME'&&needsCost&&can('PRODUCT_COST_VIEW')&&<RupiahField label="Biaya per unit untuk selisih masuk" value={form.unit_cost} onChangeText={unit_cost=>setForm({...form,unit_cost})}/>}<Card title="Pratinjau Stok">{preview?<><Row label="Stok sebelum" value={preview.before}/><Row label="Perubahan" value={(BigInt(preview.delta)>0n?'+':'')+preview.delta}/><Row label="Stok akhir" value={preview.after}/>{!preview.valid&&<Text style={s.error}>Jumlah keluar melebihi stok tercatat.</Text>}{mode!=='OPNAME'&&needsCost&&!can('PRODUCT_COST_VIEW')&&<Text style={s.error}>Penambahan nilai stok memerlukan izin biaya dari Owner.</Text>}</>:<Text style={s.muted}>Isi jumlah atau hitungan fisik untuk melihat stok akhir.</Text>}<Text style={s.muted}>Server memvalidasi stok tersedia, reservasi dan FIFO sebelum menyimpan.</Text></Card><Button title={busy?'Menyimpan…':mode==='OPNAME'?'Ajukan Hitungan ke Owner':'Simpan Penyesuaian'} disabled={busy||!valid} onPress={save}/></>:<Text style={s.muted}>Akun ini hanya boleh melihat stok. Minta Owner untuk penyesuaian.</Text>}</Card>}
 </FocusedEditor>{can("INVENTORY_OPNAME")&&<OpnameApproval context={context} request={readFinancial} submit={submit} revision={data.inventory}/>}</>;
}
function Parties({ data, kind, can, submit }) {
  const rows=kind==="CUSTOMER"?data.customers:data.suppliers;
  const empty={name:"",phone:"",address:"",notes:"",credit_limit:"0",due_days:"0",active:true};
  const [form,setForm]=useState(empty),[search,setSearch]=useState(""),[selected,setSelected]=useState(null),[editing,setEditing]=useState(null);
  const permission=kind==="CUSTOMER"?"CUSTOMER_MANAGE":"SUPPLIER_MANAGE";
  const filtered=(rows||[]).filter(p=>!search||`${p.name} ${p.phone||""}`.toLowerCase().includes(search.toLowerCase()));
  return <><Card title={kind==="CUSTOMER"?"Cari Customer":"Cari Supplier"}><Field label="Nama atau telepon" value={search} onChangeText={setSearch}/></Card>{kind==="CUSTOMER"&&data.metrics&&<Card title="Ringkasan Customer"><Row label="Customer aktif" value={data.metrics.active_customers||0}/><Row label="Total belanja" value={rupiah(data.metrics.net_spend||0)}/><Row label="Rata-rata transaksi" value={rupiah(data.metrics.average_ticket||0)}/></Card>}<List rows={filtered} render={p=><Pressable onPress={()=>setSelected(p)}><Row label={p.name} value={p.phone}/><Row label={kind==="CUSTOMER"?"Piutang":"Utang"} value={rupiah(p.outstanding)}/>{kind==="CUSTOMER"&&can("CUSTOMER_CREDIT_VIEW")&&<><Row label="Limit kredit" value={rupiah(p.credit_limit)}/><Row label="Termin" value={`${p.due_days||0} hari`}/></>}<Badge label={p.active?"AKTIF":"NONAKTIF"}/></Pressable>}/>{selected&&<Card title="Profil & Riwayat"><Row label="Nama" value={selected.name}/><Row label="Telepon" value={selected.phone}/><Row label="Alamat" value={selected.address}/><Row label="Outstanding" value={rupiah(selected.outstanding)}/><Row label={kind==="CUSTOMER"?"Total belanja":"Total pembelian"} value={rupiah(selected.total_spend||0)}/><Row label="Jumlah transaksi" value={selected.transaction_count||0}/><Row label="Rata-rata" value={rupiah(selected.average_ticket||0)}/><Row label="Terakhir" value={selected.last_purchase?new Date(selected.last_purchase).toLocaleString("id-ID"):"Belum ada"}/>{kind==="CUSTOMER"&&<><Row label="POS" value={rupiah(selected.pos_spend||0)}/><Row label="ONLINE" value={rupiah(selected.online_spend||0)}/></>}{can(permission)&&<Button title="Edit Profil" secondary onPress={()=>{setEditing(selected.id);setForm({...empty,...selected,credit_limit:String(selected.credit_limit||0),due_days:String(selected.due_days||0)});setSelected(null);}}/>}<Button title="Tutup" secondary onPress={()=>setSelected(null)}/></Card>}{can(permission)&&<Card title={editing?`Edit ${kind==="CUSTOMER"?"Customer":"Supplier"}`:kind==="CUSTOMER"?"Tambah Customer":"Tambah Supplier"}><Fields value={form} setValue={setForm} fields={[["name","Nama"],["phone","Telepon"],["address","Alamat"],["notes","Catatan"],["credit_limit","Limit kredit",true],["due_days","Termin hari",true]]}/>{editing&&<Choice options={[[true,"Aktif"],[false,"Nonaktif"]]} value={form.active!==false} onChange={active=>setForm({...form,active})}/>}<Button title="Simpan" disabled={!form.name} onPress={()=>submit(editing?`/parties/${editing}`:"/parties",{...form,kind,credit_allowed:kind==="CUSTOMER"&&BigInt(form.credit_limit||0)>0n},"Data pihak tersimpan.",kind==="CUSTOMER"?"CUSTOMER":"SUPPLIER").then(()=>{setEditing(null);setForm(empty);})}/>{editing&&<Button title="Batal" secondary onPress={()=>{setEditing(null);setForm(empty);}}/>}</Card>}</>;
}
function Purchases({ data, can, submit, request }) {
  const [invoiceId,setInvoiceId]=useState(null);
  const empty={supplier_id:"",account_id:"",paid:"0",due_date:"",reference:"",lines:[]};
  const [view,setView]=useState("NEW"),[step,setStep]=useState("SUPPLIER"),[form,setForm]=useState(empty),[paymentMode,setPaymentMode]=useState("DEBT"),[supplierSearch,setSupplierSearch]=useState(""),[productSearch,setProductSearch]=useState(""),[showSupplierForm,setShowSupplierForm]=useState(false),[supplierDraft,setSupplierDraft]=useState({name:"",phone:"",address:""}),[selectedProduct,setSelectedProduct]=useState(""),[ret,setRet]=useState({source_id:"",product_id:"",quantity:"1",reason:"",reference:""});
  const requestId=useRef(Crypto.randomUUID());
  const products=data.inventory?.products||[],suppliers=(data.suppliers||[]).filter(item=>!supplierSearch||`${item.name} ${item.phone||""}`.toLowerCase().includes(supplierSearch.toLowerCase())),accounts=data.accounts||data.books?.accounts||[],validLines=form.lines.length>0&&form.lines.every(line=>/^[1-9]\d*$/.test(line.quantity)&&validMoney(line.unit_cost)),total=validLines?BigInt(purchaseTotals(form.lines).total):0n,effectivePaid=["CASH","TRANSFER"].includes(paymentMode)?total:paymentMode==="DEBT"?0n:moneyValue(form.paid),outstanding=total-effectivePaid,allowedAccounts=purchaseAccounts(accounts,paymentMode);
  const addLine=()=>{const product=products.find(item=>item.id===selectedProduct);if(product){setForm(current=>({...current,lines:addPurchaseLine(current.lines,product)}));setSelectedProduct("");}};
  const choosePayment=mode=>{setPaymentMode(mode);setForm(current=>applyPurchasePaymentMode(current,mode,total.toString()));};
  const createSupplier=()=>submit("/parties",{...supplierDraft,kind:"SUPPLIER"},"Supplier ditambahkan.","PEMBELIAN").then(result=>{if(result){setForm(current=>({...current,supplier_id:result.id}));setSupplierDraft({name:"",phone:"",address:""});setShowSupplierForm(false);}});
  const save=()=>{let payload;try{payload=purchasePayload({...form,paid:effectivePaid.toString()},requestId.current);}catch{return Alert.alert("Pembelian belum lengkap","Periksa supplier, produk, jumlah, harga beli, pembayaran, dan jatuh tempo.");}return submit("/purchases",payload,"Pembelian berhasil diposting dan stok telah diperbarui.","PEMBELIAN").then(result=>{if(result){setForm(empty);setPaymentMode("DEBT");setStep("SUPPLIER");requestId.current=Crypto.randomUUID();}});};
  const stepOrder=["SUPPLIER","ITEMS","PAYMENT","CONFIRM"],stepIndex=stepOrder.indexOf(step),selectedSupplier=(data.suppliers||[]).find(item=>item.id===form.supplier_id),selectedAccount=accounts.find(item=>item.id===form.account_id),canContinue=step==="SUPPLIER"?!!form.supplier_id:step==="ITEMS"?validLines&&total>0n:step==="PAYMENT"?effectivePaid<=total&&(effectivePaid===0n||!!form.account_id)&&!(outstanding>0n&&!/^\d{4}-\d{2}-\d{2}$/.test(form.due_date)):true;
  return <><PurchaseInvoiceSheet id={invoiceId} request={request} onClose={()=>setInvoiceId(null)}/><View style={s.sectionHeader}><View><Text style={s.sectionTitle}>Pembelian Barang</Text><Text style={s.muted}>Catat satu invoice supplier dan tambah stok secara aman.</Text></View></View><Choice options={[["NEW","Pembelian Baru"],["HISTORY","Riwayat"],...(can("PURCHASE_RETURN")?[["RETURN","Retur"]]:[])]} value={view} onChange={setView}/>{view==="NEW"&&can("PURCHASE_CREATE")&&<><View style={s.flowSteps}>{[["SUPPLIER","1 Supplier"],["ITEMS","2 Barang"],["PAYMENT","3 Bayar"],["CONFIRM","4 Konfirmasi"]].map(([id,label])=><Text key={id} style={[s.flowStep,step===id&&s.flowStepActive]}>{label}</Text>)}</View>{step==="SUPPLIER"&&<Card title="Pilih Supplier"><Field label="Cari nama atau telepon supplier" value={supplierSearch} onChangeText={setSupplierSearch}/><SelectRows title="Supplier" rows={suppliers} selected={form.supplier_id} label={x=>x.name} onSelect={supplier_id=>setForm({...form,supplier_id})}/>{!suppliers.length&&<Text style={s.muted}>Supplier belum ditemukan. Tambahkan supplier baru jika Anda memiliki izin.</Text>}{can("SUPPLIER_MANAGE")&&<Button title={showSupplierForm?"Batal Tambah Supplier":"Tambah Supplier Baru"} secondary onPress={()=>setShowSupplierForm(value=>!value)}/>}{showSupplierForm&&can("SUPPLIER_MANAGE")&&<><Fields value={supplierDraft} setValue={setSupplierDraft} fields={[["name","Nama supplier"],["phone","Telepon"],["address","Alamat"]]}/><Button title="Simpan & Pilih Supplier" disabled={!supplierDraft.name.trim()} onPress={createSupplier}/></>}</Card>}{step==="ITEMS"&&<><Card title="Tambah Produk"><Text style={s.muted}>Masukkan jumlah dan harga beli aktual pada invoice ini. Harga referensi hanya membantu pengisian.</Text><Field label="Cari nama, SKU, atau barcode" value={productSearch} onChangeText={setProductSearch}/><SelectRows title="Pilih produk" rows={products.filter(p=>!form.lines.some(line=>line.product_id===p.id)&&(!productSearch||`${p.name} ${p.sku||""} ${p.barcode||""}`.toLowerCase().includes(productSearch.toLowerCase())))} selected={selectedProduct} label={x=>`${x.name}${x.reference_purchase_price?` · referensi ${rupiah(x.reference_purchase_price)}`:""}`} onSelect={setSelectedProduct}/><Button title="Tambahkan ke Invoice" secondary disabled={!selectedProduct} onPress={addLine}/></Card>{form.lines.map(line=><Card key={line.product_id} title={line.name}><Field label={`Jumlah (${products.find(p=>p.id===line.product_id)?.uom||"unit"})`} numeric value={line.quantity} onChangeText={quantityValue=>setForm(current=>({...current,lines:updatePurchaseLine(current.lines,line.product_id,{quantity:quantityValue})}))}/><RupiahField label="Harga beli aktual per unit" value={line.unit_cost} onChangeText={unit_cost=>setForm(current=>({...current,lines:updatePurchaseLine(current.lines,line.product_id,{unit_cost})}))}/><Row label="Subtotal" value={/^[1-9]\d*$/.test(line.quantity)&&validMoney(line.unit_cost)?rupiah(BigInt(line.quantity)*moneyValue(line.unit_cost)):rupiah(0)}/><Button title="Hapus dari Invoice" secondary onPress={()=>setForm(current=>({...current,lines:removePurchaseLine(current.lines,line.product_id)}))}/></Card>)}<Card><Row label="Total pembelian" value={rupiah(total)}/></Card></>}{step==="PAYMENT"&&<Card title="Cara Pembayaran"><Row label="Total invoice" value={rupiah(total)}/><Choice options={[["CASH","Tunai"],["TRANSFER","Transfer Bank"],["DEBT","Utang Supplier"],["PARTIAL","Bayar Sebagian"]]} value={paymentMode} onChange={choosePayment}/>{["CASH","TRANSFER","PARTIAL"].includes(paymentMode)&&<><SelectRows title={paymentMode==="CASH"?"Pilih kas pembayaran":paymentMode==="TRANSFER"?"Pilih rekening bank":"Pilih kas / bank"} rows={allowedAccounts} selected={form.account_id} label={x=>`${x.name} · ${rupiah(x.balance||0)}`} onSelect={account_id=>setForm({...form,account_id})}/>{!allowedAccounts.length&&<Text style={s.error}>{paymentMode==="CASH"?"Belum ada akun kas aktif.":"Belum ada rekening bank aktif."} Tambahkan melalui Pengaturan Usaha.</Text>}</>}{paymentMode==="PARTIAL"&&<RupiahField label="Nominal dibayar sekarang" value={form.paid} onChangeText={paid=>setForm({...form,paid})}/>}<Row label="Dibayar sekarang" value={rupiah(effectivePaid)}/><Row label="Dicatat sebagai utang" value={rupiah(outstanding>0n?outstanding:0n)}/>{outstanding>0n&&<Field label="Jatuh tempo (YYYY-MM-DD)" value={form.due_date} onChangeText={due_date=>setForm({...form,due_date})}/>}<Field label="Nomor / referensi invoice (opsional)" value={form.reference} onChangeText={reference=>setForm({...form,reference})}/></Card>}{step==="CONFIRM"&&<Card title="Konfirmasi Pembelian"><Text style={s.muted}>Satu invoice, satu posting stok. Pastikan barang, harga, dan sumber pembayaran sudah benar.</Text><Row label="Supplier" value={selectedSupplier?.name}/>{form.lines.map(line=><Row key={line.product_id} label={`${line.quantity} × ${line.name}`} value={rupiah(BigInt(line.quantity)*moneyValue(line.unit_cost))}/>) }<Row label="Total" value={rupiah(total)}/><Row label="Pembayaran" value={paymentMode==="CASH"?"Tunai":paymentMode==="TRANSFER"?"Transfer Bank":paymentMode==="DEBT"?"Utang Supplier":"Bayar Sebagian"}/>{selectedAccount&&<Row label="Sumber dana" value={selectedAccount.name}/>}<Row label="Dibayar" value={rupiah(effectivePaid)}/><Row label="Utang supplier" value={rupiah(outstanding>0n?outstanding:0n)}/><Text style={s.muted}>Setelah disimpan, stok bertambah satu kali dan pembayaran/utang mengikuti ringkasan di atas.</Text><Button title="Simpan Pembelian" onPress={save}/></Card>}<View style={s.actionRow}>{stepIndex>0&&<Button title="Kembali" secondary onPress={()=>setStep(stepOrder[stepIndex-1])}/>}{stepIndex<stepOrder.length-1&&<Button title="Lanjut" disabled={!canContinue} disabledHint={!canContinue?"Lengkapi data pada tahap ini terlebih dahulu.":undefined} onPress={()=>setStep(stepOrder[stepIndex+1])}/>}</View></>}{view==="NEW"&&!can("PURCHASE_CREATE")&&<Empty title="Tidak memiliki izin pembelian" note="Akun ini hanya dapat melihat pembelian yang sudah ada."/>}{view==="HISTORY"&&<><Card title="Riwayat Pembelian"><Text style={s.muted}>Stok hanya bertambah dari pembelian yang berhasil diposting. Pelunasan utang tidak menambah stok lagi.</Text></Card><List rows={data.purchases} emptyNote="Belum ada pembelian supplier." render={p=><Pressable onPress={()=>setInvoiceId(p.id)}><Row label={p.supplier||"Supplier"} value={rupiah(p.total)}/><Row label={p.reference||p.kind} value={new Date(p.created_at).toLocaleDateString("id-ID",{dateStyle:"medium"})}/><Badge label={p.kind==="PURCHASE"?"PEMBELIAN":"RETUR"}/></Pressable>}/></>}{view==="RETURN"&&can("PURCHASE_RETURN")&&<Card title="Retur Pembelian"><Text style={s.muted}>Retur mengurangi stok dan merekonsiliasi utang atau pengembalian dana melalui transaksi canonical.</Text><SelectRows title="Pembelian sumber" rows={(data.purchases||[]).filter(p=>p.kind==="PURCHASE")} selected={ret.source_id} label={x=>`${x.supplier} · ${rupiah(x.total)}`} onSelect={source_id=>setRet({...ret,source_id})}/><SelectRows title="Produk" rows={products} selected={ret.product_id} label={x=>x.name} onSelect={product_id=>setRet({...ret,product_id})}/><Fields value={ret} setValue={setRet} fields={[["quantity","Jumlah",true],["reason","Alasan"],["reference","Referensi pengembalian dana"]]}/><Button danger title="Proses Retur Pembelian" disabled={!ret.source_id||!ret.product_id||!ret.quantity||!ret.reason} onPress={()=>Alert.alert("Konfirmasi retur pembelian","Stok, utang, dan sumber dana direkonsiliasi oleh server.",[{text:"Batal",style:"cancel"},{text:"Lanjut",style:"destructive",onPress:()=>submit("/purchase-returns",{request_id:Crypto.randomUUID(),source_id:ret.source_id,items:[{product_id:ret.product_id,quantity:ret.quantity}],reason:ret.reason,reference:ret.reference||undefined,refund_confirmed:true},"Retur pembelian tersimpan.","PEMBELIAN")}])}/></Card>}</>;
}
function Debts({ data, kind, can, submit }) {
  const [form,setForm]=useState({source_id:"",account_id:"",amount:""}),permission=kind==="AR"?"AR_COLLECT":"AP_PAY";
  const invoices=data.aging?.items||[],selected=invoices.find(item=>item.source_id===form.source_id),amountValue=moneyValue(form.amount);
  return <><Card title={kind==="AR"?"Piutang Customer":"Utang Supplier"}><Money value={rupiah(data.aging?.outstanding||0)}/></Card><List rows={invoices} render={r=><Pressable onPress={()=>setForm(x=>({...x,source_id:r.source_id,amount:""}))}><Row label={r.name} value={rupiah(r.outstanding)}/><Row label={`Invoice ${String(r.source_id).slice(0,8)} · ${r.bucket}`} value={r.due_date}/></Pressable>}/>{can(permission)&&<Card title={kind==="AR"?"Terima Pembayaran":"Bayar Utang"}><SelectRows title="Invoice outstanding" rows={invoices} selected={form.source_id} label={x=>`${x.name} · ${rupiah(x.outstanding)} · ${x.due_date}`} onSelect={source_id=>setForm({...form,source_id,amount:""})}/>{selected&&<><Row label="Sisa invoice" value={rupiah(selected.outstanding)}/><Row label="Jatuh tempo" value={selected.due_date}/></>}<SelectRows title="Akun" rows={data.books?.accounts} selected={form.account_id} label={x=>`${x.name} · ${rupiah(x.balance)}`} onSelect={account_id=>setForm({...form,account_id})}/><RupiahField label="Nominal" value={form.amount} onChangeText={amount=>setForm({...form,amount})}/><Button title="Simpan Pembayaran" disabled={!selected||!form.account_id||!form.amount||amountValue<=0n||amountValue>BigInt(selected?.outstanding||0)} onPress={()=>submit("/debt-payments",{...form,kind,request_id:Crypto.randomUUID()},"Pembayaran utang/piutang tersimpan.",kind==="AR"?"PIUTANG":"UTANG")}/></Card>}</>;
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
function Settings({ data, context, can, submit, readFinancial, loadReceiptPreferences, saveReceiptPreferences }) {
  const store=data.store?.store||{},[form,setForm]=useState({...context.business,...store}),[account,setAccount]=useState({name:"",kind:"CASH"}),[terminalName,setTerminalName]=useState("");
  const [receiptPreferences,setReceiptPreferences]=useState(normalizeDevicePreferences()),[receiptPreferencesReady,setReceiptPreferencesReady]=useState(false);
  const terminals=data.terminals||context.terminals||[],drawers=data.drawers||[];
  useEffect(()=>{let alive=true;loadReceiptPreferences().then(value=>{if(alive){setReceiptPreferences(value);setReceiptPreferencesReady(true);}});return()=>{alive=false;};},[context.business.id,loadReceiptPreferences]);
  const saveAccount=async()=>{const result=await submit("/accounts",account,"Akun usaha siap digunakan.","PENGATURAN");if(result)setAccount({name:"",kind:"CASH"});};
  const saveTerminal=async()=>{const result=await submit("/terminals",{name:terminalName},"Terminal usaha siap digunakan.","PENGATURAN");if(result)setTerminalName("");};
  const savePaper=async paper_width=>{const saved=await saveReceiptPreferences({...receiptPreferences,paper_width});setReceiptPreferences(saved);};
  const printer=printerCapability(receiptPreferences);
  const saveProfile=()=>submit("/profile",{...form,accounting_start_date:undefined,receipt_logo:false},"Pengaturan usaha tersimpan.","PENGATURAN");
  return <><DiagnosticsPanel/><Card title="Profil Usaha"><Row label="Nama" value={context.business.display_name}/><Row label="Timezone" value={context.business.timezone}/><Row label="Kepemilikan" value={context.business.ownership}/><Row label="Mulai pembukuan" value={context.business.accounting_start_date||"Belum ditentukan"}/></Card>{context.role==="OWNER"&&<><CutoffPanel request={readFinancial} submit={submit} newOpening={<OpeningInitialization data={data} submit={submit}/>}/><AuditPanel request={readFinancial}/></>} {can("BUSINESS_SETTINGS_MANAGE")&&<><Card title="Kesiapan Kasir"><Text style={s.muted}>Satu terminal dan satu akun Kas diperlukan untuk membuka shift. Konfigurasi yang sudah ada akan digunakan kembali.</Text><Row label="Terminal aktif" value={String(terminals.length)}/><Row label="Laci kas aktif" value={String(drawers.length)}/>{terminals.map(item=><Badge key={item.id} label={`TERMINAL · ${item.name}`} tone="green"/>)}{drawers.map(item=><Badge key={item.id} label={`KAS · ${item.name}`} tone="green"/>)}</Card><Card title="Tambah Terminal"><Text style={s.muted}>Gunakan nama lokasi yang mudah dikenali, misalnya Kasir Utama. Nama yang sama akan memakai terminal yang sudah ada.</Text><Field label="Nama terminal" value={terminalName} onChangeText={setTerminalName}/><Button title="Tambah Terminal" disabled={!terminalName.trim()} onPress={saveTerminal}/></Card><Card title="Tambah Kas / Rekening"><Choice options={[["CASH","Kas / Laci Kas"],["BANK","Bank"],["QRIS","QRIS"]]} value={account.kind} onChange={kind=>setAccount({...account,kind})}/><Field label="Nama akun" value={account.name} onChangeText={name=>setAccount({...account,name})}/><Button title="Tambah Akun" disabled={!account.name.trim()} onPress={saveAccount}/></Card><Card title="Profil Usaha"><Text style={s.muted}>Tanggal mulai pembukuan ditetapkan melalui Posisi Awal Usaha dan tidak dapat ditimpa dari profil.</Text><Fields value={form} setValue={setForm} fields={[["display_name","Nama usaha"],["legal_name","Nama legal"],["address","Alamat"],["phone","Kontak"],["timezone","Timezone"]]}/><Button title="Simpan Profil" onPress={saveProfile}/></Card><Card title="Printer & Struk"><Text style={s.muted}>Identitas struk tersimpan untuk usaha ini. Ukuran kertas adalah preferensi perangkat ini agar terminal lain dapat memakai ukuran berbeda.</Text><Fields value={form} setValue={setForm} fields={[["receipt_name","Nama toko pada struk"],["receipt_header","Keterangan toko"],["receipt_footer","Pesan penutup"],["receipt_prefix","Prefix nomor struk"]]}/><Button title="Simpan Format Struk" onPress={saveProfile}/><Text style={s.label}>Ukuran kertas perangkat</Text><Choice options={[["58","58 mm"],["80","80 mm"]]} value={receiptPreferences.paper_width} onChange={savePaper}/><Row label="Status printer" value={receiptPreferencesReady?printer.state:"Memuat…"}/><Text style={s.muted}>{printer.message}</Text><Button title="Cetak otomatis: Nonaktif" secondary disabled disabledHint="Aktifkan hanya setelah transport printer yang kompatibel tersedia dan diuji."/><Button title="Tes Cetak" secondary icon="printer" disabled={!printer.can_print} disabledHint={printer.message}/></Card></>}</>;
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
 const [query,setQuery]=useState(''),[page,setPage]=useState(0);
 const filtered=rows.filter(row=>!query||String(label(row)).toLowerCase().includes(query.toLowerCase())),chosen=rows.find(row=>String(row.id??row.unit_id)===String(selected));
 return <View><Text style={s.label}>{title}</Text>{chosen&&<Text style={s.muted}>Terpilih: {label(chosen)}</Text>}<Field label={'Cari '+title} value={query} onChangeText={v=>{setQuery(v);setPage(0);}}/>{filtered.slice(page*8,page*8+8).map(row=>{const id=row.id??row.unit_id;return <Pressable key={id} accessibilityRole="button" onPress={()=>onSelect(id)}><View style={s.listRow}><Text style={String(selected)===String(id)?s.heading:s.body}>{label(row)}</Text></View></Pressable>;})}<View style={s.actionRow}>{page>0&&<Button title="Pilihan Sebelumnya" secondary onPress={()=>setPage(page-1)}/>} {(page+1)*8<filtered.length&&<Button title="Pilihan Berikutnya" secondary onPress={()=>setPage(page+1)}/>}</View>{!filtered.length&&<Text style={s.muted}>Tidak ada pilihan sesuai pencarian pada daftar yang dimuat.</Text>}</View>;
}
