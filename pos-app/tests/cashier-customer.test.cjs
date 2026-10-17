const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { filterCustomers, defaultDueDate, creditAvailability } = require("../src/cashierCustomer.cjs");

test("cashier customer search matches name or phone and remains bounded", () => {
  const rows = [{ id: "a", name: "Ahmad", phone: "08123" }, { id: "b", name: "Fatimah", phone: "08999" }];
  assert.deepEqual(filterCustomers(rows, "ahm").map(row => row.id), ["a"]);
  assert.deepEqual(filterCustomers(rows, "8999").map(row => row.id), ["b"]);
  assert.equal(filterCustomers(Array.from({ length: 40 }, (_, id) => ({ id, name: `Customer ${id}` })), "").length, 30);
});

test("credit action requires an active authorized customer and exact remaining limit", () => {
  assert.match(creditAvailability(null, "18000").reason, /Pilih customer/);
  assert.match(creditAvailability({ active: true, credit_allowed: false }, "18000").reason, /belum diaktifkan/);
  assert.equal(creditAvailability({ active: true, credit_allowed: true, outstanding: "32000", credit_limit: "50000" }, "18000").enabled, true);
  assert.equal(creditAvailability({ active: true, credit_allowed: true, outstanding: "32001", credit_limit: "50000" }, "18000").enabled, false);
  assert.equal(defaultDueDate(7, new Date(2026, 9, 16)), "2026-10-23");
});

test("cashier UI uses canonical customer, CREDIT, AR collection and permission contracts", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "MerchantBusinessApp.jsx"), "utf8");
  assert.match(source, /Cari nama atau nomor HP/);
  assert.match(source, /Simpan & Pilih Customer/);
  assert.match(source, /Catat sebagai Utang/);
  assert.match(source, /chooseMethod\(\"CREDIT\"\)/);
  assert.match(source, /Lihat Piutang & Pelunasan/);
  assert.match(source, /CUSTOMER_MANAGE/);
  assert.match(source, /CUSTOMER_CREDIT_MANAGE/);
  assert.match(source, /AR_VIEW/);
});
