#pragma once
#include <cstddef>
#include <cstdint>
// Deterministic checksum double for storage fault tests. ESP32 build uses real mbedTLS SHA-256.
inline int mbedtls_sha256(const unsigned char* data, size_t size, unsigned char* digest, int) {
  uint64_t hash = 1469598103934665603ULL;
  for (size_t i = 0; i < size; ++i) { hash ^= data[i]; hash *= 1099511628211ULL; }
  for (size_t i = 0; i < 32; ++i) digest[i] = (hash >> ((i % 8) * 8)) ^ i;
  return 0;
}
