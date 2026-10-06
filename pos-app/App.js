import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { makeApi } from "./src/api";
import {
  colors,
  s,
  Button,
  Field,
  Card,
  Row,
  Icon,
  Money,
  Badge,
  Chip,
  Empty,
  Artwork,
  ReviewTools,
} from "./src/ui";
const { createVault } = require("./src/vault.cjs");
const {
  rupiah,
  money,
  totals,
  changeCart,
  TestCredentialReader,
  CheckoutCoordinator,
  errorText,
} = require("./src/domain.cjs");
// Browser preview uses volatile memory ONLY. Native Android uses SecureStore.
const previewMemory = new Map();
// Explicit isolated acceptance bundle may include synthetic UI; production DCE excludes it.
const reviewAdapter =
  (process.env.EXPO_PUBLIC_POS_ACCEPTANCE === "1" &&
    Constants.expoConfig.extra.posEnvironment === "acceptance") ||
  (__DEV__ &&
    Constants.expoConfig.extra.posEnvironment === "development" &&
    Constants.expoConfig.extra.posReview === true)
    ? require("./src/reviewFixtures.cjs").createReviewAdapter()
    : null;
const makeClient = (token, onConnection) =>
  reviewAdapter ? reviewAdapter.api : makeApi(token, onConnection);
const storage =
  reviewAdapter || Platform.OS === "web"
    ? {
        getItemAsync: async (k) => previewMemory.get(k) || null,
        setItemAsync: async (k, v) => {
          previewMemory.set(k, v);
        },
        deleteItemAsync: async (k) => {
          previewMemory.delete(k);
        },
      }
    : SecureStore;
const vault = createVault(storage),
  TABS = ["BERANDA", "KASIR", "TRANSAKSI", "PRODUK", "LAINNYA"];
const {
  PAYMENT_LABELS,
  STATUS_LABELS,
  paymentBlock,
  cashShortcuts,
  refundSummary,
  correctionBlock,
} = require("./src/workflow.cjs");
const tabIcons = {
  BERANDA: "home",
  KASIR: "shopping-bag",
  TRANSAKSI: "file-text",
  PRODUK: "grid",
  LAINNYA: "menu",
};
const date = (value) =>
  value
    ? new Date(value).toLocaleString("id-ID", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const validMoney = (value) => {
  try {
    money(value);
    return true;
  } catch {
    return false;
  }
};
export default function App() {
  return (
    <SafeAreaProvider>
      <CashierApp />
    </SafeAreaProvider>
  );
}
function CashierApp() {
  const [boot, setBoot] = useState(true),
    [session, setSession] = useState(null),
    [context, setContext] = useState(null),
    [selected, setSelected] = useState(null),
    [summary, setSummary] = useState(null);
  const [tab, setTab] = useState("BERANDA"),
    [online, setOnline] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [tenant, setTenant] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [catalog, setCatalog] = useState({
      products: [],
      categories: [],
      total: 0,
      page: 1,
      limit: 30,
    }),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(null),
    [page, setPage] = useState(1);
  const [cart, setCart] = useState([]),
    [discount, setDiscount] = useState("0"),
    [discountReason, setDiscountReason] = useState("");
  const [history, setHistory] = useState({
      rows: [],
      total: 0,
      page: 1,
      limit: 30,
    }),
    [historyPage, setHistoryPage] = useState(1),
    [historySearch, setHistorySearch] = useState(""),
    [historyMethod, setHistoryMethod] = useState(null),
    [historyStatus, setHistoryStatus] = useState(null),
    [catalogLoading, setCatalogLoading] = useState(false),
    [historyLoading, setHistoryLoading] = useState(false),
    [confirmation, setConfirmation] = useState(null),
    [readerDev, setReaderDev] = useState(false),
    [readerReady, setReaderReady] = useState(false),
    [refreshKey, setRefreshKey] = useState(0);
  const [sheet, setSheet] = useState(null),
    [opening, setOpening] = useState("0"),
    [actual, setActual] = useState("0"),
    [method, setMethod] = useState("CASH"),
    [tender, setTender] = useState("0");
  const [provider, setProvider] = useState(""),
    [reference, setReference] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [testInput, setTestInput] = useState(""),
    [walletPreview, setWalletPreview] = useState(null);
  const [paymentState, setPaymentState] = useState({
      state: "IDLE",
      pending: false,
      result: null,
    }),
    [detail, setDetail] = useState(null),
    [correction, setCorrection] = useState(null),
    [reason, setReason] = useState(""),
    [refundAmount, setRefundAmount] = useState("");
  const apiRef = useRef(null),
    coordinator = useRef(null),
    credential = useRef(null),
    lock = useRef(false),
    generation = useRef(0);
  const api = useMemo(() => makeClient(session?.token, setOnline), [session]);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const scope = selected
    ? {
        unit_id: selected.unit_id,
        merchant_id: selected.merchant_id,
        terminal_id: selected.terminal_id,
      }
    : null;
  let total, cartTotals;
  try {
    cartTotals = totals(cart, discount);
    total = cartTotals.total;
  } catch {
    total = null;
  }
  const can = (p) => context?.permissions?.includes(p);
  const editCart = (product, delta) => {
    try {
      changeCart(cart, product, delta);
      setCart((current) => {
        try {
          return changeCart(current, product, delta);
        } catch {
          return current;
        }
      });
      setNotice(`${product.name}: keranjang diperbarui.`);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const pending =
    paymentState.pending ||
    ["PROCESSING", "CHECKING"].includes(paymentState.state);
  const run = async (work) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const loadSummary = useCallback(async (ctx, client = apiRef.current) => {
    const g = generation.current;
    const data = await client("/pos/mobile/summary", { query: ctx });
    if (g === generation.current) setSummary(data);
  }, []);
  const choose = useCallback((next) => {
    generation.current++;
    setSelected(next);
    setCart([]);
    setDiscount("0");
    setDiscountReason("");
    setWalletPreview(null);
    credential.current = null;
    setReaderReady(false);
    setTestInput("");
    setSummary(null);
    setCatalog({ products: [], categories: [], total: 0, page: 1, limit: 30 });
    setHistory({ rows: [], total: 0, page: 1, limit: 30 });
    setSearch("");
    setCategory(null);
    setPage(1);
    setHistoryPage(1);
    setDetail(null);
  }, []);
  const acceptSession = useCallback(
    async (saved) => {
      const client = makeClient(saved.token, setOnline),
        data = await client("/pos/mobile/context");
      apiRef.current = client;
      const flow = new CheckoutCoordinator({
        api: (...args) => apiRef.current(...args),
        vault,
        newId: Crypto.randomUUID,
        owner: `${data.tenant_id}:${data.user.id}`,
        onChange: setPaymentState,
      });
      const p = await flow.restore();
      coordinator.current = flow;
      setSession(saved);
      setContext(data);
      const pinned = p?.body || data.shift;
      let next = pinned
        ? {
            unit_id: pinned.unit_id,
            merchant_id: pinned.merchant_id,
            terminal_id: pinned.terminal_id,
          }
        : null;
      if (!next && data.merchants.length === 1) {
        const m = data.merchants[0],
          t = data.terminals.filter(
            (t) => t.merchant_id === m.merchant_id && t.unit_id === m.unit_id,
          );
        if (t.length === 1)
          next = {
            unit_id: m.unit_id,
            merchant_id: m.merchant_id,
            terminal_id: t[0].id,
          };
      }
      choose(next);
      if (next) await loadSummary(next, client);
      if (p) setSheet("payment");
    },
    [choose, loadSummary],
  );
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const saved = reviewAdapter
          ? { token: "local-visual-review-only" }
          : await vault.read("session");
        if (saved && alive) await acceptSession(saved);
      } catch (e) {
        if (alive) setError(errorText(e));
      } finally {
        if (alive) setBoot(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [acceptSession]);
  useEffect(() => {
    if (!session || !selected || !["KASIR", "PRODUK"].includes(tab)) return;

    let alive = true;
    const g = generation.current;
    const timer = setTimeout(() => {
      setCatalogLoading(true);
      return apiRef
        .current("/pos/mobile/catalog", {
          query: {
            ...selected,
            search,
            category_id: category,
            page,
            limit: 30,
          },
        })
        .then((data) => {
          if (alive && g === generation.current) setCatalog(data);
        })
        .catch((e) => {
          if (alive && g === generation.current) setError(errorText(e));
        })
        .finally(() => {
          if (alive && g === generation.current) setCatalogLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [session, selected, tab, search, category, page, refreshKey]);
  useEffect(() => {
    if (!session || !selected || tab !== "TRANSAKSI") return;

    let alive = true;
    const g = generation.current;
    const timer = setTimeout(() => {
      setHistoryLoading(true);
      return apiRef
        .current("/pos/mobile/transactions", {
          query: {
            ...selected,
            page: historyPage,
            search: historySearch,
            method: historyMethod,
            status: historyStatus,
          },
        })
        .then((data) => {
          if (alive && g === generation.current) setHistory(data);
        })
        .catch((e) => {
          if (alive && g === generation.current) setError(errorText(e));
        })
        .finally(() => {
          if (alive && g === generation.current) setHistoryLoading(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    session,
    selected,
    tab,
    historyPage,
    historySearch,
    historyMethod,
    historyStatus,
    refreshKey,
  ]);
  async function login() {
    await run(async () => {
      const result = await makeClient(null, setOnline)("/auth/login", {
        method: "POST",
        body: {
          tenant_slug: tenant.trim(),
          username: username.trim(),
          password,
        },
      });
      setPassword("");
      await acceptSession({ token: result.token });
      await vault.remove("session");
      await vault.write("session", { token: result.token });
      setNotice("Berhasil masuk.");
    });
  }
  async function refresh() {
    await run(async () => {
      const data = await api("/pos/mobile/context");
      setContext(data);
      if (scope) await loadSummary(scope);
      setRefreshKey((v) => v + 1);
      setNotice("Status diperbarui.");
    });
  }
  async function logout() {
    await run(async () => {
      if (pending) throw Error("UNKNOWN");
      await vault.remove("session");
      await vault.remove("pending");
      generation.current++;
      coordinator.current = null;
      credential.current = null;
      setReaderReady(false);
      choose(null);
      setSession(null);
      setContext(null);
      setPassword("");
      setTestInput("");
      setDetail(null);
      setSheet(null);
      setPaymentState({ state: "IDLE", pending: false, result: null });
    });
  }
  const confirmAction = (title, message, action) =>
    setConfirmation({ title, message, action });
  async function refreshAfterError() {
    if (pending) {
      setSheet("login");
      return;
    }
    try {
      const data = await api("/pos/mobile/context");
      setContext(data);
      setRefreshKey((v) => v + 1);
      if (scope) await loadSummary(scope);
    } catch (e) {
      if (e.status === 401) {
        setSheet("login");
      } else throw e;
    }
  }
  async function open() {
    money(opening);
    const row = await api("/pos/shifts/open", {
      method: "POST",
      body: { ...scope, opening_cash: opening },
    });
    setContext({ ...context, shift: row });
    setSheet(null);
    setTab("BERANDA");
    setNotice("Shift terbuka.");
    await loadSummary(scope);
  }
  async function close() {
    money(actual);
    const row = await api(`/pos/shifts/${summary.shift.id}/close`, {
      method: "POST",
      body: { ...scope, actual_cash: actual },
    });
    setContext({ ...context, shift: null });
    setSheet(null);
    setTab("BERANDA");
    setCart([]);
    setNotice(`Shift ditutup. Selisih ${rupiah(row.difference)}.`);
    await loadSummary(scope);
  }
  async function scan() {
    credential.current = null;
    setReaderReady(false);
    setWalletPreview(null);
    const reader = new TestCredentialReader(
      async () => {
        const v = testInput;
        setTestInput("");
        return v;
      },
      __DEV__ && Constants.expoConfig.extra.posEnvironment === "development",
    );
    const token = await reader.scan();
    const preview = await api("/pos/mobile/credential-preview", {
      method: "POST",
      body: { ...scope, credential: token, amount: total },
    });
    credential.current = token;
    setReaderReady(true);
    setWalletPreview(preview);
  }
  async function pay() {
    const blocked = paymentBlock({
      cart,
      discount,
      discountReason,
      canDiscount: can("pos.discount"),
      method,
      tender,
      online,
      shift: summary?.shift,
      walletPreview,
      credentialReady: !!credential.current,
      pending,
      busy: false,
      confirmed,
      reference,
    });
    if (blocked) throw Error(blocked);
    if (!summary?.shift || !total || !cart.length)
      throw Error("SHIFT_NOT_OPEN");
    if (!online) throw Error("NETWORK");
    const payment = { method };
    if (method === "CASH") payment.tendered = money(tender).toString();
    if (method === "RFID") {
      if (!credential.current || !walletPreview)
        throw Error("READER_UNAVAILABLE");
      payment.credential = credential.current;
    }
    if (method === "TRANSFER_QRIS") {
      payment.confirmed = confirmed;
      if (provider.trim()) payment.provider = provider.trim();
      if (reference.trim()) payment.reference = reference.trim();
      if (confirmed && !reference.trim()) throw Error("INVALID_TEXT");
    }
    const expected = total,
      result = await coordinator.current.pay({
        ...scope,
        shift_id: summary.shift.id,
        items: cart.map((p) => ({ product_id: p.id, quantity: p.quantity })),
        discount,
        discount_reason: discountReason,
        payment,
      });
    credential.current = null;
    setReaderReady(false);
    setWalletPreview(null);
    setTestInput("");
    if (result.sale.grand_total !== expected)
      setNotice(
        "Harga diperbarui server. Nominal struk adalah nominal otoritatif.",
      );
    setCart([]);
    setDiscount("0");
    setDiscountReason("");
    await loadSummary(scope);
  }
  async function recover() {
    const result = await coordinator.current.recover();
    credential.current = null;
    setReaderReady(false);
    setTestInput("");
    if (result.sale) {
      setCart([]);
      setDiscount("0");
      setDiscountReason("");
      setWalletPreview(null);
    }
    if (result.refund) {
      setCorrection(null);
      setNotice(
        result.refund.status === "PENDING"
          ? "Refund menunggu konfirmasi eksternal."
          : "Pengembalian dikonfirmasi server.",
      );
      if (detail) await showDetail(detail.sale.id);
    }
    if (scope) await loadSummary(scope);
  }
  async function showDetail(id) {
    const data = await api(`/pos/mobile/transactions/${id}`, { query: scope });
    setDetail(data);
    setSheet("detail");
  }
  async function correct() {
    const blocked = correctionBlock({
      detail,
      kind: correction,
      amount: refundAmount,
      reason,
      reference,
      canRefund: can("pos.refund"),
      canSell: can("pos.sell"),
      shift: summary?.shift,
      online,
      pending,
    });
    if (blocked) throw Error(blocked);
    if (correction === "refund") {
      money(refundAmount);
      await coordinator.current.pay(
        {
          ...scope,
          payment_id: detail.payment.id,
          amount: refundAmount,
          reason,
          ...(detail.payment.method === "CASH"
            ? { shift_id: summary?.shift?.id }
            : {}),
        },
        "/pos/refunds",
      );
    } else if (correction === "void")
      await api(`/pos/sales/${detail.sale.id}/void`, {
        method: "POST",
        body: { ...scope, shift_id: detail.sale.shift_id, reason },
      });
    else if (correction === "confirm-payment")
      await api(`/pos/sales/${detail.sale.id}/confirm-payment`, {
        method: "POST",
        body: {
          ...scope,
          shift_id: detail.sale.shift_id,
          confirmed: true,
          reference,
        },
      });
    else
      await api(`/pos/refunds/${correction}/confirm`, {
        method: "POST",
        body: { ...scope, confirmed: true, reference },
      });
    setCorrection(null);
    setNotice("Perubahan dikonfirmasi server.");
    await showDetail(detail.sale.id);
    await loadSummary(scope);
  }
  const selectedMerchant = context?.merchants.find(
      (m) =>
        m.merchant_id === selected?.merchant_id &&
        m.unit_id === selected?.unit_id,
    ),
    terminal = context?.terminals.find((t) => t.id === selected?.terminal_id);
  const contextReady = !!selectedMerchant && !!terminal;
  function newTransaction() {
    coordinator.current.reset();
    setCart([]);
    setDiscount("0");
    setDiscountReason("");
    setTender("0");
    setReference("");
    setProvider("");
    setConfirmed(false);
    setWalletPreview(null);
    credential.current = null;
    setReaderReady(false);
    setTestInput("");
    setCorrection(null);
    setSheet(null);
    setTab("KASIR");
  }
  function dismissSheet() {
    if (busy || pending) return;
    if (
      sheet === "payment" &&
      ["SUCCESS", "PENDING"].includes(paymentState.state)
    )
      return newTransaction();
    setSheet(null);
    setCorrection(null);
    credential.current = null;
    setReaderReady(false);
    setTestInput("");
    setWalletPreview(null);
  }
  function startPayment() {
    coordinator.current.reset();
    setTender(total);
    setMethod("CASH");
    setConfirmed(false);
    setReference("");
    setProvider("");
    setWalletPreview(null);
    credential.current = null;
    setReaderReady(false);
    setTestInput("");
    setSheet("payment");
  }
  async function reviewState(name) {
    reviewAdapter.setState(name);
    coordinator.current.reset();
    setSheet(null);
    setCorrection(null);
    setWalletPreview(null);
    credential.current = null;
    setReaderReady(false);
    setTestInput("");
    setCart([]);
    setDiscount("0");
    setNotice(
      "SINTETIS: review UI saja; checkout/refund tidak dapat dijalankan.",
    );
    setOnline(name !== "offline");
    setContext({ ...context, shift: reviewAdapter.summary().shift });
    setSummary(reviewAdapter.summary());
    setError(
      name === "error"
        ? "Contoh error: produk tidak tersedia."
        : name === "insufficient balance"
          ? "Saldo tidak cukup."
          : "",
    );
    if (["normal", "loading", "empty"].includes(name)) {
      setCatalog(await api("/pos/mobile/catalog"));
      setHistory(await api("/pos/mobile/transactions"));
    }
    if (name === "empty cart") setSheet("cart");
    if (
      [
        "cart populated",
        "payment success",
        "QRIS pending",
        "RFID preview",
        "large amounts",
      ].includes(name)
    ) {
      setCart(reviewAdapter.products.filter((p) => p.available).slice(0, 3));
      setTender("50000");
      if (name === "cart populated" || name === "large amounts") {
        if (name === "large amounts")
          setCart([
            {
              ...reviewAdapter.products[0],
              price: "9007199254740993",
              quantity: 1,
            },
          ]);
        setSheet("cart");
      } else {
        setSheet("payment");
        if (name === "RFID preview") {
          setMethod("RFID");
          setWalletPreview(reviewAdapter.wallet);
        } else
          setPaymentState({
            state: name === "QRIS pending" ? "PENDING" : "SUCCESS",
            pending: false,
            result: reviewAdapter.receipt(
              name === "QRIS pending" ? "TRANSFER_QRIS" : "CASH",
              name === "QRIS pending" ? "PENDING" : "CONFIRMED",
            ),
          });
      }
    }
    if (name === "unknown/checking") {
      setPaymentState({ state: "UNKNOWN", pending: true, result: null });
      setSheet("payment");
    }
  }
  if (boot)
    return (
      <SafeAreaView style={s.root}>
        <ActivityIndicator color={colors.green} />
        <Text style={s.text}>Memulihkan sesi aman…</Text>
      </SafeAreaView>
    );
  if (!session)
    return (
      <SafeAreaView style={s.root}>
        <KeyboardAvoidingView
          style={s.flex}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={s.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={s.brand}>POS KlikPesantren</Text>
            <Text style={s.text}>Masuk dengan akun kasir tenant.</Text>
            <Card title="Masuk Kasir">
              <Field
                label="Kode institusi"
                value={tenant}
                onChangeText={setTenant}
              />
              <Field
                label="Username"
                value={username}
                onChangeText={setUsername}
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secret
              />
              {error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
              )}
              <Button
                title={busy ? "Memeriksa…" : "Masuk"}
                disabled={busy}
                onPress={login}
              />
              {reviewAdapter && (
                <Button
                  title="Masuk review sintetis"
                  secondary
                  disabled={busy}
                  onPress={() =>
                    run(() =>
                      acceptSession({ token: "local-visual-review-only" }),
                    )
                  }
                />
              )}
            </Card>
            <Text style={s.muted}>
              Lingkungan: {Constants.expoConfig.extra.posEnvironment}
            </Text>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={s.root}>
      {reviewAdapter && (
        <ReviewTools
          states={reviewAdapter.states}
          busy={busy}
          onState={(name) => run(() => reviewState(name))}
        />
      )}
      <View style={s.header}>
        <View style={s.flex}>
          <Text numberOfLines={1} style={s.brand}>
            {selectedMerchant?.nama_merchant || "POS KlikPesantren"}
          </Text>
          <Text numberOfLines={1} style={s.muted}>
            {context.user.nama} · {terminal?.nama_device || "Pilih terminal"}
            {selectedMerchant ? ` · ${selectedMerchant.unit_name}` : ""}
          </Text>
        </View>
        <Badge
          label={online ? "ONLINE" : "OFFLINE"}
          tone={online ? "green" : "amber"}
        />
      </View>
      {(error || notice) && (
        <View accessibilityRole="alert" style={s.feedback}>
          <View style={s.row}>
            <Text style={[error ? s.error : s.success, s.flex]}>
              {error || notice}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tutup pesan"
              onPress={() => {
                setError("");
                setNotice("");
              }}
              style={s.qty}
            >
              <Icon name="x" size={16} />
            </Pressable>
          </View>
          {error && (
            <Button
              title="Coba lagi / perbarui sesi"
              secondary
              disabled={busy}
              onPress={() => run(refreshAfterError)}
            />
          )}
        </View>
      )}
      {!online && (
        <View style={s.feedback}>
          <Text style={s.error}>
            Transaksi membutuhkan koneksi internet. Produk yang sudah dimuat
            dapat dilihat.
          </Text>
        </View>
      )}
      {pending && sheet !== "payment" && (
        <View style={s.feedback}>
          <Text style={s.error}>
            Memeriksa status transaksi... Jangan membuat pembayaran baru.
          </Text>
          <Button
            title="Periksa pembayaran"
            disabled={busy}
            onPress={() => setSheet("payment")}
          />
        </View>
      )}
      <View style={s.flex}>
        {!contextReady ? (
          <ScrollView contentContainerStyle={s.content}>
            <Empty
              icon="monitor"
              title={
                context.shift
                  ? "Terminal shift tidak tersedia"
                  : "Pilih tempat bertugas"
              }
              note={
                context.shift
                  ? "Shift aktif mengunci lokasi. Hubungi Admin untuk memulihkan terminal."
                  : "Hanya merchant dan terminal yang ditugaskan kepada Anda yang tampil."
              }
            />
            {context.merchants.map((m) => (
              <Card
                key={`${m.unit_id}:${m.merchant_id}`}
                title={m.nama_merchant}
              >
                <Text style={s.muted}>{m.unit_name}</Text>
                {context.terminals
                  .filter(
                    (t) =>
                      t.merchant_id === m.merchant_id &&
                      t.unit_id === m.unit_id,
                  )
                  .map((t) => (
                    <Button
                      key={t.id}
                      icon="monitor"
                      title={t.nama_device}
                      disabled={busy || pending || !!context.shift}
                      onPress={() =>
                        run(async () => {
                          const next = {
                            unit_id: m.unit_id,
                            merchant_id: m.merchant_id,
                            terminal_id: t.id,
                          };
                          choose(next);
                          await loadSummary(next);
                        })
                      }
                    />
                  ))}
              </Card>
            ))}
            {!context.merchants.length && (
              <Empty
                title="Belum ada penugasan"
                note="Hubungi Admin untuk penugasan merchant dan terminal POS."
              />
            )}
            <Button
              title="Perbarui konteks"
              secondary
              disabled={busy}
              onPress={refresh}
            />
            <Button
              title="Keluar"
              secondary
              disabled={busy || pending}
              onPress={logout}
            />
          </ScrollView>
        ) : tab === "BERANDA" ? (
          <ScrollView contentContainerStyle={s.content}>
            <View style={s.row}>
              <View>
                <Text style={s.sectionTitle}>Siap melayani hari ini</Text>
                <Text style={s.muted}>
                  {summary?.shift
                    ? `Shift sejak ${date(summary.shift.opened_at)}`
                    : "Buka shift sebelum mulai jualan"}
                </Text>
              </View>
              <Badge
                label={summary?.shift ? "SHIFT AKTIF" : "BELUM BUKA"}
                tone={summary?.shift ? "green" : "amber"}
              />
            </View>
            <Button
              icon={summary?.shift ? "shopping-bag" : "unlock"}
              title={summary?.shift ? "Mulai / lanjut jualan" : "Buka Shift"}
              disabled={
                busy ||
                pending ||
                !online ||
                (!summary?.shift && !can("pos.shifts.manage"))
              }
              onPress={() =>
                summary?.shift ? setTab("KASIR") : setSheet("open")
              }
            />
            {summary?.shift ? (
              <>
                <View style={s.hero}>
                  <Text style={s.heroLabel}>
                    Penjualan terkonfirmasi · shift ini
                  </Text>
                  <Text
                    style={s.heroMoney}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.45}
                  >
                    {rupiah(summary.sales)}
                  </Text>
                  <Text style={s.heroLabel}>
                    {summary.count} transaksi lunas
                  </Text>
                </View>
                <Card title="Metode pembayaran">
                  {["RFID", "CASH", "TRANSFER_QRIS"].map((m) => {
                    const p = summary.payments.find((p) => p.method === m);
                    return (
                      <Row
                        key={m}
                        label={`${PAYMENT_LABELS[m]} · ${p?.count || 0} transaksi`}
                        value={rupiah(p?.amount || 0)}
                      />
                    );
                  })}
                  <Row
                    label="Refund dikonfirmasi"
                    value={rupiah(summary.refunds)}
                  />
                  <Row
                    label="Penjualan neto"
                    value={rupiah(
                      BigInt(summary.sales) - BigInt(summary.refunds),
                    )}
                  />
                  <Text style={s.muted}>
                    Transfer/QRIS tertunda tidak termasuk penjualan lunas.
                  </Text>
                </Card>
                <View style={s.stats}>
                  <View style={s.flex}>
                    <Button
                      title="Transaksi"
                      icon="file-text"
                      secondary
                      onPress={() => setTab("TRANSAKSI")}
                    />
                  </View>
                  {can("pos.shifts.manage") && (
                    <View style={s.flex}>
                      <Button
                        title="Tutup Shift"
                        icon="lock"
                        secondary
                        disabled={busy || pending || !online}
                        onPress={() => setSheet("close")}
                      />
                    </View>
                  )}
                </View>
              </>
            ) : (
              <Empty
                icon="sun"
                title="Shift belum dibuka"
                note="Catat kas awal, lalu layani pelanggan. Transaksi baru akan masuk ke shift Anda."
              />
            )}
            <Button
              title="Perbarui status"
              icon="refresh-cw"
              secondary
              disabled={busy}
              onPress={refresh}
            />
          </ScrollView>
        ) : ["KASIR", "PRODUK"].includes(tab) ? (
          <View style={s.flex}>
            <View style={s.filters}>
              <Field
                label={tab === "KASIR" ? "Cari menu" : "Cari produk"}
                value={search}
                onChangeText={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Chip
                  label="Semua"
                  active={!category}
                  onPress={() => {
                    setCategory(null);
                    setPage(1);
                  }}
                />
                {catalog.categories.map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    active={category === c.id}
                    onPress={() => {
                      setCategory(c.id);
                      setPage(1);
                    }}
                  />
                ))}
              </ScrollView>
            </View>
            {tab === "KASIR" && !summary?.shift && (
              <View style={s.feedback}>
                <Text style={s.error}>
                  Buka shift untuk menambahkan produk dan melayani pelanggan.
                </Text>
              </View>
            )}
            <FlatList
              numColumns={2}
              columnWrapperStyle={s.gridRow}
              data={catalog.products}
              keyExtractor={(p) => p.id}
              contentContainerStyle={s.content}
              ListEmptyComponent={
                <Empty
                  icon="coffee"
                  loading={catalogLoading}
                  title={
                    catalogLoading ? "Memuat produk..." : "Tidak ada produk"
                  }
                  note="Coba kata pencarian atau kategori lain."
                />
              }
              renderItem={({ item: p }) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${p.name}, ${rupiah(p.price)}`}
                  disabled={
                    tab === "PRODUK" ||
                    !p.available ||
                    pending ||
                    busy ||
                    !summary?.shift
                  }
                  onPress={() => {
                    try {
                      editCart(p, 1);
                      setNotice(`${p.name} ditambahkan.`);
                    } catch (e) {
                      setError(errorText(e));
                    }
                  }}
                  style={[s.product, !p.available && s.disabled]}
                >
                  <Artwork url={p.image_url} />
                  <Text numberOfLines={3} style={s.productName}>
                    {p.name}
                  </Text>
                  <Text numberOfLines={1} adjustsFontSizeToFit style={s.price}>
                    {rupiah(p.price)}
                  </Text>
                  <View style={s.row}>
                    <Badge
                      label={p.available ? "Tersedia" : "Tidak tersedia"}
                      tone={p.available ? "green" : "amber"}
                    />
                    {tab === "KASIR" && p.available && (
                      <Icon name="plus-circle" />
                    )}
                  </View>
                </Pressable>
              )}
            />
            <View style={s.pager}>
              <Chip label="‹" onPress={() => page > 1 && setPage(page - 1)} />
              <Text style={s.muted}>
                {page} · {catalog.total} produk
              </Text>
              <Chip
                label="›"
                onPress={() =>
                  page * catalog.limit < catalog.total && setPage(page + 1)
                }
              />
            </View>
            {tab === "KASIR" && (
              <View style={s.cartBar}>
                <View style={s.row}>
                  <Text style={s.value}>
                    {cart.reduce((n, p) => n + p.quantity, 0)} item
                  </Text>
                  <Text style={s.price}>
                    {total ? rupiah(total) : "Nominal tidak valid"}
                  </Text>
                </View>
                <Button
                  icon="shopping-cart"
                  title={
                    cart.length ? "Lihat keranjang" : "Pilih produk untuk mulai"
                  }
                  disabled={!cart.length || busy || pending}
                  onPress={() => setSheet("cart")}
                />
              </View>
            )}
          </View>
        ) : tab === "TRANSAKSI" ? (
          <View style={s.flex}>
            <View style={s.filters}>
              <Text style={s.heading}>
                Transaksi · {summary?.shift ? "shift aktif" : "hari ini"}
              </Text>
              <Field
                label="Cari nomor struk"
                value={historySearch}
                onChangeText={(v) => {
                  setHistorySearch(v);
                  setHistoryPage(1);
                }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[null, "CASH", "RFID", "TRANSFER_QRIS"].map((m) => (
                  <Chip
                    key={m || "all"}
                    label={PAYMENT_LABELS[m] || "Semua metode"}
                    active={historyMethod === m}
                    onPress={() => {
                      setHistoryMethod(m);
                      setHistoryPage(1);
                    }}
                  />
                ))}
              </ScrollView>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {[null, "PAID", "DRAFT", "VOID"].map((status) => (
                  <Chip
                    key={status || "all"}
                    label={STATUS_LABELS[status] || "Semua status"}
                    active={historyStatus === status}
                    onPress={() => {
                      setHistoryStatus(status);
                      setHistoryPage(1);
                    }}
                  />
                ))}
              </ScrollView>
            </View>
            <FlatList
              data={history.rows}
              keyExtractor={(r) => r.id}
              contentContainerStyle={s.content}
              ListEmptyComponent={
                <Empty
                  loading={historyLoading}
                  icon="file-text"
                  title={
                    historyLoading
                      ? "Memuat transaksi..."
                      : "Belum ada transaksi"
                  }
                  note="Riwayat mengikuti shift/hari ini dan filter yang dipilih."
                />
              }
              renderItem={({ item: r }) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  style={s.card}
                  onPress={() => run(() => showDetail(r.id))}
                >
                  <View style={s.row}>
                    <Text numberOfLines={1} style={[s.heading, s.flex]}>
                      {r.receipt}
                    </Text>
                    <Icon name="chevron-right" />
                  </View>
                  <Text style={s.muted}>
                    {date(r.created_at)} · {PAYMENT_LABELS[r.method]}
                  </Text>
                  <View style={s.row}>
                    <Text style={s.price}>{rupiah(r.grand_total)}</Text>
                    <Badge
                      label={STATUS_LABELS[r.status]}
                      tone={r.status === "PAID" ? "green" : "amber"}
                    />
                  </View>
                </Pressable>
              )}
            />
            <View style={s.pager}>
              <Chip
                label="‹"
                onPress={() =>
                  historyPage > 1 && setHistoryPage(historyPage - 1)
                }
              />
              <Text style={s.muted}>
                {historyPage} · {history.total} transaksi
              </Text>
              <Chip
                label="›"
                onPress={() =>
                  historyPage * history.limit < history.total &&
                  setHistoryPage(historyPage + 1)
                }
              />
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.content}>
            <Text style={s.sectionTitle}>Operasional</Text>
            <Card title="Shift & laci kas">
              <Row label="Dibuka" value={date(summary?.shift?.opened_at)} />
              <Row
                label="Kas awal"
                value={rupiah(summary?.shift?.opening_cash)}
              />
              <Row
                label="Kas seharusnya"
                value={rupiah(summary?.expected_cash)}
              />
              {can("pos.shifts.manage") && (
                <Button
                  title={summary?.shift ? "Tutup Shift" : "Buka Shift"}
                  icon={summary?.shift ? "lock" : "unlock"}
                  disabled={busy || pending || !online}
                  onPress={() => setSheet(summary?.shift ? "close" : "open")}
                />
              )}
            </Card>
            <Card title="Perangkat / terminal">
              <Row label="Terminal" value={terminal.nama_device} />
              <Row label="Merchant" value={selectedMerchant.nama_merchant} />
              <Row label="Unit" value={selectedMerchant.unit_name} />
              <Badge
                label={online ? "SIAP · ONLINE" : "OFFLINE"}
                tone={online ? "green" : "amber"}
              />
              <Button
                title="Ganti tempat bertugas"
                secondary
                disabled={!!context.shift || pending || busy}
                onPress={() => choose(null)}
              />
            </Card>
            <Card title="Akun & aplikasi">
              <Row label="Kasir" value={context.user.nama} />
              <Row
                label="Aplikasi"
                value={`POS KlikPesantren ${Constants.expoConfig.version}`}
              />
              {__DEV__ && (
                <Row
                  label="Lingkungan"
                  value={Constants.expoConfig.extra.posEnvironment}
                />
              )}
              <Text style={s.muted}>
                Pembaca RFID fisik belum divalidasi; alur software memakai
                abstraksi reader.
              </Text>
              <Button
                title="Perbarui status"
                icon="refresh-cw"
                secondary
                onPress={refresh}
                disabled={busy}
              />
              <Button
                title="Keluar akun"
                icon="log-out"
                secondary
                onPress={logout}
                disabled={busy || pending}
              />
            </Card>
          </ScrollView>
        )}
      </View>
      <View style={s.tabs}>
        {TABS.map((t) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t }}
            key={t}
            onPress={() => setTab(t)}
            style={[s.tab, tab === t && s.tabActive]}
          >
            <Icon
              name={tabIcons[t]}
              size={21}
              color={tab === t ? colors.green : colors.muted}
            />
            <Text style={[s.tabText, tab === t && s.activeTab]}>
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!sheet}
        animationType="slide"
        onRequestClose={dismissSheet}
      >
        <SafeAreaView style={s.root}>
          {reviewAdapter && (
            <ReviewTools
              busy={busy}
              onReset={() => run(() => reviewState("normal"))}
            />
          )}
          <View style={s.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Kembali"
              disabled={busy || pending}
              style={s.qty}
              onPress={dismissSheet}
            >
              <Icon name="arrow-left" />
            </Pressable>
            <Text style={[s.heading, s.flex]}>
              {
                {
                  cart: "Keranjang",
                  payment: "Pembayaran",
                  open: "Buka Shift",
                  close: "Tutup Shift",
                  detail: "Detail transaksi",
                  login: "Perbarui sesi",
                }[sheet]
              }
            </Text>
          </View>
          <KeyboardAvoidingView
            style={s.flex}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              {error && (
                <View accessibilityRole="alert" style={s.feedback}>
                  <Text style={s.error}>{error}</Text>
                </View>
              )}
              {busy && <ActivityIndicator color={colors.green} />}
              {sheet === "login" && (
                <Card title="Masuk kembali">
                  <Text style={s.muted}>
                    Gunakan akun yang sama. Permintaan pembayaran belum pasti
                    tetap dipertahankan.
                  </Text>
                  <Field
                    label="Kode institusi"
                    value={tenant}
                    onChangeText={setTenant}
                  />
                  <Field
                    label="Username"
                    value={username}
                    onChangeText={setUsername}
                  />
                  <Field
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    secret
                  />
                  <Button
                    title="Masuk kembali"
                    disabled={busy}
                    onPress={login}
                  />
                </Card>
              )}
              {sheet === "open" && (
                <>
                  <Card title="Tempat bertugas">
                    <Row label="Kasir" value={context.user.nama} />
                    <Row
                      label="Merchant"
                      value={selectedMerchant?.nama_merchant}
                    />
                    <Row label="Terminal" value={terminal?.nama_device} />
                    <Row label="Unit" value={selectedMerchant?.unit_name} />
                  </Card>
                  <Card title="Kas awal laci">
                    <Text style={s.muted}>
                      Masukkan uang tunai awal. Saldo dompet dan transfer tidak
                      masuk laci.
                    </Text>
                    <Field
                      label="Kas awal (Rupiah)"
                      value={opening}
                      onChangeText={setOpening}
                      numeric
                    />
                  </Card>
                </>
              )}
              {sheet === "close" && (
                <>
                  <Card title="Ringkasan kas dari server">
                    <Row
                      label="Kas awal"
                      value={rupiah(summary?.shift?.opening_cash)}
                    />
                    <Row
                      label="+ Penjualan tunai"
                      value={rupiah(summary?.cash_sales)}
                    />
                    <Row
                      label="− Refund tunai dikonfirmasi"
                      value={rupiah(summary?.cash_refunds)}
                    />
                    <Money
                      label="Kas seharusnya"
                      value={rupiah(summary?.expected_cash)}
                    />
                    <Text style={s.muted}>
                      RFID dan Transfer/QRIS tidak dihitung sebagai uang laci.
                    </Text>
                  </Card>
                  <Card title="Hitung uang laci">
                    <Field
                      label="Kas aktual (Rupiah)"
                      value={actual}
                      onChangeText={setActual}
                      numeric
                    />
                    <Row
                      label="Selisih perkiraan"
                      value={
                        /^(0|[1-9]\d*)$/.test(actual)
                          ? rupiah(
                              BigInt(actual) -
                                BigInt(summary?.expected_cash || 0),
                            )
                          : "Masukkan nominal valid"
                      }
                    />
                    <Text style={s.muted}>
                      Nilai akhir dan selisih tetap dihitung server. Tutup shift
                      menghentikan penjualan pada shift ini.
                    </Text>
                  </Card>
                </>
              )}
              {sheet === "cart" && (
                <>
                  <Card
                    title={`${cart.reduce((n, p) => n + p.quantity, 0)} item dalam keranjang`}
                  >
                    {!cart.length && (
                      <Empty
                        icon="shopping-cart"
                        title="Keranjang kosong"
                        note="Kembali ke Kasir untuk memilih produk."
                      />
                    )}
                    {cart.map((p) => (
                      <View key={p.id} style={s.cartItem}>
                        <Text style={s.heading}>{p.name}</Text>
                        <Row
                          label={`${rupiah(p.price)} per item`}
                          value={rupiah(BigInt(p.quantity) * BigInt(p.price))}
                        />
                        <View style={s.row}>
                          <View
                            style={[s.row, { justifyContent: "flex-start" }]}
                          >
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Kurangi ${p.name}`}
                              style={s.qty}
                              onPress={() => editCart(p, -1)}
                            >
                              <Icon name="minus" />
                            </Pressable>
                            <Text style={s.value}>{p.quantity}</Text>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityLabel={`Tambah ${p.name}`}
                              disabled={p.quantity >= 2147483647}
                              style={s.qty}
                              onPress={() => editCart(p, 1)}
                            >
                              <Icon name="plus" />
                            </Pressable>
                          </View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Hapus ${p.name}`}
                            style={s.qty}
                            onPress={() =>
                              setCart((current) =>
                                current.filter((i) => i.id !== p.id),
                              )
                            }
                          >
                            <Icon name="trash-2" color={colors.red} />
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </Card>
                  {can("pos.discount") && cart.length > 0 && (
                    <Card title="Diskon">
                      <Field
                        label="Diskon nominal (Rupiah)"
                        value={discount}
                        onChangeText={setDiscount}
                        numeric
                      />
                      {discount !== "0" && (
                        <Field
                          label="Alasan diskon (minimal 5 karakter)"
                          value={discountReason}
                          onChangeText={setDiscountReason}
                        />
                      )}
                    </Card>
                  )}
                  <Card title="Ringkasan">
                    <Row
                      label="Subtotal"
                      value={cartTotals ? rupiah(cartTotals.subtotal) : "—"}
                    />
                    <Row
                      label="Diskon"
                      value={cartTotals ? rupiah(cartTotals.discount) : "—"}
                    />
                    <Money
                      label="Total pembelian"
                      value={total ? rupiah(total) : "Nominal tidak valid"}
                    />
                    <Text style={s.muted}>
                      Harga dan total final ditentukan server saat pembayaran.
                    </Text>
                  </Card>
                </>
              )}
              {sheet === "payment" && (
                <>
                  {["SUCCESS", "PENDING"].includes(paymentState.state) ? (
                    <Card>
                      <Receipt
                        result={paymentState.result}
                        onNew={newTransaction}
                        onDetail={
                          paymentState.result?.sale
                            ? () =>
                                run(() =>
                                  showDetail(paymentState.result.sale.id),
                                )
                            : null
                        }
                      />
                    </Card>
                  ) : pending ? (
                    <Card>
                      <Empty
                        icon="clock"
                        loading={["PROCESSING", "CHECKING"].includes(
                          paymentState.state,
                        )}
                        title={
                          STATUS_LABELS[paymentState.state] ||
                          "Memeriksa status transaksi..."
                        }
                        note="Jangan membuat transaksi baru. Pemeriksaan memakai identitas pembayaran yang sama."
                      />
                      <Button
                        title="Periksa status transaksi"
                        disabled={
                          busy ||
                          ["PROCESSING", "CHECKING"].includes(
                            paymentState.state,
                          )
                        }
                        onPress={() => run(recover)}
                      />
                      <Button
                        title="Perbarui sesi akun yang sama"
                        secondary
                        disabled={busy}
                        onPress={() => setSheet("login")}
                      />
                    </Card>
                  ) : (
                    <>
                      <Card>
                        <Money
                          label="Total pembelian"
                          value={total ? rupiah(total) : "—"}
                        />
                      </Card>
                      <Text style={s.heading}>Pilih metode pembayaran</Text>
                      {[
                        ["RFID", "credit-card", "Tempelkan kartu santri"],
                        [
                          "CASH",
                          "dollar-sign",
                          "Terima tunai dan hitung kembalian",
                        ],
                        [
                          "TRANSFER_QRIS",
                          "smartphone",
                          "Catat transfer/QRIS secara manual",
                        ],
                      ].map(([m, icon, note]) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ selected: method === m }}
                          key={m}
                          onPress={() => {
                            setMethod(m);
                            credential.current = null;
                            setReaderReady(false);
                            setWalletPreview(null);
                            setTestInput("");
                          }}
                          style={[s.choice, method === m && s.choiceActive]}
                        >
                          <Icon name={icon} size={24} />
                          <View style={s.flex}>
                            <Text style={s.heading}>{PAYMENT_LABELS[m]}</Text>
                            <Text style={s.muted}>{note}</Text>
                          </View>
                          {method === m && <Icon name="check-circle" />}
                        </Pressable>
                      ))}
                      {method === "CASH" && (
                        <Card title="Pembayaran tunai">
                          <Field
                            label="Uang diterima (Rupiah)"
                            value={tender}
                            onChangeText={setTender}
                            numeric
                          />
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                          >
                            {total &&
                              cashShortcuts(total).map((v, i) => (
                                <Chip
                                  key={v}
                                  label={i === 0 ? "Uang pas" : rupiah(v)}
                                  active={v === tender}
                                  onPress={() => setTender(v)}
                                />
                              ))}
                          </ScrollView>
                          <Money
                            label="Kembalian"
                            value={
                              /^(0|[1-9]\d*)$/.test(tender) &&
                              total &&
                              BigInt(tender) >= BigInt(total)
                                ? rupiah(BigInt(tender) - BigInt(total))
                                : "Uang diterima kurang"
                            }
                          />
                        </Card>
                      )}
                      {method === "TRANSFER_QRIS" && (
                        <Card title="Transfer / QRIS manual">
                          <Badge
                            label={
                              confirmed
                                ? "AKAN DIKONFIRMASI"
                                : "MENUNGGU KONFIRMASI"
                            }
                            tone={confirmed ? "green" : "amber"}
                          />
                          <Text style={s.muted}>
                            Tidak ada gateway atau QR otomatis. Verifikasi dana
                            nyata sebelum menandai lunas.
                          </Text>
                          <Field
                            label="Bank / provider (opsional)"
                            value={provider}
                            onChangeText={setProvider}
                          />
                          <Field
                            label="Referensi pembayaran"
                            value={reference}
                            onChangeText={setReference}
                          />
                          <Button
                            title={
                              confirmed
                                ? "✓ Dana sudah saya terima"
                                : "Dana belum diterima"
                            }
                            secondary
                            onPress={() => setConfirmed(!confirmed)}
                          />
                          <Text style={s.muted}>
                            {confirmed
                              ? "Referensi wajib. Transaksi akan dicatat lunas."
                              : "Disimpan tertunda, bukan pendapatan lunas. Konfirmasi nanti melalui detail transaksi."}
                          </Text>
                        </Card>
                      )}
                      {method === "RFID" && (
                        <Card title="Tempelkan kartu">
                          <Icon name="credit-card" size={34} />
                          <Text style={s.text}>
                            {walletPreview
                              ? "Periksa santri dan saldo sebelum membayar."
                              : "Menunggu pembaca kartu yang terhubung."}
                          </Text>
                          {__DEV__ &&
                          Constants.expoConfig.extra.posEnvironment ===
                            "development" ? (
                            <>
                              <Button
                                title="Pembaca uji development"
                                secondary
                                onPress={() => setReaderDev(!readerDev)}
                              />
                              {readerDev && (
                                <>
                                  <Field
                                    label="Kredensial test (disembunyikan)"
                                    value={testInput}
                                    onChangeText={setTestInput}
                                    secret
                                  />
                                  <Button
                                    title="Baca kartu uji"
                                    secondary
                                    disabled={busy || !online}
                                    onPress={() => run(scan)}
                                  />
                                </>
                              )}
                            </>
                          ) : (
                            <Text style={s.muted}>
                              Pembaca fisik belum divalidasi. Gunakan metode
                              lain sampai perangkat pembaca siap.
                            </Text>
                          )}
                          {walletPreview && (
                            <>
                              <Row
                                label="Santri"
                                value={walletPreview.santri_name}
                              />
                              <Row
                                label="Unit"
                                value={selectedMerchant?.unit_name}
                              />
                              <Row
                                label="Saldo dompet"
                                value={rupiah(walletPreview.current_balance)}
                              />
                              <Row label="Pembelian" value={rupiah(total)} />
                              <Row
                                label="Sisa setelah pembelian"
                                value={rupiah(walletPreview.projected_balance)}
                              />
                            </>
                          )}
                          <Text style={s.muted}>
                            Pembayaran dompet selalu memerlukan internet. Saldo
                            diperiksa kembali secara atomik oleh server.
                          </Text>
                        </Card>
                      )}
                    </>
                  )}
                </>
              )}
              {sheet === "detail" && detail && (
                <>
                  <Card>
                    <Receipt result={detail} />
                    <Row label="Terminal" value={detail.sale.terminal_name} />
                    {detail.sale.discount_reason && (
                      <Row
                        label="Alasan diskon"
                        value={detail.sale.discount_reason}
                      />
                    )}
                    <Row
                      label="Pengembalian dikonfirmasi"
                      value={rupiah(refundSummary(detail).confirmed)}
                    />
                    <Row
                      label="Sudah dialokasikan (termasuk pending)"
                      value={rupiah(refundSummary(detail).reserved)}
                    />
                    <Row
                      label="Sisa dapat dikembalikan"
                      value={rupiah(refundSummary(detail).remaining)}
                    />
                  </Card>
                  {detail.refunds.map((r) => (
                    <Card key={r.id}>
                      <Badge
                        label={`Refund · ${STATUS_LABELS[r.status]}`}
                        tone={r.status === "PENDING" ? "amber" : "green"}
                      />
                      <Row label="Nominal" value={rupiah(r.amount)} />
                      <Text style={s.text}>{r.reason}</Text>
                      {r.status === "PENDING" && can("pos.refund") && (
                        <Button
                          title="Konfirmasi dana refund eksternal"
                          secondary
                          disabled={busy || pending || !online}
                          onPress={() => {
                            setCorrection(r.id);
                            setReference("");
                          }}
                        />
                      )}
                    </Card>
                  ))}
                  {!correction && (
                    <Card title="Koreksi transaksi">
                      {detail.sale.status === "DRAFT" &&
                        can("pos.sell") &&
                        summary?.shift?.id === detail.sale.shift_id && (
                          <>
                            <Button
                              title="Konfirmasi dana diterima"
                              secondary
                              disabled={busy || pending || !online}
                              onPress={() => {
                                setCorrection("confirm-payment");
                                setReference("");
                              }}
                            />
                            <Button
                              title="Batalkan transaksi belum dibayar"
                              secondary
                              disabled={busy || pending || !online}
                              onPress={() => {
                                setCorrection("void");
                                setReason("");
                              }}
                            />
                          </>
                        )}
                      {detail.sale.status === "PAID" &&
                        can("pos.refund") &&
                        BigInt(refundSummary(detail).remaining) > 0n && (
                          <Button
                            title="Pengembalian dana"
                            secondary
                            disabled={
                              busy ||
                              pending ||
                              !online ||
                              (detail.payment.method === "CASH" &&
                                !summary?.shift)
                            }
                            onPress={() => {
                              setCorrection("refund");
                              setReason("");
                              setRefundAmount("");
                              coordinator.current.reset();
                            }}
                          />
                        )}
                      <Text style={s.muted}>
                        Riwayat asli tidak dapat diedit. Pengembalian dompet
                        masuk ke rekening asal; pengembalian tunai memakai laci
                        shift aktif.
                      </Text>
                    </Card>
                  )}
                  {correction && (
                    <Card
                      title={
                        correction === "refund"
                          ? "Pengembalian dana"
                          : correction === "void"
                            ? "Batalkan transaksi"
                            : "Konfirmasi dana eksternal"
                      }
                    >
                      {correction === "refund" && (
                        <>
                          <Row
                            label="Nominal awal"
                            value={rupiah(detail.payment.amount)}
                          />
                          <Row
                            label="Sisa dapat dikembalikan"
                            value={rupiah(refundSummary(detail).remaining)}
                          />
                          <Field
                            label="Nominal pengembalian (Rupiah)"
                            value={refundAmount}
                            onChangeText={setRefundAmount}
                            numeric
                          />
                          <Text style={s.muted}>
                            {detail.payment.method === "RFID"
                              ? "Kredit ke dompet asli."
                              : detail.payment.method === "CASH"
                                ? "Pengeluaran laci pada shift aktif."
                                : "Refund eksternal disimpan tertunda sampai referensi dikonfirmasi."}
                          </Text>
                        </>
                      )}
                      {["refund", "void"].includes(correction) ? (
                        <Field
                          label="Alasan (minimal 5 karakter)"
                          value={reason}
                          onChangeText={setReason}
                        />
                      ) : (
                        <Field
                          label="Referensi dana eksternal"
                          value={reference}
                          onChangeText={setReference}
                        />
                      )}
                      <Button
                        title="Konfirmasi tindakan"
                        disabled={
                          busy ||
                          !!correctionBlock({
                            detail,
                            kind: correction,
                            amount: refundAmount,
                            reason,
                            reference,
                            canRefund: can("pos.refund"),
                            canSell: can("pos.sell"),
                            shift: summary?.shift,
                            online,
                            pending,
                          })
                        }
                        onPress={() =>
                          confirmAction(
                            "Lanjutkan koreksi?",
                            `Struk ${detail.sale.receipt}. Histori asli tetap disimpan.`,
                            correct,
                          )
                        }
                      />
                      <Button
                        title="Batal"
                        secondary
                        disabled={busy || pending}
                        onPress={() => setCorrection(null)}
                      />
                    </Card>
                  )}
                </>
              )}
            </ScrollView>
            {sheet === "cart" && (
              <View style={s.footer}>
                <Button
                  icon="credit-card"
                  title={`Bayar ${total ? rupiah(total) : "—"}`}
                  disabled={
                    !cart.length ||
                    !total ||
                    total === "0" ||
                    busy ||
                    pending ||
                    !online ||
                    !summary?.shift ||
                    (discount !== "0" &&
                      (!can("pos.discount") ||
                        discountReason.trim().length < 5))
                  }
                  onPress={startPayment}
                />
              </View>
            )}
            {sheet === "payment" &&
              !pending &&
              !["SUCCESS", "PENDING"].includes(paymentState.state) && (
                <View style={s.footer}>
                  <Button
                    title={
                      method === "CASH"
                        ? "Bayar Tunai"
                        : method === "RFID"
                          ? "Bayar dengan Dompet"
                          : confirmed
                            ? "Konfirmasi pembayaran"
                            : "Simpan menunggu konfirmasi"
                    }
                    icon="check"
                    disabled={
                      !!paymentBlock({
                        cart,
                        discount,
                        discountReason,
                        canDiscount: can("pos.discount"),
                        method,
                        tender,
                        online,
                        shift: summary?.shift,
                        walletPreview,
                        credentialReady: readerReady,
                        pending,
                        busy,
                        confirmed,
                        reference,
                      })
                    }
                    onPress={() => run(pay)}
                  />
                  {!online && (
                    <Text style={s.error}>
                      Transaksi membutuhkan koneksi internet.
                    </Text>
                  )}
                </View>
              )}
            {sheet === "open" && (
              <View style={s.footer}>
                <Button
                  title="Buka Shift"
                  icon="unlock"
                  disabled={
                    busy ||
                    pending ||
                    !can("pos.shifts.manage") ||
                    !online ||
                    !validMoney(opening)
                  }
                  onPress={() => run(open)}
                />
              </View>
            )}
            {sheet === "close" && (
              <View style={s.footer}>
                <Button
                  title="Konfirmasi tutup shift"
                  icon="lock"
                  disabled={
                    busy ||
                    pending ||
                    !online ||
                    !can("pos.shifts.manage") ||
                    !summary?.shift ||
                    !validMoney(actual)
                  }
                  onPress={() =>
                    confirmAction(
                      "Tutup shift?",
                      "Pastikan uang laci sudah dihitung. Penjualan akan dihentikan pada shift ini.",
                      close,
                    )
                  }
                />
              </View>
            )}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
      <Modal
        visible={!!confirmation}
        transparent
        animationType="fade"
        onRequestClose={() => !busy && setConfirmation(null)}
      >
        <View style={s.overlay}>
          <View style={s.dialog}>
            <Text style={s.heading}>{confirmation?.title}</Text>
            <Text style={s.text}>{confirmation?.message}</Text>
            <Button
              title="Ya, konfirmasi"
              disabled={busy}
              onPress={() => {
                const action = confirmation.action;
                setConfirmation(null);
                run(action);
              }}
            />
            <Button
              title="Batal"
              secondary
              disabled={busy}
              onPress={() => setConfirmation(null)}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
function Receipt({ result, onNew, onDetail }) {
  if (!result?.sale)
    return (
      <Empty
        icon="check-circle"
        title={
          result?.payment?.status === "PENDING"
            ? "Pengembalian menunggu konfirmasi"
            : "Pengembalian tersimpan"
        }
        onRetry={onNew}
      />
    );
  const { sale, payment, items } = result,
    paid = sale.status === "PAID" && payment.status === "CONFIRMED",
    voided = sale.status === "VOID";
  return (
    <>
      <View style={s.receiptHero}>
        <Icon
          name={paid ? "check-circle" : voided ? "x-circle" : "clock"}
          size={42}
          color={paid ? colors.green : colors.amber}
        />
        <Text style={s.sectionTitle}>
          {paid
            ? "Pembayaran berhasil"
            : voided
              ? "Transaksi dibatalkan"
              : "Menunggu konfirmasi"}
        </Text>
        <Money value={rupiah(sale.grand_total)} />
        <Badge
          label={PAYMENT_LABELS[payment.method]}
          tone={paid ? "green" : "amber"}
        />
      </View>
      {!paid && !voided && (
        <Text style={s.muted}>
          Belum diakui sebagai penjualan lunas. Verifikasi dana melalui detail
          transaksi.
        </Text>
      )}
      <Row label="Nomor struk" value={sale.receipt} />
      <Row label="Merchant" value={sale.merchant_name} />
      <Row label="Kasir" value={sale.cashier_name} />
      <Row label="Waktu" value={date(sale.created_at)} />
      {items.map((i) => (
        <View key={i.id} style={s.cartItem}>
          <Text style={s.text}>{i.name}</Text>
          <Row
            label={`${i.quantity} × ${rupiah(i.unit_price)}`}
            value={rupiah(i.total)}
          />
          {BigInt(i.discount || 0) > 0n && (
            <Row label="Diskon item" value={rupiah(i.discount)} />
          )}
        </View>
      ))}
      <Row label="Subtotal" value={rupiah(sale.subtotal)} />
      <Row label="Diskon" value={rupiah(sale.discount)} />
      <Row label="Total" value={rupiah(sale.grand_total)} />
      {payment.method === "CASH" && (
        <>
          <Row label="Uang diterima" value={rupiah(payment.tendered)} />
          <Row label="Kembalian" value={rupiah(payment.change)} />
        </>
      )}
      {payment.method === "RFID" && (
        <>
          {payment.santri_name && (
            <Row label="Santri" value={payment.santri_name} />
          )}
          <Row
            label="Saldo setelah transaksi"
            value={rupiah(payment.wallet_balance_after)}
          />
        </>
      )}
      {sale.void_reason && (
        <Row label="Alasan pembatalan" value={sale.void_reason} />
      )}
      <Text style={s.muted}>
        Nominal struk berasal dari server. Riwayat pembayaran tidak dapat
        diedit.
      </Text>
      {onNew && (
        <Button icon="shopping-bag" title="Transaksi Baru" onPress={onNew} />
      )}{" "}
      {onDetail && <Button title="Lihat Detail" secondary onPress={onDetail} />}
    </>
  );
}
