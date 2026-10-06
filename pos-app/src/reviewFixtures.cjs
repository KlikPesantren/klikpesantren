// POS_VISUAL_FIXTURE_ONLY: isolated UI data, no fetch, DB, credentials or ledger.
const scope = { unit_id: 900001, merchant_id: 900001, terminal_id: 900001 };
const permissions = [
  "pos.view",
  "pos.sell",
  "pos.shifts.manage",
  "pos.discount",
  "pos.refund",
];
const shift = {
  ...scope,
  id: "90000000-0000-4000-8000-000000000001",
  status: "OPEN",
  opening_cash: "100000",
};
const products = [
  ["Mie Nyemek", 18000],
  ["Indomie Goreng", 12000],
  ["Nasi Goreng", 20000],
  ["Es Kopi Susu", 15000],
  ["Kopi Hitam", 8000],
  ["Air Mineral", 5000],
  [
    "Paket nasi goreng spesial dengan telur, ayam dan minuman — nama panjang untuk review",
    35000,
  ],
].map(([name, price], i) => ({
  id: `90000000-0000-4000-8000-${String(i + 10).padStart(12, "0")}`,
  name,
  price: String(price),
  sku: `DEMO-${i + 1}`,
  available: i !== 5,
  category_id: i < 3 || i === 6 ? "food" : "drink",
  quantity: 1,
}));
const categories = [
  { id: "food", name: "Makanan" },
  { id: "drink", name: "Minuman" },
];
const wallet = {
  santri_name: "Santri Demo — Sintetis",
  unit_id: scope.unit_id,
  current_balance: "100000",
  projected_balance: "63000",
  preview_only: true,
};
function receipt(method = "CASH", status = "CONFIRMED") {
  return {
    sale: {
      id: "90000000-0000-4000-8000-000000000002",
      receipt: "REVIEW-ONLY-0001",
      status: status === "PENDING" ? "DRAFT" : "PAID",
      created_at: "2026-10-06T06:00:00Z",
      merchant_name: "Kantin Anwarul Huda",
      cashier_name: "Kasir 01",
      terminal_name: "POS-01",
      subtotal: "37000",
      discount: "0",
      grand_total: "37000",
      shift_id: shift.id,
    },
    payment: {
      id: "90000000-0000-4000-8000-000000000003",
      method,
      status,
      amount: "37000",
      tendered: "50000",
      change: "13000",
      santri_name: wallet.santri_name,
      wallet_balance_after: "63000",
    },
    items: [
      {
        id: "review-item",
        name: products[0].name,
        quantity: 2,
        unit_price: "18500",
        total: "37000",
      },
    ],
    refunds: [
      {
        id: "review-refund",
        amount: "5000",
        status: "PENDING",
        reason: "Contoh tampilan pengembalian sintetis",
        created_at: "2026-10-06T06:10:00Z",
      },
    ],
  };
}
const states = [
  "normal",
  "loading",
  "empty",
  "error",
  "offline",
  "shift closed",
  "shift open",
  "empty cart",
  "cart populated",
  "payment success",
  "QRIS pending",
  "RFID preview",
  "insufficient balance",
  "unknown/checking",
  "large amounts",
];
function createReviewAdapter() {
  let state = "normal";
  const summary = () => ({
    shift: state === "shift closed" ? null : shift,
    count: 12,
    sales: "245000",
    payments: [
      { method: "CASH", count: 6, amount: "120000" },
      { method: "RFID", count: 4, amount: "85000" },
      { method: "TRANSFER_QRIS", count: 2, amount: "40000" },
    ],
    refunds: "5000",
    cash_sales: "120000",
    cash_refunds: "5000",
    expected_cash: "215000",
  });
  async function api(path, { query = {} } = {}) {
    if (state === "offline")
      throw Object.assign(Error("NETWORK"), { code: "NETWORK" });
    if (state === "error")
      throw Object.assign(Error("review-error"), {
        code: "PRODUCT_UNAVAILABLE",
        status: 403,
      });
    if (state === "loading")
      await new Promise((resolve) => setTimeout(resolve, 1200));
    if (path === "/pos/mobile/context")
      return {
        user: { id: 900001, nama: "Kasir 01", username: "review-only" },
        tenant_id: 900001,
        permissions,
        merchants: [
          {
            merchant_id: scope.merchant_id,
            unit_id: scope.unit_id,
            nama_merchant: "Kantin Anwarul Huda",
            unit_name: "Pesantren",
          },
        ],
        terminals: [
          {
            id: scope.terminal_id,
            nama_device: "POS-01",
            merchant_id: scope.merchant_id,
            unit_id: scope.unit_id,
            enabled: true,
            pos_enabled: true,
          },
        ],
        shift: summary().shift,
      };
    if (path === "/pos/mobile/summary") return summary();
    if (path === "/pos/mobile/catalog") {
      const filtered =
        state === "empty"
          ? []
          : products.filter(
              (p) =>
                (!query.category_id || p.category_id === query.category_id) &&
                p.name
                  .toLowerCase()
                  .includes(String(query.search || "").toLowerCase()),
            );
      return {
        products: filtered,
        categories,
        total: filtered.length,
        page: 1,
        limit: 30,
      };
    }
    if (path === "/pos/mobile/transactions")
      return {
        rows:
          state === "empty"
            ? []
            : ["CASH", "RFID", "TRANSFER_QRIS"]
                .filter((m) => !query.method || m === query.method)
                .map((m, i) => ({
                  id: `review-${i}`,
                  receipt: `REVIEW-ONLY-000${i + 1}`,
                  grand_total: "37000",
                  created_at: "2026-10-06T06:00:00Z",
                  method: m,
                  status: i === 2 ? "DRAFT" : "PAID",
                  payment_status: i === 2 ? "PENDING" : "CONFIRMED",
                }))
                .filter((r) => r.receipt.includes(query.search || "")),
        page: 1,
        total: state === "empty" ? 0 : 3,
        limit: 30,
      };
    if (path.startsWith("/pos/mobile/transactions/"))
      return receipt(
        path.endsWith("review-2") ? "TRANSFER_QRIS" : "CASH",
        path.endsWith("review-2") ? "PENDING" : "CONFIRMED",
      );
    if (path === "/pos/mobile/credential-preview") return wallet;
    // Explicitly reject ALL financial/auth/network actions, including future additions.
    throw Object.assign(Error("REVIEW_WRITE_DISABLED"), {
      code: "REVIEW_WRITE_DISABLED",
      status: 400,
    });
  }
  return {
    api,
    setState: (v) => {
      if (!states.includes(v)) throw Error("INVALID_REVIEW_STATE");
      state = v;
    },
    summary,
    scope,
    states,
    products,
    wallet,
    receipt,
  };
}
module.exports = { createReviewAdapter };
