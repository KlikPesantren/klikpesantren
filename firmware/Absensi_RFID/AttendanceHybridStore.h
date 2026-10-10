#pragma once

#include <Arduino.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <mbedtls/sha256.h>

class AttendanceDualSlotStore {
 public:
  AttendanceDualSlotStore(
    Preferences& preferences,
    const char* pointerKey,
    const char* firstPath,
    const char* secondPath,
    size_t maximumBytes
  ) : prefs_(preferences), pointerKey_(pointerKey), firstPath_(firstPath),
      secondPath_(secondPath), maximumBytes_(maximumBytes) {}

  bool exists() const { return LittleFS.exists(firstPath_) || LittleFS.exists(secondPath_); }

  bool load(String& payload, bool allowFallback = true) {
    String active = prefs_.getString(pointerKey_, "a");
    if (readSlot(active == "b" ? secondPath_ : firstPath_, payload)) return true;
    // Queue recovery must not roll back to an older queue and lose acknowledged writes.
    if (!allowFallback) return false;
    String fallback;
    if (!readSlot(active == "b" ? firstPath_ : secondPath_, fallback)) return false;
    payload = fallback;
    return prefs_.putString(pointerKey_, active == "b" ? "a" : "b") > 0;
  }

  bool save(const String& payload) {
    if (payload.length() == 0 || payload.length() > maximumBytes_) return false;
    String active = prefs_.getString(pointerKey_, "a");
    String target = active == "b" ? "a" : "b";
    const char* path = target == "b" ? secondPath_ : firstPath_;
    String header = sha256(payload) + "\n";

    File output = LittleFS.open(path, "w");
    if (!output) return false;
    size_t written = output.print(header);
    written += output.print(payload);
    output.flush();
    output.close();
    if (written != payload.length()+65) return false;

    // Verify every persisted byte without allocating another full queue copy.
    File verification=LittleFS.open(path,"r");
    if (!verification || verification.size()!=payload.length()+65) return false;
    uint8_t block[256]; size_t offset=0; bool equal=true;
    while(offset<verification.size()) {
      size_t requested=min(sizeof(block),verification.size()-offset);
      size_t read=verification.read(block,requested);
      if(read!=requested){equal=false;break;}
      for(size_t i=0;i<read;i++) {
        char expected=offset+i<65 ? header[offset+i] : payload[offset+i-65];
        if(block[i]!=static_cast<uint8_t>(expected)){equal=false;break;}
      }
      if(!equal)break; offset+=read;
    }
    verification.close(); if(!equal)return false;
    return prefs_.putString(pointerKey_, target) > 0;
  }

  bool readSlot(const char* path, String& payload) {
    File input = LittleFS.open(path, "r");
    if (!input || input.size() < 66 || input.size() > maximumBytes_ + 65) {
      if (input) input.close();
      return false;
    }
    uint8_t header[65];
    if(input.read(header,sizeof(header))!=sizeof(header) || header[64]!='\n') {input.close();return false;}
    payload = input.readString();
    input.close();
    if (payload.length() == 0 || payload.length() > maximumBytes_) return false;
    header[64]=0;
    return constantTimeEqual(String(reinterpret_cast<char*>(header)), sha256(payload));
  }

  static String sha256(const String& value) {
    unsigned char digest[32];
    mbedtls_sha256(
      reinterpret_cast<const unsigned char*>(value.c_str()),
      value.length(),
      digest,
      0
    );
    static const char HEX_DIGITS[] = "0123456789abcdef";
    char output[65];
    for (size_t index = 0; index < sizeof(digest); index++) {
      output[index * 2] = HEX_DIGITS[(digest[index] >> 4) & 0x0F];
      output[index * 2 + 1] = HEX_DIGITS[digest[index] & 0x0F];
    }
    output[64] = '\0';
    return String(output);
  }

 private:
  Preferences& prefs_;
  const char* pointerKey_;
  const char* firstPath_;
  const char* secondPath_;
  size_t maximumBytes_;

  static bool constantTimeEqual(const String& left, const String& right) {
    if (left.length() != right.length()) return false;
    unsigned char difference = 0;
    for (size_t index = 0; index < left.length(); index++) {
      difference |= static_cast<unsigned char>(left[index] ^ right[index]);
    }
    return difference == 0;
  }
};
