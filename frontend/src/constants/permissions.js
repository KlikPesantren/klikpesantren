// =============================================================
// SUMBER KEBENARAN TUNGGAL UNTUK RBAC FRONTEND
// Dipakai bersama oleh Sidebar.jsx dan ProtectedRoute.jsx
// =============================================================

// Map: path frontend → permission yang dibutuhkan untuk membukanya
export const ROUTE_PERMISSIONS = {
  "/dashboard":         "dashboard.view",
  "/santri":            "santri.view",
  "/alumni":            "alumni.view",
  "/kelas":             "kelas.view",
  "/wali":              "wali.view",
  "/guru":              "guru.view",
  "/absensi":           "absensi.view",
  "/absensi-guru":      "absensi_guru.view",
  "/hafalan":           "hafalan.view",
  "/nilai":             "nilai.view",
  "/mata-pelajaran":    "nilai.view",
  "/pembayaran":        "pembayaran.view",
  "/buku-kas":          "bukukas.view",
  "/kas-instansi":      "kas_instansi.view",
  "/kas-instansi/konsolidasi": "kas_instansi.konsolidasi",
  "/program-unit":      "program_unit.view",
  "/sahriyah":          "sahriyah.view",
  "/sahriyah-setting":  "sahriyah.manage",
  "/pelanggaran":       "pelanggaran.view",
  "/kesehatan":         "kesehatan.view",
  "/perizinan":         "perizinan.view",
  "/tamu":              "tamu.view",
  "/pengumuman":        "pengumuman.view",
  "/wali-home-links":   "konten_pesantren.view",
  "/profil-pesantren":  "profil.view",
  "/devices":           "device.view",
  "/audit":             "audit.view",
  "/rfid-monitor":      "rfid.view",
  "/rfid-dashboard":    ["wallet.view", "rfid.view"],
  "/rfid-transactions": ["wallet.view", "rfid.view"],
  "/rfid-topup":        ["wallet.view", "rfid.view"],
  "/wallet-withdrawal": ["wallet.manage", "rfid.manage"],
  "/rfid-merchant":     "rfid.view",
  "/rfid-devices":      "rfid.view",
  "/rfid-mutasi":       ["wallet.view", "rfid.view"],
  "/rfid-refund":       "rfid.view",
  "/users":             "user.view",
  "/roles":             "role.manage",
  "/units":             "unit.view",
};

// Map: path frontend → tenant feature key
export const ROUTE_UNIT_FEATURES = {
  "/absensi": "absensi",
  "/pembayaran": "pembayaran",
  "/perizinan": "perizinan",
  "/pelanggaran": "pelanggaran",
  "/kesehatan": "kesehatan",
  "/pengumuman": "pengumuman",
  "/hafalan": "hafalan",
  "/nilai": "nilai",
  "/mata-pelajaran": "mata_pelajaran",
  "/sahriyah": "sahriyah",
  "/sahriyah-setting": "sahriyah",
  "/rfid-dashboard": "wallet",
  "/rfid-transactions": "wallet",
  "/rfid-topup": "wallet",
  "/wallet-withdrawal": "wallet",
  "/rfid-mutasi": "wallet",
  "/rfid-monitor": "rfid",
  "/rfid-merchant": "rfid",
  "/rfid-devices": "rfid",
  "/rfid-refund": "rfid",
};

export const ROUTE_FEATURES = {
  "/dashboard":         "dashboard",
  "/santri":            "santri",
  "/kelas":             "kelas",
  "/wali":              "wali",
  "/guru":              "guru",
  "/absensi":           "pendidikan",
  "/absensi-guru":      "pendidikan",
  "/hafalan":           "pendidikan",
  "/nilai":             "pendidikan",
  "/mata-pelajaran":    "pendidikan",
  "/pembayaran":        "pembayaran",
  "/buku-kas":          "buku_kas",
  "/kas-instansi":      "kas_instansi",
  "/kas-instansi/konsolidasi": "kas_instansi",
  "/program-unit":      "program_unit",
  "/sahriyah":          "sahriyah",
  "/sahriyah-setting":  "sahriyah",
  "/pelanggaran":       "pelanggaran",
  "/kesehatan":         "keamanan",
  "/perizinan":         "perizinan",
  "/tamu":              "keamanan",
  "/pengumuman":        "pengumuman",
  "/wali-home-links":   "pengumuman",
  "/profil-pesantren":  "profil",
  "/devices":           "rfid",
  "/audit":             "audit",
  "/rfid-monitor":      "rfid",
  "/rfid-dashboard":    null,
  "/rfid-transactions": null,
  "/rfid-topup":        null,
  "/wallet-withdrawal": null,
  "/rfid-merchant":     "rfid",
  "/rfid-devices":      "rfid",
  "/rfid-mutasi":       null,
  "/rfid-refund":       "rfid",
  "/users":             "sistem",
  "/roles":             "sistem",
  "/units":             null,
};

// New authenticated routes are unit-aware by default. Only genuinely
// tenant/global administration pages opt out here, so AppShell cannot drift
// behind a second positive whitelist when a unit-owned module is added.
const TENANT_GLOBAL_ROUTES = new Set([
  "/alumni",
  "/kas-instansi",
  "/kas-instansi/konsolidasi",
  "/program-unit",
  "/wali-home-links",
  "/profil-pesantren",
  "/devices",
  "/audit",
  "/users",
  "/roles",
]);

export function isUnitAwareRoute(pathname) {
  return Object.prototype.hasOwnProperty.call(ROUTE_PERMISSIONS, pathname)
    && !TENANT_GLOBAL_ROUTES.has(pathname);
}
