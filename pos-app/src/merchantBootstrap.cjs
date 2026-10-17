const READINESS_ITEMS = Object.freeze([
  ["profile", "Profil usaha", "PENGATURAN", "BUSINESS_SETTINGS_MANAGE"],
  ["initialization", "Posisi awal usaha", "PENGATURAN", "BUSINESS_SETTINGS_MANAGE"],
  ["account", "Kas / rekening", "PENGATURAN", "BUSINESS_SETTINGS_MANAGE"],
  ["cash_drawer", "Laci kas untuk shift", "PENGATURAN", "BUSINESS_SETTINGS_MANAGE"],
  ["terminal", "Terminal kasir", "PENGATURAN", "BUSINESS_SETTINGS_MANAGE"],
  ["product", "Produk", "PRODUK", "PRODUCT_MANAGE"],
  ["employee", "Karyawan", "PENGGUNA", "USER_MANAGE"],
]);

function keepMerchantSelection(current, rows = []) {
  if (rows.some(item => item.id === current)) return current;
  return rows.length === 1 ? rows[0].id : "";
}

function shiftResourceChoice(current, rows = []) {
  const selected = keepMerchantSelection(current, rows);
  return {
    selected,
    automatic: rows.length === 1,
    needsChoice: rows.length > 1 && !selected,
  };
}

function cashierSetupState(terminals = [], drawers = [], canConfigure = false) {
  return {
    missingTerminal: terminals.length === 0,
    missingDrawer: drawers.length === 0,
    canConfigure,
    ready: terminals.length > 0 && drawers.length > 0,
  };
}

module.exports = { READINESS_ITEMS, keepMerchantSelection, shiftResourceChoice, cashierSetupState };
