const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { barcodeCredential, nfcCredential, scanResult, externalPayment } = require("../src/paymentCredential.cjs");
const { createSaleJournal } = require("../src/saleJournal.cjs");

test("barcode card accepts only opaque credential without identity or balance data", () => {
  const token = "kpw_" + "A".repeat(43);
  assert.equal(barcodeCredential(token), token);
  assert.deepEqual(scanResult("BARCODE", token), { credential_method: "BARCODE", credential: token });
  assert.deepEqual(scanResult("QR", token), { credential_method: "QR", credential: token });
  for (const invalid of ["75", "Rp50000", "kpw_short", "https://example.invalid/card"])
    assert.throws(() => barcodeCredential(invalid), /UNKNOWN_CREDENTIAL/);
});

test("NFC preserves UID byte order and leading zeroes while canonicalizing case", () => {
  assert.equal(nfcCredential({ id: "0AB102FF" }), "0ab102ff");
  assert.deepEqual(scanResult("RFID", "0AB102FF"), { credential_method: "RFID", credential: "0ab102ff" });
  for (const invalid of ["A1B2", "0A:B1:02:FF", "kpw_credential", ""])
    assert.throws(() => nfcCredential({ id: invalid }), /UNSUPPORTED_NFC_TAG/);
});

test("BANK and QRIS require explicit auditable manual confirmation", () => {
  for (const method of ["BANK", "QRIS"]) {
    assert.throws(() => externalPayment(method, { reference: "proof" }), /PAYMENT_CONFIRMATION_REQUIRED/);
    assert.throws(() => externalPayment(method, { manual_confirmed: true, reference: "" }), /PAYMENT_CONFIRMATION_REQUIRED/);
    assert.deepEqual(externalPayment(method, { manual_confirmed: true, reference: "reviewed-proof" }), {
      method, manual_confirmed: true, confirmation_mode: "MANUAL", reference: "reviewed-proof",
    });
  }
});

test("unknown outcome retains one immutable sale request and exact retry clears it", async () => {
  let record = null, sends = 0, committed = null;
  const vault = {
    read: async () => record,
    write: async (_key, value) => { assert.equal(record, null); record = structuredClone(value); },
    remove: async () => { record = null; },
  };
  const journal = createSaleJournal({ vault, send: async payload => {
    sends++;
    if (!committed) { committed = structuredClone(payload); throw Object.assign(Error("timeout"), { code: "NETWORK" }); }
    assert.deepEqual(payload, committed);
    return { sale: { id: "same-sale" }, replay: true };
  }});
  const payload = { request_id: "wp4-request-0001", items: [{ product_id: "p", quantity: 1 }], payments: [{ method: "CASH", amount: "1000" }] };
  const authority = { business_id: "business-a", user_id: "user-a" };
  await assert.rejects(() => journal.submit(payload, authority), /timeout/);
  assert.deepEqual((await journal.read()).payload, payload);
  await assert.rejects(() => journal.submit({ ...payload, request_id: "different" }, authority), /PENDING_SALE_REQUIRES_RETRY/);
  const recovered = await journal.submit(null, authority);
  assert.equal(recovered.sale.id, "same-sale"); assert.equal(sends, 2); assert.equal(await journal.read(), null);
});

test("reader UI is native, preview-first, and never logs raw UID/token", () => {
  const root = path.join(__dirname, "..");
  const scanner = fs.readFileSync(path.join(root, "src", "WalletCredentialScanner.jsx"), "utf8");
  const app = fs.readFileSync(path.join(root, "src", "MerchantBusinessApp.jsx"), "utf8");
  const server = fs.readFileSync(path.join(root, "..", "services", "posBusinessService.js"), "utf8");
  assert.match(scanner, /CameraView/); assert.match(scanner, /react-native-nfc-manager/);
  assert.doesNotMatch(scanner, /console\.(?:log|info|warn|error)/);
  assert.match(app, /wallet\/preview/); assert.match(app, /available_balance/);
  assert.match(app, /title="Unit santri"/); assert.match(app, /scannerAvailability\(context\.units,payment\.unit_id\)/);
  assert.match(scanner, /disabledReason/);
  assert.match(scanner, /nfcFailureMessage/);
  assert.match(scanner, /manager\.isEnabled\(\)/);
  assert.match(server, /manual_confirmed !== true/); assert.match(server, /confirmation_mode !== 'MANUAL'/);
});
