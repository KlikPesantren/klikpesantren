const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { stockStatus, filterProducts, purchaseAccounts, applyPurchasePaymentMode } = require("../src/inventoryUx.cjs");

const appSource = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");

test("product search and stock filters preserve canonical available stock", () => {
  const products = [
    { id: "a", name: "Air Mineral", sku: "AIR-1", barcode: "111", category: "Minuman", available: "10", minimum_stock: "2" },
    { id: "b", name: "Roti", sku: "ROT-1", barcode: "222", category: "Makanan", available: "2", minimum_stock: "2" },
    { id: "c", name: "Susu", sku: "SUS-1", barcode: "333", category: "Minuman", available: "0", minimum_stock: "1" },
  ];
  assert.equal(stockStatus(products[0]), "AVAILABLE");
  assert.equal(stockStatus(products[1]), "LOW");
  assert.equal(stockStatus(products[2]), "OUT");
  assert.deepEqual(filterProducts(products, { query: "333" }).map(x => x.id), ["c"]);
  assert.deepEqual(filterProducts(products, { category: "Minuman", stock: "AVAILABLE" }).map(x => x.id), ["a"]);
});

test("purchase payment choices keep cash, bank and supplier debt explicit", () => {
  const accounts = [{ id: "cash", kind: "CASH" }, { id: "bank", kind: "BANK" }, { id: "qris", kind: "QRIS" }];
  assert.deepEqual(purchaseAccounts(accounts, "CASH").map(x => x.id), ["cash"]);
  assert.deepEqual(purchaseAccounts(accounts, "TRANSFER").map(x => x.id), ["bank"]);
  assert.deepEqual(applyPurchasePaymentMode({ paid: "100", account_id: "old", due_date: "2030-01-01" }, "DEBT", "900"), { paid: "0", account_id: "", due_date: "2030-01-01" });
  assert.deepEqual(applyPurchasePaymentMode({ paid: "0", account_id: "old", due_date: "2030-01-01" }, "CASH", "900"), { paid: "900", account_id: "", due_date: "" });
});

test("inventory UX routes opening stock to canonical initialization and purchases to canonical posting", () => {
  assert.match(appSource, /Buka Posisi Awal Usaha/);
  assert.match(appSource, /navigate\("PENGATURAN"\)/);
  assert.match(appSource, /Barang Masuk dari Pembelian/);
  assert.match(appSource, /navigate\("PEMBELIAN"\)/);
  assert.match(appSource, /purchasePayload\(\{\.\.\.form,paid:effectivePaid\.toString\(\)\},requestId\.current\)/);
  assert.match(appSource, /Satu invoice, satu posting stok/);
  assert.doesNotMatch(appSource, /reason:mode==="OPENING"/);
});
