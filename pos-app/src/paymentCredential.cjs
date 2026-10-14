const OPAQUE_CARD = /^kpw_[A-Za-z0-9_-]{43}$/;

function barcodeCredential(value) {
  const credential = String(value || "").trim();
  if (!OPAQUE_CARD.test(credential)) throw Error("UNKNOWN_CREDENTIAL");
  return credential;
}

function nfcCredential(tag) {
  const id = String(tag?.id || "").trim();
  // Preserve the tag's byte order and leading zeroes; only canonicalize hex case.
  if (!/^(?:[0-9a-fA-F]{2}){4,16}$/.test(id)) throw Error("UNSUPPORTED_NFC_TAG");
  return id.toLowerCase();
}

function scanResult(method, value) {
  if (method === "RFID") return { credential_method: "RFID", credential: nfcCredential({ id: value }) };
  if (method === "QR") return { credential_method: "QR", credential: barcodeCredential(value) };
  if (method === "BARCODE") return { credential_method: "BARCODE", credential: barcodeCredential(value) };
  throw Error("INVALID_CREDENTIAL_METHOD");
}

function externalPayment(method, input) {
  if (!["BANK", "QRIS"].includes(method)) throw Error("INVALID_PAYMENT_METHOD");
  if (input?.manual_confirmed !== true) throw Error("PAYMENT_CONFIRMATION_REQUIRED");
  const reference = String(input.reference || "").trim();
  if (!reference || reference.length > 500) throw Error("PAYMENT_CONFIRMATION_REQUIRED");
  return { method, manual_confirmed: true, confirmation_mode: "MANUAL", reference };
}

module.exports = { OPAQUE_CARD, barcodeCredential, nfcCredential, scanResult, externalPayment };
