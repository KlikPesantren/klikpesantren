#pragma once
#include "Arduino.h"
#include <map>
#include <memory>
struct HostFs {
  std::map<std::string, String> files;
  bool mounted = true, failOpen = false, shortWrite = false;
  unsigned formats = 0;
};
inline HostFs hostFs;
class File {
 public:
  std::string path;
  bool valid = false;
  explicit operator bool() const { return valid; }
  size_t size() const { return hostFs.files[path].size(); }
  String readString() { return hostFs.files[path]; }
  size_t print(const String& value) {
    size_t written = hostFs.shortWrite ? value.size() / 2 : value.size();
    hostFs.files[path] = value.substr(0, written); return written;
  }
  void flush() {}
  void close() {}
};
class HostLittleFS {
 public:
  bool begin(bool formatOnFail) { if (formatOnFail) throw "automatic format forbidden"; return hostFs.mounted; }
  bool format() { hostFs.formats++; hostFs.files.clear(); hostFs.mounted = true; return true; }
  bool exists(const char* path) const { return hostFs.files.count(path); }
  File open(const char* path, const char* mode) {
    File file; file.path = path;
    if (hostFs.failOpen) return file;
    if (strcmp(mode, "w") == 0) { hostFs.files[path] = ""; file.valid = true; }
    else file.valid = exists(path);
    return file;
  }
};
inline HostLittleFS LittleFS;
