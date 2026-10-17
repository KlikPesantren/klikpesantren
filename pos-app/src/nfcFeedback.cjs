"use strict";

const NFC_MESSAGES = {
  NFC_UNAVAILABLE: "Perangkat ini tidak memiliki pembaca NFC yang kompatibel.",
  NFC_DISABLED: "NFC sedang nonaktif. Aktifkan NFC di Pengaturan Android, lalu coba lagi.",
  NFC_CANCELLED: "Pemindaian NFC dibatalkan. Tempelkan kartu dan tahan sampai terbaca.",
  NFC_TIMEOUT: "Kartu belum terbaca. Tempelkan kartu lebih dekat lalu coba lagi.",
  NFC_READ_FAILED: "Kartu terdeteksi tetapi gagal dibaca. Pertahankan posisi kartu lalu coba lagi.",
  UNSUPPORTED_NFC_TAG: "Tag terbaca, tetapi UID tidak sesuai format kartu RFID KlikPesantren.",
  WALLET_PREVIEW_FAILED: "Kartu terbaca, tetapi preview Dompet ditolak server. Periksa unit dan hak akses merchant.",
};

function nfcFailureCode(error, phase = "READ") {
  const names = new Set([String(error?.name || ""), String(error?.constructor?.name || "")]);
  const message = String(error?.message || error || "").toLowerCase();
  if (["NFC_UNAVAILABLE", "NFC_DISABLED", "UNSUPPORTED_NFC_TAG", "WALLET_PREVIEW_FAILED"].includes(error?.message)) return error.message;
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

module.exports = { NFC_MESSAGES, nfcFailureCode, nfcFailureMessage };
