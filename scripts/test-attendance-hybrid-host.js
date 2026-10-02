const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {spawnSync} = require("node:child_process");
const root = path.join(__dirname, "..");
const compiler = process.env.CXX || "g++";
const include = process.env.ARDUINOJSON_INCLUDE || path.join(os.homedir(), "Documents/Arduino/libraries/ArduinoJson/src");
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "attendance-hybrid-host-"));
const output = path.join(outputDir, process.platform === "win32" ? "test.exe" : "test");
// Compile the actual sketch serializer, not a reimplementation of its format.
const sketch = fs.readFileSync(path.join(root, "AttendanceRFID_EDC01/AttendanceRFID_EDC01.ino"), "utf8");
const serializer = sketch.match(/String readRfidUid\(\) \{[\s\S]*?\n\}/)?.[0];
if (!serializer) throw new Error("RFID serializer missing");
const serializerHeader = path.join(outputDir, "uid-serializer.h");
fs.writeFileSync(serializerHeader, `#include "Arduino.h"
#include <cstdio>
using byte = uint8_t;
struct TestReader {
  struct { byte size = 4; byte uidByte[10] = {0x0a, 0xb1, 0x02, 0xff}; } uid;
  bool PICC_IsNewCardPresent() { return true; }
  bool PICC_ReadCardSerial() { return true; }
  void PICC_HaltA() {}
  void PCD_StopCrypto1() {}
} rfid;
${serializer}\n`);
const args = ["-std=c++17", "-Wno-deprecated-declarations", "-I", path.join(__dirname,"attendance-hybrid-host"),
  "-include", serializerHeader,
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
