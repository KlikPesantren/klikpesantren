function filterCustomers(rows, query, limit = 30) {
  const term = String(query || "").trim().toLowerCase();
  return (rows || []).filter(row => !term || `${row.name || ""} ${row.phone || ""}`.toLowerCase().includes(term)).slice(0, limit);
}

function defaultDueDate(days, now = new Date()) {
  const value = Number(days || 0);
  if (!Number.isSafeInteger(value) || value < 0 || value > 3650) return "";
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + value);
  const year = date.getFullYear(), month = String(date.getMonth() + 1).padStart(2, "0"), day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function creditAvailability(customer, total) {
  if (!customer) return { enabled: false, reason: "Pilih customer terdaftar sebelum mencatat utang." };
  if (!customer.active) return { enabled: false, reason: "Customer tidak aktif." };
  if (!customer.credit_allowed) return { enabled: false, reason: "Fasilitas utang customer belum diaktifkan oleh Owner." };
  const value = BigInt(total || 0), outstanding = BigInt(customer.outstanding || 0), limit = BigInt(customer.credit_limit || 0);
  if (value <= 0n) return { enabled: false, reason: "Total transaksi harus lebih dari Rp0." };
  if (outstanding + value > limit) return { enabled: false, reason: "Transaksi melebihi sisa limit utang customer." };
  return { enabled: true, reason: "" };
}

module.exports = { filterCustomers, defaultDueDate, creditAvailability };
