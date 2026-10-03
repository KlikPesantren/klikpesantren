#include <LittleFS.h>
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
#include "AttendancePrototypeTypes.h"

#define SS_PIN 5
#define RST_PIN 4
#define BUZZER 2

Preferences prefs;

bool syncInProgress = false;
bool backendOffline = false;
bool lastApiTransportError = false;

const bool DEBUG = true;
const unsigned long HEARTBEAT_INTERVAL_MS = 30000;
const unsigned long SYNC_INTERVAL_MS = 15000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const int API_TIMEOUT_MS = 15000;
const int HEARTBEAT_TIMEOUT_MS = 8000;
const int AUDIT_TIMEOUT_MS = 8000;

const unsigned long NTP_RETRY_INTERVAL_MS = 60000;
const unsigned long ATTENDANCE_FEEDBACK_DURATION_MS = 2500;
const unsigned long UNKNOWN_UID_PAGE_DURATION_MS = 3000;
const size_t UNKNOWN_UID_DIRECT_LENGTH = 12;
const size_t UNKNOWN_UID_PAGE_CHARS = 7;
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


// =====================
// STATE
// =====================

enum State {

  STANDBY,

  CHECK_SALDO,

  TOPUP_RESULT,

  WAIT_ADMIN_OVERRIDE,

  WAIT_ADMIN,

  WAIT_SANTRI,

  SHOW_PAYMENT,

  SHOW_TOPUP,

  INPUT_PAYMENT,

  INPUT_TOPUP,

  PROCESSING,

  RESULT,

};

// GLOBAL ==========
bool wifiWasConnected =
  false;

bool auditSent =
  false;

State currentState =
  STANDBY;

String currentTransactionId = "";

String currentUID = "";

String adminUID = "";

String currentName = "";

int currentSaldo = 0;

int currentLimitHarian = -1;

int currentPemakaianHariIni = 0;

int currentSisaLimitHariIni = -1;

String nominalInput = "";

bool isTopup = false;

bool processing = false;

bool overrideLimit =
  false;

String lastLine1 = "";
String lastLine2 = "";

unsigned long lastLCDUpdate = 0;

unsigned long lastRFIDRead = 0;

unsigned long displayTimer = 0;

unsigned long lastPing = 0;

unsigned long lastSync = 0;

bool wifiDisconnectedShown =
  false;

int idleDots = 0;

unsigned long lastIdleAnim = 0;

unsigned long lastKeypadPress = 0;

unsigned long stateTimer = 0;

unsigned long resultTimer = 0;

int resultDuration = 0;






String resultMessage1 = "";
String resultMessage2 = "";


String ADMIN_UID_1 = "";
String ADMIN_UID_2 = "";

// Runtime configuration is provisioned into ESP32 Preferences/NVS.
String ssid = "";
String password = "";
String SERVER_URL = "";
String TENANT_SLUG = "";
String DEVICE_ID = "";
String DEVICE_SECRET = "";
String DEVICE_MODE = "";
String HARDWARE_PROFILE = "";

bool runtimeConfigReady = false;
bool ntpConfigured = false;
unsigned long lastNtpAttempt = 0;
bool attendanceFeedbackActive = false;
unsigned long attendanceFeedbackStartedAt = 0;
bool attendanceUnknownUidActive = false;
String attendanceUnknownUid = "";
size_t attendanceUnknownUidPage = 0;
size_t attendanceUnknownUidPageCount = 0;
unsigned long attendanceUnknownUidPageStartedAt = 0;

// =====================
// RFID
// =====================

MFRC522 rfid(
  SS_PIN,
  RST_PIN);

// =====================
// LCD
// =====================

LiquidCrystal_I2C lcd(
  0x27,
  16,
  2);

// =====================
// KEYPAD
// =====================

const byte ROWS = 4;
const byte COLS = 4;

char keys[ROWS][COLS] = {

  { '1', '2', '3', 'A' },

  { '4', '5', '6', 'B' },

  { '7', '8', '9', 'C' },

  { '*', '0', '#', 'D' }

};

byte rowPins[ROWS] = {
  13, 14, 27, 26
};

byte colPins[COLS] = {
  25, 33, 32, 15
};

Keypad keypad = Keypad(

  makeKeymap(keys),

  rowPins,

  colPins,

  ROWS,

  COLS

);

// =====================
// BEEP
// =====================

void beep(int duration) {

  tone(

    BUZZER,

    2000,

    duration

  );
}

bool isSupportedHardwareProfile() {
  return HARDWARE_PROFILE == "EDC01" || HARDWARE_PROFILE == "EDC02";
}

bool isAttendanceMode() {
  return DEVICE_MODE == "ATTENDANCE";
}

void applyHardwareProfile() {
  const char edc01Keys[ROWS][COLS] = {
    { '1', '2', '3', 'A' },
    { '4', '5', '6', 'B' },
    { '7', '8', '9', 'C' },
    { '*', '0', '#', 'D' }
  };
  const char edc02Keys[ROWS][COLS] = {
    { 'D', 'C', 'B', 'A' },
    { '#', '9', '6', '3' },
    { '0', '8', '5', '2' },
    { '*', '7', '4', '1' }
  };
  const char (*selected)[COLS] = HARDWARE_PROFILE == "EDC02"
    ? edc02Keys
    : edc01Keys;
  for (byte row = 0; row < ROWS; row++) {
    for (byte column = 0; column < COLS; column++) {
      keys[row][column] = selected[row][column];
    }
  }
}

void refreshRuntimeConfigReady() {
  DEVICE_MODE.trim();
  DEVICE_MODE.toUpperCase();
  HARDWARE_PROFILE.trim();
  HARDWARE_PROFILE.toUpperCase();
  SERVER_URL.trim();
  while (SERVER_URL.endsWith("/")) {
    SERVER_URL.remove(SERVER_URL.length() - 1);
  }
  runtimeConfigReady =
    ssid.length() > 0 &&
    password.length() > 0 &&
    SERVER_URL.startsWith("https://") &&
    TENANT_SLUG.length() > 0 &&
    DEVICE_ID.length() > 0 &&
    DEVICE_SECRET.length() > 0 &&
    isAttendanceMode() &&
    isSupportedHardwareProfile();
  applyHardwareProfile();
}

void loadRuntimeConfig() {
  ssid = prefs.getString("wifi_ssid", "");
  password = prefs.getString("wifi_password", "");
  SERVER_URL = prefs.getString("api_base_url", "");
  TENANT_SLUG = prefs.getString("tenant_slug", "");
  DEVICE_ID = prefs.getString("device_id", "");
  DEVICE_SECRET = prefs.getString("device_secret", "");
  DEVICE_MODE = prefs.getString("device_mode", "");
  HARDWARE_PROFILE = prefs.getString("hw_profile", "");
  refreshRuntimeConfigReady();
}

void printPresence(const char* field, bool present) {
  Serial.print(field);
  Serial.print(": ");
  Serial.println(present ? "SET" : "MISSING");
}

void printRuntimeConfigStatus() {
  Serial.println("CONFIG STATUS");
  printPresence("wifi_ssid", ssid.length() > 0);
  printPresence("wifi_password", password.length() > 0);
  printPresence("api_base_url", SERVER_URL.startsWith("https://"));
  printPresence("tenant_slug", TENANT_SLUG.length() > 0);
  printPresence("device_id", DEVICE_ID.length() > 0);
  printPresence("device_secret", DEVICE_SECRET.length() > 0);
  printPresence("device_mode", isAttendanceMode());
  printPresence("hardware_profile", isSupportedHardwareProfile());
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
    if (value != "EDC01" && value != "EDC02") return false;
    bytesWritten = prefs.putString("hw_profile", value);
  } else {
    return false;
  }

  if (bytesWritten == 0) return false;
  loadRuntimeConfig();
  return true;
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
  if (storeProvisionedField(field, value)) {
    Serial.println("CONFIG FIELD SAVED");
    if (field == "wifi_ssid" || field == "wifi_password") {
      WiFi.disconnect();
      wifiWasConnected = false;
    }
    if (runtimeConfigReady) {
      showAttendanceStandby();
    } else {
      showProvisioningRequired();
    }
  } else {
    Serial.println("CONFIG FIELD REJECTED");
  }
}

// LCD ===============

String rupiah(int value) {

  String str =
    String(value);

  String result = "";

  int count = 0;

  for (

    int i =
      str.length() - 1;

    i >= 0;

    i--

  ) {

    result =
      str[i] + result;

    count++;

    if (

      count % 3 == 0

      &&

      i != 0

    ) {

      result =
        "." + result;
    }
  }

  return result;
}

void printLine(

  int row,
  String text

) {

  lcd.setCursor(0, row);

  String padded =
    text;

  if (padded.length() > 16) {
    padded = padded.substring(0, 16);
  }

  while (

    padded.length()
    < 16

  ) {

    padded += " ";
  }

  lcd.print(padded);
}

void showScreen(

  String line1,
  String line2

) {

  if (

    millis()
      - lastLCDUpdate

    < 50

    ) return;

  lastLCDUpdate =
    millis();

  if (

    line1 == lastLine1

    &&

    line2 == lastLine2

    ) return;

  lastLine1 = line1;
  lastLine2 = line2;

  printLine(0, line1);

  printLine(1, line2);
}

void showIdle() {

  if (

    millis()
      - lastIdleAnim

    < 500

    ) return;

  lastIdleAnim =
    millis();

  idleDots++;

  if (
    idleDots > 3) {

    idleDots = 0;
  }

  String dots = "";

  for (

    int i = 0;

    i < idleDots;

    i++

  ) {

    dots += ".";
  }

  if (syncInProgress) {
    showScreen("SYNCING", "Menyinkronkan transaksi...");
    return;
  }

  // =====================
  // OFFLINE
  // =====================

  if (

    WiFi.status() != WL_CONNECTED
    || backendOffline

  ) {

    showScreen(

      "MODE OFFLINE",

      "Limit tidak aktif"

    );

    return;
  }

  // =====================
  // ONLINE
  // =====================

  showScreen(

    "MODE ONLINE",

    "Limit aktif" + dots

  );
}

void showResult(

  String line1,
  String line2,
  int duration

) {

  resultMessage1 =
    line1;

  resultMessage2 =
    line2;

  showScreen(

    line1,
    line2

  );

  resultTimer =
    millis();

  resultDuration =
    duration;

  currentState =
    RESULT;
}

// =====================
// UI MANAGER
// =====================

void showPaymentScreen() {

  showScreen(

    "Bayar:",

    nominalInput

  );
}

void showTopupScreen() {

  showScreen(

    "Topup:",

    nominalInput

  );
}

void showProcessingScreen() {

  showScreen(

    "Memproses",

    "..."

  );
}

void showOverrideScreen() {

  showScreen(

    "Scan Santri",

    "Override"

  );
}

void showAdminScreen() {

  showScreen(

    "Scan Admin",

    ""

  );
}

void showSaldoScreen() {

  showScreen(

    currentName,

    "Saldo:" + rupiah(currentSaldo)

  );
}

// WIFI ==========

void connectWiFi() {

  static unsigned long
    lastAttempt = 0;

  if (!runtimeConfigReady) return;

  // =====================
  // WIFI CONNECTED
  // =====================

  if (

    WiFi.status()
    == WL_CONNECTED

  ) {

    // =====================
    // FIRST CONNECT
    // =====================

    if (

      !wifiWasConnected

    ) {

      wifiWasConnected =
        true;

      Serial.println(

        "WIFI CONNECTED"

      );

      Serial.println(

        WiFi.localIP()

      );

      sendAudit(

        "WIFI_ON",

        "wifi connected"

      );
    }

    wifiDisconnectedShown =
      false;

    return;
  }

  // =====================
  // WIFI LOST
  // =====================

  if (

    wifiWasConnected

  ) {

    wifiWasConnected =
      false;

    Serial.println(

      "WIFI LOST"

    );

    sendAudit(

      "WIFI_OFF",

      "wifi disconnected"

    );
  }

  // =====================
  // RETRY TIMER
  // =====================

  if (

    millis()
      - lastAttempt

    < WIFI_RECONNECT_INTERVAL_MS

    ) return;

  lastAttempt =
    millis();

  // =====================
  // SHOW RECONNECT
  // =====================

  if (

    !wifiDisconnectedShown

  ) {

    Serial.println(

      "Connecting WiFi..."

    );

    wifiDisconnectedShown =
      true;
  }

  // =====================
  // RECONNECT
  // =====================

  WiFi.begin(

    ssid.c_str(),

    password.c_str()

  );
}

// =====================
// API HELPER
// =====================

bool apiPost(

  String endpoint,

  String body,

  String& response

) {

  if (

    WiFi.status()
    != WL_CONNECTED

  ) {

    return false;
  }

  WiFiClientSecure client;
  client.setCACert(KLIKPESANTREN_ROOT_CA);
  client.setTimeout(API_TIMEOUT_MS);

  HTTPClient http;

  String url =
    SERVER_URL + endpoint;

  if (DEBUG) {
    Serial.println("====== API POST ======");
    Serial.print("WiFi.status: ");
    Serial.println(WiFi.status());
    Serial.print("Local IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("URL: ");
    Serial.println(url);
  }

  http.begin(client, url);

  http.setTimeout(API_TIMEOUT_MS);

  http.addHeader(

    "Content-Type",

    "application/json"

  );

  int httpCode =
    http.POST(body);

  lastApiTransportError = httpCode < 0;

  response =
    http.getString();

  if (DEBUG) {
    Serial.print("HTTP CODE: ");
    Serial.println(httpCode);
  }
  if (httpCode < 0) {
    Serial.print("HTTP ERROR: ");
    Serial.println(http.errorToString(httpCode));
  }
  if (DEBUG) {
    Serial.println("======================");
  }

  if (httpCode >= 200 && httpCode < 300) {

    http.end();

    return true;
  }

  http.end();

  return false;
}

// =====================
// SAVE SANTRI CACHE
// =====================

void saveSantriCache(

  String uid,
  String nama,
  int saldo,
  int limitHarian,
  int pemakaianHariIni,
  int sisaLimitHariIni

) {

  String path =
    "/santri_" + uid + ".txt";

  File file =

    LittleFS.open(

      path,

      FILE_WRITE

    );

  if (!file) {

    Serial.println(

      "CACHE WRITE FAILED"

    );

    return;
  }

  file.println(nama);

  file.println(saldo);

  file.println(limitHarian);

  file.println(pemakaianHariIni);

  file.println(sisaLimitHariIni);

  file.close();

  Serial.println(

    "CACHE SAVED"

  );
}

// =====================
// LOAD SANTRI CACHE
// =====================

bool loadSantriCache(

  String uid

) {

  String path =
    "/santri_" + uid + ".txt";

  File file =

    LittleFS.open(

      path,

      FILE_READ

    );

  if (!file) {

    Serial.println(

      "CACHE NOT FOUND"

    );

    return false;
  }

  currentName =
    file.readStringUntil('\n');

  currentName.trim();

  currentSaldo =
    file.readStringUntil('\n').toInt();

  currentLimitHarian = -1;
  currentPemakaianHariIni = 0;
  currentSisaLimitHariIni = -1;

  // OFFLINE: limit nonaktif sesuai keputusan produk.
  // Snapshot limit lama tidak dibaca dan tidak dipakai.

  file.close();

  Serial.println(

    "CACHE LOADED"

  );

  return true;
}

bool fetchSantriData(

  String uid

) {

  if (

    WiFi.status()
    != WL_CONNECTED

  ) {

    Serial.println(

      "OFFLINE MODE"

    );

    return loadSantriCache(uid);
  }

  StaticJsonDocument<256>
    payload;

  payload["tenant_slug"] =
    TENANT_SLUG;

  payload["device_id"] =
    DEVICE_ID;

  payload["device_secret"] =
    DEVICE_SECRET;

  payload["uid_rfid"] =
    uid;

  String body;

  serializeJson(
    payload,
    body);

  String response;

  bool successHttp =

    apiPost(
      "/rfid/card/lookup",
      body,
      response);

  Serial.print(
    "LOOKUP SANTRI: ");

  Serial.println(
    successHttp ? "OK" : "FAIL");

  if (

    successHttp

  ) {

    backendOffline = false;

    DynamicJsonDocument
      doc(1024);

    deserializeJson(

      doc,
      response

    );

    bool success =

      doc["success"];

    if (

      !success

    ) {

      Serial.print(
        "LOOKUP ERROR: ");

      Serial.println(
        doc["error"].as<String>());

      // Server terjangkau dan menolak kartu: jangan gunakan cache lama.
      return false;
    }

    JsonObject data =

      doc["data"];

    currentName =

      data["nama"]
        .as<String>();

    currentSaldo =

      data["saldo"];

    currentLimitHarian =

      data["limit_harian"].isNull()
        ? -1
        : data["limit_harian"].as<int>();

    currentPemakaianHariIni =

      data["pemakaian_hari_ini"].isNull()
        ? 0
        : data["pemakaian_hari_ini"].as<int>();

    currentSisaLimitHariIni =

      data["sisa_limit_hari_ini"].isNull()
        ? -1
        : data["sisa_limit_hari_ini"].as<int>();

    saveSantriCache(

      uid,

      currentName,

      currentSaldo,

      currentLimitHarian,

      currentPemakaianHariIni,

      currentSisaLimitHariIni

    );

    return true;
  }

  if (

    response.length()
    > 0

  ) {

    Serial.print(
      "LOOKUP RESPONSE: ");

    Serial.println(
      response);
  }

  if (!lastApiTransportError) {
    // Server terjangkau tetapi menolak lookup: jangan memakai cache lama.
    return false;
  }

  backendOffline = true;
  return loadSantriCache(uid);
}
void resetState();

String readRFID() {

  if (

    !rfid.PICC_IsNewCardPresent()

  ) {

    return "";
  }

  if (

    !rfid.PICC_ReadCardSerial()

  ) {

    return "";
  }

  String uid = "";

  for (

    byte i = 0;

    i < rfid.uid.size;

    i++

  ) {

    if (

      rfid.uid.uidByte[i]
      < 0x10

    ) {

      uid += "0";
    }

    uid +=

      String(

        rfid.uid.uidByte[i],
        HEX

      );
  }

  uid.toLowerCase();

  uid.trim();

  rfid.PICC_HaltA();

  return uid;
}

void handleRFID() {

  if (

    millis()
      - lastRFIDRead

    < 200

    ) return;

  String uid =
    readRFID();

  if (uid == "")
    return;

  lastRFIDRead =
    millis();

  currentUID =
    uid;
  // =====================
  // MODE TOPUP - SCAN ADMIN
  // =====================

  if (

    currentState
    == WAIT_ADMIN_OVERRIDE

  ) {

    if (

      uid != ADMIN_UID_1

      &&

      uid != ADMIN_UID_2

    ) {

      return;
    }


    // =====================
    // ADMIN VALID
    // =====================

    overrideLimit =
      true;

    beep(50);

    showScreen(

      "Override",

      "Aktif"

    );

    stateTimer =
      millis();

    currentState =
      WAIT_SANTRI;

    return;
  }

  // =====================
  // MODE TOPUP - SCAN ADMIN
  // =====================

  if (

    currentState
    == WAIT_ADMIN

  ) {

    if (

      uid != ADMIN_UID_1

      &&

      uid != ADMIN_UID_2

    ) {

      showResult(

        "Akses Ditolak",

        "Bukan Admin",

        2200

      );

      return;
    }

    adminUID = uid;

    showScreen(

      "Admin OK",

      "Scan Santri"

    );

    beep(50);

    currentState =
      WAIT_SANTRI;

    return;
  }


  // =====================
  // FETCH SANTRI
  // =====================

  bool found =

    fetchSantriData(uid);

  if (!found) {

    beep(300);

    showResult(

      "Tak Terdaftar",
      uid,
      2200

    );

    return;
  }

  // =====================
  // MODE CEK SALDO
  // =====================

  if (

    currentState
    == CHECK_SALDO

  ) {

    showResult(

      currentName,

      "Saldo:" + rupiah(currentSaldo),

      1500

    );

    return;
  }

  // =====================
  // MODE TOPUP SANTRI
  // =====================

  if (

    currentState
    == WAIT_SANTRI

  ) {

    showSaldoScreen();

    displayTimer =
      millis();

    nominalInput = "";

    if (

      isTopup

    ) {

      currentState =
        SHOW_TOPUP;

    }

    else {

      currentState =
        SHOW_PAYMENT;
    }

    return;
  }

  // =====================
  // MODE TRANSAKSI NORMAL
  // =====================

  if (

    currentState
    == STANDBY

  ) {

    showScreen(

      currentName,

      "Saldo:" + rupiah(currentSaldo)

    );

    displayTimer =
      millis();

    nominalInput = "";

    currentState =
      SHOW_PAYMENT;

    return;
  }
}


// KEYPAD ==========
void handleKeypad() {

  char key =
    keypad.getKey();

  if (!key)
    return;

  if (

    millis()
      - lastKeypadPress

    < 150

    ) return;

  lastKeypadPress =
    millis();

  if (

    currentState
    == PROCESSING

    ) return;

  Serial.print("KEY: ");
  Serial.println(key);

  // =====================
  // OVERLIMIT
  // =====================
  if (

    key == 'D'

    &&

    currentState
      == STANDBY

  ) {

    showAdminScreen();

    currentState =
      WAIT_ADMIN_OVERRIDE;

    return;
  }

  // =====================
  // CANCEL GLOBAL
  // =====================

  if (

    key == 'C'

  ) {

    processing = false;

    resetState();

    beep(50);

    return;
  }

  // =====================
  // STANDBY
  // =====================

  if (

    currentState
    == STANDBY

  ) {

    // =====================
    // CEK SALDO
    // =====================

    if (

      key == 'A'

    ) {

      isTopup = false;

      currentState =
        CHECK_SALDO;

      showScreen(

        "Cek Saldo",

        "Tempel Kartu"

      );

    }

    // =====================
    // TOPUP
    // =====================

    else if (

      key == 'B'

    ) {

      isTopup = false;

      beep(180);

      showResult(

        "Topup via",

        "Admin Web",

        1600

      );
    }
  }

  // =====================
  // INPUT PAYMENT
  if (

    (

      currentState
        == INPUT_PAYMENT

      ||

      currentState
        == INPUT_TOPUP

      )

    &&

    nominalInput == ""

    &&

    millis()
        - displayTimer

      < 2500

  ) {

    return;

  }

  else if (

    currentState
      == INPUT_PAYMENT

    ||

    currentState
      == INPUT_TOPUP

  ) {

    // INPUT ANGKA

    if (

      key >= '0'

      &&

      key <= '9'

    ) {

      if (

        nominalInput.length()

        >= 6

        ) return;

      nominalInput += key;

      if (

        isTopup

      ) {

        showTopupScreen();

      }

      else {

        showPaymentScreen();
      }

    }

    // HAPUS

    else if (

      key == '*'

    ) {

      if (

        nominalInput.length()

        > 0

      ) {

        nominalInput.remove(

          nominalInput.length()
          - 1

        );
      }

      if (

        isTopup

      ) {

        showTopupScreen();

      }

      else {

        showPaymentScreen();
      }

    }

    // PROSES

    else if (

      key == '#'

    ) {

      if (

        nominalInput.length()

        == 0

        ) return;

      processing = true;

      currentState =
        PROCESSING;

      showProcessingScreen();
    }
  }
}

// =====================
// TRANSACTION ID
// =====================

String generateTransactionId() {

  return

    DEVICE_ID

    + "-"

    + String(millis());
}

String offlineDayKey() {

  return String(
    millis() / 86400000UL
  );
}

bool validateOfflinePayment(
  int nominal
) {

  if (

    !loadSantriCache(currentUID)

  ) {

    showResult(

      "CACHE TIDAK ADA",

      "ONLINE DULU",

      2200

    );

    beep(300);

    return false;
  }

  if (

    isTopup

  ) return true;

  if (

    nominal > currentSaldo

  ) {

    showResult(

      "SALDO KURANG",

      "Saldo:" + rupiah(currentSaldo),

      2200

    );

    beep(300);

    return false;
  }

  // OFFLINE: jangan cek, hitung, atau kurangi limit.
  // Hanya validitas kartu pada cache dan saldo lokal yang diperiksa.

  return true;
}


// OFFLINE SAVE ===========
//=========================

void saveOfflineTransaction() {

  File file =

    LittleFS.open(

      "/queue.txt",

      FILE_APPEND

    );

  if (!file) {

    Serial.println(

      "QUEUE OPEN FAILED"

    );

    return;
  }

  String trx =

    currentTransactionId

    + "|"

    + currentUID

    + "|"

    + nominalInput

    + "|"

    + String(isTopup)

    + "|"

    + offlineDayKey()

    + "|"

    + String(overrideLimit)

    + "\n";

  file.print(trx);

  file.close();

  Serial.println(

    "OFFLINE SAVED"

  );

  File debug =

    LittleFS.open(

      "/queue.txt",

      FILE_READ

    );

  if (debug) {

    while (

      debug.available()

    )

      debug.close();
  }
}


// SEND TRANSACTION ==========
//============================
bool sendTransaction() {

  if (

    WiFi.status() != WL_CONNECTED
    || backendOffline

  ) {

    int nominal =
      nominalInput.toInt();

    if (

      !validateOfflinePayment(nominal)

    ) return false;

    if (

      !isTopup

    ) {

      currentSaldo -=
        nominal;

      saveSantriCache(

        currentUID,

        currentName,

        currentSaldo,

        currentLimitHarian,

        currentPemakaianHariIni,

        currentSisaLimitHariIni

      );
    }

    saveOfflineTransaction();

    showResult(

      "QUEUE SAVED",

      "Saldo:" + rupiah(currentSaldo),

      1800

    );

    beep(100);

    return false;
  }

  StaticJsonDocument<256>
    doc;

  doc["tenant_slug"] =
    TENANT_SLUG;

  doc["uid_rfid"] =
    currentUID;

  doc["nominal"] =
    nominalInput.toInt();

  doc["device_id"] =
    DEVICE_ID;

  doc["device_secret"] =
    DEVICE_SECRET;

  doc["override_limit"] =
    overrideLimit;

  doc["trx_id"] =
    currentTransactionId;

  String body;

  serializeJson(
    doc,
    body);

  String response;

  bool successHttp =

    apiPost(
      "/rfid/payment",
      body,
      response);

  if (!successHttp && lastApiTransportError) {
    backendOffline = true;
    int nominal = nominalInput.toInt();
    if (!validateOfflinePayment(nominal)) return false;
    if (!isTopup) {
      currentSaldo -= nominal;
      saveSantriCache(currentUID, currentName, currentSaldo, -1, 0, -1);
    }
    saveOfflineTransaction();
    showResult("MODE OFFLINE", "Limit tidak aktif", 1800);
    beep(100);
    return false;
  }

  backendOffline = false;

  DynamicJsonDocument
    res(512);

  deserializeJson(

    res,
    response

  );

  bool success =

    res["success"];

  if (

    success

  ) {

    int saldo =

      res["saldo_sekarang"];

    currentSaldo =
      saldo;

    saveSantriCache(

      currentUID,

      currentName,

      currentSaldo,

      currentLimitHarian,

      currentPemakaianHariIni,

      currentSisaLimitHariIni

    );

    sendAudit(

      isTopup
        ? "TOPUP"
        : "PAYMENT",

      currentUID
        + " | Rp "
        + nominalInput

    );

    showResult(

      "Berhasil",

      "Saldo:" + rupiah(saldo),

      1200

    );

    beep(50);

    return true;
  }

  String msg =
    res["error"];

  showResult(

    "Gagal",

    msg,

    2200

  );

  beep(300);

  return false;
}

// =====================
// PROCESS PAYMENT =======

void processPayment() {

  Serial.print("TOPUP MODE: ");

  Serial.println(isTopup);

  currentTransactionId =

    generateTransactionId();

  Serial.print(

    "TRX ID: "

  );

  Serial.println(

    currentTransactionId

  );

  sendTransaction();

  overrideLimit =
    false;
}

int getQueueCount() {

  File file =

    LittleFS.open(

      "/queue.txt",

      FILE_READ

    );

  if (!file) {

    return 0;
  }

  int count = 0;

  while (

    file.available()

  ) {

    String line =

      file.readStringUntil('\n');

    line.trim();

    if (

      line != ""

    ) {

      count++;
    }
  }

  file.close();

  return count;
}

// DEVICE PING ===============

void sendPing() {

  if (

    WiFi.status()
    != WL_CONNECTED

    ) return;

  WiFiClientSecure client;
  client.setCACert(KLIKPESANTREN_ROOT_CA);
  client.setTimeout(HEARTBEAT_TIMEOUT_MS);

  HTTPClient http;

  String url =
    SERVER_URL
    + "/rfid/device/heartbeat";

  http.begin(client, url);

  http.setTimeout(HEARTBEAT_TIMEOUT_MS);

  http.addHeader(

    "Content-Type",

    "application/json"

  );

  StaticJsonDocument<256>
    doc;

  doc["tenant_slug"] = TENANT_SLUG;
  doc["device_id"] = DEVICE_ID;
  doc["device_secret"] = DEVICE_SECRET;

  String body;

  serializeJson(
    doc,
    body);

  int httpCode =
    http.POST(body);

  String response =
    http.getString();

  if (DEBUG) {
    Serial.println("====== PING ======");

    Serial.print("WiFi.status: ");
    Serial.println(WiFi.status());

    Serial.print("Local IP: ");
    Serial.println(WiFi.localIP());

    Serial.print("URL: ");
    Serial.println(url);

    Serial.print("BODY: ");
    Serial.println("[REDACTED]");

    Serial.print("PING HTTP CODE: ");
    Serial.println(httpCode);
  }

  if (httpCode < 0) {
    Serial.print("PING HTTP ERROR: ");
    Serial.println(http.errorToString(httpCode));
  }

  if (DEBUG) {
    Serial.print("RESPONSE: ");
    Serial.println(response);

    Serial.println("==================");

    Serial.print(
      "PING: ");

    Serial.println(
      httpCode);
  }

  http.end();
}

void sendAudit(

  String eventType,

  String detail

) {

  if (

    WiFi.status()
    != WL_CONNECTED

  ) {

    Serial.println(

      "AUDIT WIFI OFF"

    );

    return;
  }

  WiFiClientSecure client;
  client.setCACert(KLIKPESANTREN_ROOT_CA);
  client.setTimeout(AUDIT_TIMEOUT_MS);

  HTTPClient http;

  String url =

    SERVER_URL
    + "/audit";

  Serial.println(

    "SEND AUDIT"

  );

  http.begin(client, url);

  http.setTimeout(AUDIT_TIMEOUT_MS);

  http.addHeader(

    "Content-Type",

    "application/json"

  );

  String body =

    "{"

    "\"device_id\":\""
    + DEVICE_ID +

    "\","

    "\"event_type\":\""
    + eventType +

    "\","

    "\"detail\":\""
    + detail +

    "\""

    "}";

  int code =

    http.POST(body);

  if (DEBUG) {
    Serial.print(

      "AUDIT CODE: "

    );

    Serial.println(code);
  }

  if (code < 0) {
    Serial.print("AUDIT HTTP ERROR: ");
    Serial.println(http.errorToString(code));
  }

  http.end();
}

// =====================
// SYNC OFFLINE
// =====================

void syncOfflineQueue() {

  if (

    syncInProgress

    ) return;

  if (

    WiFi.status()
    != WL_CONNECTED

    ) return;

  File file =

    LittleFS.open(

      "/queue.txt",

      FILE_READ

    );

  if (

    !file

    ) return;

  if (

    file.size()
    == 0

  ) {

    file.close();

    return;
  }

  syncInProgress =
    true;

  showScreen("SYNCING", "Menyinkronkan transaksi...");

  Serial.println(

    "SYNC START"

  );

  String remaining = "";

  while (

    file.available()

  ) {

    String line =

      file.readStringUntil(
        '\n');

    line.trim();

    if (

      line == ""

      ) continue;

    // =====================
    // PARSE DATA
    // =====================

    int p1 =
      line.indexOf('|');

    int p2 =
      line.indexOf('|', p1 + 1);

    int p3 =
      line.indexOf('|', p2 + 1);

    int p4 =
      line.indexOf('|', p3 + 1);

    int p5 =
      p4 == -1
        ? -1
        : line.indexOf('|', p4 + 1);

    if (

      p1 == -1

      ||

      p2 == -1

      ||

      p3 == -1

    ) {

      continue;
    }

    String trxId =

      line.substring(
        0,
        p1);

    String uid =

      line.substring(
        p1 + 1,
        p2);

    String nominal =

      line.substring(
        p2 + 1,
        p3);

    String topup =

      p4 == -1
        ? line.substring(p3 + 1)
        : line.substring(p3 + 1, p4);

    String queuedOverride =

      p5 == -1
        ? "0"
        : line.substring(p5 + 1);

    queuedOverride.trim();
    // =====================
    // JSON
    // =====================

    StaticJsonDocument<256>
      doc;

    doc["tenant_slug"] =
      TENANT_SLUG;

    doc["uid_rfid"] =
      uid;

    doc["nominal"] =
      nominal.toInt();

    doc["device_id"] =
      DEVICE_ID;

    doc["device_secret"] =
      DEVICE_SECRET;

    doc["trx_id"] =
      trxId;

    doc["override_limit"] =
      false;

    doc["offline_sync"] = true;

    String body;

    serializeJson(
      doc,
      body);

    String response;

    bool successHttp =

      apiPost(
        "/rfid/payment",
        body,
        response);

    // =====================
    // GAGAL
    // =====================

    if (!successHttp && lastApiTransportError) {

      backendOffline = true;

      remaining +=
        line + "\n";

      continue;
    }

    backendOffline = false;

    DynamicJsonDocument
      res(256);

    deserializeJson(

      res,
      response

    );

    bool success =

      res["success"];

    if (success && !res["saldo_sekarang"].isNull()) {
      loadSantriCache(uid);
      currentSaldo = res["saldo_sekarang"].as<int>();
      saveSantriCache(uid, currentName, currentSaldo, -1, 0, -1);
    }

    String message =

      res["message"]
        .as<String>();

    // =====================
    // SERVER TOLAK
    // =====================

    if (

      !success

    ) {

      sendAudit(

        "SYNC_FAILED",

        trxId

      );

      remaining +=
        line + "\n";

      continue;
    }

    // =====================
    // DUPLICATE = SUCCESS
    // =====================

    if (

      message
      == "Duplicate ignored"

    ) {

      Serial.println(

        "DUPLICATE SKIPPED"

      );

      continue;
    }

    Serial.println(

      "SYNC OK"

    );

    sendAudit(

      "SYNC_SUCCESS",

      trxId

    );
  }

  file.close();

  // =====================
  // SIMPAN SISA
  // =====================

  File writeFile =

    LittleFS.open(

      "/queue.txt",

      FILE_WRITE

    );

  if (

    writeFile

  ) {

    writeFile.print(
      remaining);

    writeFile.close();
  }

  syncInProgress =
    false;

  Serial.println(

    "SYNC DONE"

  );

  if (remaining == "") {
    showResult("SYNC SUCCESS", "Sinkron selesai", 1800);
  } else {
    showResult("SYNC FAILED", "Akan dicoba lagi", 1800);
  }
}

void attendanceBeep(AttendanceTone feedbackTone) {
  if (feedbackTone == ATTENDANCE_TONE_SUCCESS) {
    beep(80);
    return;
  }
  if (feedbackTone == ATTENDANCE_TONE_INFO) {
    beep(70);
    delay(90);
    beep(70);
    return;
  }
  beep(320);
}

void showAttendanceStandby() {
  showScreen("Tempelkan Kartu", "Absensi");
}

void showProvisioningRequired() {
  showScreen("Setup via Serial", "Config Belum Ada");
}

void showAttendanceFeedback(
  const String& line1,
  const String& line2,
  AttendanceTone feedbackTone
) {
  attendanceUnknownUidActive = false;
  attendanceUnknownUid = "";
  printLine(0, line1);
  printLine(1, line2);
  lastLine1 = line1;
  lastLine2 = line2;
  lastLCDUpdate = millis();
  attendanceBeep(feedbackTone);
  attendanceFeedbackActive = true;
  attendanceFeedbackStartedAt = millis();
}

void renderUnknownUidPage() {
  String line1;
  if (attendanceUnknownUid.length() <= UNKNOWN_UID_DIRECT_LENGTH) {
    line1 = "UID:" + attendanceUnknownUid;
  } else {
    size_t offset = attendanceUnknownUidPage * UNKNOWN_UID_PAGE_CHARS;
    String pagePrefix =
      "UID" + String(attendanceUnknownUidPage + 1)
      + "/" + String(attendanceUnknownUidPageCount) + ":";
    line1 = pagePrefix + attendanceUnknownUid.substring(
      offset,
      min(offset + UNKNOWN_UID_PAGE_CHARS, attendanceUnknownUid.length())
    );
  }
  printLine(0, line1);
  printLine(1, "BELUM TERDAFTAR");
  lastLine1 = line1;
  lastLine2 = "BELUM TERDAFTAR";
  lastLCDUpdate = millis();
}

void showUnknownCredentialFeedback(const String& scannedUid) {
  attendanceUnknownUid = scannedUid;
  attendanceUnknownUidPage = 0;
  attendanceUnknownUidPageCount = scannedUid.length() <= UNKNOWN_UID_DIRECT_LENGTH
    ? 1
    : (scannedUid.length() + UNKNOWN_UID_PAGE_CHARS - 1) / UNKNOWN_UID_PAGE_CHARS;
  attendanceUnknownUidActive = true;
  attendanceFeedbackActive = true;
  attendanceFeedbackStartedAt = millis();
  attendanceUnknownUidPageStartedAt = attendanceFeedbackStartedAt;
  renderUnknownUidPage();
  attendanceBeep(ATTENDANCE_TONE_ERROR);
}

void updateAttendanceFeedback() {
  if (!attendanceFeedbackActive) return;
  if (attendanceUnknownUidActive) {
    if (millis() - attendanceUnknownUidPageStartedAt < UNKNOWN_UID_PAGE_DURATION_MS) return;
    if (attendanceUnknownUidPage + 1 < attendanceUnknownUidPageCount) {
      attendanceUnknownUidPage += 1;
      attendanceUnknownUidPageStartedAt = millis();
      renderUnknownUidPage();
      return;
    }
    attendanceUnknownUidActive = false;
    attendanceUnknownUid = "";
    attendanceFeedbackActive = false;
    showAttendanceStandby();
    return;
  }
  if (millis() - attendanceFeedbackStartedAt < ATTENDANCE_FEEDBACK_DURATION_MS) return;
  attendanceFeedbackActive = false;
  showAttendanceStandby();
}

bool attendanceClockValid() {
  time_t now;
  time(&now);
  return now >= MIN_VALID_EPOCH;
}

void ensureAttendanceClock() {
  if (WiFi.status() != WL_CONNECTED || attendanceClockValid()) return;
  if (ntpConfigured && millis() - lastNtpAttempt < NTP_RETRY_INTERVAL_MS) return;
  lastNtpAttempt = millis();
  ntpConfigured = true;
  configTime(0, 0, "pool.ntp.org", "time.google.com");
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

bool createDurableAttendanceEventId(String& eventId) {
  uint64_t current = prefs.getULong64("att_counter", 0);
  if (current == UINT64_MAX) return false;
  uint64_t next = current + 1;
  if (prefs.putULong64("att_counter", next) == 0) return false;
  char counterText[24];
  snprintf(counterText, sizeof(counterText), "%llu", static_cast<unsigned long long>(next));
  eventId = DEVICE_ID + "-attendance-" + String(counterText);
  return eventId.length() <= 160;
}

AttendanceHttpResult postAttendanceEvent(const String& body) {
  AttendanceHttpResult result = { false, -1, "" };
  if (WiFi.status() != WL_CONNECTED || !runtimeConfigReady) return result;

  WiFiClientSecure client;
  client.setCACert(KLIKPESANTREN_ROOT_CA);
  client.setTimeout(API_TIMEOUT_MS);

  HTTPClient http;
  String url = SERVER_URL + "/attendance/events";
  if (!http.begin(client, url)) return result;
  http.setTimeout(API_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Id", DEVICE_ID);
  http.addHeader("X-Device-Secret", DEVICE_SECRET);
  http.addHeader("X-Tenant-Slug", TENANT_SLUG);

  int httpStatus = http.POST(body);
  result.httpStatus = httpStatus;
  result.transportOk = httpStatus >= 0;
  if (result.transportOk) {
    result.body = http.getString();
  }
  if (DEBUG) {
    Serial.print("Attendance HTTP status: ");
    Serial.println(httpStatus);
  }
  http.end();
  return result;
}

String attendanceDisplayTime(const String& capturedAt) {
  if (capturedAt.length() >= 16) {
    return capturedAt.substring(11, 16) + "Z";
  }
  return "UTC";
}

void handleAttendanceResponse(
  const AttendanceHttpResult& result,
  const String& requestCapturedAt,
  const String& scannedUid
) {
  if (!result.transportOk) {
    showAttendanceFeedback("Koneksi Gagal", "Coba Lagi", ATTENDANCE_TONE_ERROR);
    return;
  }
  if (result.httpStatus >= 500) {
    showAttendanceFeedback("Server Error", "Coba Lagi", ATTENDANCE_TONE_ERROR);
    return;
  }

  DynamicJsonDocument response(1024);
  DeserializationError parseError = deserializeJson(response, result.body);
  if (parseError) {
    showAttendanceFeedback("Respons Server", "Tidak Valid", ATTENDANCE_TONE_ERROR);
    return;
  }

  String code = response["code"].as<String>();
  String personName = response["person"]["name"].as<String>();
  String responseCapturedAt = response["captured_at"].as<String>();
  String status = response["status"].as<String>();
  if (responseCapturedAt.length() == 0) responseCapturedAt = requestCapturedAt;

  if (code == "ATTENDANCE_RECORDED" && response["ok"] == true) {
    if (personName.length() == 0) personName = "Absensi";
    showAttendanceFeedback(
      personName,
      "Hadir " + attendanceDisplayTime(responseCapturedAt),
      ATTENDANCE_TONE_SUCCESS
    );
  } else if (code == "ALREADY_ATTENDED" && response["ok"] == true) {
    if (personName.length() == 0) personName = "Absensi";
    showAttendanceFeedback(personName, "Sudah Absen", ATTENDANCE_TONE_INFO);
  } else if (code == "STATUS_PROTECTED" && response["ok"] == true) {
    if (personName.length() == 0) personName = "Absensi";
    String protectedLabel = "Status Terkunci";
    if (status == "I") protectedLabel = "Status: Izin";
    if (status == "S") protectedLabel = "Status: Sakit";
    showAttendanceFeedback(personName, protectedLabel, ATTENDANCE_TONE_INFO);
  } else if (code == "UNKNOWN_CREDENTIAL") {
    showUnknownCredentialFeedback(scannedUid);
  } else if (code == "AMBIGUOUS_CREDENTIAL") {
    showAttendanceFeedback("Konflik Kartu", "Hubungi Admin", ATTENDANCE_TONE_ERROR);
  } else if (code == "NO_ACTIVE_SESSION") {
    showAttendanceFeedback("Sesi Tidak Aktif", "Coba Nanti", ATTENDANCE_TONE_ERROR);
  } else if (code == "NOT_ELIGIBLE") {
    showAttendanceFeedback("Tidak Eligible", "Pada Sesi", ATTENDANCE_TONE_ERROR);
  } else if (code == "AMBIGUOUS_SESSION") {
    showAttendanceFeedback("Konflik Sesi", "Hubungi Admin", ATTENDANCE_TONE_ERROR);
  } else if (code == "EVENT_TOO_OLD") {
    showAttendanceFeedback("Event Kedaluwarsa", "Scan Ulang", ATTENDANCE_TONE_ERROR);
  } else if (code == "INVALID_EVENT_TIME") {
    showAttendanceFeedback("Waktu Device", "Tidak Valid", ATTENDANCE_TONE_ERROR);
  } else if (code == "EVENT_ID_CONFLICT") {
    showAttendanceFeedback("Konflik Event", "Scan Ulang", ATTENDANCE_TONE_ERROR);
  } else if (code == "FEATURE_DISABLED") {
    showAttendanceFeedback("Fitur Nonaktif", "Cek Platform", ATTENDANCE_TONE_ERROR);
  } else if (code == "DEVICE_DISABLED") {
    showAttendanceFeedback("Device Nonaktif", "Hubungi Admin", ATTENDANCE_TONE_ERROR);
  } else if (
    code == "DEVICE_AUTH_INVALID"
    || code == "DEVICE_CREDENTIALS_REQUIRED"
  ) {
    showAttendanceFeedback("Akses Ditolak", "Cek Device", ATTENDANCE_TONE_ERROR);
  } else if (
    code == "DEVICE_TENANT_INVALID"
    || code == "DEVICE_MERCHANT_INVALID"
  ) {
    showAttendanceFeedback("Konfig Device", "Tidak Cocok", ATTENDANCE_TONE_ERROR);
  } else if (result.httpStatus == 401 || result.httpStatus == 403) {
    showAttendanceFeedback("Akses Ditolak", "Cek Konfigurasi", ATTENDANCE_TONE_ERROR);
  } else if (result.httpStatus >= 400) {
    showAttendanceFeedback("Request Ditolak", "Cek Konfigurasi", ATTENDANCE_TONE_ERROR);
  } else {
    showAttendanceFeedback("Server Error", "Coba Lagi", ATTENDANCE_TONE_ERROR);
  }
}

void handleAttendanceRFID() {
  if (!runtimeConfigReady || !isAttendanceMode() || attendanceFeedbackActive) return;
  if (millis() - lastRFIDRead < 200) return;

  String uid = readRFID();
  if (uid.length() == 0) return;
  lastRFIDRead = millis();

  if (WiFi.status() != WL_CONNECTED) {
    showAttendanceFeedback("Koneksi Gagal", "Coba Lagi", ATTENDANCE_TONE_ERROR);
    return;
  }

  String capturedAt;
  if (!formatCapturedAtUtc(capturedAt)) {
    showAttendanceFeedback("Waktu Device", "Belum Valid", ATTENDANCE_TONE_ERROR);
    return;
  }

  String eventId;
  if (!createDurableAttendanceEventId(eventId)) {
    showAttendanceFeedback("ID Event", "Bermasalah", ATTENDANCE_TONE_ERROR);
    return;
  }

  StaticJsonDocument<384> request;
  request["event_id"] = eventId;
  request["credential_type"] = "rfid";
  request["credential"] = uid;
  request["captured_at"] = capturedAt;
  String body;
  serializeJson(request, body);

  showScreen("Memproses", "Absensi");
  AttendanceHttpResult result = postAttendanceEvent(body);
  handleAttendanceResponse(result, capturedAt, uid);
}

// SETUP ===============
//======================

void setup() {

  Serial.begin(115200);
  Serial.setTimeout(250);

  prefs.begin(

    "offline",

    false

  );

  loadRuntimeConfig();
  printRuntimeConfigStatus();

  pinMode(

    BUZZER,

    OUTPUT

  );

  SPI.begin();

  rfid.PCD_Init();

  lcd.init();

  lcd.backlight();

  // Attendance mode never mounts or mutates the payment LittleFS queue.
  // Existing payment queue data remains untouched for a later authorized flow.

  // =====================
  // WIFI
  // =====================

  connectWiFi();

  // =====================
  // UI
  // =====================

  if (runtimeConfigReady) {
    showAttendanceStandby();
  } else {
    showProvisioningRequired();
  }
}

// resetState ==========

void resetState() {

  currentUID = "";

  adminUID = "";

  currentName = "";

  currentSaldo = 0;

  currentLimitHarian = -1;

  currentPemakaianHariIni = 0;

  currentSisaLimitHariIni = -1;

  nominalInput = "";

  isTopup = false;

  overrideLimit =
    false;

  processing = false;

  displayTimer = 0;

  currentState =
    STANDBY;

  showIdle();
}

// LOOP ===============

void loop() {
  handleSerialProvisioning();
  connectWiFi();

  if (!runtimeConfigReady || !isAttendanceMode()) {
    showProvisioningRequired();
    delay(5);
    return;
  }

  ensureAttendanceClock();

  if (WiFi.status() == WL_CONNECTED && attendanceClockValid() && !auditSent) {
    auditSent = true;
    sendAudit("BOOT", "ATTENDANCE");
  }

  updateAttendanceFeedback();
  if (!attendanceFeedbackActive) {
    handleAttendanceRFID();
  }

  if (attendanceClockValid() && millis() - lastPing > HEARTBEAT_INTERVAL_MS) {
    lastPing = millis();
    sendPing();
  }

  delay(5);
}
