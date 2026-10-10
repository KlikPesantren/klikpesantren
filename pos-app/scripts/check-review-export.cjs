const fs = require("node:fs");
const { Buffer } = require("node:buffer");
const path = require("node:path");
const roots = process.argv.slice(2);
if (!roots.length) throw Error("Provide production export directories");
const forbidden = [
  "POS_VISUAL_FIXTURE_ONLY",
  "REVIEW-ONLY-0001",
  "local-visual-review-only",
  "REVIEW_WRITE_DISABLED",
  "Santri Demo — Sintetis",
];
let bundles = 0;
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) inspect(file);
    else if (/\.(js|hbc)$/.test(file)) {
      bundles++;
      const content = fs.readFileSync(file);
      for (const marker of forbidden)
        if (content.includes(Buffer.from(marker)))
          throw Error("Development fixture present in production export");
    }
  }
}
for (const root of roots) inspect(root);
if (bundles < roots.length) throw Error("Missing production bundles");
console.log(
  `PASS ${bundles} production bundles exclude review fixture and synthetic session`,
);
