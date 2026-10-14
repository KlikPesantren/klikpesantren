const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalRupiah, formatRupiahInput, editRupiah } = require("../src/rupiahInput.cjs");

test("Rupiah display and payload preserve exact integer value", () => {
  assert.equal(formatRupiahInput("50000"), "50.000");
  assert.equal(canonicalRupiah("Rp 50.000"), "50000");
  assert.equal(formatRupiahInput("00050000"), "50.000");
});

test("separator, backspace and paste edits remain canonical and cursor-safe", () => {
  assert.deepEqual(editRupiah("50.000", "5.000", { start: 2, end: 2 }), {
    value: "5000", formatted: "5.000", selection: { start: 1, end: 1 },
  });
  const pasted = editRupiah("12.000", "12.345.678", { start: 6, end: 6 });
  assert.equal(pasted.value, "12345678");
  assert.equal(pasted.formatted, "12.345.678");
  assert.equal(pasted.selection.end, pasted.formatted.length);
});

test("invalidly large Rupiah fails closed", () => {
  assert.throws(() => canonicalRupiah("9223372036854775808"), /INVALID_MONEY/);
});
