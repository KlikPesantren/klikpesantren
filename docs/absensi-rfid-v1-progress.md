# Absensi RFID V1 — software verification, 3 Oktober 2026

Canonical repository: `C:\Users\hi\Documents\0Aiki\Administrasi Santri Digital\klikpesantren`.
Protected-main baseline: `c2f5e5b53d3f5e479a2ea2f71c3f8691a7fa3b7e`.
Physical flash/acceptance is NOT performed by the software tests.

## Implemented

- Single active universal sketch `firmware/Absensi_RFID/Absensi_RFID.ino`;
  old EDC01/EDC02 sources preserved byte-for-byte as non-uploadable archives.
- Phone setup, masked operator-chosen WPA2 setup PIN, local captive portal,
  bounded Wi-Fi/NTP failure recovery, existing-device Wi-Fi recovery via held D.
- Hashed, expiring, one-time pairing; CSPRNG credential with bcrypt cost 12;
  transactional exchange/recovery and explicit Admin device management/adoption.
- Tenant/unit/permission authority remains server-side; no automatic legacy
  device classification or credential/UID backfill.
- Canonical lowercase hex UID across firmware, cache, registration and lookup;
  nonhex legacy remains exact and ambiguous collisions fail closed.
- Local-first durable tap; bounded cache/queue and actual ArduinoJson 7 heap
  allocator; background refresh/replay never makes foreground HTTP requests.
- Scheduled manual H/I/S, protected legacy/canonical correction bridge,
  audit provenance, recurring multi-unit sessions, server-side idempotent auto-A,
  overdue materialized occurrence recovery and isolated job failures.
- Guru canonical manual/session/auto-A; guru RFID enrollment remains unavailable
  rather than inventing a credential source.
- Shared canonical + unmatched legacy Admin/Wali reads with existing child/unit
  ownership guards. No second Attendance truth.

## Software evidence

- Final source/executable aggregator: 22 suites PASS.
- Authenticated actual localhost routers against representative PostgreSQL branch:
  Admin JWT/session/tenant/RBAC; Wali two children/three contexts A→B→A,
  wrong-child/foreign-unit rejection, no-scope fail closed.
- Real PostgreSQL pairing/replay/replacement, unit assignment, occurrence
  uniqueness, santri/guru auto-A idempotency, late A→H, protected I/S, shared
  history, authorized disposable tenant cascade and forced rollback PASS.
  All fixtures, DDL and rehearsal grants rolled back. Production writes: zero.
- Migration 093 UP → verify → DOWN → verify → second UP PASS in the guarded
  non-production branch; existing device rows/columns preserved; outer rollback.
- Runtime metadata rehearsal: pairing SELECT/INSERT/UPDATE + sequence USAGE only;
  no pairing DELETE, elevated role flags or ownership.
- ESP32 core 3.3.8 / esp32:esp32:esp32 compile PASS. Resource numbers are recorded
  in the final report; compile does not prove physical peak heap or Wi-Fi/LCD UX.
- Host actual foreground function: 100/100 next-ready while network busy.
  Observed median 1.722 ms / p95 4.265 ms (mock filesystem/LCD, NOT ESP32 timing).
- Worst physical UID/event fixture: 128 durable queue rows PASS; queue allocator
  peak 52,789 bytes on 64-bit host; dual-slot files 74,315 bytes. Overflow,
  corruption, reboot and write-failure handling tested.
- Frontend multi-unit wiring/build and targeted ESLint PASS.
- Established production READ-ONLY Buku Kas reconciliation: Rp0 mismatch.
  Sahriyah canonical KPI reconciliation: Rp0 mismatch, financial snapshot unchanged.
  Wallet running ledger/account balance mismatch: Rp0. Payment/Wallet row hashes
  unchanged during the read-only safety check. Historical cache untouched.

## Release boundary

Production migration 093, grants, deploy and physical flash are not implied by
these results. Before production migration, independently confirm canonical
Neon production branch/endpoint and backup/recovery readiness using the established
provider workflow. Do not fall back to raw DB_HOST hash, bypass migration ledger
integrity, or run DOWN on production.

Use protected PR/check/merge workflow, deploy exact merged SHA only after release
gates, and run production-safe smoke. Only then proceed to owner-operated physical
acceptance. Phone/AP behavior, target peak heap/TLS coexistence and actual LCD/tap
timing remain physical acceptance metrics, not invented software PASS claims.
