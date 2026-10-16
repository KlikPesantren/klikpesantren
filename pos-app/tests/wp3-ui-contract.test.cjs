const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");
const api = fs.readFileSync(path.join(__dirname, "../src/api.js"), "utf8");
const config = fs.readFileSync(path.join(__dirname, "../app.config.js"), "utf8");

test("product image workflow uses native picker, local compression and authenticated multipart API", () => {
  assert.match(source, /launchImageLibraryAsync/);
  assert.match(source, /launchCameraAsync/);
  assert.match(source, /ImageManipulator\.manipulateAsync/);
  assert.match(source, /product-assets/);
  assert.match(api, /Authorization: `Bearer \$\{token\}`/);
  assert.match(api, /formData/);
  assert.match(config, /expo-image-picker/);
  assert.match(config, /microphonePermission: false/);
});

test("WP3 purchase and debt UI use canonical multi-line and invoice selection contracts", () => {
  assert.match(source, /purchasePayload\(\{\.\.\.form,paid:effectivePaid\.toString\(\)\},requestId\.current\)/);
  assert.match(source, /Invoice outstanding/);
  assert.doesNotMatch(source, /ID transaksi sumber/);
  assert.match(source, /Harga beli referensi/);
  assert.match(source, /Nilai stok dan harga pokok tetap berasal dari pembelian atau posisi awal yang diposting/);
});
