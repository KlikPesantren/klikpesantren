const MAX = 9223372036854775807n;
function rupiah(value) {
  return `Rp${BigInt(value || 0).toLocaleString("id-ID")}`;
}
function money(value) {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw Error("INVALID_MONEY");
  const n = BigInt(value);
  if (n > MAX) throw Error("INVALID_MONEY");
  return n;
}
function totals(cart, discount = "0") {
  const subtotal = cart.reduce(
      (sum, p) => sum + money(p.price) * BigInt(p.quantity),
      0n,
    ),
    d = money(discount);
  if (d > subtotal || subtotal > MAX) throw Error("INVALID_TOTAL");
  return {
    subtotal: subtotal.toString(),
    discount: d.toString(),
    total: (subtotal - d).toString(),
  };
}
function changeCart(cart, product, delta) {
  if (!product.available) throw Error("PRODUCT_UNAVAILABLE");
  const old = cart.find((p) => p.id === product.id),
    quantity = (old?.quantity || 0) + delta;
  if (!Number.isSafeInteger(quantity) || quantity > 2147483647)
    throw Error("INVALID_QUANTITY");
  const next = cart.filter((p) => p.id !== product.id);
  if (quantity > 0) next.push({ ...product, quantity });
  if (next.length > 100) throw Error("INVALID_CART");
  return next;
}
function normalizeCredential(value) {
  const v = String(value || "").trim();
  if (!v || v.length > 80) throw Error("UNKNOWN_CREDENTIAL");
  return /^[a-f\d]+$/i.test(v) ? v.toLowerCase() : v;
}
// Adapter interface: scan() -> credential token. Never logs or renders tokens.
class CredentialReader {
  async scan() {
    throw Error("READER_UNAVAILABLE");
  }
}
class TestCredentialReader extends CredentialReader {
  constructor(take, enabled = false) {
    super();
    this.take = take;
    this.enabled = enabled;
  }
  async scan() {
    if (!this.enabled) throw Error("READER_UNAVAILABLE");
    return normalizeCredential(await this.take());
  }
}
const messages = {
  UNKNOWN_CREDENTIAL: "Kartu tidak terdaftar.",
  AMBIGUOUS_CREDENTIAL: "Kartu memiliki konflik identitas. Hubungi admin.",
  MEMBERSHIP_INACTIVE: "Santri tidak aktif pada unit ini.",
  WALLET_ACCOUNT_REQUIRED: "Dompet pada unit ini belum tersedia.",
  WALLET_NOT_ACTIVE: "Dompet santri tidak aktif.",
  WALLET_FROZEN: "Dompet dibekukan.",
  WALLET_CLOSED: "Dompet ditutup.",
  INSUFFICIENT_BALANCE: "Saldo tidak cukup.",
  INSUFFICIENT_TENDER: "Uang diterima kurang.",
  SHIFT_NOT_OPEN: "Shift sudah ditutup.",
  SHIFT_ALREADY_OPEN: "Shift sudah terbuka. Muat ulang konteks.",
  SHIFT_UNPAID_SALES:
    "Konfirmasikan atau batalkan transaksi tertunda sebelum tutup shift.",
  TERMINAL_DENIED: "Perangkat tidak diizinkan.",
  CASHIER_NOT_ASSIGNED: "Merchant tidak ditugaskan kepada Anda.",
  ACTIVE_SHIFT_CONTEXT_LOCKED:
    "Selesaikan shift aktif sebelum berpindah konteks.",
  PRODUCT_UNAVAILABLE: "Produk tidak tersedia. Periksa keranjang.",
  PERMISSION_DENIED: "Akses tidak diizinkan.",
  FEATURE_DISABLED: "Dompet/RFID belum diaktifkan pada unit ini.",
  UNIT_REQUIRED: "Pilih unit spesifik.",
  IDEMPOTENCY_CONFLICT:
    "Permintaan berbeda. Jangan buat pembayaran baru; hubungi admin.",
  UNAUTHENTICATED: "Sesi berakhir. Masuk kembali.",
  NETWORK: "Koneksi terputus.",
  UNKNOWN:
    "Status transaksi sedang diperiksa. Jangan ulangi dengan transaksi baru.",
  READER_UNAVAILABLE: "Pembaca RFID fisik belum terhubung/divalidasi.",
  INVALID_MONEY: "Masukkan Rupiah bulat tanpa tanda baca.",
  INVALID_TOTAL: "Nominal atau diskon tidak valid.",
  OVER_REFUND: "Nominal melebihi sisa yang dapat dikembalikan.",
  REFUND_WALLET_UNAVAILABLE: "Dompet asal tidak tersedia untuk pengembalian.",
  AUTH_EXPIRED:
    "Sesi berakhir. Masuk kembali dengan akun yang sama untuk memulihkan transaksi.",
};
const errorText = (e) =>
  messages[e?.code || e?.message] ||
  "Operasi ditolak. Periksa input atau hubungi admin.";
// One immutable journal record is persisted before submission; no offline financial queue.
class CheckoutCoordinator {
  constructor({ api, vault, newId, owner, onChange = () => {} }) {
    Object.assign(this, { api, vault, newId, owner, onChange });
    this.pending = null;
    this.busy = false;
    this.state = "IDLE";
    this.result = null;
  }
  emit(state) {
    this.state = state;
    this.onChange({ state, pending: !!this.pending, result: this.result });
  }
  async restore() {
    const p = await this.vault.read("pending");
    if (p) {
      if (p.owner !== this.owner) throw Error("PENDING_OWNER_MISMATCH");
      this.pending = p;
      this.emit("UNKNOWN");
    }
    return this.pending;
  }
  async pay(body, path = "/pos/checkout") {
    if (this.busy) throw Error("PROCESSING");
    if (this.pending) throw Error("UNKNOWN");
    this.busy = true;
    try {
      if (!["/pos/checkout", "/pos/refunds"].includes(path))
        throw Error("INVALID_OPERATION");
      const p = {
        owner: this.owner,
        path,
        body: JSON.parse(JSON.stringify({ ...body, request_id: this.newId() })),
      };
      await this.vault.write("pending", p);
      this.pending = p;
    } finally {
      this.busy = false;
    }
    return this.send();
  }
  async finish(result) {
    this.result = result;
    await this.vault.remove("pending");
    this.pending = null;
    this.emit(result.payment.status === "PENDING" ? "PENDING" : "SUCCESS");
    return result;
  }
  async send() {
    if (this.busy) throw Error("PROCESSING");
    if (!this.pending) throw Error("NO_PENDING");
    this.busy = true;
    this.emit("PROCESSING");
    try {
      const path = this.pending.path || "/pos/checkout",
        data = await this.api(path, {
          method: "POST",
          body: this.pending.body,
        });
      return await this.finish(
        path === "/pos/refunds"
          ? { refund: data, payment: { status: data.status } }
          : data,
      );
    } catch (e) {
      if (
        e.status >= 400 &&
        e.status < 500 &&
        ![401, 403, 408, 429].includes(e.status) &&
        e.code !== "IDEMPOTENCY_CONFLICT"
      ) {
        await this.vault.remove("pending");
        this.pending = null;
        this.emit("DECLINED");
      } else this.emit("UNKNOWN");
      throw e;
    } finally {
      this.busy = false;
    }
  }
  async recover() {
    if (this.busy) throw Error("PROCESSING");
    if (!this.pending) throw Error("NO_PENDING");
    this.busy = true;
    this.emit("CHECKING");
    if (this.pending.path === "/pos/refunds") {
      this.busy = false;
      return this.send();
    }
    try {
      const b = this.pending.body,
        r = await this.api("/pos/mobile/request-status", {
          query: {
            unit_id: b.unit_id,
            merchant_id: b.merchant_id,
            terminal_id: b.terminal_id,
            request_id: b.request_id,
          },
        });
      if (r.found) return await this.finish(r);
    } catch (e) {
      this.emit("UNKNOWN");
      throw e;
    } finally {
      this.busy = false;
    }
    return this.send(); // NOT_FOUND never generates a new request or changes payload.
  }
  reset() {
    if (this.pending || this.busy) throw Error("UNKNOWN");
    this.result = null;
    this.emit("IDLE");
  }
}
module.exports = {
  rupiah,
  money,
  totals,
  changeCart,
  normalizeCredential,
  CredentialReader,
  TestCredentialReader,
  CheckoutCoordinator,
  errorText,
};
