const test = require("node:test");
const assert = require("node:assert/strict");
const {
  paymentBlock,
  cashShortcuts,
  refundSummary,
  correctionBlock,
  STATUS_LABELS,
} = require("../src/workflow.cjs");
const { productImageUrl } = require("../../utils/posProductImage");
const base = {
  online: true,
  shift: { id: "synthetic-shift" },
  cart: [{ id: "synthetic-product", price: "12500", quantity: 2 }],
  discount: "0",
  method: "CASH",
  tender: "25000",
  canDiscount: true,
};
test("cash blocks insufficient, offline, no shift and duplicate processing; exact integer change shortcuts", () => {
  assert.equal(paymentBlock(base), null);
  for (const [override, code] of [
    [{ tender: "24999" }, "INSUFFICIENT_TENDER"],
    [{ online: false }, "NETWORK"],
    [{ shift: null }, "SHIFT_NOT_OPEN"],
    [{ busy: true }, "PROCESSING"],
    [{ pending: true }, "PROCESSING"],
  ])
    assert.equal(paymentBlock({ ...base, ...override }), code);
  assert.deepEqual(cashShortcuts("25001"), [
    "25001",
    "30000",
    "50000",
    "100000",
  ]);
  assert.equal(cashShortcuts("9007199254740993")[0], "9007199254740993");
});
test("discount permission and mandatory reason; QRIS pending is not paid", () => {
  assert.equal(
    paymentBlock({ ...base, discount: "1000", canDiscount: false }),
    "INVALID_DISCOUNT",
  );
  assert.equal(
    paymentBlock({ ...base, discount: "1000", discountReason: "ok" }),
    "INVALID_DISCOUNT",
  );
  assert.equal(
    paymentBlock({ ...base, discount: "1000", discountReason: "test only" }),
    null,
  );
  assert.equal(
    paymentBlock({ ...base, method: "TRANSFER_QRIS", confirmed: false }),
    null,
  );
  assert.equal(
    paymentBlock({
      ...base,
      method: "TRANSFER_QRIS",
      confirmed: true,
      reference: "",
    }),
    "INVALID_TEXT",
  );
  assert.equal(
    paymentBlock({
      ...base,
      method: "TRANSFER_QRIS",
      confirmed: true,
      reference: "synthetic-reference",
    }),
    null,
  );
  assert.notEqual(STATUS_LABELS.PENDING, STATUS_LABELS.PAID);
});
test("RFID requires online credential and exact preview, blocks insufficient balance", () => {
  const r = {
    ...base,
    method: "RFID",
    credentialReady: true,
    walletPreview: { current_balance: "30000", projected_balance: "5000" },
  };
  assert.equal(paymentBlock(r), null);
  assert.equal(
    paymentBlock({ ...r, credentialReady: false }),
    "READER_UNAVAILABLE",
  );
  assert.equal(
    paymentBlock({
      ...r,
      walletPreview: { current_balance: "24000", projected_balance: "0" },
    }),
    "INSUFFICIENT_BALANCE",
  );
  assert.equal(
    paymentBlock({
      ...r,
      walletPreview: { current_balance: "30000", projected_balance: "6000" },
    }),
    "READER_UNAVAILABLE",
  );
  assert.equal(paymentBlock({ ...r, online: false }), "NETWORK");
});
test("refund reservations prevent over-refund; corrections require permissions, reason and original open shift", () => {
  const detail = {
    sale: { status: "PAID", shift_id: "synthetic-shift" },
    payment: { amount: "25000", status: "CONFIRMED", method: "CASH" },
    refunds: [
      { amount: "5000", status: "CONFIRMED" },
      { amount: "3000", status: "PENDING" },
    ],
  };
  assert.deepEqual(refundSummary(detail), {
    original: "25000",
    reserved: "8000",
    confirmed: "5000",
    remaining: "17000",
  });
  const r = {
    detail,
    kind: "refund",
    amount: "17000",
    reason: "test only",
    canRefund: true,
    online: true,
    shift: base.shift,
  };
  assert.equal(correctionBlock(r), null);
  assert.equal(correctionBlock({ ...r, amount: "17001" }), "OVER_REFUND");
  assert.equal(
    correctionBlock({ ...r, canRefund: false }),
    "PERMISSION_DENIED",
  );
  assert.equal(correctionBlock({ ...r, shift: null }), "SHIFT_NOT_OPEN");
  assert.equal(correctionBlock({ ...r, reason: "" }), "INVALID_TEXT");
  const draft = {
    sale: { status: "DRAFT", shift_id: "other-shift" },
    payment: { method: "TRANSFER_QRIS" },
  };
  assert.equal(
    correctionBlock({ ...r, detail: draft, kind: "void", canSell: true }),
    "SHIFT_NOT_OPEN",
  );
});
test("optional images accept public HTTPS, reject credentials/private targets and signed query secrets", () => {
  assert.equal(productImageUrl(""), null);
  assert.equal(productImageUrl(null), null);
  assert.equal(
    productImageUrl(
      "https://res.cloudinary.com/synthetic/image/upload/item.png",
    ),
    "https://res.cloudinary.com/synthetic/image/upload/item.png",
  );
  for (const value of [
    "http://example.com/a",
    "https://localhost/a",
    "https://127.0.0.1/a",
    "https://user:password@example.com/a",
    "https://example.com/a?token=synthetic",
    "https://example.com/a#private",
  ])
    assert.throws(() => productImageUrl(value), {
      code: "INVALID_PRODUCT_IMAGE",
    });
});
