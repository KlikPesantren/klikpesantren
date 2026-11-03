# SUQ SHOGIR integrated WS1–WS4 RC

Use git rev-parse HEAD to identify this candidate. This dossier and runtime/mobile/test files belong to one local commit; no push, production changes or APK build.

Backend parent: 329028cb66d2665b38b036c8b7160bd8e53bec33. Mobile baseline: b0885269c8b0bc2e55f0e27da3c0fdf2d5673c9e. Historical WS1–WS3 reports describe their checkpoints; WS4 findings/readiness supersede their status. No unrelated canonical academic edits included.

- SUQ_SHOGIR_WS4_FINDINGS.md: all 22 IDs; 9 CLOSED locally, 7 PARTIAL, 5 BLOCKED, 1 OPEN.
- BUSINESS_POLICY_DECISIONS.md: seven grouped Owner decisions, none activated.
- SUQ_SHOGIR_RELEASE_READINESS.md: dependencies, acceptance matrix, staged rollout/recovery; not release authorization.
- QA_EVIDENCE.json: local test evidence, not physical/production acceptance.
- SOURCE_MANIFEST.json: SHA-256 of RC source and dossier, excluding itself.

No new migration. Proposed production privilege delta only UPDATE(id) on cash_accounts; never ledger UPDATE. Review actual role/ACL before any separately authorized rollout. Existing Auto Alfa scheduler code is unchanged.

Gate: technical local QA PASS, overall PARTIAL. WS5 may start with policy review and controlled physical acceptance; production GO is not granted.
