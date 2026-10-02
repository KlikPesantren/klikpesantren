#include "Arduino.h"
#include <ArduinoJson.h>
namespace ArduinoJson {
template <> struct Converter<String> {
  static void toJson(const String& src, JsonVariant dst) { dst.set(std::string(src)); }
  static String fromJson(JsonVariantConst src) { return String(src.as<std::string>()); }
  static bool checkJson(JsonVariantConst src) { return src.is<std::string>(); }
};
}
#include "AttendanceHybridRuntime.h"
#include "tap-handler.h"
#include <cassert>
#include <iostream>
#include <chrono>
#include <vector>
#include <algorithm>

const int64_t NOW = 1800000000;
String snapshot() {
  JsonDocument d;
  d["schema_version"] = 1; d["authorized_unit_id"] = 2; d["timezone"] = "Asia/Jakarta";
  d["generated_epoch"] = NOW; d["refresh_after_epoch"] = NOW + 900; d["valid_until_epoch"] = NOW + 604800;
  d["sessions"].to<JsonArray>();
  auto w = d["windows"].to<JsonArray>().add<JsonObject>();
  w["key"] = "session:date"; w["start_epoch"] = NOW - 60; w["end_epoch"] = NOW + 3600; w["state"] = "active";
  auto c = d["credentials"].to<JsonArray>().add<JsonObject>();
  c["type"] = "rfid"; c["person_type"] = "santri"; c["value"] = "TEST-CARD"; c["status"] = "valid"; c["eligible"] = true;
  std::string raw; serializeJson(d, raw); return raw;
}
String request(const char* id) {
  JsonDocument d; d["event_id"] = id; d["credential_type"] = "rfid";
  d["credential"] = "TEST-CARD"; d["captured_at"] = "2027-01-15T08:00:00Z";
  std::string raw; serializeJson(d, raw); return raw;
}
void reset() { hostFs = HostFs(); hostPartitionErased = false; }
int main() {
  // Synthetic bytes prove case, leading-zero and byte-order compatibility.
  const String canonicalUid = readRfidUid();
  assert(canonicalUid == "0ab102ff");
  reset(); foreground.load("foreground-test");
  JsonDocument foregroundCache; deserializeJson(foregroundCache, snapshot());
  foregroundCache["credentials"].to<JsonArray>();
  for (int i=0;i<100;i++) {
    char uid[9]; snprintf(uid,sizeof(uid),"%08x",i);
    auto c=foregroundCache["credentials"].as<JsonArray>().add<JsonObject>();
    c["type"]="rfid"; c["person_type"]="santri"; c["value"]=uid;
    c["status"]="valid"; c["eligible"]=true; c["display_name"]="PESERTA UJI";
  }
  std::string foregroundSnapshot; serializeJson(foregroundCache,foregroundSnapshot);
  assert(foreground.installCache(foregroundSnapshot,AttendanceDualSlotStore::sha256(foregroundSnapshot)));
  std::vector<double> foregroundMs;
  for(int i=0;i<100;i++) {
    char uid[9]; snprintf(uid,sizeof(uid),"%08x",i); pendingUid=uid;
    JsonDocument body; deserializeJson(body,request(std::to_string(i).c_str())); body["credential"]=pendingUid;
    std::string rawBody; serializeJson(body,rawBody); pendingRequestBody=rawBody;
    hostReady=false;
    auto started=std::chrono::steady_clock::now(); queuePendingTap();
    foregroundMs.push_back(std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-started).count());
    assert(hostReady && networkBusy && hostLine1=="PESERTA UJI" && hostLine2=="BERHASIL");
    assert(foreground.count("pending")==static_cast<unsigned>(i+1));
  }
  AttendanceHybridRuntime foregroundReboot(foregroundPrefs); foregroundReboot.load("foreground-test");
  assert(foregroundReboot.healthy && foregroundReboot.count("pending")==100);
  std::sort(foregroundMs.begin(),foregroundMs.end());
  std::cout << "HOST actual queuePendingTap handler, mocked flash/LCD/network: 100 cards median_ms="
    << foregroundMs[50] << " p95_ms=" << foregroundMs[94] << " network_busy=true next_ready=100/100 pending=100\n";
  pendingUid="00000000"; hostLine2=""; queuePendingTap(); assert(hostLine2=="SUDAH ABSEN");
  hostTrusted=false; queuePendingTap(); assert(hostLine2=="BUTUH INTERNET"); hostTrusted=true;
  pendingUid="00000100";
  foreground.cache["credentials"][0]["value"]=pendingUid;
  hostFs.shortWrite=true; hostLine2=""; queuePendingTap();
  assert(hostLine2!="BERHASIL" && foreground.count("pending")==100); hostFs.shortWrite=false;
  reset(); Preferences uidPrefs; AttendanceHybridRuntime uidRuntime(uidPrefs); uidRuntime.load("uid-test");
  JsonDocument uidCache; deserializeJson(uidCache, snapshot());
  uidCache["credentials"][0]["value"] = canonicalUid;
  std::string uidSnapshot; serializeJson(uidCache, uidSnapshot);
  assert(uidRuntime.installCache(uidSnapshot, AttendanceDualSlotStore::sha256(uidSnapshot)));
  String uidOccurrence;
  assert(uidRuntime.validate(canonicalUid, true, NOW, uidOccurrence) == "VALID");
  assert(uidRuntime.validate("0AB102FF", true, NOW, uidOccurrence) == "VALID");
  assert(canonicalAttendanceUid(" 0AB102FF ") == canonicalUid);
  assert(canonicalAttendanceUid("TEST-CARD") == "TEST-CARD");
  JsonDocument uidRequest; deserializeJson(uidRequest, request("uid-event"));
  uidRequest["credential"] = canonicalUid;
  std::string uidBody; serializeJson(uidRequest, uidBody);
  assert(uidRuntime.append(uidBody, "session:date", NOW));
  AttendanceHybridRuntime uidReboot(uidPrefs); uidReboot.load("uid-test");
  JsonDocument replay; deserializeJson(replay, uidReboot.replayBody(uidReboot.oldestPending()));
  assert(replay["credential"].as<String>() == canonicalUid);
  reset(); Preferences p; AttendanceHybridRuntime h(p); h.load("scope-a"); assert(h.healthy);
  String raw = snapshot(), key;
  assert(h.validate("TEST-CARD", false, NOW, key) == "TIME_INVALID");
  assert(h.validate("TEST-CARD", true, NOW, key) == "NO_CACHE");
  assert(!h.installCache(raw, "wrong-checksum"));
  assert(h.installCache(raw, AttendanceDualSlotStore::sha256(raw)));
  assert(!h.validSnapshot("{}"));
  hostFs.shortWrite = true;
  assert(!h.installCache(raw, AttendanceDualSlotStore::sha256(raw)));
  hostFs.shortWrite = false;
  AttendanceHybridRuntime cachedAfterFailure(p); cachedAfterFailure.load("scope-a");
  assert(cachedAfterFailure.hasCache && cachedAfterFailure.fresh(true, NOW));
  assert(h.validate("TEST-CARD", true, NOW, key) == "VALID");
  assert(h.validate("NOT-A-CARD", true, NOW, key) == "UNKNOWN_CREDENTIAL");
  assert(h.validate("TEST-CARD", true, NOW + 604801, key) == "STALE_CACHE");
  h.cache["windows"][0]["state"] = "cancelled";
  assert(h.validate("TEST-CARD", true, NOW, key) == "NO_ACTIVE_SESSION");
  h.cache["windows"][0]["state"] = "closed";
  assert(h.validate("TEST-CARD", true, NOW, key) == "NO_ACTIVE_SESSION");
  h.cache["windows"][0]["state"] = "active";
  h.cache["credentials"][0]["eligible"] = false;
  assert(h.validate("TEST-CARD", true, NOW, key) == "NOT_ELIGIBLE");
  h.cache["credentials"][0]["eligible"] = true;
  auto w = h.cache["windows"].as<JsonArray>().add<JsonObject>();
  w["key"] = "second"; w["start_epoch"] = NOW - 60; w["end_epoch"] = NOW + 60; w["state"] = "active";
  assert(h.validate("TEST-CARD", true, NOW, key) == "AMBIGUOUS_SESSION");
  h.cache["windows"].as<JsonArray>().remove(1);
  assert(h.append(request("one"), "session:date", NOW));
  assert(h.validate("TEST-CARD", true, NOW, key) == "LOCAL_DUPLICATE");
  AttendanceHybridRuntime reboot(p); reboot.load("scope-a");
  assert(reboot.hasCache && reboot.healthy && reboot.count("pending") == 1);
  assert(reboot.validate("TEST-CARD", false, NOW, key) == "TIME_INVALID");
  assert(reboot.replayBody(reboot.oldestPending()) == request("one"));
  assert(attendanceReplayDisposition(false, -1, "") == ReplayDisposition::RETRY);
  assert(reboot.count("pending") == 1); // Failed replay preserves the original durable event.
  hostFs.shortWrite = true;
  assert(!reboot.append(request("failed-write"), "other", NOW + 1));
  hostFs.shortWrite = false;
  AttendanceHybridRuntime afterFailure(p); afterFailure.load("scope-a");
  assert(afterFailure.count("pending") == 1);
  p.failPointer = true;
  assert(!afterFailure.append(request("failed-pointer"), "other", NOW + 1));
  p.failPointer = false;
  AttendanceHybridRuntime afterPointer(p); afterPointer.load("scope-a");
  assert(afterPointer.count("pending") == 1);
  assert(afterPointer.finish("one", "reconciled", "STATUS_PROTECTED"));
  assert(afterPointer.count("pending") == 0);
  assert(afterPointer.validate("TEST-CARD", true, NOW, key) == "LOCAL_DUPLICATE");
  assert(afterPointer.append(request("rejected"), "other", NOW + 10));
  p.failPointer = true;
  assert(!afterPointer.finish("rejected", "quarantined", "EVENT_ID_CONFLICT"));
  p.failPointer = false;
  assert(afterPointer.count("pending") == 1);
  assert(afterPointer.finish("rejected", "quarantined", "EVENT_ID_CONFLICT"));
  assert(afterPointer.oldestPending() == -1 && afterPointer.count("quarantined") == 1);
  assert(!afterPointer.finish("nonexistent-event", "reconciled", "ATTENDANCE_RECORDED"));
  assert(afterPointer.append(request("late"), "other", NOW + 3601));
  assert(afterPointer.count("reconciled") == 0); // Only expired confirmed receipt is removed.
  assert(afterPointer.count("quarantined") == 1);
  assert(afterPointer.append(request("older"), "older-occurrence", NOW + 100));
  assert(afterPointer.eventId(afterPointer.oldestPending()) == "older");
  AttendanceHybridRuntime otherScope(p); otherScope.load("scope-b"); assert(!otherScope.healthy && !otherScope.hasCache);
  String active = p.getString("att_queue_slot", "a");
  hostFs.files[active == "a" ? "/att_queue_a" : "/att_queue_b"] += "corrupt";
  AttendanceHybridRuntime corrupt(p); corrupt.load("scope-a"); assert(!corrupt.healthy);
  reset(); Preferences fullPrefs; AttendanceHybridRuntime full(fullPrefs); full.load("full");
  std::vector<double> durableMs;
  auto totalStart = std::chrono::steady_clock::now();
  for (unsigned i = 0; i < 100; i++) {
    auto started = std::chrono::steady_clock::now();
    assert(full.append(request(std::to_string(i).c_str()), "different", NOW + i));
    durableMs.push_back(std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now()-started).count());
  }
  double totalMs = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now()-totalStart).count();
  assert(full.count("pending") == 100);
  AttendanceHybridRuntime hundredReboot(fullPrefs); hundredReboot.load("full");
  assert(hundredReboot.healthy && hundredReboot.count("pending") == 100);
  std::sort(durableMs.begin(), durableMs.end());
  std::cout << "HOST in-memory filesystem ONLY (not ESP32 flash/LCD timings): 100 durable appends median_ms="
    << durableMs[50] << " p95_ms=" << durableMs[94] << " total_ms=" << totalMs << " pending=100 capacity=" << ATTENDANCE_QUEUE_ITEMS << "\n";
  for (unsigned i = 100; i < ATTENDANCE_QUEUE_ITEMS; i++) assert(full.append(request(std::to_string(i).c_str()), "different", NOW + i));
  assert(!full.append(request("overflow"), "different", NOW + 100));
  assert(full.count("pending") == ATTENDANCE_QUEUE_ITEMS);
  assert(full.append(request("never"), "different", NOW + 700000) == false); // Never prune unsynced old items.
  reset(); hostFs.mounted = false; Preferences corruptFs;
  AttendanceHybridRuntime fsFailure(corruptFs); fsFailure.load("scope");
  assert(!fsFailure.healthy && hostFs.formats == 0);
  hostPartitionErased = true; fsFailure.load("scope"); assert(fsFailure.healthy && hostFs.formats == 1);
  assert(attendanceReplayDisposition(false, -1, "") == ReplayDisposition::RETRY);
  assert(attendanceReplayDisposition(true, 500, "SERVER_ERROR") == ReplayDisposition::RETRY);
  assert(attendanceReplayDisposition(true, 429, "RATE_LIMITED") == ReplayDisposition::RETRY);
  for (auto code : {"ATTENDANCE_RECORDED", "ALREADY_ATTENDED", "STATUS_PROTECTED"})
    assert(attendanceReplayDisposition(true, 200, code) == ReplayDisposition::RECONCILED);
  for (auto code : {"EVENT_TOO_OLD", "EVENT_ID_CONFLICT", "UNKNOWN_CREDENTIAL", "NOT_ELIGIBLE", "NO_ACTIVE_SESSION"})
    assert(attendanceReplayDisposition(true, 409, code) == ReplayDisposition::QUARANTINE);
  assert(attendanceReplayDisposition(true, 403, "FEATURE_DISABLED") == ReplayDisposition::ACCESS_BLOCKED);
  assert(attendanceReplayDisposition(true, 401, "DEVICE_AUTH_INVALID") == ReplayDisposition::ACCESS_BLOCKED);
  assert(!attendanceWindowActive(NOW + 3600, NOW, NOW + 3600, "active"));
  std::cout << "PASS executable hybrid firmware: cache/time/eligibility/duplicate/reboot/write-failure/corruption/full/replay/isolation\n";
}
