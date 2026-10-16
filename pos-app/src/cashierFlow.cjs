function positiveMoney(value) {
  return /^(0|[1-9]\d*)$/.test(String(value ?? "")) && BigInt(value) > 0n;
}

function scannerAvailability(units, unitId) {
  if (!Array.isArray(units) || units.length === 0) {
    return {
      enabled: false,
      reason: "Merchant belum terhubung ke unit santri. Minta Tenant Admin mengaktifkan unit untuk merchant ini.",
    };
  }
  if (!unitId) {
    return {
      enabled: false,
      reason: "Pilih unit santri terlebih dahulu agar credential diperiksa dalam tenant dan unit yang benar.",
    };
  }
  if (!units.some(unit => String(unit.unit_id ?? unit.id) === String(unitId))) {
    return {
      enabled: false,
      reason: "Unit yang dipilih tidak lagi tersedia untuk merchant ini. Pilih ulang unit yang aktif.",
    };
  }
  return { enabled: true, reason: "" };
}

function transferMethod(accounts, accountId) {
  const account = (accounts || []).find(row => String(row.id) === String(accountId));
  return ["BANK", "QRIS"].includes(account?.kind) ? account.kind : null;
}

function cashChange(tendered, total) {
  if (!positiveMoney(tendered) || !positiveMoney(total)) return null;
  const change = BigInt(tendered) - BigInt(total);
  return change >= 0n ? change : null;
}

module.exports = { cashChange, scannerAvailability, transferMethod };
