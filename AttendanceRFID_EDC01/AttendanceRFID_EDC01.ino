#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <SPI.h>
#include <MFRC522.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <Keypad.h>
#include <Preferences.h>
#include <time.h>

#define RFID_SS_PIN 5
#define RFID_RST_PIN 4
#define BUZZER_PIN 2

const char* NVS_NAMESPACE = "offline";
const unsigned long WIFI_CONNECT_TIMEOUT_MS = 12000;
const unsigned long WIFI_RETRY_BACKOFF_MS = 5000;
const unsigned long NTP_RETRY_INTERVAL_MS = 30000;
const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
const unsigned long RFID_DEBOUNCE_MS = 800;
const unsigned long FEEDBACK_DURATION_MS = 3000;
const unsigned long UNKNOWN_UID_DIRECT_DURATION_MS = 6000;
const unsigned long UNKNOWN_UID_PAGE_DURATION_MS = 3000;
const size_t UNKNOWN_UID_DIRECT_LENGTH = 12;
const size_t UNKNOWN_UID_PAGE_CHARS = 12;
const int ATTENDANCE_HTTP_TIMEOUT_MS = 6000;
const int HEARTBEAT_HTTP_TIMEOUT_MS = 4000;
const time_t MIN_VALID_EPOCH = 1704067200;

const char KLIKPESANTREN_ROOT_CA[] PROGMEM = R"EOF(
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD
VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG
A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw
WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz
IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi
AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi
QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR
HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW
BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8
p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
)EOF";

enum class RuntimeState {
  BOOT,
  LOAD_CONFIG,
  WIFI_CONNECTING,
  TIME_SYNC,
  READY,
  CARD_READ,
  SENDING,
  RESULT
};

enum class FeedbackTone {
  SUCCESS,
  INFO,
  ERROR
};

struct HttpResult {
  bool transportOk;
  int status;
  String body;
};

Preferences prefs;
MFRC522 rfid(RFID_SS_PIN, RFID_RST_PIN);
LiquidCrystal_I2C lcd(0x27, 16, 2);

const byte ROWS = 4;
const byte COLS = 4;
char keys[ROWS][COLS] = {
  { '1', '2', '3', 'A' },
  { '4', '5', '6', 'B' },
  { '7', '8', '9', 'C' },
  { '*', '0', '#', 'D' }
};
byte rowPins[ROWS] = { 13, 14, 27, 26 };
byte colPins[COLS] = { 25, 33, 32, 15 };
Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

String wifiSsid;
String wifiPassword;
String apiBaseUrl;
String tenantSlug;
String deviceId;
String deviceSecret;
String deviceMode;
String hardwareProfile;

RuntimeState runtimeState = RuntimeState::BOOT;
bool configDirty = true;
bool runtimeConfigReady = false;
bool wifiAttemptActive = false;
unsigned long wifiAttemptStartedAt = 0;
unsigned long nextWifiAttemptAt = 0;
unsigned long lastNtpRequestAt = 0;
bool ntpRequested = false;
unsigned long lastHeartbeatAt = 0;
unsigned long lastRfidReadAt = 0;

String pendingUid;
String pendingCapturedAt;
String pendingEventId;
String pendingRequestBody;

bool feedbackActive = false;
unsigned long feedbackStartedAt = 0;
unsigned long feedbackDurationMs = FEEDBACK_DURATION_MS;

bool attendanceUnknownUidActive = false;
String attendanceUnknownUid;
size_t attendanceUnknownUidPage = 0;
size_t attendanceUnknownUidPageCount = 0;
size_t attendanceUnknownUidStep = 0;
unsigned long attendanceUnknownUidPageStartedAt = 0;

String lastLcdLine1;
String lastLcdLine2;

String fitLcd(const String& value) {
  if (value.length() <= 16) return value;
  return value.substring(0, 16);
}

void showScreen(const String& line1, const String& line2) {
  String nextLine1 = fitLcd(line1);
  String nextLine2 = fitLcd(line2);
  if (nextLine1 == lastLcdLine1 && nextLine2 == lastLcdLine2) return;
  lastLcdLine1 = nextLine1;
  lastLcdLine2 = nextLine2;
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print(nextLine1);
  lcd.setCursor(0, 1);
  lcd.print(nextLine2);
}

void playTone(FeedbackTone tone) {
  int frequency = 1500;
  int duration = 120;
  if (tone == FeedbackTone::SUCCESS) {
    frequency = 2200;
    duration = 180;
  } else if (tone == FeedbackTone::ERROR) {
    frequency = 700;
    duration = 300;
  }
  ::tone(BUZZER_PIN, frequency, duration);
}

void transitionTo(RuntimeState next) {
  runtimeState = next;
}

bool isAttendanceMode() {
  return deviceMode == "ATTENDANCE";
}

bool isEdc01Profile() {
  return hardwareProfile == "EDC01";
}

void refreshRuntimeConfigReady() {
  wifiSsid.trim();
  apiBaseUrl.trim();
  tenantSlug.trim();
  deviceId.trim();
  deviceMode.trim();
  hardwareProfile.trim();
  deviceMode.toUpperCase();
  hardwareProfile.toUpperCase();
  while (apiBaseUrl.endsWith("/")) {
    apiBaseUrl.remove(apiBaseUrl.length() - 1);
  }
  runtimeConfigReady =
    wifiSsid.length() > 0 &&
    wifiPassword.length() > 0 &&
    apiBaseUrl.startsWith("https://") &&
    tenantSlug.length() > 0 &&
    deviceId.length() > 0 &&
    deviceSecret.length() > 0 &&
    isAttendanceMode() &&
    isEdc01Profile();
}

void loadRuntimeConfig() {
  wifiSsid = prefs.getString("wifi_ssid", "");
  wifiPassword = prefs.getString("wifi_password", "");
  apiBaseUrl = prefs.getString("api_base_url", "");
  tenantSlug = prefs.getString("tenant_slug", "");
  deviceId = prefs.getString("device_id", "");
  deviceSecret = prefs.getString("device_secret", "");
  deviceMode = prefs.getString("device_mode", "");
  hardwareProfile = prefs.getString("hw_profile", "");
  refreshRuntimeConfigReady();
}

void printPresence(const char* field, bool present) {
  Serial.print(field);
  Serial.print(": ");
  Serial.println(present ? "SET" : "MISSING");
}

void printRuntimeConfigStatus() {
  Serial.println("CONFIG STATUS");
  printPresence("wifi_ssid", wifiSsid.length() > 0);
  printPresence("wifi_password", wifiPassword.length() > 0);
  printPresence("api_base_url", apiBaseUrl.startsWith("https://"));
  printPresence("tenant_slug", tenantSlug.length() > 0);
  printPresence("device_id", deviceId.length() > 0);
  printPresence("device_secret", deviceSecret.length() > 0);
  printPresence("device_mode", isAttendanceMode());
  printPresence("hardware_profile", isEdc01Profile());
  Serial.println(runtimeConfigReady ? "CONFIG READY" : "CONFIG INCOMPLETE");
}

bool storeProvisionedField(const String& field, String value) {
  value.trim();
  if (value.length() == 0) return false;

  size_t bytesWritten = 0;
  if (field == "wifi_ssid") {
    bytesWritten = prefs.putString("wifi_ssid", value);
  } else if (field == "wifi_password") {
    bytesWritten = prefs.putString("wifi_password", value);
  } else if (field == "api_base_url") {
    if (!value.startsWith("https://")) return false;
    while (value.endsWith("/")) value.remove(value.length() - 1);
    bytesWritten = prefs.putString("api_base_url", value);
  } else if (field == "tenant_slug") {
    bytesWritten = prefs.putString("tenant_slug", value);
  } else if (field == "device_id") {
    bytesWritten = prefs.putString("device_id", value);
  } else if (field == "device_secret") {
    bytesWritten = prefs.putString("device_secret", value);
  } else if (field == "device_mode") {
    value.toUpperCase();
    if (value != "ATTENDANCE") return false;
    bytesWritten = prefs.putString("device_mode", value);
  } else if (field == "hardware_profile") {
    value.toUpperCase();
    if (value != "EDC01") return false;
    bytesWritten = prefs.putString("hw_profile", value);
  } else {
    return false;
  }

  if (bytesWritten == 0) return false;
  configDirty = true;
  return true;
}

void showProvisioningRequired() {
  showScreen("CONFIG BELUM", "LENGKAP");
}

void showReady() {
  showScreen("SIAP ABSENSI", "TEMPELKAN KARTU");
}

void handleSerialProvisioning() {
  if (!Serial.available()) return;

  String command = Serial.readStringUntil('\n');
  command.trim();
  if (command == "SHOW") {
    printRuntimeConfigStatus();
    return;
  }
  if (command == "HELP") {
    Serial.println("SET <field> <value>");
    Serial.println("Fields: wifi_ssid, wifi_password, api_base_url,");
    Serial.println("tenant_slug, device_id, device_secret, device_mode,");
    Serial.println("hardware_profile. Values are never echoed.");
    return;
  }
  if (!command.startsWith("SET ")) {
    Serial.println("PROVISION COMMAND REJECTED");
    return;
  }

  String remainder = command.substring(4);
  int separator = remainder.indexOf(' ');
  if (separator <= 0) {
    Serial.println("PROVISION COMMAND REJECTED");
    return;
  }

  String field = remainder.substring(0, separator);
  String value = remainder.substring(separator + 1);
  bool wifiChanged = field == "wifi_ssid" || field == "wifi_password";
  if (!storeProvisionedField(field, value)) {
    Serial.println("CONFIG FIELD REJECTED");
    return;
  }

  Serial.println("CONFIG FIELD SAVED");
  if (wifiChanged) {
    WiFi.disconnect(false, false);
    wifiAttemptActive = false;
    nextWifiAttemptAt = millis() + 500;
  }
  transitionTo(RuntimeState::LOAD_CONFIG);
}

bool attendanceClockValid() {
  time_t now;
  time(&now);
  return now >= MIN_VALID_EPOCH;
}

bool formatCapturedAtUtc(String& capturedAt) {
  if (!attendanceClockValid()) return false;
  time_t now;
  time(&now);
  struct tm utcTime;
  if (gmtime_r(&now, &utcTime) == nullptr) return false;
  char timestamp[21];
  if (strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utcTime) == 0) {
    return false;
  }
  capturedAt = String(timestamp);
  return true;
}

void beginWifiAttempt() {
  if (wifiAttemptActive || millis() < nextWifiAttemptAt) return;
  Serial.println("WiFi connecting");
  showScreen("MENGHUBUNGKAN", "WIFI");
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());
  wifiAttemptStartedAt = millis();
  wifiAttemptActive = true;
}

void updateWifiConnecting() {
  if (!runtimeConfigReady) {
    showProvisioningRequired();
    return;
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiAttemptActive = false;
    ntpRequested = false;
    transitionTo(RuntimeState::TIME_SYNC);
    return;
  }

  if (!wifiAttemptActive) {
    beginWifiAttempt();
    return;
  }

  if (millis() - wifiAttemptStartedAt < WIFI_CONNECT_TIMEOUT_MS) return;

  WiFi.disconnect(false, false);
  wifiAttemptActive = false;
  nextWifiAttemptAt = millis() + WIFI_RETRY_BACKOFF_MS;
  showScreen("WIFI GAGAL", "COBA KEMBALI");
}

void updateTimeSync() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiAttemptActive = false;
    nextWifiAttemptAt = millis() + 500;
    transitionTo(RuntimeState::WIFI_CONNECTING);
    return;
  }

  if (attendanceClockValid()) {
    showReady();
    transitionTo(RuntimeState::READY);
    return;
  }

  showScreen("SINKRON WAKTU", "MOHON TUNGGU");
  if (!ntpRequested || millis() - lastNtpRequestAt >= NTP_RETRY_INTERVAL_MS) {
    configTime(0, 0, "pool.ntp.org", "time.google.com");
    ntpRequested = true;
    lastNtpRequestAt = millis();
  }
}

String readRfidUid() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return "";

  String uid;
  uid.reserve(rfid.uid.size * 2);
  char byteText[3];
  for (byte index = 0; index < rfid.uid.size; index++) {
    snprintf(byteText, sizeof(byteText), "%02X", rfid.uid.uidByte[index]);
    uid += byteText;
  }

  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  return uid;
}

bool createDurableAttendanceEventId(String& eventId) {
  uint64_t current = prefs.getULong64("att_counter", 0);
  if (current == UINT64_MAX) return false;

  uint64_t next = current + 1;
  if (prefs.putULong64("att_counter", next) == 0) return false;

  char counterText[24];
  snprintf(counterText, sizeof(counterText), "%llu", static_cast<unsigned long long>(next));
  eventId = deviceId + "-attendance-" + String(counterText);
  return eventId.length() <= 160;
}

HttpResult postAuthenticatedJson(
  const String& endpoint,
  const String& body,
  int timeoutMs
) {
  HttpResult result = { false, -1, "" };
  if (WiFi.status() != WL_CONNECTED || !runtimeConfigReady) return result;

  WiFiClientSecure client;
  client.setCACert(KLIKPESANTREN_ROOT_CA);
  client.setTimeout(timeoutMs);

  HTTPClient http;
  String url = apiBaseUrl + endpoint;
  if (!http.begin(client, url)) return result;

  http.setConnectTimeout(timeoutMs);
  http.setTimeout(timeoutMs);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", deviceId);
  http.addHeader("X-Device-Secret", deviceSecret);
  http.addHeader("X-Tenant-Slug", tenantSlug);

  int status = http.POST(body);
  result.status = status;
  result.transportOk = status >= 0;
  if (result.transportOk) {
    result.body = http.getString();
  }
  http.end();
  return result;
}

void sendHeartbeatIfDue() {
  if (
    runtimeState != RuntimeState::READY ||
    WiFi.status() != WL_CONNECTED ||
    millis() - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS
  ) {
    return;
  }

  lastHeartbeatAt = millis();
  HttpResult result = postAuthenticatedJson(
    "/rfid/device/heartbeat",
    "{}",
    HEARTBEAT_HTTP_TIMEOUT_MS
  );
  if (!result.transportOk) {
    Serial.println("Heartbeat transport failed");
  } else {
    Serial.print("Heartbeat HTTP: ");
    Serial.println(result.status);
  }
}

void showAttendanceFeedback(
  const String& line1,
  const String& line2,
  FeedbackTone tone,
  unsigned long durationMs = FEEDBACK_DURATION_MS
) {
  attendanceUnknownUidActive = false;
  feedbackActive = true;
  feedbackStartedAt = millis();
  feedbackDurationMs = durationMs;
  showScreen(line1, line2);
  playTone(tone);
}

void renderUnknownUidStep() {
  if (attendanceUnknownUid.length() <= UNKNOWN_UID_DIRECT_LENGTH) {
    showScreen("UID:" + attendanceUnknownUid, "BELUM TERDAFTAR");
    return;
  }

  size_t pageSteps = attendanceUnknownUidPageCount * 2;
  if (attendanceUnknownUidStep >= pageSteps) {
    showScreen("BELUM TERDAFTAR", "CATAT UID");
    return;
  }

  attendanceUnknownUidPage =
    attendanceUnknownUidStep % attendanceUnknownUidPageCount;
  size_t start = attendanceUnknownUidPage * UNKNOWN_UID_PAGE_CHARS;
  String page = attendanceUnknownUid.substring(
    start,
    start + UNKNOWN_UID_PAGE_CHARS
  );
  String label = "UID " + String(attendanceUnknownUidPage + 1)
    + "/" + String(attendanceUnknownUidPageCount);
  showScreen(label, page);
}

void showUnknownCredentialFeedback(const String& scannedUid) {
  feedbackActive = true;
  feedbackStartedAt = millis();
  playTone(FeedbackTone::ERROR);

  attendanceUnknownUid = scannedUid;
  attendanceUnknownUidPage = 0;
  attendanceUnknownUidStep = 0;
  attendanceUnknownUidPageCount =
    (attendanceUnknownUid.length() + UNKNOWN_UID_PAGE_CHARS - 1)
    / UNKNOWN_UID_PAGE_CHARS;
  attendanceUnknownUidActive =
    attendanceUnknownUid.length() > UNKNOWN_UID_DIRECT_LENGTH;
  feedbackDurationMs = attendanceUnknownUidActive
    ? UNKNOWN_UID_PAGE_DURATION_MS
    : UNKNOWN_UID_DIRECT_DURATION_MS;
  attendanceUnknownUidPageStartedAt = millis();
  renderUnknownUidStep();
}

bool updateResultFeedback() {
  if (!feedbackActive) return true;

  if (!attendanceUnknownUidActive) {
    if (millis() - feedbackStartedAt < feedbackDurationMs) return false;
    feedbackActive = false;
    return true;
  }

  if (millis() - attendanceUnknownUidPageStartedAt < UNKNOWN_UID_PAGE_DURATION_MS) {
    return false;
  }

  attendanceUnknownUidPageStartedAt = millis();
  attendanceUnknownUidStep++;
  size_t finalStep = attendanceUnknownUidPageCount * 2;
  if (attendanceUnknownUidStep <= finalStep) {
    renderUnknownUidStep();
    return false;
  }

  attendanceUnknownUidActive = false;
  attendanceUnknownUid = "";
  feedbackActive = false;
  return true;
}

void handleAttendanceResponse(
  const HttpResult& result,
  const String& requestCapturedAt,
  const String& scannedUid
) {
  (void)requestCapturedAt;
  if (!result.transportOk) {
    showAttendanceFeedback("KONEKSI GAGAL", "COBA LAGI", FeedbackTone::ERROR);
    return;
  }
  if (result.status >= 500) {
    showAttendanceFeedback("SERVER ERROR", "COBA LAGI", FeedbackTone::ERROR);
    return;
  }

  DynamicJsonDocument response(1024);
  DeserializationError error = deserializeJson(response, result.body);
  if (error) {
    if (result.status == 401) {
      showAttendanceFeedback("AKSES DITOLAK", "CEK DEVICE", FeedbackTone::ERROR);
    } else if (result.status == 403) {
      showAttendanceFeedback("CONFIG ERROR", "CEK FITUR", FeedbackTone::ERROR);
    } else {
      showAttendanceFeedback("RESPONS INVALID", "COBA LAGI", FeedbackTone::ERROR);
    }
    return;
  }

  String code = response["code"].as<String>();
  if (code == "ATTENDANCE_RECORDED") {
    showAttendanceFeedback("ABSENSI", "BERHASIL", FeedbackTone::SUCCESS);
  } else if (code == "ALREADY_ATTENDED") {
    showAttendanceFeedback("SUDAH ABSEN", "", FeedbackTone::INFO);
  } else if (code == "UNKNOWN_CREDENTIAL") {
    showUnknownCredentialFeedback(scannedUid);
  } else if (code == "NO_ACTIVE_SESSION") {
    showAttendanceFeedback("TIDAK ADA SESI", "", FeedbackTone::ERROR);
  } else if (code == "NOT_ELIGIBLE") {
    showAttendanceFeedback("TIDAK TERDAFTAR", "DI SESI", FeedbackTone::ERROR);
  } else if (code == "STATUS_PROTECTED") {
    showAttendanceFeedback("STATUS DIKUNCI", "", FeedbackTone::INFO);
  } else if (code == "AMBIGUOUS_CREDENTIAL") {
    showAttendanceFeedback("UID KONFLIK", "", FeedbackTone::ERROR);
  } else if (code == "AMBIGUOUS_SESSION") {
    showAttendanceFeedback("SESI KONFLIK", "", FeedbackTone::ERROR);
  } else if (code == "EVENT_TOO_OLD") {
    showAttendanceFeedback("DATA KADALUARSA", "", FeedbackTone::ERROR);
  } else if (code == "INVALID_EVENT_TIME") {
    showAttendanceFeedback("WAKTU TIDAK", "VALID", FeedbackTone::ERROR);
  } else if (code == "EVENT_ID_CONFLICT") {
    showAttendanceFeedback("EVENT KONFLIK", "", FeedbackTone::ERROR);
  } else if (code == "FEATURE_DISABLED") {
    showAttendanceFeedback("FITUR NONAKTIF", "", FeedbackTone::ERROR);
  } else if (
    code == "DEVICE_AUTH_INVALID" ||
    code == "DEVICE_CREDENTIALS_REQUIRED"
  ) {
    showAttendanceFeedback("AKSES DITOLAK", "CEK DEVICE", FeedbackTone::ERROR);
  } else if (
    code == "DEVICE_DISABLED" ||
    code == "DEVICE_TENANT_INVALID" ||
    code == "DEVICE_MERCHANT_INVALID"
  ) {
    showAttendanceFeedback("CONFIG ERROR", "HUBUNGI ADMIN", FeedbackTone::ERROR);
  } else if (result.status == 401) {
    showAttendanceFeedback("AKSES DITOLAK", "CEK DEVICE", FeedbackTone::ERROR);
  } else if (result.status == 403) {
    showAttendanceFeedback("CONFIG ERROR", "CEK FITUR", FeedbackTone::ERROR);
  } else if (result.status >= 400) {
    showAttendanceFeedback("REQUEST DITOLAK", "CEK KONFIG", FeedbackTone::ERROR);
  } else {
    showAttendanceFeedback("SERVER ERROR", "COBA LAGI", FeedbackTone::ERROR);
  }
}

void prepareAttendanceRequest() {
  if (WiFi.status() != WL_CONNECTED) {
    showAttendanceFeedback("KONEKSI GAGAL", "COBA LAGI", FeedbackTone::ERROR);
    transitionTo(RuntimeState::RESULT);
    return;
  }
  if (!formatCapturedAtUtc(pendingCapturedAt)) {
    showAttendanceFeedback("WAKTU BELUM", "TERSINKRON", FeedbackTone::ERROR);
    transitionTo(RuntimeState::RESULT);
    return;
  }
  if (!createDurableAttendanceEventId(pendingEventId)) {
    showAttendanceFeedback("EVENT ID", "GAGAL", FeedbackTone::ERROR);
    transitionTo(RuntimeState::RESULT);
    return;
  }

  StaticJsonDocument<384> request;
  request["event_id"] = pendingEventId;
  request["credential_type"] = "rfid";
  request["credential"] = pendingUid;
  request["captured_at"] = pendingCapturedAt;
  pendingRequestBody = "";
  serializeJson(request, pendingRequestBody);
  transitionTo(RuntimeState::SENDING);
}

void sendPendingAttendance() {
  showScreen("MENGIRIM", "ABSENSI");
  HttpResult result = postAuthenticatedJson(
    "/attendance/events",
    pendingRequestBody,
    ATTENDANCE_HTTP_TIMEOUT_MS
  );
  Serial.print("Attendance HTTP: ");
  Serial.println(result.status);
  handleAttendanceResponse(result, pendingCapturedAt, pendingUid);

  pendingRequestBody = "";
  pendingEventId = "";
  pendingCapturedAt = "";
  pendingUid = "";
  transitionTo(RuntimeState::RESULT);
}

void updateReady() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiAttemptActive = false;
    nextWifiAttemptAt = millis() + 500;
    transitionTo(RuntimeState::WIFI_CONNECTING);
    return;
  }
  if (!attendanceClockValid()) {
    ntpRequested = false;
    transitionTo(RuntimeState::TIME_SYNC);
    return;
  }

  sendHeartbeatIfDue();
  if (millis() - lastRfidReadAt < RFID_DEBOUNCE_MS) return;

  String uid = readRfidUid();
  if (uid.length() == 0) return;

  lastRfidReadAt = millis();
  pendingUid = uid;
  showScreen("KARTU DIBACA", "MEMPROSES");
  transitionTo(RuntimeState::CARD_READ);
}

void processRuntimeState() {
  switch (runtimeState) {
    case RuntimeState::BOOT:
      showScreen("KLIKPESANTREN", "BOOT");
      transitionTo(RuntimeState::LOAD_CONFIG);
      break;

    case RuntimeState::LOAD_CONFIG:
      if (!configDirty) break;
      configDirty = false;
      loadRuntimeConfig();
      printRuntimeConfigStatus();
      if (!runtimeConfigReady) {
        showProvisioningRequired();
        break;
      }
      if (WiFi.status() == WL_CONNECTED) {
        ntpRequested = false;
        transitionTo(RuntimeState::TIME_SYNC);
      } else {
        wifiAttemptActive = false;
        nextWifiAttemptAt = millis();
        transitionTo(RuntimeState::WIFI_CONNECTING);
      }
      break;

    case RuntimeState::WIFI_CONNECTING:
      updateWifiConnecting();
      break;

    case RuntimeState::TIME_SYNC:
      updateTimeSync();
      break;

    case RuntimeState::READY:
      updateReady();
      break;

    case RuntimeState::CARD_READ:
      prepareAttendanceRequest();
      break;

    case RuntimeState::SENDING:
      sendPendingAttendance();
      break;

    case RuntimeState::RESULT:
      if (updateResultFeedback()) {
        showReady();
        transitionTo(RuntimeState::READY);
      }
      break;
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(100);

  prefs.begin(NVS_NAMESPACE, false);

  pinMode(BUZZER_PIN, OUTPUT);
  SPI.begin();
  rfid.PCD_Init();
  Wire.begin();
  lcd.init();
  lcd.backlight();

  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);

  runtimeState = RuntimeState::BOOT;
}

void loop() {
  handleSerialProvisioning();
  processRuntimeState();
  delay(1);
}
