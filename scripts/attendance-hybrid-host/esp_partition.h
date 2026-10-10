#pragma once
#include <cstddef>
#include <cstring>
const int ESP_PARTITION_TYPE_DATA = 1, ESP_PARTITION_SUBTYPE_DATA_SPIFFS = 2, ESP_OK = 0;
struct esp_partition_t { size_t size; };
inline bool hostPartitionErased = false;
inline const esp_partition_t* esp_partition_find_first(int, int, const char*) {
  static esp_partition_t partition = {512}; return &partition;
}
inline int esp_partition_read(const esp_partition_t*, size_t, void* output, size_t length) {
  memset(output, hostPartitionErased ? 0xff : 0x01, length); return ESP_OK;
}
