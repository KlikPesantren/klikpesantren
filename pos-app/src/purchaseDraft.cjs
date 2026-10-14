const { canonicalRupiah } = require("./rupiahInput.cjs");

function normalizeQuantity(value) {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text)) throw Error("INVALID_QUANTITY");
  return text;
}

function addPurchaseLine(lines, product) {
  if (!product?.id) throw Error("PRODUCT_REQUIRED");
  if (lines.some(line => line.product_id === product.id)) return lines;
  return [...lines, {
    product_id: product.id, name: product.name, quantity: "1",
    unit_cost: String(product.reference_purchase_price || ""),
  }];
}

function updatePurchaseLine(lines, productId, patch) {
  return lines.map(line => line.product_id === productId ? { ...line, ...patch } : line);
}

function removePurchaseLine(lines, productId) {
  return lines.filter(line => line.product_id !== productId);
}

function purchaseTotals(lines) {
  let total = 0n;
  for (const line of lines) {
    const quantity = BigInt(normalizeQuantity(line.quantity));
    const cost = BigInt(canonicalRupiah(line.unit_cost));
    total += quantity * cost;
  }
  return { total: total.toString() };
}

function purchasePayload(draft, requestId) {
  const total = BigInt(purchaseTotals(draft.lines).total);
  const paid = BigInt(canonicalRupiah(draft.paid || "0") || "0");
  if (!draft.supplier_id || !draft.lines.length || total <= 0n || paid > total) throw Error("INVALID_PURCHASE");
  if (paid > 0n && !draft.account_id) throw Error("ACCOUNT_REQUIRED");
  if (paid < total && !/^\d{4}-\d{2}-\d{2}$/.test(draft.due_date || "")) throw Error("DUE_DATE_REQUIRED");
  return {
    request_id: requestId, supplier_id: draft.supplier_id,
    account_id: paid > 0n ? draft.account_id : undefined,
    paid: paid.toString(), due_date: paid < total ? draft.due_date : undefined,
    reference: draft.reference?.trim() || undefined,
    items: draft.lines.map(line => ({
      product_id: line.product_id, quantity: normalizeQuantity(line.quantity),
      unit_cost: canonicalRupiah(line.unit_cost),
    })),
  };
}

module.exports = { addPurchaseLine, updatePurchaseLine, removePurchaseLine, purchaseTotals, purchasePayload };
