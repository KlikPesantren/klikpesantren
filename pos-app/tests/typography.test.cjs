const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("operational app loads the four approved Plus Jakarta Sans weights before render", () => {
  const app = read("App.js");
  for (const weight of ["400Regular", "500Medium", "600SemiBold", "700Bold"])
    assert.match(app, new RegExp(`PlusJakartaSans_${weight}`, "g"));
  assert.match(app, /if \(!fontsLoaded\)/);
});

test("native typography is centralized and rejects visually heavy 800/900 weights", () => {
  const typography = read("src/typography.js");
  const ui = read("src/ui.js");
  assert.match(typography, /AppText/);
  assert.match(typography, /tabular-nums/);
  assert.doesNotMatch(ui, /fontWeight:\s*["''](?:800|900)["'']/);
});

test("operational screens use the centralized text renderer", () => {
  for (const file of ["src/MerchantBusinessApp.jsx", "src/ReviewMerchantApp.jsx"])
    assert.match(read(file), /AppText as Text/);
});
