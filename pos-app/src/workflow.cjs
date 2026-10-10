const { money, totals } = require("./domain.cjs");
const PAYMENT_LABELS = {
  CASH: "Tunai",
  RFID: "Dompet Santri",
  TRANSFER_QRIS: "Transfer / QRIS",
};
const STATUS_LABELS = {
  PAID: "Lunas",
  DRAFT: "Menunggu pembayaran",
  VOID: "Dibatalkan",
  PENDING: "Menunggu konfirmasi",
  CONFIRMED: "Dikonfirmasi",
  DECLINED: "Pembayaran ditolak",
  UNKNOWN: "Memeriksa status transaksi...",
  PROCESSING: "Memproses pembayaran...",
  CHECKING: "Memeriksa status transaksi...",
};
function paymentBlock(input) {
  if (input.busy || input.pending) return "PROCESSING";
  if (!input.online) return "NETWORK";
  if (!input.shift) return "SHIFT_NOT_OPEN";
  try {
    if (
      !input.cart.length ||
      money(totals(input.cart, input.discount).total) === 0n
    )
      return "INVALID_TOTAL";
    if (
      money(input.discount) > 0n &&
      (!input.canDiscount ||
        String(input.discountReason || "").trim().length < 5)
    )
      return "INVALID_DISCOUNT";
    const total = money(totals(input.cart, input.discount).total);
    if (input.method === "CASH" && money(input.tender) < total)
      return "INSUFFICIENT_TENDER";
    if (input.method === "RFID") {
      if (!input.walletPreview || !input.credentialReady)
        return "READER_UNAVAILABLE";
      if (money(input.walletPreview.current_balance) < total)
        return "INSUFFICIENT_BALANCE";
      if (
        money(input.walletPreview.projected_balance) !==
        money(input.walletPreview.current_balance) - total
      )
        return "READER_UNAVAILABLE";
    }
    if (
      input.method === "TRANSFER_QRIS" &&
      input.confirmed &&
      !String(input.reference || "").trim()
    )
      return "INVALID_TEXT";
    if (!Object.hasOwn(PAYMENT_LABELS, input.method))
      return "INVALID_OPERATION";
  } catch {
    return "INVALID_TOTAL";
  }
  return null;
}
function cashShortcuts(total) {
  const n = money(total);
  return [
    ...new Set(
      [
        n,
        ...[10000n, 50000n, 100000n].map(
          (step) => ((n + step - 1n) / step) * step,
        ),
      ].map(String),
    ),
  ];
}
function refundSummary(detail) {
  const original = money(detail.payment.amount);
  const reserved = (detail.refunds || []).reduce(
    (sum, r) => sum + money(r.amount),
    0n,
  );
  const confirmed = (detail.refunds || [])
    .filter((r) => r.status === "CONFIRMED")
    .reduce((sum, r) => sum + money(r.amount), 0n);
  return {
    original: String(original),
    reserved: String(reserved),
    confirmed: String(confirmed),
    remaining: String(original > reserved ? original - reserved : 0n),
  };
}
function correctionBlock({
  detail,
  kind,
  amount,
  reason,
  reference,
  canRefund,
  canSell,
  shift,
  online,
  pending,
}) {
  if (pending) return "UNKNOWN";
  if (!online) return "NETWORK";
  if (kind === "refund") {
    if (!canRefund) return "PERMISSION_DENIED";
    if (detail.sale.status !== "PAID" || detail.payment.status !== "CONFIRMED")
      return "PAYMENT_NOT_PAID";
    if (detail.payment.method === "CASH" && !shift) return "SHIFT_NOT_OPEN";
    try {
      const n = money(amount);
      if (n === 0n || n > money(refundSummary(detail).remaining))
        return "OVER_REFUND";
    } catch {
      return "INVALID_MONEY";
    }
  } else if (kind === "void" || kind === "confirm-payment") {
    if (!canSell) return "PERMISSION_DENIED";
    if (
      detail.sale.status !== "DRAFT" ||
      !shift ||
      shift.id !== detail.sale.shift_id
    )
      return "SHIFT_NOT_OPEN";
  } else if (!canRefund) return "PERMISSION_DENIED";
  if (
    ["refund", "void"].includes(kind) &&
    String(reason || "").trim().length < 5
  )
    return "INVALID_TEXT";
  if (!["refund", "void"].includes(kind) && !String(reference || "").trim())
    return "INVALID_TEXT";
  return null;
}
module.exports = {
  PAYMENT_LABELS,
  STATUS_LABELS,
  paymentBlock,
  cashShortcuts,
  refundSummary,
  correctionBlock,
};
