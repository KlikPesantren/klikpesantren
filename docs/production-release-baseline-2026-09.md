# Production release baseline — September 2026

This record documents the verified source lineage and rollback points after the production source reconciliation. It contains no credentials.

## Canonical Git source

- Release branch: `release/production-reconciled-2026-09`
- Stable backend/Admin tag: `admin-prod-2026-09-stable`
- Stable Wali source tag: `wali-v1.0.0-vc12`
- Runtime lineage base: `390d920a483289dbfb606d2443b585ff33e89e50`
- Universal Wali vc12 source: `3d6b4b26d3f04c2b693f74d6dadfac4b0b8ebc5b`
- The immutable reconciliation commit is the commit resolved by the stable tags.

The vc12 source is a direct descendant of the Admin runtime base. The only changes after `390d920` and before `3d6b4b2` are Universal Wali release assets, configuration, and tests; backend and Admin source trees are identical.

## Production rollback points

- Railway service: `klikpesantren`
- Railway stable deployment: `2eb00909-2362-40d4-9c0c-69f785f8800e`
- Railway stable image digest: `sha256:0bb51809357a2bc56e2e19c36ffb70b06b8624dace0fc0a3582199d3a485bb10`
- Vercel Admin project: `kliksantri-demo2`
- Vercel stable deployment: `dpl_DbLAA8X5P3rctSkoGNaNgt3G3uyp`
- Vercel production alias: `https://app.klikpesantren.com`
- Universal Wali vc12 EAS build: `6c5a0fb2-9f9b-4175-a38f-f57195ca729d`

## Database baseline

- Latest applied migration: `090_sahriyah_membership_idempotency_and_alumni_transition.sql`
- Migrations 072–079 and 082 were restored to Git from exact files whose SHA-256 matches the production migration ledger.
- Historical migration checksum differences were verified as CRLF/LF-only; no SQL content mismatch was found.
- No migration or database mutation was performed during reconciliation.

## Rollback procedure

1. Stop further release actions and record the failing deployment ID.
2. Railway: roll back service `klikpesantren` to deployment `2eb00909-2362-40d4-9c0c-69f785f8800e`.
3. Vercel: reassign `app.klikpesantren.com` to deployment `dpl_DbLAA8X5P3rctSkoGNaNgt3G3uyp`.
4. Do not run migrations or alter financial rows as part of rollback.
5. Verify API root, invalid-login contract, scoped authenticated endpoints, and the Admin production bundle before reopening deployment.
