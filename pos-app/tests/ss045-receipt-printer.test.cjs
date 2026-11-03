"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildReceiptText, normalizeDevicePreferences, printerCapability } = require("../src/receiptOutput.cjs");

const fixture = payments => ({
  sale: { id: "sale-test", total: "18000", paid: "18000", created_at: "2026-10-20T03:00:00.000Z", customer_name: "Pelanggan Uji" },
  branding: { receipt: "SUQ-TEST", name: "Toko Uji", address: "Alamat pengujian", phone: "0800000000", cashier_name: "Kasir Uji", footer: "Terima kasih" },
  items: [{ product_id: "p1", name: "Produk Uji", quantity: "1", unit_price: "18000", discount: "0", total: "18000" }],
  payments,
});

test("receipt 58/80 uses canonical stored sale values", () => {
  for (const width of ["58", "80"]) {
    const output = buildReceiptText(fixture([{ method: "CASH", amount: "18000", tendered: "20000", change: "2000" }]), width);
    assert.match(output, /TOTAL\s+Rp18\.000/);
    assert.match(output, /Uang diterima\s+Rp20\.000/);
    assert.match(output, /Kembalian\s+Rp2\.000/);
    assert.ok(output.split("\n").every(row => row.length <= (width === "58" ? 32 : 48)));
  }
});

test("long transaction and payment references remain fully recoverable", () => {
  const reference = "TRANSFER-REFERENCE-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789";
  const value = fixture([{ method: "BANK", amount: "18000", reference }]);
  value.branding.receipt = "SUQ-TRANSACTION-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789";
  const output = buildReceiptText(value, "58").replaceAll("\n", "");
  assert.match(output, /SUQ-TRANSACTION-ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789/);
  assert.match(output, new RegExp(reference));
});

test("split, wallet, and credit output never expose credential material", () => {
  const value = fixture([
    { method: "BANK", amount: "3000", reference: "BANK-TEST" },
    { method: "DOMPET_SANTRI", amount: "5000", credential: "FORBIDDEN", credential_ref_hash: "FORBIDDEN_HASH" },
    { method: "CREDIT", amount: "10000" },
  ]);
  const output = buildReceiptText(value, "80");
  assert.match(output, /Transfer Bank/);
  assert.match(output, /Dompet Santri/);
  assert.match(output, /Piutang Rp10\.000/);
  assert.doesNotMatch(output, /FORBIDDEN/);
});

test("printer preferences fail closed without verified transport", () => {
  assert.deepEqual(normalizeDevicePreferences({ paper_width: "80", auto_print: true }), { paper_width: "80", auto_print: false, transport: null });
  assert.equal(printerCapability({ paper_width: "58" }).state, "NOT_CONFIGURED");
  assert.equal(printerCapability({ paper_width: "58" }).can_print, false);
});

test("application exposes preview, safe sharing, reprint, and permission controls", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");
  assert.match(source, /Printer & Struk/);
  assert.match(source, /Bagikan Struk/);
  assert.match(source, /Simpan PDF/);
  assert.match(source, /Cetak Ulang/);
  assert.match(source, /BUSINESS_SETTINGS_MANAGE/);
  assert.match(source, /createReceiptActions/);
  assert.match(source, /printer\.message/);
});
