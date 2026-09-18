# Production security hardening - 2026-09-16

No credential values are recorded here. Baseline: `6932895360fe9958884a08cff428a6fe3c87c7f3`.

## Outcome

- GitHub protection is active on `main` and `production`.
- No migration, business/financial mutation, Android build, or Play publication occurred.
- Credential rotation is incomplete: provider scopes cannot create safe replacements, and successful Admin/Wali login fixtures are unavailable for DB/JWT cutover.
- No old credential was revoked.

## Inventory

| Family | Exposure | Rotation | Revoked | Action |
| --- | --- | --- | --- | --- |
| Neon/PostgreSQL | Definite transcript exposure | Blocked | No | Create a second role; cut over only with Admin/Wali login and finance smoke. |
| Admin/platform JWT | Definite transcript exposure | Blocked | No | Rotate separately with known-good Admin login. |
| Wali JWT | Definite transcript exposure | Blocked | No | Rotate separately with known-good Wali login and token-version checks. |
| Cloudinary | Definite; also in ignored root `.env` | Manual | No | Replace in Cloudinary, verify upload/read, update Railway, revoke old, remove local copy. |
| Cloudflare | Definite transcript exposure | Manual | No | Current token cannot manage tokens (403). Create least-privilege Zone DNS Edit/Read token. |
| Vercel | Definite transcript exposure | Manual | No | Automated token creation was rejected by account scope; no orphan was created. |
| Railway/GitHub/EAS session | No evidence of exposure | None | N/A | Values were not printed or stored in service variables. |
| Firebase client config | Public client config | None | N/A | No server service-account private key found. |

Exact current production secrets were absent from Git history. Exact Cloudinary matches exist only in ignored root `.env`. Heuristic history hits were references, fixtures, examples, or redacted documentation.

## Manual rotation sequence

Rotate one family at a time and keep the old credential until every check passes.

1. Vercel: create an expiring team/project token; validate project/domain reads; update only `VERCEL_API_TOKEN`; smoke; revoke old `Klikpesantren Railway` token.
2. Cloudflare: create Zone DNS Edit and Zone Read token for the KlikPesantren zone; validate; update only `CLOUDFLARE_API_TOKEN`; smoke; revoke old.
3. Cloudinary: create replacement; validate ping and safe upload/read; update key+secret together; smoke assets; revoke old; remove old local values.
4. Neon: create a least-privilege second login on the same DB; validate; atomically update Railway DB variables; verify Admin/Wali login, scoped APIs, and finance; revoke old role.
5. JWT: rotate `JWT_SECRET` and `WALI_JWT_SECRET` separately; verify login/logout, old-token rejection, token-version, and tenant/unit/family isolation. Never accept the old secret as fallback.

## Branch protection

Both branches require a pull request, enforce protection for admins, dismiss stale reviews, require conversation resolution, and prohibit force-push and deletion. Required checks remain disabled because no stable CI check names were available; unknown checks could deadlock releases.

## Verification and rollback

- Railway: `KlikPesantren/klikpesantren:production`.
- Vercel: `KlikPesantren/klikpesantren:main`.
- API/Admin/tenant domains stayed healthy; unauthenticated contracts stayed `401`.
- Migration ledger remained clean through `090` read-only.
- Buku Kas mismatch: `Rp0`.
- Sahriyah unit 179 September 2026: 80 bills, Rp21,250,000, mismatch `Rp0`.
- Wallet snapshot: 173 accounts and 1,549 transactions; no mutation.
- Railway rollback: `2eb00909-2362-40d4-9c0c-69f785f8800e`.
- Vercel rollback: `dpl_DbLAA8X5P3rctSkoGNaNgt3G3uyp`.

If a cutover fails, restore the previous credential immediately and redeploy the last healthy revision. Never run migrations or alter financial rows during credential rollback.
