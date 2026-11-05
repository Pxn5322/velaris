# Evidence — T6.06 (retention settings, memory decision, one environment)

Date: 2026-11-05. Branch: `feature/T6.06-retention-settings`.

## Scope

This change closes three T6.01 gaps and answers the owner decisions of
2026-11-05:

- **O-6 (implemented).** Provisioning seeds one `TRACES` retention row per
  tenant with the 30-day default the trace writer already applied. Migration
  `0009_retention_policy_defaults` backfills every existing tenant.
  `GET` and `PUT /settings/retention` expose all three categories behind
  SupabaseAuthGuard, the new `retention.manage` code and the tenant scope
  check. A missing TRACES row now logs a warning.
- **O-2 (decision, D-36).** Memory stays disabled and out of MVP scope. No
  route is added until a producer and an opt-in consent flow exist.
- **O-4 (decision, D-37).** One environment serves development, CI live checks
  and the first deployment. `tests/live/registration.spec.js` is the opt-in
  live J-01 journey; it skips unless `E2E_LIVE_API_URL` is set. J-06 stays
  deferred because it has no UI.

## Commands observed

| Command | Result |
| --- | --- |
| `npm run test --workspace apps/api` | exit 0, 620 tests in 66 files |
| `npm run test` (root) | exit 0, 642 tests (620 API, 22 `packages/ai-evals`) |
| `npm run typecheck` | exit 0 |
| `npm run inventory:check` | exit 0, 41 routes: 38 protected, 3 documented public |
| `npx prisma validate` | valid |
| `npx prisma migrate deploy` (local `DATABASE_URL`) | exit 0, `0009_retention_policy_defaults` applied to the development database |
| `npm run format:check` | exit 0 |
| `npm run lint` | exit 0, 14 known warnings in two existing API spec files |
| `npm run build` | exit 0 |
| `python scripts/check_docs.py --draft` | 100/100 |
| `npm run e2e:web` | exit 0, 47 passed and 2 skipped (the live registration spec) |

## RED → GREEN

- RED: `retention.controller.integration.spec.ts` failed with `Cannot find
  module './retention.controller.js'` before the controller existed.
- RED: `signup.retention.spec.ts` failed on the absent
  `retentionPolicy.create` call before provisioning seeded the row.
- GREEN: 13 new tests pass — 9 retention route cases (401, 403 role, 400 no
  scope, 403 foreign tenant, 200 list, 400 window, 400 category, 200 write
  with audit, 403 write role), 1 provisioning case, 3 default-helper cases.

## Denial and tenant coverage

The route tests assert that a caller without `retention.manage` and a caller
without an active membership in the named tenant both fail before any policy
row is read or written. A write outside the caller's tenant answers 403 and
creates neither a row nor an audit event.

## Live check (2026-11-05)

The opt-in registration journey ran against the single environment with the
current Supabase keys:

- API on `http://localhost:3000` (local `DATABASE_URL`, current project keys)
  and the production web build on `http://localhost:3001`.
- API root returned 200 and the web root returned 200.
- `E2E_LIVE_API_URL=http://localhost:3000 E2E_BASE_URL=http://localhost:3001
  npx playwright test tests/live` → 2 passed in 6.6 s.
- The journey created a synthetic workspace (`live-check+<timestamp>@velaris.test`),
  signed the new owner in and landed on the admin view (J-01). The protected
  route returned 401 without a credential.
- The run created one synthetic Supabase auth account and one tenant with its
  seeded TRACES row in the development project. The owner clears that data
  before production (D-37). No secret entered the transcript or the log.

## Limits

- The live registration journey is verified locally. Against a hosted
  deployment it still runs once in the T6.03 smoke check, which covers TLS,
  CORS and the deployed origins that a local run cannot prove.
- The retention panel lives in the admin "System Settings" tab and is
  covered by `tests/retention.spec.js` (five journeys).
- `updated_by` stores the actor's identity-provider subject. The column has no
  foreign key and the route has no application user row at hand.
