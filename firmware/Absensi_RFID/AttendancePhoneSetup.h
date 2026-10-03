#pragma once

// Setup exists only after blank boot or deliberate physical D hold. No remotely
// accessible normal-runtime portal. Operator chooses an ephemeral WPA2 PIN on
// the physical keypad; all PIN digits are masked, never shown/logged as secrets.
WebServer setupHttp(80);
DNSServer setupDns;
String setupNonce, setupPairing, setupStatus, setupApName, setupApPassword;
unsigned long setupStartedAt=0, setupLastConnect=0;
bool setupSubmitted=false, setupPairedRequest=false, setupRoutesRegistered=false;
bool setupApStarted=false;

String setupRandom() {
  uint8_t bytes[16]; esp_fill_random(bytes,sizeof(bytes));
  String value;
  for (uint8_t b:bytes) { char hex[3]; snprintf(hex,sizeof(hex),"%02x",b); value+=hex; }
  return value;
}

void setupPage() {
  setupHttp.sendHeader("Cache-Control","no-store");
  setupHttp.sendHeader("X-Content-Type-Options","nosniff");
  setupHttp.sendHeader("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  String page=F("<!doctype html><html lang='id'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Setup Absensi RFID</title><style>body{font:18px system-ui;max-width:480px;padding:24px;margin:auto}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;margin:8px 0}</style><h1>Setup Absensi RFID</h1><p>Hubungkan Wi-Fi. Perangkat baru memerlukan kode pairing dari Admin.</p><form method='post' action='/setup'><label>Nama Wi-Fi<input name='ssid' maxlength='32' required autocomplete='off'></label><label>Password Wi-Fi<input type='password' name='password' maxlength='63' autocomplete='new-password'></label>");
  page+=deviceSecret.length()==0
    ? F("<label>Kode Pairing<input name='pairing' minlength='43' maxlength='43' required autocomplete='off'></label>")
    : F("<label>Kode Pairing baru (opsional, hanya recovery credential)<input name='pairing' minlength='43' maxlength='43' autocomplete='off'></label>");
  page+="<input type='hidden' name='nonce' value='"+setupNonce+"'><button>Simpan dan Hubungkan</button></form><p>";
  // Status is exclusively a fixed local enum/copy, never backend text or submitted data.
  page+=setupStatus; page+=F("</p><p>Alamat: 192.168.4.1. Jangan bagikan kode akses setup.</p></html>");
  setupHttp.send(200,"text/html; charset=utf-8",page);
}

void startPhoneSetup() {
  if (setupMode || networkBusy) return;
  setupMode=true; setupSubmitted=false; setupPairedRequest=false;
  setupPairing=""; setupStatus="Menunggu konfigurasi"; setupNonce=setupRandom();
  setupApPassword=""; setupApStarted=false;
  uint64_t mac=ESP.getEfuseMac(); char suffix[5]; snprintf(suffix,sizeof(suffix),"%04x",unsigned(mac&0xffff));
  setupApName=String("KlikPesantren-Setup-")+suffix;
  setupStartedAt=millis();
  if (!setupRoutesRegistered) {
    setupHttp.on("/",HTTP_GET,setupPage);
    setupHttp.on("/setup",HTTP_POST,[](){
      setupHttp.sendHeader("Cache-Control","no-store");
      if (!setupMode || setupSubmitted || setupHttp.arg("nonce")!=setupNonce || setupHttp.arg("plain").length()>2048) {
        setupHttp.send(403,"text/plain","Permintaan setup ditolak"); return;
      }
      String ssid=setupHttp.arg("ssid"), password=setupHttp.arg("password"), code=setupHttp.arg("pairing");
      if (ssid.length()==0 || ssid.length()>32 || password.length()>63 ||
          (deviceSecret.length()==0 && code.length()!=43)) {
        setupHttp.send(400,"text/plain","Konfigurasi tidak valid"); return;
      }
      wifiSsid=ssid; wifiPassword=password; setupPairing=code;
      setupSubmitted=true; setupStatus="Menghubungkan. Muat ulang halaman ini untuk status.";
      WiFi.disconnect(false,false); WiFi.begin(wifiSsid.c_str(),wifiPassword.c_str());
      setupLastConnect=millis(); configTime(0,0,"pool.ntp.org","time.google.com");
      setupHttp.send(202,"text/plain","Konfigurasi diterima. Menunggu Wi-Fi/waktu/pairing. Buka kembali 192.168.4.1 untuk status.");
    });
    setupHttp.onNotFound(setupPage); setupRoutesRegistered=true;
  }
}

bool saveSetupWifi() {
  prefs.putString("wifi_ssid",wifiSsid);
  prefs.putString("wifi_password",wifiPassword);
  return prefs.getString("wifi_ssid","")==wifiSsid && prefs.getString("wifi_password","")==wifiPassword;
}

void finishPhoneSetup() {
  if (!saveSetupWifi()) { setupStatus="Penyimpanan gagal. Coba kembali."; return; }
  setupPairing=""; setupApPassword=""; setupNonce="";
  setupHttp.stop(); setupDns.stop(); WiFi.softAPdisconnect(true); WiFi.mode(WIFI_STA);
  setupMode=false; configDirty=true; transitionTo(RuntimeState::LOAD_CONFIG);
}

void acceptPairingResponse(HttpResult& result) {
  AttendanceBoundedJsonDocument response(8*1024);
  if (result.status==200 && !deserializeJson(response,result.body) && response["success"]==true) {
    JsonObject identity=response["data"];
    if (identity["device_secret"].is<const char*>() && identity["device_id"].is<const char*>() &&
        identity["tenant_slug"].is<const char*>() && identity["device_mode"]=="ATTENDANCE") {
      String serialized; serializeJson(identity,serialized);
      if (serialized.length()<1024 && prefs.putString("att_identity",serialized)>0) {
        serialized=""; result.body=""; response.clear(); finishPhoneSetup(); return;
      }
    }
  }
  result.body=""; response.clear(); setupPairing="";
  setupSubmitted=false; setupPairedRequest=false; setupNonce=setupRandom();
  setupStatus="Pairing gagal/tidak pasti. Generate kode baru di Admin, lalu kirim formulir kembali.";
  // Never automatically retry an exchange that could already have consumed its token.
}

void updatePhoneSetup() {
  if(!setupApStarted) {
    if(setupKey>='0' && setupKey<='9' && setupApPassword.length()<12) setupApPassword+=setupKey;
    if(setupKey=='*')setupApPassword="";
    if(setupKey=='#' && setupApPassword.length()>=8) {
      WiFi.mode(WIFI_AP_STA);
      if(!WiFi.softAP(setupApName.c_str(),setupApPassword.c_str())) {
        setupApPassword="";showScreen("SETUP GAGAL","COBA PIN LAGI");return;
      }
      setupApStarted=true;setupStartedAt=millis();
      setupDns.start(53,"*",WiFi.softAPIP());setupHttp.begin();
    } else {
      String masked;for(unsigned i=0;i<setupApPassword.length();i++)masked+='*';
      showScreen("PIN SETUP 8-12",masked+" #=OK *=ULANG");return;
    }
  }
  setupDns.processNextRequest(); setupHttp.handleClient();
  unsigned page=(millis()-setupStartedAt)/4000%2;
  if (page==0) showScreen("SETUP HP AKTIF",setupApName.substring(setupApName.length()-4));
  else showScreen("BUKA DI HP","192.168.4.1");
  if (!setupSubmitted) return;
  if (WiFi.status()!=WL_CONNECTED) {
    if (millis()-setupLastConnect>20000) { setupSubmitted=false; setupStatus="Wi-Fi gagal. Periksa konfigurasi dan coba kembali."; }
    return;
  }
  if (!attendanceClockValid()) {
    if (millis()-setupLastConnect>60000) {
      setupSubmitted=false; setupPairing=""; setupNonce=setupRandom();
      setupStatus="Waktu belum valid. Periksa akses internet/NTP, lalu kirim formulir kembali.";
    }
    return;
  }
  if (deviceSecret.length()>0 && setupPairing.length()==0 && !setupPairedRequest) { finishPhoneSetup(); return; }
  if (!setupPairedRequest && !networkBusy) {
    AttendanceBoundedJsonDocument body(8*1024); body["pairing_code"]=setupPairing;
    String serialized; serializeJson(body,serialized);
    if (startNetworkJob(NetworkJob::PAIRING,"/attendance/device/pair",serialized)) {
      setupPairedRequest=true; setupPairing="";
    }
  }
}
