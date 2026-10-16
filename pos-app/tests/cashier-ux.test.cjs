const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cashChange, scannerAvailability, transferMethod } = require("../src/cashierFlow.cjs");

test("wallet scanner explains missing merchant unit instead of silently disabling", () => {
  assert.deepEqual(scannerAvailability([], ""), {
    enabled: false,
    reason: "Merchant belum terhubung ke unit santri. Minta Tenant Admin mengaktifkan unit untuk merchant ini.",
  });
  assert.match(scannerAvailability([{ unit_id: 7 }], "").reason, /Pilih unit santri/);
  assert.equal(scannerAvailability([{ unit_id: 7 }], 7).enabled, true);
  assert.equal(scannerAvailability([{ unit_id: 7 }], 8).enabled, false);
});

test("transfer UI preserves canonical BANK or QRIS destination accounting", () => {
  const accounts = [{ id: "bank", kind: "BANK" }, { id: "qris", kind: "QRIS" }, { id: "cash", kind: "CASH" }];
  assert.equal(transferMethod(accounts, "bank"), "BANK");
  assert.equal(transferMethod(accounts, "qris"), "QRIS");
  assert.equal(transferMethod(accounts, "cash"), null);
});

test("cash tender computes exact integer Rupiah change", () => {
  assert.equal(cashChange("20000", "18000"), 2000n);
  assert.equal(cashChange("18000", "18000"), 0n);
  assert.equal(cashChange("17000", "18000"), null);
});

test("cashier uses four-step mobile flow, auto total, and keyboard-safe login", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "MerchantBusinessApp.jsx"), "utf8");
  assert.match(source, /PRODUCTS.*CART.*PAYMENT.*CONFIRM/s);
  assert.match(source, /effectivePayments=payments\.map\(payment=>!split/);
  assert.match(source, /KeyboardAvoidingView/);
  assert.match(source, /automaticallyAdjustKeyboardInsets/);
  assert.match(source, /transferMethod\(accounts,p\.account_id\)/);
  assert.match(source, /const id=row\.id\?\?row\.unit_id/);
  assert.match(source, /unit\.nama_unit\|\|unit\.unit_name\|\|unit\.name/);
});
