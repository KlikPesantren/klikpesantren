import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import Constants from "expo-constants";
import { makeApi } from "./src/api";
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
const storage =
  Platform.OS === "web"
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
const colors = {
  green: "#087f5b",
  navy: "#102b40",
  muted: "#586b7b",
  line: "#dce5e8",
  surface: "#fff",
  background: "#f3f6f8",
  red: "#b42318",
};
function Button({ title, onPress, disabled, secondary = false }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, disabled && s.disabled]}
    >
      <Text style={[s.buttonText, secondary && { color: colors.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChangeText,
  secret = false,
  numeric = false,
}) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secret}
        keyboardType={numeric ? "number-pad" : "default"}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </View>
  );
}
function Card({ title, children }) {
  return (
    <View style={s.card}>
      {title && <Text style={s.heading}>{title}</Text>}
      {children}
    </View>
  );
}
function Row({ label, value }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}
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
    [historyMethod, setHistoryMethod] = useState(null);
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
  const api = useMemo(() => makeApi(session?.token, setOnline), [session]);
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
  let total;
  try {
    total = totals(cart, discount).total;
  } catch {
    total = null;
  }
  const can = (p) => context?.permissions?.includes(p);
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
      const client = makeApi(saved.token, setOnline),
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
        const saved = await vault.read("session");
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
    const timer = setTimeout(
      () =>
        apiRef
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
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [session, selected, tab, search, category, page]);
  useEffect(() => {
    if (!session || !selected || tab !== "TRANSAKSI") return;
    let alive = true;
    const g = generation.current;
    const timer = setTimeout(
      () =>
        apiRef
          .current("/pos/mobile/transactions", {
            query: {
              ...selected,
              page: historyPage,
              search: historySearch,
              method: historyMethod,
            },
          })
          .then((data) => {
            if (alive && g === generation.current) setHistory(data);
          })
          .catch((e) => {
            if (alive && g === generation.current) setError(errorText(e));
          }),
      200,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [session, selected, tab, historyPage, historySearch, historyMethod]);
  async function login() {
    await run(async () => {
      const result = await makeApi(null, setOnline)("/auth/login", {
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
    Alert.alert(title, message, [
      { text: "Batal", style: "cancel" },
      { text: "Konfirmasi", onPress: () => run(action) },
    ]);
  async function open() {
    money(opening);
    const row = await api("/pos/shifts/open", {
      method: "POST",
      body: { ...scope, opening_cash: opening },
    });
    setContext({ ...context, shift: row });
    setSheet(null);
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
    setNotice(`Shift ditutup. Selisih ${rupiah(row.difference)}.`);
    await loadSummary(scope);
  }
  async function scan() {
    credential.current = null;
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
    setWalletPreview(preview);
  }
  async function pay() {
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
    setWalletPreview(null);
    setTestInput("");
    if (result.sale.grand_total !== expected)
      setNotice(
        "Harga diperbarui server. Nominal struk adalah nominal otoritatif.",
      );
    await loadSummary(scope);
  }
  async function recover() {
    const result = await coordinator.current.recover();
    credential.current = null;
    setTestInput("");
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
      <View style={s.header}>
        <View style={s.flex}>
          <Text style={s.brand}>POS KlikPesantren</Text>
          <Text style={s.muted}>
            {selectedMerchant?.nama_merchant || "Pilih merchant"} ·{" "}
            {terminal?.nama_device || "Pilih terminal"}
          </Text>
        </View>
        <Text style={online ? s.success : s.error}>
          {online ? "ONLINE" : "OFFLINE"}
        </Text>
      </View>
      {(error || notice) && (
        <View accessibilityRole="alert" style={s.feedback}>
          <Text style={error ? s.error : s.success}>{error || notice}</Text>
          <Button
            title="Tutup pesan"
            secondary
            onPress={() => {
              setError("");
              setNotice("");
            }}
          />
          <Button
            title="Masuk kembali / perbarui sesi"
            secondary
            disabled={busy}
            onPress={() => setSheet("login")}
          />
        </View>
      )}
      {pending && (
        <View style={s.feedback}>
          <Text style={s.error}>
            Status pembayaran belum pasti. Jangan membuat transaksi baru.
          </Text>
          <Button
            title="Periksa transaksi yang sama"
            disabled={busy}
            onPress={() => run(recover)}
          />
        </View>
      )}
      <View style={s.flex}>
        {!contextReady ? (
          <ScrollView contentContainerStyle={s.content}>
            <Card title="Konteks Kasir">
              <Text style={s.text}>
                {context.shift
                  ? "Shift aktif mengunci konteks. Terminal/penugasan tidak tersedia: hubungi admin."
                  : "Pilih terminal yang ditugaskan server."}
              </Text>
              {!context.merchants.length && (
                <Text style={s.error}>Belum ada penugasan merchant aktif.</Text>
              )}
              {context.merchants.map((m) => (
                <View key={`${m.unit_id}:${m.merchant_id}`}>
                  <Text style={s.heading}>
                    {m.nama_merchant} · {m.unit_name}
                  </Text>
                  {context.terminals
                    .filter(
                      (t) =>
                        t.merchant_id === m.merchant_id &&
                        t.unit_id === m.unit_id,
                    )
                    .map((t) => (
                      <Button
                        key={t.id}
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
                </View>
              ))}
              <Button
                title="Perbarui konteks"
                secondary
                onPress={refresh}
                disabled={busy}
              />
              <Button
                title="Logout"
                secondary
                onPress={logout}
                disabled={busy || pending}
              />
            </Card>
          </ScrollView>
        ) : tab === "BERANDA" ? (
          <ScrollView contentContainerStyle={s.content}>
            <Card title="Siap Operasional">
              <Row label="Kasir" value={context.user.nama} />
              <Row label="Unit" value={selectedMerchant.unit_name} />
              <Row label="Terminal" value={terminal.nama_device} />
              <Row
                label="Shift"
                value={summary?.shift ? "OPEN" : "BELUM DIBUKA"}
              />
              <Button
                title={summary?.shift ? "BUKA KASIR" : "BUKA SHIFT"}
                disabled={busy || pending || !online}
                onPress={() =>
                  summary?.shift ? setTab("KASIR") : setSheet("open")
                }
              />
            </Card>
            {summary?.shift && (
              <Card title="Ringkasan Shift">
                <Text style={s.money}>{rupiah(summary.sales)}</Text>
                <Row label="Transaksi terkonfirmasi" value={summary.count} />
                {summary.payments.map((p) => (
                  <Row
                    key={p.method}
                    label={p.method}
                    value={rupiah(p.amount)}
                  />
                ))}
                <Row
                  label="Refund terkonfirmasi"
                  value={rupiah(summary.refunds)}
                />
              </Card>
            )}
            <Button
              title="Perbarui status"
              secondary
              disabled={busy}
              onPress={refresh}
            />
          </ScrollView>
        ) : ["KASIR", "PRODUK"].includes(tab) ? (
          <View style={s.flex}>
            <View style={s.filters}>
              <Field
                label="Cari produk"
                value={search}
                onChangeText={(v) => {
                  setSearch(v);
                  setPage(1);
                }}
              />
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <Button
                  title="Semua"
                  secondary
                  onPress={() => {
                    setCategory(null);
                    setPage(1);
                  }}
                />
                {catalog.categories.map((c) => (
                  <Button
                    key={c.id}
                    title={c.name}
                    secondary
                    onPress={() => {
                      setCategory(c.id);
                      setPage(1);
                    }}
                  />
                ))}
              </ScrollView>
            </View>
            <FlatList
              data={catalog.products}
              keyExtractor={(p) => p.id}
              contentContainerStyle={s.content}
              ListEmptyComponent={
                <Text style={s.muted}>Tidak ada produk untuk filter ini.</Text>
              }
              renderItem={({ item: p }) => (
                <Pressable
                  accessibilityRole="button"
                  disabled={
                    tab === "PRODUK" ||
                    !p.available ||
                    pending ||
                    !summary?.shift
                  }
                  onPress={() => {
                    try {
                      setCart(changeCart(cart, p, 1));
                    } catch (e) {
                      setError(errorText(e));
                    }
                  }}
                  style={[s.product, !p.available && s.disabled]}
                >
                  <View style={s.flex}>
                    <Text style={s.heading}>{p.name}</Text>
                    <Text style={s.muted}>
                      {p.available ? "Tersedia" : "Tidak tersedia"} · {p.sku}
                    </Text>
                  </View>
                  <Text style={s.price}>{rupiah(p.price)}</Text>
                </Pressable>
              )}
            />
            <View style={s.pager}>
              <Button
                title="‹"
                secondary
                disabled={page <= 1}
                onPress={() => setPage(page - 1)}
              />
              <Text style={s.muted}>
                {page} · {catalog.total} produk
              </Text>
              <Button
                title="›"
                secondary
                disabled={page * catalog.limit >= catalog.total}
                onPress={() => setPage(page + 1)}
              />
            </View>
            {tab === "KASIR" && (
              <View style={s.cartBar}>
                <Text style={s.value}>
                  {cart.reduce((n, p) => n + p.quantity, 0)} item ·{" "}
                  {total ? rupiah(total) : "Nominal tidak valid"}
                </Text>
                <Button
                  title="Keranjang"
                  disabled={!cart.length || pending || busy}
                  onPress={() => setSheet("cart")}
                />
              </View>
            )}
          </View>
        ) : tab === "TRANSAKSI" ? (
          <View style={s.flex}>
            <View style={s.filters}>
              <Field
                label="Cari struk"
                value={historySearch}
                onChangeText={(v) => {
                  setHistorySearch(v);
                  setHistoryPage(1);
                }}
              />
              <ScrollView horizontal>
                {[null, "CASH", "RFID", "TRANSFER_QRIS"].map((m) => (
                  <Button
                    key={m || "all"}
                    title={m || "Semua"}
                    secondary
                    onPress={() => {
                      setHistoryMethod(m);
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
                <Text style={s.muted}>
                  Belum ada transaksi pada shift/hari ini.
                </Text>
              }
              renderItem={({ item: r }) => (
                <Pressable
                  style={s.card}
                  onPress={() => run(() => showDetail(r.id))}
                >
                  <Text numberOfLines={1} style={s.heading}>
                    {r.receipt}
                  </Text>
                  <Row label={r.method} value={rupiah(r.grand_total)} />
                  <Text style={s.muted}>
                    {r.status} · {r.payment_status}
                  </Text>
                </Pressable>
              )}
            />
            <View style={s.pager}>
              <Button
                title="‹"
                secondary
                disabled={historyPage <= 1}
                onPress={() => setHistoryPage(historyPage - 1)}
              />
              <Text>
                {historyPage} · {history.total}
              </Text>
              <Button
                title="›"
                secondary
                disabled={historyPage * history.limit >= history.total}
                onPress={() => setHistoryPage(historyPage + 1)}
              />
            </View>
          </View>
        ) : (
          <ScrollView contentContainerStyle={s.content}>
            <Card title="Operasional">
              <Row label="Kasir" value={context.user.nama} />
              <Row label="Merchant" value={selectedMerchant.nama_merchant} />
              <Row label="Unit" value={selectedMerchant.unit_name} />
              <Row label="Terminal" value={terminal.nama_device} />
              <Row label="Aplikasi" value={Constants.expoConfig.version} />
              <Row label="Koneksi" value={online ? "Online" : "Terputus"} />
              <Text style={s.muted}>
                RFID: pembaca fisik menunggu validasi hardware. Adapter input
                hanya tersedia pada development.
              </Text>
              {can("pos.shifts.manage") && (
                <Button
                  title={summary?.shift ? "Tutup Shift" : "Buka Shift"}
                  disabled={busy || pending || !online}
                  onPress={() => setSheet(summary?.shift ? "close" : "open")}
                />
              )}
              <Button
                title="Ganti merchant / terminal"
                secondary
                disabled={!!context.shift || pending || busy}
                onPress={() => choose(null)}
              />
              <Button
                title="Perbarui status"
                secondary
                onPress={refresh}
                disabled={busy}
              />
              <Button
                title="Logout"
                secondary
                disabled={busy || pending}
                onPress={logout}
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
            style={s.tab}
          >
            <Text style={[s.tabText, tab === t && s.activeTab]}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <Modal
        visible={!!sheet}
        animationType="slide"
        onRequestClose={() => {
          if (!busy && !pending) {
            setSheet(null);
            setCorrection(null);
            credential.current = null;
            setTestInput("");
            setWalletPreview(null);
          }
        }}
      >
        <SafeAreaView style={s.root}>
          <KeyboardAvoidingView
            style={s.flex}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <ScrollView
              contentContainerStyle={s.content}
              keyboardShouldPersistTaps="handled"
            >
              <Button
                title="Kembali"
                secondary
                disabled={busy || pending}
                onPress={() => {
                  setSheet(null);
                  setCorrection(null);
                  credential.current = null;
                  setTestInput("");
                  setWalletPreview(null);
                }}
              />
              {error && (
                <Text accessibilityRole="alert" style={s.error}>
                  {error}
                </Text>
              )}
              {busy && <ActivityIndicator color={colors.green} />}
              {sheet === "login" && (
                <Card title="Perbarui Sesi">
                  <Text style={s.text}>
                    Gunakan akun yang sama bila ada transaksi belum pasti.
                    Request lama tetap dipertahankan.
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
                <Card title="Buka Shift">
                  <Row
                    label="Merchant"
                    value={selectedMerchant?.nama_merchant}
                  />
                  <Row label="Terminal" value={terminal?.nama_device} />
                  <Field
                    label="Kas awal (Rupiah)"
                    value={opening}
                    onChangeText={setOpening}
                    numeric
                  />
                  <Button
                    title="Buka Shift"
                    disabled={busy || !can("pos.shifts.manage") || !online}
                    onPress={() => run(open)}
                  />
                </Card>
              )}
              {sheet === "close" && (
                <Card title="Tutup Shift">
                  <Row
                    label="Kas awal"
                    value={rupiah(summary?.shift?.opening_cash)}
                  />
                  <Row
                    label="Penjualan tunai"
                    value={rupiah(summary?.cash_sales)}
                  />
                  <Row
                    label="Refund tunai"
                    value={rupiah(summary?.cash_refunds)}
                  />
                  <Row
                    label="Kas seharusnya"
                    value={rupiah(summary?.expected_cash)}
                  />
                  <Field
                    label="Kas aktual (Rupiah)"
                    value={actual}
                    onChangeText={setActual}
                    numeric
                  />
                  <Text style={s.muted}>
                    RFID dan QRIS bukan uang laci. Selisih ditentukan server.
                  </Text>
                  <Button
                    title="Konfirmasi tutup shift"
                    disabled={busy || !online}
                    onPress={() =>
                      confirmAction(
                        "Tutup shift?",
                        "Penjualan pada shift ini akan dihentikan.",
                        close,
                      )
                    }
                  />
                </Card>
              )}
              {sheet === "cart" && (
                <Card title="Keranjang">
                  {cart.map((p) => (
                    <View key={p.id} style={s.cartItem}>
                      <Text style={s.heading}>{p.name}</Text>
                      <Row
                        label={`${p.quantity} × ${rupiah(p.price)}`}
                        value={rupiah(BigInt(p.quantity) * BigInt(p.price))}
                      />
                      <View style={s.row}>
                        <Button
                          title="−"
                          secondary
                          onPress={() => setCart(changeCart(cart, p, -1))}
                        />
                        <Button
                          title="+"
                          secondary
                          onPress={() => setCart(changeCart(cart, p, 1))}
                        />
                        <Button
                          title="Hapus"
                          secondary
                          onPress={() =>
                            setCart(cart.filter((i) => i.id !== p.id))
                          }
                        />
                      </View>
                    </View>
                  ))}
                  {can("pos.discount") && (
                    <>
                      <Field
                        label="Diskon nominal (Rupiah)"
                        value={discount}
                        onChangeText={setDiscount}
                        numeric
                      />
                      <Field
                        label="Alasan diskon (minimal 5 karakter)"
                        value={discountReason}
                        onChangeText={setDiscountReason}
                      />
                    </>
                  )}
                  <Text style={s.money}>
                    {total ? rupiah(total) : "Nominal tidak valid"}
                  </Text>
                  <Text style={s.muted}>
                    Preview; harga dan total final dihitung server.
                  </Text>
                  <Button
                    title="Pilih Pembayaran"
                    disabled={
                      !cart.length ||
                      !total ||
                      total === "0" ||
                      busy ||
                      !online ||
                      (discount !== "0" && discountReason.trim().length < 5)
                    }
                    onPress={() => {
                      coordinator.current.reset();
                      setTender(total);
                      setConfirmed(false);
                      setReference("");
                      setProvider("");
                      setSheet("payment");
                    }}
                  />
                </Card>
              )}
              {sheet === "payment" && (
                <Card title="Pembayaran">
                  {["SUCCESS", "PENDING"].includes(paymentState.state) ? (
                    <Receipt
                      result={paymentState.result}
                      onNew={() => {
                        coordinator.current.reset();
                        setCart([]);
                        setDiscount("0");
                        setSheet(null);
                        setTab("KASIR");
                      }}
                      onDetail={
                        paymentState.result?.sale
                          ? () =>
                              run(() => showDetail(paymentState.result.sale.id))
                          : null
                      }
                    />
                  ) : pending ? (
                    <>
                      <Text style={s.heading}>
                        {paymentState.state === "PROCESSING"
                          ? "MEMPROSES"
                          : "STATUS BELUM PASTI"}
                      </Text>
                      <Text style={s.text}>
                        Jangan membuat transaksi baru. Pemulihan memakai
                        permintaan yang sama.
                      </Text>
                      <Button
                        title="Periksa status / coba ulang permintaan sama"
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
                    </>
                  ) : (
                    <>
                      <Text style={s.money}>{total ? rupiah(total) : "—"}</Text>
                      {["RFID", "CASH", "TRANSFER_QRIS"].map((m) => (
                        <Button
                          key={m}
                          title={m === method ? `✓ ${m}` : m}
                          secondary
                          onPress={() => {
                            setMethod(m);
                            credential.current = null;
                            setWalletPreview(null);
                            setTestInput("");
                          }}
                        />
                      ))}
                      {method === "CASH" && (
                        <>
                          <Field
                            label="Uang diterima (Rupiah)"
                            value={tender}
                            onChangeText={setTender}
                            numeric
                          />
                          <View style={s.row}>
                            {[total, "50000", "100000"]
                              .filter(Boolean)
                              .map((v, i) => (
                                <Button
                                  key={i}
                                  title={i === 0 ? "Uang pas" : rupiah(v)}
                                  secondary
                                  onPress={() => setTender(v)}
                                />
                              ))}
                          </View>
                          <Row
                            label="Kembalian preview"
                            value={
                              /^(0|[1-9]\d*)$/.test(tender) &&
                              total &&
                              BigInt(tender) >= BigInt(total)
                                ? rupiah(BigInt(tender) - BigInt(total))
                                : "Uang kurang"
                            }
                          />
                        </>
                      )}
                      {method === "TRANSFER_QRIS" && (
                        <>
                          <Text style={s.text}>
                            Pencatatan manual, bukan gateway atau QR otomatis.
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
                                ? "✓ Dana telah saya verifikasi"
                                : "Simpan MENUNGGU KONFIRMASI"
                            }
                            secondary
                            onPress={() => setConfirmed(!confirmed)}
                          />
                          <Text style={s.muted}>
                            {confirmed
                              ? "Wajib referensi asli, hanya setelah dana diterima."
                              : "Belum dibayar, bukan penjualan terkonfirmasi."}
                          </Text>
                        </>
                      )}
                      {method === "RFID" && (
                        <>
                          {__DEV__ &&
                          Constants.expoConfig.extra.posEnvironment ===
                            "development" ? (
                            <>
                              <Text style={s.muted}>
                                Adapter input TEST. Tidak tersedia pada release
                                production.
                              </Text>
                              <Field
                                label="Kredensial test (disembunyikan)"
                                value={testInput}
                                onChangeText={setTestInput}
                                secret
                              />
                              <Button
                                title="Baca kartu test / periksa dompet"
                                secondary
                                disabled={busy || !online}
                                onPress={() => run(scan)}
                              />
                            </>
                          ) : (
                            <Text style={s.error}>
                              Pembaca RFID fisik belum divalidasi. Pembayaran
                              kartu belum tersedia pada build release.
                            </Text>
                          )}
                          {walletPreview && (
                            <>
                              <Row
                                label="Santri"
                                value={walletPreview.santri_name}
                              />
                              <Row
                                label="Saldo saat ini"
                                value={rupiah(walletPreview.current_balance)}
                              />
                              <Row
                                label="Sisa perkiraan"
                                value={rupiah(walletPreview.projected_balance)}
                              />
                              <Text style={s.muted}>
                                Checkout memeriksa saldo kembali; preview bukan
                                persetujuan pembayaran.
                              </Text>
                            </>
                          )}
                        </>
                      )}
                      <Button
                        title={
                          method === "TRANSFER_QRIS" && !confirmed
                            ? "Simpan PENDING"
                            : "Konfirmasi Pembayaran"
                        }
                        disabled={
                          busy ||
                          pending ||
                          !online ||
                          !total ||
                          (method === "RFID" && !walletPreview) ||
                          (method === "TRANSFER_QRIS" &&
                            confirmed &&
                            !reference.trim())
                        }
                        onPress={() => run(pay)}
                      />
                    </>
                  )}
                </Card>
              )}
              {sheet === "detail" && detail && (
                <Card title="Detail Transaksi">
                  <Receipt result={detail} />
                  {detail.refunds.map((r) => (
                    <View key={r.id}>
                      <Row
                        label={`Refund ${r.status}`}
                        value={rupiah(r.amount)}
                      />
                      <Text style={s.text}>{r.reason}</Text>
                      {r.status === "PENDING" && can("pos.refund") && (
                        <Button
                          title="Konfirmasi refund eksternal"
                          secondary
                          disabled={busy || pending}
                          onPress={() => {
                            setCorrection(r.id);
                            setReference("");
                          }}
                        />
                      )}
                    </View>
                  ))}
                  {detail.sale.status === "DRAFT" && (
                    <>
                      <Button
                        title="Konfirmasi dana diterima"
                        secondary
                        disabled={busy || pending}
                        onPress={() => {
                          setCorrection("confirm-payment");
                          setReference("");
                        }}
                      />
                      <Button
                        title="Void transaksi belum dibayar"
                        secondary
                        disabled={busy || pending}
                        onPress={() => {
                          setCorrection("void");
                          setReason("");
                        }}
                      />
                    </>
                  )}
                  {detail.sale.status === "PAID" && can("pos.refund") && (
                    <Button
                      title="Pengembalian dana"
                      secondary
                      disabled={busy || pending}
                      onPress={() => {
                        setCorrection("refund");
                        setReason("");
                        setRefundAmount("");
                        coordinator.current.reset();
                      }}
                    />
                  )}
                  {correction && (
                    <>
                      <Text style={s.heading}>
                        Konfirmasi{" "}
                        {correction === "refund"
                          ? "refund"
                          : correction === "void"
                            ? "void"
                            : "dana eksternal"}
                      </Text>
                      {["refund", "void"].includes(correction) ? (
                        <>
                          <Field
                            label="Alasan (minimal 5 karakter)"
                            value={reason}
                            onChangeText={setReason}
                          />
                          {correction === "refund" && (
                            <>
                              <Field
                                label="Nominal pengembalian"
                                value={refundAmount}
                                onChangeText={setRefundAmount}
                                numeric
                              />
                              <Text style={s.muted}>
                                {detail.payment.method === "CASH"
                                  ? "Mengurangi laci shift OPEN saat ini."
                                  : detail.payment.method === "RFID"
                                    ? "Kredit hanya ke dompet asal."
                                    : "Refund eksternal disimpan PENDING; wajib konfirmasi referensi."}
                              </Text>
                            </>
                          )}
                        </>
                      ) : (
                        <Field
                          label="Referensi dana eksternal"
                          value={reference}
                          onChangeText={setReference}
                        />
                      )}
                      <Button
                        title="Konfirmasi tindakan"
                        disabled={busy || pending || !online}
                        onPress={() =>
                          confirmAction(
                            "Lanjutkan koreksi?",
                            `Struk ${detail.sale.receipt}. Histori asli tetap disimpan.`,
                            correct,
                          )
                        }
                      />
                    </>
                  )}
                </Card>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
function Receipt({ result, onNew, onDetail }) {
  if (!result?.sale)
    return (
      <>
        <Text style={s.heading}>
          {result?.payment?.status === "PENDING"
            ? "REFUND MENUNGGU KONFIRMASI"
            : "REFUND TERSIMPAN"}
        </Text>
        {onNew && <Button title="Kembali" onPress={onNew} />}
      </>
    );
  const { sale, payment, items } = result;
  return (
    <>
      <Text style={s.heading}>
        {sale.status === "VOID"
          ? "DIBATALKAN"
          : payment.status === "PENDING"
            ? "MENUNGGU KONFIRMASI"
            : "BERHASIL"}
      </Text>
      <Text selectable style={s.muted}>
        {sale.receipt}
      </Text>
      <Text style={s.text}>
        {sale.merchant_name} · {sale.cashier_name}
      </Text>
      <Text style={s.muted}>
        {new Date(sale.created_at).toLocaleString("id-ID")}
      </Text>
      {items.map((i) => (
        <Row
          key={i.id}
          label={`${i.quantity} × ${i.name}`}
          value={rupiah(i.total)}
        />
      ))}
      <Text style={s.money}>{rupiah(sale.grand_total)}</Text>
      <Row label="Metode" value={payment.method} />
      {payment.method === "CASH" && (
        <>
          <Row label="Diterima" value={rupiah(payment.tendered)} />
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
      {onNew && <Button title="Transaksi Baru" onPress={onNew} />}{" "}
      {onDetail && <Button title="Lihat Detail" secondary onPress={onDetail} />}
    </>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 28 },
  header: {
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  brand: { fontSize: 20, fontWeight: "800", color: colors.navy },
  heading: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.navy,
    marginBottom: 8,
  },
  text: { fontSize: 14, lineHeight: 21, color: colors.navy },
  muted: { fontSize: 12, lineHeight: 19, color: colors.muted },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: 10,
    marginBottom: 8,
  },
  field: { gap: 6, marginBottom: 8 },
  label: { fontSize: 13, color: colors.muted, flexShrink: 1 },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    minHeight: 48,
    padding: 12,
    fontSize: 16,
    color: colors.navy,
    backgroundColor: colors.surface,
  },
  button: {
    minHeight: 46,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.green,
    borderRadius: 10,
    marginVertical: 3,
  },
  secondary: {
    backgroundColor: "#e8f4ef",
    borderWidth: 1,
    borderColor: "#b8ddce",
  },
  buttonText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#fff",
    textAlign: "center",
  },
  disabled: { opacity: 0.45 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  value: { fontSize: 14, fontWeight: "700", color: colors.navy, flexShrink: 1 },
  money: { fontSize: 30, fontWeight: "800", color: colors.navy },
  price: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.green,
    flexShrink: 1,
  },
  error: { color: colors.red, fontSize: 14, lineHeight: 21 },
  success: { color: colors.green, fontSize: 13 },
  feedback: { padding: 12, backgroundColor: "#fff8e8", gap: 6 },
  filters: { padding: 12, gap: 6 },
  product: {
    padding: 16,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  pager: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    padding: 8,
  },
  cartBar: {
    padding: 12,
    borderTopWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: 8,
  },
  cartItem: {
    borderBottomWidth: 1,
    borderColor: colors.line,
    paddingVertical: 10,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.line,
    minHeight: 58,
  },
  tab: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: 12,
  },
  tabText: { fontSize: 10, fontWeight: "700", color: colors.muted },
  activeTab: { color: colors.green },
});
