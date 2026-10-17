"use strict";

const money = value => {
  try { return BigInt(String(value ?? "0")); } catch { return 0n; }
};

const PAYMENT_LABELS = {
  CASH: "Tunai",
  BANK: "Transfer Bank",
  QRIS: "QRIS",
  DOMPET_SANTRI: "Dompet Santri",
  CREDIT: "Piutang",
};

function receiptPresentation(value = {}) {
  const sale = value.sale || {};
  const items = (value.items || []).map(item => ({
    ...item,
    lineGross: money(item.unit_price) * money(item.quantity),
    lineDiscount: money(item.discount),
    lineTotal: money(item.total),
  }));
  const subtotal = items.reduce((sum, item) => sum + item.lineGross, 0n);
  const discount = items.reduce((sum, item) => sum + item.lineDiscount, 0n);
  const payments = (value.payments || []).map(payment => ({
    ...payment,
    displayLabel: payment.label && payment.label !== payment.method
      ? payment.label
      : PAYMENT_LABELS[payment.method] || payment.method,
    amountValue: money(payment.amount),
    tenderedValue: payment.tendered == null ? null : money(payment.tendered),
    changeValue: payment.change == null ? null : money(payment.change),
  }));
  return {
    sale,
    brand: value.branding || sale.receipt_snapshot || {},
    items,
    subtotal,
    discount,
    total: money(sale.total),
    paymentTotal: payments.reduce((sum, payment) => sum + payment.amountValue, 0n),
    payments,
    customerLabel: sale.customer_name || (sale.party_id ? "Pelanggan terdaftar" : "Pelanggan umum"),
  };
}

module.exports = { PAYMENT_LABELS, receiptPresentation };
