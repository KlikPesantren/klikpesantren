const MAX_RUPIAH = 9223372036854775807n;

function digits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function canonicalRupiah(value) {
  const raw = digits(value).replace(/^0+(?=\d)/, "");
  if (!raw) return "";
  if (BigInt(raw) > MAX_RUPIAH) throw Error("INVALID_MONEY");
  return raw;
}

function formatRupiahInput(value) {
  const raw = canonicalRupiah(value);
  return raw ? raw.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "";
}

function cursorFromRight(formatted, digitsToRight) {
  if (!digitsToRight) return formatted.length;
  let seen = 0;
  for (let i = formatted.length - 1; i >= 0; i--) {
    if (/\d/.test(formatted[i]) && ++seen === digitsToRight)
      return formatted[i - 1] === "." ? i - 1 : i;
  }
  return 0;
}

function editRupiah(previousFormatted, nextText, previousSelection) {
  const cursor = Math.max(0, Math.min(previousFormatted.length, previousSelection?.end ?? previousFormatted.length));
  const digitsToRight = digits(previousFormatted.slice(cursor)).length;
  const value = canonicalRupiah(nextText);
  const formatted = formatRupiahInput(value);
  const position = cursorFromRight(formatted, Math.min(digitsToRight, value.length));
  return { value, formatted, selection: { start: position, end: position } };
}

module.exports = { MAX_RUPIAH, canonicalRupiah, formatRupiahInput, editRupiah };
