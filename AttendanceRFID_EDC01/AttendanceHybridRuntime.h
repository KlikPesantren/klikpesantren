#pragma once
#include <ArduinoJson.h>
#include "AttendanceHybridStore.h"
#include "AttendanceHybridPolicy.h"
#include <esp_partition.h>

inline bool mountAttendanceStorage() {
  if (LittleFS.begin(false)) return true;
  // First-use initialization is allowed ONLY for a completely erased partition.
  // Never auto-format existing/corrupt data or payment files.
  const esp_partition_t* partition = esp_partition_find_first(ESP_PARTITION_TYPE_DATA,
    ESP_PARTITION_SUBTYPE_DATA_SPIFFS, "spiffs");
  if (!partition) return false;
  uint8_t buffer[256];
  for (size_t offset = 0; offset < partition->size; offset += sizeof(buffer)) {
    size_t length = min(sizeof(buffer), static_cast<size_t>(partition->size) - offset);
    if (esp_partition_read(partition, offset, buffer, length) != ESP_OK) return false;
    for (size_t i = 0; i < length; i++) if (buffer[i] != 0xff) return false;
  }
  return LittleFS.format() && LittleFS.begin(false);
}

const size_t ATTENDANCE_CACHE_BYTES = 24 * 1024;
const size_t ATTENDANCE_QUEUE_BYTES = 32 * 1024;
const size_t ATTENDANCE_QUEUE_ITEMS = 96;

class AttendanceHybridRuntime {
 public:
  AttendanceHybridRuntime(Preferences& prefs)
    : cacheStore(prefs, "att_cache_slot", "/att_cache_a", "/att_cache_b", ATTENDANCE_CACHE_BYTES + 65),
      queueStore(prefs, "att_queue_slot", "/att_queue_a", "/att_queue_b", ATTENDANCE_QUEUE_BYTES),
      cache(64 * 1024), queue(48 * 1024) {}
  bool healthy = false;
  bool hasCache = false;
  String context;
  String version;
  DynamicJsonDocument cache;
  DynamicJsonDocument queue;

  void load(const String& scope) {
    context = AttendanceDualSlotStore::sha256(scope);
    cache.clear(); queue.clear(); hasCache = false; version = "";
    healthy = mountAttendanceStorage();
    if (!healthy) return;
    String raw;
    if (cacheStore.load(raw)) {
      if (raw.substring(0, 64) == context && raw[64] == '\n') {
        String snapshot = raw.substring(65);
        if (validSnapshot(snapshot)) {
          deserializeJson(cache, snapshot);
          version = AttendanceDualSlotStore::sha256(snapshot); hasCache = true;
        }
      }
    }
    raw = "";
    if (queueStore.exists()) {
      // Fail closed on corrupt active slot or context mismatch; do not erase/fallback.
      healthy = queueStore.load(raw, false) && !deserializeJson(queue, raw) && validQueue();
    } else {
      queue["format"] = 1; queue["context"] = context;
      queue.createNestedArray("events");
      healthy = persistQueue();
    }
  }

  bool validSnapshot(const String& raw) {
    if (raw.length() == 0 || raw.length() > ATTENDANCE_CACHE_BYTES) return false;
    DynamicJsonDocument candidate(64 * 1024);
    if (deserializeJson(candidate, raw) || candidate["schema_version"] != 1 ||
        !candidate["authorized_unit_id"].is<int>() || candidate["authorized_unit_id"].as<int>() <= 0 ||
        !candidate["timezone"].is<const char*>() || !candidate["sessions"].is<JsonArray>() ||
        !candidate["windows"].is<JsonArray>() || !candidate["credentials"].is<JsonArray>()) return false;
    int64_t generated = candidate["generated_epoch"].as<int64_t>();
    if (!attendanceCacheFresh(true, generated, generated, candidate["valid_until_epoch"].as<int64_t>()) ||
        candidate["refresh_after_epoch"].as<int64_t>() <= generated ||
        candidate["credentials"].size() > 200 || candidate["windows"].size() > 128 ||
        candidate["sessions"].size() > 16 || candidate["timezone"].as<String>().length() == 0) return false;
    for (JsonObject c : candidate["credentials"].as<JsonArray>()) {
      String uid = c["value"].as<String>();
      if (c["type"] != "rfid" || c["person_type"] != "santri" || uid.length() < 1 || uid.length() > 200 ||
          !c["eligible"].is<bool>() || (c["status"] != "valid" && c["status"] != "ambiguous")) return false;
    }
    for (JsonObject w : candidate["windows"].as<JsonArray>()) {
      if (!w["key"].is<const char*>() || w["start_epoch"].as<int64_t>() <= 0 ||
          w["end_epoch"].as<int64_t>() <= w["start_epoch"].as<int64_t>() ||
          (w["state"] != "active" && w["state"] != "cancelled" && w["state"] != "closed")) return false;
    }
    return true;
  }
  bool installCache(const String& raw, const String& checksum) {
    if (!healthy || AttendanceDualSlotStore::sha256(raw) != checksum || !validSnapshot(raw)) return false;
    String persisted = context + "\n" + raw;
    if (!cacheStore.save(persisted)) return false;
    cache.clear();
    if (deserializeJson(cache, raw)) { hasCache = false; return false; }
    hasCache = true; version = checksum; return true;
  }
  bool fresh(bool trusted, int64_t now) const {
    return hasCache && attendanceCacheFresh(trusted, now,
      cache["generated_epoch"].as<int64_t>(), cache["valid_until_epoch"].as<int64_t>());
  }
  bool refreshDue(int64_t now) const {
    return !hasCache || now >= cache["refresh_after_epoch"].as<int64_t>();
  }
  String validate(const String& uid, bool trusted, int64_t now, String& occurrence) {
    if (!trusted) return "TIME_INVALID";
    if (!hasCache) return "NO_CACHE";
    if (!fresh(trusted, now)) return "STALE_CACHE";
    bool found = false;
    for (JsonObject c : cache["credentials"].as<JsonArray>()) {
      if (c["value"].as<String>() != uid) continue;
      found = true;
      if (c["status"] != "valid") return "AMBIGUOUS_CREDENTIAL";
      if (!c["eligible"].as<bool>()) return "NOT_ELIGIBLE";
      break;
    }
    if (!found) return "UNKNOWN_CREDENTIAL";
    unsigned matches = 0;
    for (JsonObject w : cache["windows"].as<JsonArray>()) {
      if (attendanceWindowActive(now, w["start_epoch"].as<int64_t>(), w["end_epoch"].as<int64_t>(), w["state"])) {
        occurrence = w["key"].as<String>(); matches++;
      }
    }
    if (matches == 0) return "NO_ACTIVE_SESSION";
    if (matches > 1) return "AMBIGUOUS_SESSION";
    for (JsonObject e : queue["events"].as<JsonArray>()) {
      if (e["occurrence"].as<String>() == occurrence && e["request"]["credential"].as<String>() == uid)
        return "LOCAL_DUPLICATE";
    }
    return "VALID";
  }
  bool append(const String& body, const String& occurrence, int64_t epoch) {
    if (!healthy) return false;
    // Retain successful receipts through their occurrence window for duplicate prevention.
    // Pending and quarantined events are never pruned.
    JsonArray events = queue["events"].as<JsonArray>();
    for (int i = events.size() - 1; i >= 0; --i) {
      if (events[i]["state"] == "reconciled" && epoch >= events[i]["dedupe_until"].as<int64_t>())
        events.remove(i);
    }
    if (events.size() >= ATTENDANCE_QUEUE_ITEMS) return false;
    DynamicJsonDocument request(768);
    if (deserializeJson(request, body)) return false;
    JsonObject e = events.createNestedObject();
    e["request"] = request.as<JsonObject>(); e["occurrence"] = occurrence;
    e["epoch"] = epoch; e["state"] = "pending";
    e["dedupe_until"] = epoch + 604800;
    for (JsonObject w : cache["windows"].as<JsonArray>()) {
      if (w["key"].as<String>() == occurrence) { e["dedupe_until"] = w["end_epoch"]; break; }
    }
    if (persistQueue()) return true;
    events.remove(events.size() - 1); return false;
  }
  int oldestPending() const {
    int selected = -1; int64_t oldest = INT64_MAX;
    JsonArrayConst events = queue["events"].as<JsonArrayConst>();
    for (size_t i = 0; i < events.size(); i++) {
      if (events[i]["state"] == "pending" && events[i]["epoch"].as<int64_t>() < oldest) {
        selected = i; oldest = events[i]["epoch"].as<int64_t>();
      }
    }
    return selected;
  }
  unsigned count(const char* state) const {
    unsigned result = 0;
    for (JsonObjectConst e : queue["events"].as<JsonArrayConst>()) if (e["state"] == state) result++;
    return result;
  }
  String replayBody(int index) {
    String body; serializeJson(queue["events"][index]["request"], body); return body;
  }
  String eventId(int index) { return queue["events"][index]["request"]["event_id"].as<String>(); }
  bool finish(const String& eventId, const char* state, const String& code) {
    int index = -1;
    for (size_t i = 0; i < queue["events"].size(); i++) {
      if (queue["events"][i]["request"]["event_id"].as<String>() == eventId) { index = i; break; }
    }
    if (!healthy || index < 0 || index >= static_cast<int>(queue["events"].size())) return false;
    String previous = queue["events"][index]["state"].as<String>();
    queue["events"][index]["state"] = state; queue["events"][index]["outcome"] = code;
    if (persistQueue()) return true;
    queue["events"][index]["state"] = previous; queue["events"][index].remove("outcome"); return false;
  }
 private:
  AttendanceDualSlotStore cacheStore;
  AttendanceDualSlotStore queueStore;
  bool persistQueue() {
    String raw; serializeJson(queue, raw);
    return !queue.overflowed() && raw.length() <= ATTENDANCE_QUEUE_BYTES && queueStore.save(raw);
  }
  bool validQueue() {
    if (queue["format"] != 1 || queue["context"].as<String>() != context ||
        !queue["events"].is<JsonArray>() || queue["events"].size() > ATTENDANCE_QUEUE_ITEMS) return false;
    for (JsonObject e : queue["events"].as<JsonArray>()) {
      JsonObject r = e["request"];
      if (r.size() != 4 || !r["event_id"].is<const char*>() || !r["credential"].is<const char*>() ||
          r["credential_type"] != "rfid" || !r["captured_at"].is<const char*>() ||
          !e["occurrence"].is<const char*>() || e["epoch"].as<int64_t>() <= 0 ||
          e["dedupe_until"].as<int64_t>() <= e["epoch"].as<int64_t>() ||
          (e["state"] != "pending" && e["state"] != "quarantined" && e["state"] != "reconciled")) return false;
    }
    return true;
  }
};
