#pragma once
#include <stdint.h>
#include <string.h>

// Pure policy shared by firmware and executable host regression.
inline bool attendanceCacheFresh(bool trusted, int64_t now, int64_t generated, int64_t expires) {
  return trusted && generated > 0 && expires > generated && expires - generated <= 604800
    && now >= generated && now <= expires;
}
inline bool attendanceWindowActive(int64_t now, int64_t start, int64_t end, const char* state) {
  return state && strcmp(state, "active") == 0 && start < end && now >= start && now < end;
}
enum class ReplayDisposition { RETRY, RECONCILED, QUARANTINE, ACCESS_BLOCKED };
inline ReplayDisposition attendanceReplayDisposition(bool transport, int status, const char* code) {
  if (!transport || status >= 500 || status == 408 || status == 429 || !code || !code[0])
    return ReplayDisposition::RETRY;
  if (status == 401 || status == 403 || strcmp(code, "FEATURE_DISABLED") == 0 ||
      strncmp(code, "DEVICE_", 7) == 0) return ReplayDisposition::ACCESS_BLOCKED;
  if (status >= 200 && status < 300 && (strcmp(code, "ATTENDANCE_RECORDED") == 0 ||
      strcmp(code, "ALREADY_ATTENDED") == 0 || strcmp(code, "STATUS_PROTECTED") == 0))
    return ReplayDisposition::RECONCILED;
  const char* terminal[] = {"EVENT_TOO_OLD", "EVENT_ID_CONFLICT", "UNKNOWN_CREDENTIAL",
    "NOT_ELIGIBLE", "NO_ACTIVE_SESSION", "AMBIGUOUS_CREDENTIAL", "AMBIGUOUS_SESSION",
    "INVALID_EVENT_TIME", "INVALID_EVENT_ID", "INVALID_CREDENTIAL", "ATTENDANCE_POLICY_REJECTED"};
  for (const char* item : terminal) if (strcmp(item, code) == 0) return ReplayDisposition::QUARANTINE;
  return ReplayDisposition::RETRY;
}
