# Evidence — production cutover checklist

Date: 2026-11-05. Preparation only; no production action ran.

## What exists now

`docs/SETUP_GUIDE.md` section 6.2 holds the controlled cutover from the single
development environment to production (D-37):

- preconditions: T6.03 smoke and rollback rehearsal, owner approval, a
  production project with backups and a restore drill, approved hosting and
  spend;
- data clearing: delete synthetic auth accounts and tenant rows, keep the
  migration history and seeded roles, verify every application table is empty;
- production provisioning: migrations, roles, vector extension, indexes,
  CHECK constraints, row-level security, Auth redirect URLs and origins;
- key rotation: new publishable key, service-role key and JWT secret, production
  values only in the host secret store, a web rebuild because `NEXT_PUBLIC_*`
  is baked in, a scan of built assets for the old host and revocation of the
  development service-role key;
- isolation checks before release: one synthetic workspace, own-tenant reads,
  cross-tenant 403, missing credential 401, seeded retention window and one
  `retention.policy_changed` event, no development rows, and a live J-01 run;
- release observation and rollback by redeploying the previous artifacts.

## Why no cutover ran

The cutover needs a production Supabase project, approved hosting, domains,
TLS and spend approval. None exists yet. It also depends on T6.03, which is
open until the owner supplies the hosting target.

## Next step

T6.03 completes. The owner then runs section 6.2 in order, records each result
in `docs/TESTING.md` section 9 and asks for release approval. No automated
production deployment exists.
