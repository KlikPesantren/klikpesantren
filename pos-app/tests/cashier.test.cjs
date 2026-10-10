const test = require("node:test");
const { Buffer } = require("node:buffer");
const assert = require("node:assert/strict");
const {
  CheckoutCoordinator,
  totals,
  changeCart,
  normalizeCredential,
  TestCredentialReader,
  errorText,
  rupiah,
} = require("../src/domain.cjs");
const { createVault } = require("../src/vault.cjs");
const store = () => {
  const data = new Map();
  return {
    data,
    getItemAsync: async (k) => data.get(k) || null,
    setItemAsync: async (k, v) => data.set(k, v),
    deleteItemAsync: async (k) => data.delete(k),
  };
};
const body = {
  unit_id: 2,
  merchant_id: 1,
  terminal_id: 1,
  shift_id: "synthetic",
  items: [{ product_id: "test-product", quantity: 1 }],
  payment: { method: "RFID", credential: "test-only" },
};
test("interrupted secure write cannot submit and logout erases all staged secrets", async () => {
  const s = store(),
    nativeSet = s.setItemAsync;
  let count = 0;
  s.setItemAsync = async (k, v) => {
    if (++count === 3) throw Error("synthetic-keystore-failure");
    return nativeSet(k, v);
  };
  const vault = createVault(s);
  let submitted = 0;
  const f = new CheckoutCoordinator({
    vault,
    owner: "1:2",
    newId: () => "write-failure-only",
    api: async () => {
      submitted++;
    },
  });
  await assert.rejects(
    f.pay({
      ...body,
      items: Array.from({ length: 20 }, () => ({
        product_id: "synthetic".repeat(20),
        quantity: 1,
      })),
    }),
  );
  assert.equal(submitted, 0);
  await assert.rejects(vault.read("pending"), /VAULT_CORRUPT/);
  await vault.remove("pending");
  assert.equal(s.data.size, 0);
});
test("cart integers, quantity, unavailable, leading zeroes, large money", () => {
  const p = { id: "one", price: "9007199254740993", available: true };
  let c = changeCart([], p, 1);
  assert.equal(totals(c).total, p.price);
  assert.equal(rupiah(p.price), "Rp9.007.199.254.740.993");
  c = changeCart(c, p, -1);
  assert.equal(c.length, 0);
  assert.throws(() => changeCart([], { ...p, available: false }, 1));
  assert.throws(() => totals([{ ...p, quantity: 1 }], "9007199254740994"));
  assert.equal(normalizeCredential(" 0AB102FF "), "0ab102ff");
  assert.equal(
    errorText({ code: "INSUFFICIENT_BALANCE" }),
    "Saldo tidak cukup.",
  );
});
test("reader abstraction test adapter gated; no assumption about NFC", async () => {
  assert.equal(
    await new TestCredentialReader(async () => "0AB102FF", true).scan(),
    "0ab102ff",
  );
  await assert.rejects(
    new TestCredentialReader(async () => "test", false).scan(),
    /READER_UNAVAILABLE/,
  );
});
test("SecureStore chunks round-trip, corruption fail closed, logout erases", async () => {
  const s = store(),
    v = createVault(s),
    value = {
      token: "test-only",
      items: Array.from({ length: 100 }, () => ({
        name: "synthetic".repeat(10),
      })),
    };
  await v.write("session", value);
  assert.deepEqual(await v.read("session"), value);
  for (const x of s.data.values()) assert.ok(Buffer.byteLength(x) < 2048);
  await v.remove("session");
  assert.equal(s.data.size, 0);
  await v.write("pending", value);
  s.data.delete("kp.pos.pending.0");
  await assert.rejects(v.read("pending"), /VAULT_CORRUPT/);
});
test("persist before submit, immutable payload, double tap blocked, original success", async () => {
  const v = createVault(store());
  let release,
    calls = 0;
  const gate = new Promise((r) => {
    release = r;
  });
  const f = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => "stable-test-id",
    api: async (_p, opts) => {
      calls++;
      assert.deepEqual((await v.read("pending")).body, opts.body);
      await gate;
      return { sale: { grand_total: "10" }, payment: { status: "CONFIRMED" } };
    },
  });
  const source = structuredClone(body),
    pending = f.pay(source);
  await new Promise((r) => setImmediate(r));
  await assert.rejects(f.pay(source), /PROCESSING/);
  source.items[0].quantity = 9;
  release();
  await pending;
  assert.equal(calls, 1);
  assert.equal(f.state, "SUCCESS");
  assert.equal(await v.read("pending"), null);
});
test("timeout after commit -> restart -> lookup returns original, no second charge", async () => {
  const v = createVault(store());
  let debits = 0;
  const result = {
    sale: { id: "test-sale" },
    payment: { status: "CONFIRMED" },
  };
  const f = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => "stable-test-id",
    api: async () => {
      debits++;
      throw Object.assign(Error("timeout"), { code: "NETWORK" });
    },
  });
  await assert.rejects(f.pay(body));
  assert.equal(f.state, "UNKNOWN");
  assert.equal(f.pending.body.request_id, "stable-test-id");
  const g = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => {
      throw Error("must not generate");
    },
    api: async (path) => {
      assert.equal(path, "/pos/mobile/request-status");
      return { found: true, ...result };
    },
  });
  await g.restore();
  await g.recover();
  assert.equal(g.state, "SUCCESS");
  assert.equal(debits, 1);
});
test("not-found retry uses exactly same persisted ID + payload; auth never false declined", async () => {
  const v = createVault(store()),
    sent = [];
  let fail = true;
  const api = async (path, opts) => {
    if (path.endsWith("request-status")) return { found: false };
    sent.push(structuredClone(opts.body));
    if (fail) throw Object.assign(Error("session"), { status: 401 });
    return { payment: { status: "PENDING" } };
  };
  const f = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => "stable-test-id",
    api,
  });
  await assert.rejects(f.pay(body));
  assert.equal(f.state, "UNKNOWN");
  fail = false;
  await f.recover();
  assert.equal(f.state, "PENDING");
  assert.deepEqual(sent[0], sent[1]);
});
test("pending cannot be resumed by another account; financial 400 explicit decline", async () => {
  const v = createVault(store());
  await v.write("pending", { owner: "1:2", body });
  const f = new CheckoutCoordinator({
    vault: v,
    owner: "2:2",
    newId: () => "",
    api: async () => {},
  });
  await assert.rejects(f.restore(), /PENDING_OWNER_MISMATCH/);
  await v.remove("pending");
  const g = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => "stable-test-id",
    api: async () => {
      throw Object.assign(Error("tender"), {
        status: 400,
        code: "INSUFFICIENT_TENDER",
      });
    },
  });
  await assert.rejects(g.pay(body));
  assert.equal(g.state, "DECLINED");
  assert.equal(await v.read("pending"), null);
});
test("refund timeout/restart repeats original request and preserves PENDING", async () => {
  const v = createVault(store()),
    sent = [];
  let fail = true;
  const api = async (path, opts) => {
    assert.equal(path, "/pos/refunds");
    sent.push(opts.body);
    if (fail) throw Error("network");
    return { id: "refund", status: "PENDING" };
  };
  const f = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => "refund-stable-test",
    api,
  });
  await assert.rejects(f.pay({ amount: "20" }, "/pos/refunds"));
  fail = false;
  const g = new CheckoutCoordinator({
    vault: v,
    owner: "1:2",
    newId: () => {
      throw Error("new key");
    },
    api,
  });
  await g.restore();
  await g.recover();
  assert.deepEqual(sent[0], sent[1]);
  assert.equal(g.state, "PENDING");
});
