# Attendance V1 hybrid terminal

The online contract remains `POST /attendance/events`. A tap keeps one NVS-backed
event ID and its original RFC3339 timestamp through timeout fallback and replay.
Only the server resolves identity, occurrence, eligibility and final H/I/S/A status.
No Wallet, payment, POS, schema or EDC02 changes are included.

## Bootstrap and authorized cache

`GET /attendance/device/snapshot` uses existing secure device authentication and
tenant `pendidikan` + `rfid` entitlement gates. Query parameters cannot select or
broaden tenant/unit authority. The assigned active device unit determines scope.
Offline eligibility is deliberately restricted to active, enrolled members of that
unit; combined sessions are included only when the unit belongs to their scope.
The existing online adapter retains its canonical multi-unit resolution.

The repeatable-read snapshot contains timezone, session schedules/weekdays,
UTC occurrence windows (including cancellation), and minimal RFID eligibility.
Existing occurrences use their immutable occurrence-unit scope. Credential
ambiguity checks use the same exact UID identity semantics as server ingestion,
including conflicting identities elsewhere in the tenant. No names/contact data,
balances, payments or device credentials are exported.

Limits: 200 credentials, 16 sessions, 128 windows, 24 KiB JSON. Requests beyond
these limits fail explicitly rather than returning a truncated authoritative cache.
Refresh is every 60 seconds (server metadata) and after reconnect; failed refresh retries after one
minute and preserves the valid previous cache. Expiry is at most seven days.
UTC windows are computed server-side from the tenant timezone, avoiding ad hoc
timezone/DST conversion in firmware. Offline status is candidate HADIR only.

Raw UIDs are required for device matching and replay of the existing POST contract.
They remain in local Attendance files and authenticated TLS payloads. Files are
not encrypted by this firmware; physical flash protection/encryption is a hardware
deployment concern. Neither the snapshot nor queue has a public download/Serial
dump command. Raw UID display occurs only during unknown-card enrollment feedback.

## Time and reconnect

NTP callback establishes trust for the current boot. ESP32 running time remains
usable through Wi-Fi/internet loss while powered, with a seven-day trust limit.
Cold boot without network/confirmed RTC cannot accept new events. Persisted cache
and previously timestamped queue survive; LCD requests internet for valid time.
NTP is requested again after reconnect. Wi-Fi connection attempts use one begin
call, timeout and backoff. A single background task serializes bounded HTTPS work,
so heartbeat/bootstrap/replay do not block the main RFID/Serial loop. During a
background request, a valid tap is queued immediately. A foreground POST can wait
up to six seconds; subsequent cards resume after its explicit result.

## Durable local storage

New Attendance files only: `/att_cache_a`, `/att_cache_b`, `/att_queue_a`,
`/att_queue_b`. NVS pointers `att_cache_slot` and `att_queue_slot` select committed
slots. Each file is `SHA256(payload)`, newline, then payload. Cache payload is
scope fingerprint, newline, snapshot JSON. Queue payload is format-1 JSON:
context fingerprint plus events containing the original four-field request,
occurrence key, epoch, dedupe deadline, state and optional outcome.

Writes target the inactive slot, flush/close, reread/checksum/verify, then commit
the NVS pointer. Success is reported only after this procedure succeeds. Cache
can recover from the other valid slot and repairs its pointer before another
write. Queue never falls back to an older slot automatically: corrupt active queue
fails closed and preserves both files for controlled recovery. Filesystem mount
failure never formats existing data; first-use formatting is allowed only after
every byte of the filesystem partition has been verified erased.

Queue is bounded by 96 records and 32 KiB. Full/write failure shows an error and
never claims offline success. Immediate online submission remains available when
storage is full. Pending and quarantined records never expire automatically.
Successful receipts persist through the occurrence window to suppress duplicate
local taps, then may be pruned. NVS `att_counter` is incremented before using an
event ID; failed writes may leave harmless gaps, never reused IDs.

## Reconciliation and observability

Oldest pending capture is replayed first with the exact original body. Network,
5xx, 408, 429 and malformed/unknown responses retain the event with exponential
backoff capped at five minutes. `ATTENDANCE_RECORDED`, `ALREADY_ATTENDED` and
`STATUS_PROTECTED` mark reconciliation only after the server confirms it; protected
I/S/manual status remains authoritative. Terminal semantic rejections are retained
as quarantined review records, including expired events and ID conflicts.
401/403 pauses replay/new local acceptance until an authenticated snapshot succeeds.
Persist failure after a server response retains a pending item for idempotent replay.
Items are matched by event ID, so intervening appends/pruning cannot mark another
item by a stale array index.

LCD distinguishes online/offline readiness, no cache, stale cache, time invalid,
durable offline success, sync remaining, and review records. `SHOW` emits only
configuration presence and aggregate pending/review/cache/storage status. Existing
heartbeat remains backward compatible; no observability schema changes are needed.

## Validation and physical acceptance

`npm run test:attendance-hybrid-v1` runs backend snapshot/auth route integration
with synthetic DB dependencies, then compiles and executes the actual C++ cache,
queue and policy against filesystem/NVS fault doubles. Set `CXX` to a C++17 compiler
and `ARDUINOJSON_INCLUDE` to ArduinoJson 7 headers if absent from default locations.
The host SHA function is a deterministic fault-test double; actual ESP32 compilation
uses mbedTLS SHA-256. Hardware/flash timing and physical power cuts still require
the manual device plan. The automated tests do not claim physical acceptance.

After reviewed integration/backend deployment and a separately authorized normal
non-erase flash: test known/unknown online cards; disable Wi-Fi while powered;
tap several known cards during a valid session; repeat one card; restore Wi-Fi;
confirm automatic replay and Admin results; verify queued records survive reboot;
finally cold-boot without Wi-Fi and confirm new taps are refused until NTP sync.
Preserve the frozen keypad, RC522, LCD/buzzer mapping and `offline` provisioning
namespace. EDC02 remains the reference device.
