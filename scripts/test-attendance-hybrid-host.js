const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const root = path.join(__dirname, "..");
const compiler = process.env.CXX || "g++";
const include = process.env.ARDUINOJSON_INCLUDE || path.join(os.homedir(), "Documents/Arduino/libraries/ArduinoJson/src");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "attendance-hybrid-host-"));
const output = path.join(outputDir, process.platform === "win32" ? "test.exe" : "test");
const args = ["-std=c++17", "-Wno-deprecated-declarations", "-I", path.join(__dirname,"attendance-hybrid-host"),
  "-I", path.join(root,"AttendanceRFID_EDC01"), "-I", include,
  path.join(__dirname,"attendance-hybrid-host/test.cpp"), "-o", output];
try {
  const build = spawnSync(compiler, args, {stdio:"inherit"});
  if (build.error) throw build.error;
  if (build.status !== 0) throw new Error("Hybrid host compile failed");
  const run = spawnSync(output, [], {stdio:"inherit"});
  if (run.error) throw run.error;
  if (run.status !== 0) throw new Error("Hybrid host behavior regression failed");
} catch (error) { console.error(error.message); process.exitCode=1; }
finally { fs.rmSync(outputDir, {recursive:true,force:true}); }
