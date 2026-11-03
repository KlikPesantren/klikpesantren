const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cashChange, scannerAvailability, transferMethod } = require("../src/cashierFlow.cjs");
const { creditAvailability } = require("../src/cashierCustomer.cjs");
const { nfcFailureCode, nfcStatusMessage } = require("../src/nfcFeedback.cjs");

const root = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(root, "src", "MerchantBusinessApp.jsx"), "utf8");
const scanner = fs.readFileSync(path.join(root, "src", "WalletCredentialScanner.jsx"), "utf8");

test("SS-042 uses one sales workspace with cart and payment sheets", () => {
  const cashier = app.slice(app.indexOf("function Cashier("), app.indexOf("function Transactions("));
  assert.match(cashier, /Pilih barang, periksa transaksi, lalu bayar/);
  assert.match(cashier, /visible=\{cartOpen\}/);
  assert.match(cashier, /paymentOpen&&<Modal visible/);
  assert.match(cashier, /title="Lanjut Transaksi"/);
  assert.match(cashier, /title="Lanjut Pembayaran"/);
  assert.doesNotMatch(cashier, /1 Produk/);
  assert.doesNotMatch(cashier, /setStep\(/);
});

test("final cashier UX keeps products primary and moves cart editing into the bottom panel", () => {
  const cashier = app.slice(app.indexOf("function Cashier("), app.indexOf("function Transactions("));
  assert.doesNotMatch(cashier, /Transaksi masih kosong/);
  assert.doesNotMatch(cashier, />Transaksi Aktif</);
  assert.match(cashier, />Atur Transaksi</);
  assert.match(cashier, /Pindai barcode produk/);
  assert.match(cashier, /<Artwork url=\{product\.image_url\} compact\/>/);
  assert.match(cashier, /backToTransaction/);
  assert.match(cashier, /title="Lanjut Pilih Barang"/);
});

test("cash, transfer and credit keep canonical payment semantics", () => {
  assert.equal(cashChange("20000", "18000"), 2000n);
  assert.equal(transferMethod([{ id: "bank-1", kind: "BANK" }], "bank-1"), "BANK");
  assert.match(app, /method:p\.method,amount:p\.amount,account_id:shift\.cash_account_id,tendered/);
  assert.match(app, /p\.method==="CREDIT"\?\{method:p\.method,amount:p\.amount\}/);
  assert.equal(creditAvailability(null, 18000n).enabled, false);
  assert.equal(creditAvailability({ active: true, credit_allowed: true, outstanding: "0", credit_limit: "20000" }, 18000n).enabled, true);
});

test("wallet scanner remains merchant-unit gated", () => {
  assert.equal(scannerAvailability([], "unit-1").enabled, false);
  assert.equal(scannerAvailability([{ unit_id: "unit-1" }], "").enabled, false);
  assert.equal(scannerAvailability([{ unit_id: "unit-1" }], "unit-2").enabled, false);
  assert.equal(scannerAvailability([{ unit_id: "unit-1" }], "unit-1").enabled, true);
  assert.match(app, /verifyWalletPreview/);
  assert.match(app, /available_balance/);
});

test("SS-047 exposes distinct scan lifecycle and recovery states", () => {
  for (const status of ["READY", "WAITING", "DETECTED", "VERIFYING", "VERIFIED"])
    assert.ok(nfcStatusMessage(status));
  assert.equal(nfcFailureCode({ code: "UNKNOWN_CREDENTIAL" }, "PREVIEW"), "UNKNOWN_CREDENTIAL");
  assert.equal(nfcFailureCode({ code: "WALLET_UNIT_DENIED" }, "PREVIEW"), "WALLET_UNIT_DENIED");
  assert.equal(nfcFailureCode({ code: "MERCHANT_SESSION_INVALID" }, "PREVIEW"), "MERCHANT_SESSION_INVALID");
  assert.equal(nfcFailureCode({ code: "INSUFFICIENT_BALANCE" }, "PREVIEW"), "INSUFFICIENT_BALANCE");
  assert.equal(nfcFailureCode({ code: "NETWORK" }, "PREVIEW"), "NETWORK");
});

test("NFC lifecycle cancels on background, close, timeout and rapid rescan", () => {
  assert.match(scanner, /AppState\.addEventListener/);
  assert.match(app, /paymentOpen&&<Modal visible/);
  assert.match(scanner, /return \(\) => \{ subscription\.remove\(\); void cancelNfc\(false\); \}/);
  assert.match(scanner, /scanSequence\.current/);
  assert.match(scanner, /cancelTechnologyRequest/);
  assert.match(scanner, /NFC_TIMEOUT/);
  assert.match(scanner, /busy \? \(\) => cancelNfc\(true\) : scanNfc/);
});

test("scanner never logs or displays the raw credential", () => {
  assert.doesNotMatch(scanner, /console\.(?:log|info|warn|error)/);
  assert.doesNotMatch(scanner, /tag\?\.id\}|credential\}/);
  assert.match(app, /Credential mentah tidak ditampilkan/);
});
