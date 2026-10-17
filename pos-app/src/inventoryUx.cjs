function stockStatus(product) {
  const available = BigInt(product?.available ?? product?.on_hand ?? 0);
  const minimum = BigInt(product?.minimum_stock ?? 0);
  if (available <= 0n) return "OUT";
  if (available <= minimum) return "LOW";
  return "AVAILABLE";
}

function filterProducts(products = [], filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  return products.filter(product =>
    (!query || `${product.name || ""} ${product.sku || ""} ${product.barcode || ""}`.toLowerCase().includes(query)) &&
    (!filters.category || product.category === filters.category) &&
    (!filters.stock || stockStatus(product) === filters.stock));
}

function purchaseAccounts(accounts = [], mode) {
  if (mode === "CASH") return accounts.filter(account => account.kind === "CASH");
  if (mode === "TRANSFER") return accounts.filter(account => account.kind === "BANK");
  if (mode === "PARTIAL") return accounts.filter(account => ["CASH", "BANK"].includes(account.kind));
  return [];
}

function applyPurchasePaymentMode(draft, mode, total) {
  const next = { ...draft };
  if (mode === "DEBT") return { ...next, paid: "0", account_id: "" };
  if (["CASH", "TRANSFER"].includes(mode)) return { ...next, paid: String(total), account_id: "", due_date: "" };
  return next;
}

module.exports = { stockStatus, filterProducts, purchaseAccounts, applyPurchasePaymentMode };
