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
const sketch = fs.readFileSync(path.join(root, "firmware/Absensi_RFID/Absensi_RFID.ino"), "utf8");
const serializer = sketch.match(/String readRfidUid\(\) \{[\s\S]*?\n\}/)?.[0];
if (!serializer) throw new Error("RFID serializer missing");
const serializerHeader = path.join(outputDir, "uid-serializer.h");
const tapHandler = sketch.match(/void queuePendingTap\(\) \{[\s\S]*?\n\}/)?.[0];
if (!tapHandler) throw new Error("Local-first tap handler missing");
fs.writeFileSync(path.join(outputDir, "tap-handler.h"), `
Preferences foregroundPrefs;
AttendanceHybridRuntime foreground(foregroundPrefs);
bool attendanceAccessBlocked = false, hostTrusted = true, hostReady = false;
bool networkBusy = true; // Simulated delayed/unavailable network for ALL foreground taps.
int64_t hostNow = 1800000000;
String pendingUid, pendingRequestBody, pendingCapturedAt, hostLine1, hostLine2;
enum class FeedbackTone { SUCCESS, INFO, ERROR };
struct HttpResult { bool transportOk; int status; String body; };
bool attendanceClockValid() { return hostTrusted; }
void showAttendanceFeedback(const String& a,const String& b,FeedbackTone) { hostLine1=a; hostLine2=b; }
void clearPendingTap() { hostReady=true; }
void handleAttendanceResponse(const HttpResult& r,const String&,const String&) {
  JsonDocument d; deserializeJson(d,r.body); hostLine2=d["code"].as<String>();
}
#define hybrid foreground
#define time(x) hostNow
${tapHandler}
#undef time
#undef hybrid
`);
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
  "-include", serializerHeader, "-I", outputDir,
  "-I", path.join(root,"firmware/Absensi_RFID"), "-I", include,
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
