#include <cassert>
#include <iostream>
#include "AttendanceMaintenanceUi.h"
#include "setup-cancel.h"
int main() {
  AttendanceMaintenanceUi ui;
  for(char k:std::string("ABC*0123456789D")) ui.key(k,1);
  assert(ui.scanningAllowed() && !ui.wifiRequested && !ui.syncRequested);
  ui.key('#',10); assert(ui.view==AttendanceView::MAIN_MENU && !ui.scanningAllowed());
  ui.key('1',20); assert(ui.view==AttendanceView::STATUS_VIEW);
  ui.key('#',30); assert(ui.page==1 && !ui.syncRequested && !ui.wifiRequested);
  ui.key('D',40); ui.key('4',50); assert(ui.view==AttendanceView::INFO_VIEW);
  ui.key('#',60); assert(ui.page==1 && !ui.syncRequested && !ui.wifiRequested);
  ui.key('D',70); ui.key('D',80); assert(ui.scanningAllowed());
  ui.key('D',100); ui.tick(3100); assert(!ui.wifiRequested); // short D cannot synthesize HOLD
  ui.holdD(3101); assert(ui.view==AttendanceView::WIFI_SETUP && ui.wifiRequested);
  ui.cancelled(true,3200); assert(ui.scanningAllowed());
  ui.cancelled(false,3300); assert(ui.view==AttendanceView::SETUP_REQUIRED && !ui.scanningAllowed());
  ui.key('#',3400); assert(ui.wifiRequested);
  ui.cancelled(true,3500); ui.key('#',3600); ui.tick(33599); assert(!ui.scanningAllowed());
  ui.tick(33600); assert(ui.scanningAllowed());
  ui.key('#',34000); ui.key('3',34001); assert(ui.syncRequested && !ui.scanningAllowed());
  ui.synced(false,35000); ui.tick(38000); assert(ui.view==AttendanceView::MAIN_MENU);
  ui.key('D',38001); assert(ui.scanningAllowed());
  // Execute the actual firmware cancel handler with isolated hardware/NVS mocks.
  setupPreviousSsid="previous-network"; setupPreviousPassword="synthetic-test-only";
  wifiSsid="candidate-network"; wifiPassword="candidate-test-only";
  const auto identityBefore=deviceSecret; const auto queueBefore=queueFixture; const auto cacheBefore=cacheFixture;
  cancelPhoneSetup();
  assert(wifiSsid=="previous-network" && wifiPassword=="synthetic-test-only");
  assert(deviceSecret==identityBefore && queueFixture==queueBefore && cacheFixture==cacheBefore);
  assert(!setupMode && !setupApStarted && setupHttp.stopped && setupDns.stopped && WiFi.apStopped && WiFi.disconnected);
  assert(configDirty && runtimeState==RuntimeState::LOAD_CONFIG && maintenanceUi.scanningAllowed());
  configured=false; cancelPhoneSetup(); assert(maintenanceUi.view==AttendanceView::SETUP_REQUIRED);
  networkBusy=true; networkJob=NetworkJob::PAIRING; setupMode=true;
  cancelPhoneSetup(); assert(setupCancelRequested && setupMode); // settle one-time exchange before AP teardown
  runtimeState=RuntimeState::READY;
  scheduleBackgroundNetwork(); assert(jobs==0 && manualRefreshPending); // never overlap a worker
  networkBusy=false; scheduleBackgroundNetwork();
  assert(jobs==1 && networkJob==NetworkJob::SNAPSHOT && lastEndpoint=="/attendance/device/snapshot");
  assert(!manualRefreshPending && manualRefreshActive);
  assert(queueFixture==queueBefore && cacheFixture==cacheBefore); // refresh request is not a destructive operation
  std::cout<<"PASS maintenance state navigation, timeout, reserved keys, sync feedback, actual setup cancellation/preservation and pairing race guard\n";
}
