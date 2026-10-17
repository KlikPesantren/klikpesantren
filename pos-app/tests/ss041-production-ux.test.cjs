const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { receiptPresentation } = require("../src/receiptPresentation.cjs");
const { nfcFailureCode, nfcFailureMessage } = require("../src/nfcFeedback.cjs");

const sale = payments => receiptPresentation({
  sale: { id: "sale-test", total: "18000", created_at: "2026-10-18T01:00:00.000Z", party_id: null },
  items: [{ product_id: "product-test", name: "Produk Uji", quantity: "1", unit_price: "20000", discount: "2000", total: "18000" }],
  payments,
});

test("cash receipt distinguishes total, tendered and change without changing paid amount", () => {
  const receipt = sale([{ method: "CASH", amount: "18000", tendered: "20000", change: "2000" }]);
  assert.equal(receipt.subtotal, 20000n);
  assert.equal(receipt.discount, 2000n);
  assert.equal(receipt.total, 18000n);
  assert.equal(receipt.paymentTotal, 18000n);
  assert.equal(receipt.payments[0].tenderedValue, 20000n);
  assert.equal(receipt.payments[0].changeValue, 2000n);
});

test("split and Wallet receipts preserve each canonical payment allocation", () => {
  const split = sale([
    { method: "CASH", amount: "5000", tendered: "10000", change: "5000" },
    { method: "BANK", amount: "3000", reference: "TEST-REFERENCE" },
    { method: "DOMPET_SANTRI", amount: "10000" },
  ]);
  assert.equal(split.paymentTotal, 18000n);
  assert.deepEqual(split.payments.map(row => [row.displayLabel, row.amountValue]), [
    ["Tunai", 5000n], ["Transfer Bank", 3000n], ["Dompet Santri", 10000n],
  ]);
  assert.equal(split.payments[0].changeValue, 5000n);
});

test("NFC failures distinguish hardware, disabled radio, cancellation, read and server preview", () => {
  class UserCancel extends Error {}
  class TagConnectionLost extends Error {}
  assert.equal(nfcFailureCode(Error("NFC_UNAVAILABLE")), "NFC_UNAVAILABLE");
  assert.equal(nfcFailureCode(Error("NFC_DISABLED")), "NFC_DISABLED");
  assert.equal(nfcFailureCode(new UserCancel()), "NFC_CANCELLED");
  assert.equal(nfcFailureCode(new TagConnectionLost()), "NFC_READ_FAILED");
  assert.equal(nfcFailureCode(Error("WALLET_PREVIEW_FAILED"), "PREVIEW"), "WALLET_PREVIEW_FAILED");
  assert.match(nfcFailureMessage(Error("NFC_DISABLED")).message, /Aktifkan NFC/);
});

test("navigation reuses a fresh merchant-scoped projection while preserving cashier component state", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");
  assert.match(source, /recentlyLoaded=age<15_000/);
  assert.match(source, /moduleCache\.current\.get\(authority,target\)/);
  assert.match(source, /background:!!cached/);
  assert.match(source, /props\.module!=="KASIR"&&s\.hidden/);
  assert.match(source, /moduleCache\.current\.invalidate\(authorityKey\(context,businessId\)\)/);
  assert.match(source, /moduleCache\.current\.clear\(\)/);
});

test("receipt UI exposes professional transaction and payment fields", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");
  for (const label of ["Nomor transaksi", "Waktu", "Kasir", "Pelanggan", "Subtotal", "Diskon", "Total tagihan", "Uang diterima", "Kembalian", "Total pembayaran"])
    assert.match(source, new RegExp(label));
});
