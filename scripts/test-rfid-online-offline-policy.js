const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function onlinePayment(state, nominal) {
  if (state.saldo < nominal) return { ok: false, reason: "saldo", state };
  if (state.used + nominal > state.limit) return { ok: false, reason: "limit", state };
  return { ok: true, state: { ...state, saldo: state.saldo - nominal, used: state.used + nominal } };
}

function offlinePayment(state, nominal, trxId) {
  if (state.saldo < nominal) return { ok: false, reason: "saldo", state };
  return {
    ok: true,
    state: { ...state, saldo: state.saldo - nominal, queue: [...state.queue, trxId] },
  };
}

function sync(state, trxId, shouldFail = false) {
  if (shouldFail) return { ...state, pending: [...state.pending, trxId] };
  if (state.processed.has(trxId)) return state;
  return { ...state, processed: new Set([...state.processed, trxId]) };
}

let online = { saldo: 20000, limit: 10000, used: 0 };
online = onlinePayment(online, 5000).state;
assert.equal(online.saldo, 15000, "online limit cukup");

const rejectedLimit = onlinePayment(online, 6000);
assert.equal(rejectedLimit.ok, false, "online limit kurang ditolak");
assert.deepEqual(rejectedLimit.state, online, "penolakan limit tidak mengubah cache/saldo/limit");

online = onlinePayment(online, 5000).state;
assert.equal(online.used, 10000, "multi EDC memakai source of truth yang sama");
const rejectedSaldo = onlinePayment({ saldo: 1000, limit: 10000, used: 0 }, 2000);
assert.equal(rejectedSaldo.reason, "saldo", "saldo habis ditolak tanpa perubahan");

let offline = { saldo: 20000, limit: 10000, used: 10000, queue: [] };
offline = offlinePayment(offline, 6000, "trx-offline-1").state;
assert.equal(offline.saldo, 14000, "offline melebihi limit tetap boleh");
assert.deepEqual(offline.queue, ["trx-offline-1"], "offline queue tersimpan");
const offlineRejected = offlinePayment({ ...offline, saldo: 1000 }, 2000, "nope");
assert.equal(offlineRejected.reason, "saldo", "offline saldo kurang ditolak");
assert.deepEqual(offlineRejected.state.queue, offline.queue, "offline ditolak tidak mengubah queue");

let syncState = { processed: new Set(), pending: [] };
syncState = sync(syncState, "trx-offline-1");
syncState = sync(syncState, "trx-offline-1");
assert.equal(syncState.processed.size, 1, "duplicate transaction_id tidak double debit");
syncState = sync(syncState, "trx-retry", true);
assert.deepEqual(syncState.pending, ["trx-retry"], "upload gagal tetap pending");
syncState = sync(syncState, "trx-retry");
assert(syncState.processed.has("trx-retry"), "retry setelah reconnect berhasil");

const firmwareFiles = [
  "archive/firmware/EDC01/KasirRFID_V3.ino.source.txt",
  "archive/firmware/EDC02/KasirRFID_V3_Edc02.ino.source.txt",
];
for (const file of firmwareFiles) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  assert(!source.includes("OFFLINE LIMIT CHECK"), `${file}: tidak menghitung limit offline`);
  assert(!source.includes("getOfflinePaymentUsageToday"), `${file}: tidak membaca usage limit offline`);
  assert(source.includes('doc["offline_sync"] = true'), `${file}: queue ditandai offline sync`);
  assert(source.includes("Limit tidak aktif"), `${file}: status offline jelas`);
  assert(source.includes("Menyinkronkan transaksi..."), `${file}: status syncing jelas`);
  assert(source.includes("SYNC SUCCESS"), `${file}: status sync success jelas`);
  assert(source.includes("SYNC FAILED"), `${file}: status sync gagal jelas`);
  assert(source.includes("|| backendOffline"), `${file}: backend timeout masuk mode offline`);
  assert(source.includes("httpCode >= 200 && httpCode < 300"), `${file}: hanya HTTP 2xx dianggap sukses`);
  assert(source.includes("!successHttp && lastApiTransportError"), `${file}: HTTP error tidak dianggap offline`);
}

const paymentSource = fs.readFileSync(
  path.join(__dirname, "..", "controllers/rfidController.js"), "utf8",
);
assert(paymentSource.includes("pg_advisory_xact_lock"), "payment idempotent lintas retry");
assert(paymentSource.includes("if (!isOfflineSync && limit !== null)"), "limit wajib aktif online");

console.log("RFID online/offline stabilization matrix: PASS");
