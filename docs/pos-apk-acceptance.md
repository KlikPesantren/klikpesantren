# POS Android acceptance APK (not a store release)

Dedicated identity: POS KlikPesantren / com.klikpesantren.pos / 1.0.0 / versionCode 1.
Dedicated EAS project: @kliksantridemo/klikpesantren-pos,
project ID 28970813-9740-42d8-a81d-e762ca36d66c.

Profile `acceptance` builds one internal standalone APK, not a development client or AAB.
It sets POS_ENV=acceptance, POS_REVIEW=1 and EXPO_PUBLIC_POS_ACCEPTANCE=1.
Configured API sentinel is https://pos-acceptance.invalid, not a staging or production API.
All application requests resolve through the existing in-memory synthetic adapter.
Every financial write remains rejected. The API transport also rejects every request
in acceptance mode before fetch, so accidental adapter fallback cannot contact production.
No real login credentials should be entered: boot uses the synthetic context, and after
logout `Masuk review sintetis` restores that context without network authentication.

Use collapsed `Review sintetis` controls to inspect shift-open/closed, cart, receipt,
QRIS pending, RFID preview/insufficient balance, offline and unknown-payment screens.
These are UI fixtures, not proof of backend writes or physical reader support.

Production/staging config cannot enable the acceptance flag; acceptance cannot target
a real API. Production exports must pass scripts/check-review-export.cjs. When switching
bundle environments, use Expo export --clear to invalidate cached public env transforms.

## Isolated upload

The repository also contains unrelated apps and legacy firmware. Use EAS_NO_VCS=1 and
EAS_PROJECT_ROOT set explicitly to the absolute pos-app directory for this acceptance
build only. This uploads the audited POS subtree without Git history or unrelated files;
no Git remote push or main merge is required. pos-app/.easignore excludes generated native
folders, exports, tests, env files and credentials. First inspect the archive and require
the source worktree to be clean. Include the exact local source commit in the EAS message.

Only run eas build --platform android --profile acceptance once after signing setup is
authorized and all checks pass. Do not retry automatically. Check existing build status
if the local connection drops. No auto-submit, production deploy, migration or device action.

Android signing must belong to this dedicated POS application; never reuse or alter
WaliSantri credentials. Creating the first POS signing key requires explicit approval.
Until that approval, no cloud build is started or quota consumed.
