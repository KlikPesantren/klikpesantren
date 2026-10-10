#pragma once
#include "Arduino.h"
#include <map>
class Preferences {
 public:
  std::map<std::string, String> values;
  bool failPointer = false;
  String getString(const char* key, const char* fallback) { return values.count(key) ? values[key] : String(fallback); }
  size_t putString(const char* key, const String& value) {
    if (failPointer) return 0;
    values[key] = value; return value.size();
  }
};
