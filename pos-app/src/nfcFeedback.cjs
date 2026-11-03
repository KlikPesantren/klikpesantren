"use strict";

const NFC_MESSAGES = {
  UNSUPPORTED_NFC_TAG: "Kartu tidak kompatibel dengan pembaca NFC ini. Gunakan barcode/token yang sah atau hubungi Admin.",
  CREDENTIAL_DISABLED: "Kartu/token sudah dinonaktifkan. Hubungi Admin KlikPesantren.",
  MEMBERSHIP_INACTIVE: "Santri tidak aktif pada unit yang dipilih.",
  WALLET_NOT_ACTIVE: "Dompet tidak aktif. Hubungi Admin KlikPesantren.",
  WALLET_PREVIEW_STALE: "Pilihan pembayaran berubah. Pilih unit dan pindai kembali.",
  INVALID_WALLET_PREVIEW: "Hasil verifikasi tidak cocok dengan unit pembayaran. Pindai ulang atau hubungi Admin.",
  NETWORK_TIMEOUT: "Verifikasi server melewati batas waktu. Belum ada debit dari langkah pemindaian ini.",
  POS_INTERNAL_ERROR: "Server belum dapat memverifikasi kartu. Coba lagi setelah layanan pulih.",
  SERVER_ERROR: "Server belum dapat memverifikasi kartu. Coba lagi setelah layanan pulih.",
  NFC_UNAVAILABLE: "Perangkat ini tidak memiliki pembaca NFC yang kompatibel.",
  NFC_DISABLED: "NFC sedang nonaktif. Aktifkan NFC di Pengaturan Android, lalu coba lagi.",
  NFC_CANCELLED: "Pemindaian NFC dibatalkan. Tempelkan kartu dan tahan sampai terbaca.",
  NFC_TIMEOUT: "Kartu belum terbaca. Tempelkan kartu lebih dekat lalu coba lagi.",
  NFC_READ_FAILED: "Kartu terdeteksi tetapi gagal dibaca. Pertahankan posisi kartu lalu coba lagi.",
  WALLET_PREVIEW_FAILED: "Kartu terbaca, tetapi preview Dompet ditolak server. Periksa unit dan hak akses merchant.",
  UNKNOWN_CREDENTIAL: "Kartu belum terdaftar atau sudah dicabut. Gunakan kartu aktif atau pindai barcode resmi.",
  WALLET_UNIT_DENIED: "Santri tidak berada pada unit yang diizinkan untuk merchant ini. Pilih unit yang benar.",
  MERCHANT_SESSION_INVALID: "Sesi merchant sudah berakhir. Masuk kembali sebelum memindai.",
  INSUFFICIENT_BALANCE: "Saldo Dompet Santri tidak mencukupi untuk pembayaran ini.",
  NETWORK: "Koneksi ke server terputus. Verifikasi belum berhasil; pemindaian ini belum mendebit saldo.",
  PAYMENT_STATUS_UNKNOWN: "Status pembayaran belum pasti. Periksa transaksi tertunda sebelum mencoba kembali.",
};

const NFC_STATUS_MESSAGES = {
  READY: "Siap memindai kartu NFC atau barcode.",
  WAITING: "Dekatkan kartu dan tahan sampai terbaca.",
  DETECTED: "Kartu terdeteksi.",
  VERIFYING: "Memverifikasi santri dan saldo Dompet…",
  VERIFIED: "Identitas dan saldo berhasil dimuat. Periksa lalu konfirmasi pembayaran.",
};

function nfcFailureCode(error, phase = "READ") {
  const names = new Set([String(error?.name || ""), String(error?.constructor?.name || "")]);
  const message = String(error?.message || error || "").toLowerCase();
  const explicit = String(error?.code || error?.message || "");
  if (Object.hasOwn(NFC_MESSAGES, explicit)) return explicit;
  if (names.has("UserCancel") || message === "cancelled" || message.includes("cancel")) return "NFC_CANCELLED";
  if (names.has("RadioDisabled") || message.includes("disabled") || message.includes("not enabled")) return "NFC_DISABLED";
  if (names.has("UnsupportedFeature") || message.includes("not support") || message.includes("unavailable")) return "NFC_UNAVAILABLE";
  if (names.has("Timeout") || message.includes("timeout")) return "NFC_TIMEOUT";
  if (["TagConnectionLost", "TagNotConnected", "TagResponseError", "RetryExceeded"].some(name => names.has(name))) return "NFC_READ_FAILED";
  return phase === "PREVIEW" ? "WALLET_PREVIEW_FAILED" : "NFC_READ_FAILED";
}

function nfcFailureMessage(error, phase) {
  const code = nfcFailureCode(error, phase);
  return { code, message: NFC_MESSAGES[code] };
}

function nfcStatusMessage(status) {
  return NFC_STATUS_MESSAGES[status] || NFC_STATUS_MESSAGES.READY;
}

module.exports = { NFC_MESSAGES, NFC_STATUS_MESSAGES, nfcFailureCode, nfcFailureMessage, nfcStatusMessage };
