#pragma once
#include <string>
#include <cstring>
#include <cstdint>
#include <algorithm>
using std::min;
class String : public std::string {
 public:
  using std::string::string;
  String() = default;
  String(const std::string& value) : std::string(value) {}
  size_t write(uint8_t value) { push_back(static_cast<char>(value)); return 1; }
  size_t write(const uint8_t* value, size_t length) { append(reinterpret_cast<const char*>(value), length); return length; }
  String substring(size_t from, size_t to = std::string::npos) const {
    return from >= size() ? String() : String(substr(from, to == std::string::npos ? to : to - from));
  }
};
