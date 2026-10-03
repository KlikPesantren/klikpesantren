#ifndef KLIKPESANTREN_ATTENDANCE_PROTOTYPE_TYPES_H
#define KLIKPESANTREN_ATTENDANCE_PROTOTYPE_TYPES_H

#include <Arduino.h>

struct AttendanceHttpResult {
  bool transportOk;
  int httpStatus;
  String body;
};

enum AttendanceTone {
  ATTENDANCE_TONE_SUCCESS,
  ATTENDANCE_TONE_INFO,
  ATTENDANCE_TONE_ERROR
};

#endif
