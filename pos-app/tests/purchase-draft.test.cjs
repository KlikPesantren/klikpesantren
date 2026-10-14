const test = require("node:test");
const assert = require("node:assert/strict");
const { addPurchaseLine, updatePurchaseLine, removePurchaseLine, purchaseTotals, purchasePayload } = require("../src/purchaseDraft.cjs");

test("multi-line purchase uses one atomic payload and exact Rupiah totals", () => {
  let lines = addPurchaseLine([], { id: "a", name: "Produk A", reference_purchase_price: "2500" });
  lines = addPurchaseLine(lines, { id: "b", name: "Produk B" });
  lines = updatePurchaseLine(lines, "a", { quantity: "2" });
  lines = updatePurchaseLine(lines, "b", { quantity: "3", unit_cost: "1.500" });
  assert.equal(purchaseTotals(lines).total, "9500");
  const payload = purchasePayload({ supplier_id: "supplier", account_id: "cash", paid: "4.500", due_date: "2030-01-01", lines }, "request-123");
  assert.equal(payload.items.length, 2);
  assert.equal(payload.paid, "4500");
  assert.equal(payload.items[1].unit_cost, "1500");
});

test("duplicate products are reused, lines can be removed, and invalid payment fails closed", () => {
  const product = { id: "a", name: "Produk A" };
  let lines = addPurchaseLine([], product);
  assert.equal(addPurchaseLine(lines, product).length, 1);
  lines = updatePurchaseLine(lines, "a", { unit_cost: "1000" });
  assert.throws(() => purchasePayload({ supplier_id: "s", paid: "1001", lines }, "request-123"), /INVALID_PURCHASE/);
  assert.equal(removePurchaseLine(lines, "a").length, 0);
});
