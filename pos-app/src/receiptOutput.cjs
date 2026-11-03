"use strict";

const { receiptPresentation } = require("./receiptPresentation.cjs");

const PAPER_COLUMNS = Object.freeze({ "58": 32, "80": 48 });
const DEVICE_DEFAULTS = Object.freeze({ paper_width: "58", auto_print: false, transport: null });

const text = value => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const { rupiah: money } = require('./moneyFormat.cjs');
const line = (left, right, width) => {
  const a = text(left), b = text(right);
  if (!b) return a.slice(0, width);
  const room = Math.max(1, width - b.length - 1);
  return `${a.slice(0, room).padEnd(room)} ${b}`.slice(0, width);
};
const wrap = (value, width) => {
  const words = text(value).split(/\s+/).filter(Boolean).flatMap(word => {
    const chunks = [];
    for (let offset = 0; offset < word.length; offset += width) chunks.push(word.slice(offset, offset + width));
    return chunks;
  }), rows = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current += ` ${word}`;
    else { rows.push(current.slice(0, width)); current = word; }
  }
  if (current) rows.push(current.slice(0, width));
  return rows;
};
const center = (value, width) => text(value).slice(0, width).padStart(Math.floor((width + text(value).slice(0, width).length) / 2));

function normalizeDevicePreferences(value = {}) {
  value = value || {};
  return {
    paper_width: PAPER_COLUMNS[String(value.paper_width)] ? String(value.paper_width) : DEVICE_DEFAULTS.paper_width,
    auto_print: value.auto_print === true && value.transport != null,
    transport: value.transport || null,
  };
}

function printerCapability(preferences = {}) {
  const normalized = normalizeDevicePreferences(preferences);
  if (!normalized.transport) return { state: "NOT_CONFIGURED", can_print: false, message: "Printer belum dikonfigurasi. Gunakan Bagikan / Simpan Struk." };
  return { state: "NOT_CONNECTED", can_print: false, message: "Transport printer belum terhubung pada perangkat ini." };
}

function buildReceiptText(value, paperWidth = "58") {
  if(value?.finance_document)return require("./financialReceipt.cjs").financialProofText(value);
  const receipt = receiptPresentation(value), width = PAPER_COLUMNS[String(paperWidth)] || PAPER_COLUMNS["58"];
  const { brand, sale } = receipt, rows = [];
  rows.push(center(brand.name || "Struk Penjualan", width));
  if (brand.header) rows.push(...wrap(brand.header, width));
  if (brand.address) rows.push(...wrap(brand.address, width));
  if (brand.phone) rows.push(center(brand.phone, width));
  rows.push("-".repeat(width));
  rows.push(...wrap(`No: ${brand.receipt || sale.id}`, width));
  rows.push(...wrap(`Waktu: ${new Date(sale.created_at).toLocaleString("id-ID")}`, width));
  rows.push(...wrap(`Kasir: ${brand.cashier_name || "-"}`, width));
  rows.push(...wrap(`Pelanggan: ${receipt.customerLabel}`, width));
  rows.push("-".repeat(width));
  for (const item of receipt.items) {
    rows.push(...wrap(item.name, width));
    const parts=item.pricing_snapshot?.parts||[],mixed=parts.some(p=>p.unit_price!=null&&String(p.unit_price)!==String(item.unit_price));
    if(mixed){for(const p of parts){rows.push(...wrap(p.quantity+' x '+money(p.unit_price)+' / '+p.level_name,width));rows.push(line(p.name||'Harga final',money(p.total),width));}}
    else rows.push(line(`${item.quantity} x ${money(item.unit_price)}`, money(item.lineTotal), width));
    if(item.lineDiscount>0n)rows.push(line('Diskon item',money(item.lineDiscount),width));
    if(item.pricing_snapshot){rows.push(...wrap(`Level: ${item.pricing_snapshot.level_name}`,width));
      for(const part of item.pricing_snapshot.parts||[])if(part.promotion_id)rows.push(...wrap(`Promo: ${part.name}`,width));}
  }
  rows.push("-".repeat(width));
  rows.push(line("Subtotal", money(receipt.subtotal), width));
  if (receipt.discount > 0n) rows.push(line("Diskon", `-${money(receipt.discount)}`, width));
  rows.push(line("TOTAL", money(receipt.total), width));
  rows.push("-".repeat(width));
  for (const payment of receipt.payments) {
    rows.push(line(payment.displayLabel, money(payment.amountValue), width));
    if (payment.method === "CASH") {
      rows.push(line("Uang diterima", money(payment.tenderedValue ?? payment.amountValue), width));
      rows.push(line("Kembalian", money(payment.changeValue ?? 0n), width));
    }
    if (payment.reference) rows.push(...wrap(`Referensi: ${payment.reference}`, width));
  }
  const credit = receipt.payments.filter(row => row.method === "CREDIT").reduce((sum, row) => sum + row.amountValue, 0n);
  if (credit > 0n) rows.push(line("Status", `Piutang ${money(credit)}`, width));
  rows.push(line("Total pembayaran", money(receipt.paymentTotal), width));
  rows.push("-".repeat(width));
  rows.push(...wrap(brand.footer || "Powered by KlikPesantren", width).map(row => center(row, width)));
  return `${rows.join("\n")}\n`;
}

function buildReceiptHtml(value, paperWidth = "58") {
  const escaped = buildReceiptText(value, paperWidth).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Struk Suq Shogir</title><style>@page{margin:12mm}body{margin:0;color:#111;background:white}pre{font:12px/1.5 monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%}</style></head><body><pre>${escaped}</pre></body></html>`;
}

module.exports = { PAPER_COLUMNS, DEVICE_DEFAULTS, normalizeDevicePreferences, printerCapability, buildReceiptText, buildReceiptHtml };
