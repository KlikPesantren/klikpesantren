const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { authorityKey, boundedRows, createModuleDataCache } = require("../src/moduleDataCache.cjs");

const source = fs.readFileSync(path.join(__dirname, "../src/MerchantBusinessApp.jsx"), "utf8");

test("module preview cache is bounded, expires and cannot cross authority", () => {
  let clock = 1_000;
  const cache = createModuleDataCache({ ttlMs: 100, maxEntries: 2, now: () => clock });
  const a = authorityKey({ user_id: "u-a", role: "OWNER", permissions: ["B", "A"] }, "merchant-a");
  const aSame = authorityKey({ user_id: "u-a", role: "OWNER", permissions: ["A", "B"] }, "merchant-a");
  const b = authorityKey({ user_id: "u-b", role: "OWNER", permissions: ["A", "B"] }, "merchant-b");
  assert.equal(a, aSame);
  cache.set(a, "PRODUK", { marker: "a" });
  assert.equal(cache.get(aSame, "PRODUK").marker, "a");
  assert.equal(cache.get(b, "PRODUK"), null);
  cache.set(a, "STOK", { marker: "stock" }); cache.set(a, "LAPORAN", { marker: "report" });
  assert.equal(cache.size(), 2); assert.equal(cache.get(a, "PRODUK"), null);
  clock += 101; assert.equal(cache.get(a, "STOK"), null);
});

test("mutation invalidation and merchant switch clear cached projections", () => {
  const cache = createModuleDataCache();
  const a = authorityKey({ user_id: "u", role: "OWNER", permissions: ["PRODUCT_VIEW"] }, "a");
  const b = authorityKey({ user_id: "u", role: "OWNER", permissions: ["PRODUCT_VIEW"] }, "b");
  cache.set(a, "PRODUK", { id: "a-product" }); cache.set(b, "PRODUK", { id: "b-product" });
  cache.invalidate(a);
  assert.equal(cache.get(a, "PRODUK"), null); assert.equal(cache.get(b, "PRODUK").id, "b-product");
  cache.clear(); assert.equal(cache.size(), 0);
  assert.match(source, /moduleCache\.current\.invalidate\(authorityKey\(context,businessId\)\)/);
  assert.match(source, /moduleCache\.current\.clear\(\)/);
});

test("large lists render in bounded pages instead of one unbounded pass", () => {
  const rows = Array.from({ length: 1_000 }, (_, id) => ({ id }));
  const first = boundedRows(rows, 30), next = boundedRows(rows, 60);
  assert.equal(first.visible.length, 30); assert.equal(first.hasMore, true);
  assert.equal(next.visible.length, 60); assert.equal(next.total, 1_000);
  assert.match(source, /const PAGE_SIZE=30/);
  assert.match(source, /Tampilkan .* berikutnya/);
  assert.match(source, /target===module&&Object\.keys\(data\)\.length&&recentlyLoaded/);
});

test("navigation loading is separate from mutation busy and cached data is visibly revalidated", () => {
  assert.match(source, /const \[loadingModule,setLoadingModule\]/);
  assert.match(source, /Memperbarui data/);
  assert.match(source, /moduleCache\.current\.get/);
  assert.match(source, /await Promise\.all/);
  assert.match(source, /setBusy\(true\)/);
  assert.match(source, /Menampilkan data terakhir/);
});

test("daily money entry reuses exact Rupiah field and disabled actions explain prerequisites", () => {
  for (const label of ["Kas awal", "Diskon", "Nominal", "Uang diterima", "Kas fisik aktual"])
    assert.match(source, new RegExp(`<RupiahField label="${label}`));
  assert.match(source, /disabledHint=\{pendingSale/);
  assert.match(source, /disabledHint=\{!selectedTerminal/);
  assert.doesNotMatch(source, /\[\"OPENING\",\"Saldo awal\"\]/);
});
