const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..'), dir=path.join(root,'firmware/Absensi_RFID');
const sketch=fs.readFileSync(path.join(dir,'Absensi_RFID.ino'),'utf8');
const setup=fs.readFileSync(path.join(dir,'AttendancePhoneSetup.h'),'utf8');
const cancel=setup.match(/void cancelPhoneSetup\(\) \{[\s\S]*?\n\}/)?.[0]; assert(cancel);
const schedule=sketch.match(/void scheduleBackgroundNetwork\(\) \{[\s\S]*?\n\}/)?.[0]; assert(schedule);
assert(!/prefs\.|hybrid\./.test(cancel),'Cancel must never write identity, cache or queue');
assert(sketch.includes('setupHoldArmed && !setupHoldConsumed && keypad.getState()==HOLD'));
assert(sketch.includes('setHoldTime(3000)'));
assert(sketch.includes('rowPins[ROWS] = { 13, 14, 27, 26 }'));
assert(sketch.includes('colPins[COLS] = { 25, 33, 32, 15 }'));
for(const row of ["{ '1', '2', '3', 'A' }","{ '4', '5', '6', 'B' }","{ '7', '8', '9', 'C' }","{ '*', '0', '#', 'D' }"]) assert(sketch.includes(row));
assert(sketch.includes('if (!maintenanceUi.scanningAllowed()) { scheduleBackgroundNetwork(); return; }'));
assert(sketch.includes('manualRefreshPending=false; manualRefreshActive=true;'));
assert(sketch.includes('bool installed = hybrid.installCache(snapshot, checksum)'));
assert(!/prefs\.clear|prefs\.remove|setInsecure/.test(sketch+setup));
assert(!/Serial\.(print|println|printf)/.test(setup));
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'attendance-maintenance-'));
try {
  fs.writeFileSync(path.join(temp,'setup-cancel.h'),`
#include <string>
using String=std::string;
enum class NetworkJob {NONE,PAIRING,SNAPSHOT,REPLAY}; NetworkJob networkJob=NetworkJob::NONE;
enum class RuntimeState {READY,LOAD_CONFIG}; RuntimeState runtimeState=RuntimeState::READY;
AttendanceMaintenanceUi maintenanceUi;
bool networkBusy=false,setupMode=true,setupApStarted=true,setupSubmitted=true,setupPairedRequest=false;
bool setupCancelRequested=false,runtimeConfigReady=true,wifiAttemptActive=true,configDirty=false,configured=true;
String setupPreviousSsid,setupPreviousPassword,wifiSsid,wifiPassword,setupPairing,setupApPassword,setupNonce;
String deviceSecret="synthetic-secret",queueFixture="pending",cacheFixture="last-good";
unsigned nextWifiAttemptAt=0; unsigned millis(){return 100;}
struct StopMock{bool stopped=false;void stop(){stopped=true;}} setupHttp,setupDns;
const int WIFI_STA=1;
const int WL_CONNECTED=3;
struct WifiMock{bool apStopped=false,disconnected=false;void softAPdisconnect(bool){apStopped=true;}void mode(int){} void disconnect(bool,bool){disconnected=true;} int status(){return WL_CONNECTED;}} WiFi;
void refreshRuntimeConfigReady(){runtimeConfigReady=configured;}
void transitionTo(RuntimeState s){runtimeState=s;}
${cancel}
bool manualRefreshPending=true,manualRefreshActive=false,attendanceAccessBlocked=false,backendReachable=true;
unsigned nextCacheAttemptAt=1000,nextReplayAt=0;
int replayIndex=-1; String replayEventId;
struct HybridMock{bool healthy=true;bool refreshDue(long){return false;}int oldestPending(){return -1;}String eventId(int){return "synthetic";}String replayBody(int){return "synthetic";}} hybrid;
bool attendanceClockValid(){return true;}
int jobs=0; String lastEndpoint;
bool startNetworkJob(NetworkJob job,const String& endpoint,const String&){jobs++;networkBusy=true;networkJob=job;lastEndpoint=endpoint;return true;}
void sendHeartbeatIfDue(){}
#define time(x) 100
${schedule}
#undef time
`);
  const exe=path.join(temp,process.platform==='win32'?'test.exe':'test');
  for(const [command,args] of [[process.env.CXX||'g++',['-std=c++17','-I',dir,'-I',temp,path.join(__dirname,'attendance-hybrid-host/maintenance.cpp'),'-o',exe]],[exe,[]]]) {
    const result=spawnSync(command,args,{stdio:'inherit'}); if(result.error)throw result.error; assert.equal(result.status,0);
  }
} finally {fs.rmSync(temp,{recursive:true,force:true});}
