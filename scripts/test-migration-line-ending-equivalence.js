const assert = require("node:assert/strict");
const { checksum, checksumMatches } = require("../utils/migrationLedger");

const lf = "BEGIN;\nSELECT 1;\nCOMMIT;\n";
const crlf = lf.replace(/\n/g, "\r\n");

assert(checksumMatches(lf, checksum(lf)));
assert(checksumMatches(crlf, checksum(lf)));
assert(checksumMatches(lf, checksum(crlf)));
assert(!checksumMatches("SELECT 2;\n", checksum(lf)));

console.log("PASS migration checksum treats CRLF/LF as equivalent without hiding content drift");
