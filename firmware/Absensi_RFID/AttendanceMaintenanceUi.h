#pragma once
#include <stdint.h>

// Pure local UI: no network, credential, storage or Attendance mutation authority.
enum class AttendanceView { STANDBY, MAIN_MENU, STATUS_VIEW, WIFI_SETUP, SYNC_VIEW, INFO_VIEW, SETUP_REQUIRED };
struct AttendanceMaintenanceUi {
  AttendanceView view = AttendanceView::STANDBY;
  uint32_t touched = 0, syncFinishedAt = 0;
  unsigned page = 0;
  bool wifiRequested = false, syncRequested = false, syncFinished = false, syncOk = false;
  void open(AttendanceView next, uint32_t now) { view=next; touched=now; page=0; }
  bool scanningAllowed() const { return view==AttendanceView::STANDBY; }
  void key(char key, uint32_t now) {
    if (!key || key=='A' || key=='B' || key=='C') return;
    touched=now;
    if (view==AttendanceView::STANDBY) {
      if(key=='#') open(AttendanceView::MAIN_MENU,now);
    } else if(view==AttendanceView::SETUP_REQUIRED) {
      if(key=='#') { open(AttendanceView::WIFI_SETUP,now); wifiRequested=true; }
    } else if(view==AttendanceView::MAIN_MENU) {
      if(key=='D') open(AttendanceView::STANDBY,now);
      else if(key=='1') open(AttendanceView::STATUS_VIEW,now);
      else if(key=='2') { open(AttendanceView::WIFI_SETUP,now); wifiRequested=true; }
      else if(key=='3') { open(AttendanceView::SYNC_VIEW,now); syncRequested=true; syncFinished=false; }
      else if(key=='4') open(AttendanceView::INFO_VIEW,now);
    } else if(view==AttendanceView::STATUS_VIEW || view==AttendanceView::INFO_VIEW) {
      if(key=='D') open(AttendanceView::MAIN_MENU,now);
      else if(key=='#') page++;
    } else if(view==AttendanceView::SYNC_VIEW && key=='D') open(AttendanceView::MAIN_MENU,now);
  }
  // Keypad library HOLD is generated only after a continuous 3000ms physical hold.
  void holdD(uint32_t now) {
    if(view==AttendanceView::STANDBY) { open(AttendanceView::WIFI_SETUP,now); wifiRequested=true; }
  }
  void cancelled(bool configured, uint32_t now) {
    wifiRequested=false;
    open(configured ? AttendanceView::STANDBY : AttendanceView::SETUP_REQUIRED,now);
  }
  void synced(bool ok,uint32_t now) { syncFinished=true; syncOk=ok; syncFinishedAt=now; }
  void tick(uint32_t now) {
    if(view==AttendanceView::SYNC_VIEW && syncFinished && uint32_t(now-syncFinishedAt)>=3000)
      open(AttendanceView::MAIN_MENU,now);
    if((view==AttendanceView::MAIN_MENU || view==AttendanceView::STATUS_VIEW || view==AttendanceView::INFO_VIEW) && uint32_t(now-touched)>=30000)
      open(AttendanceView::STANDBY,now);
  }
};
