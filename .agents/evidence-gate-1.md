# GATE-1 evidence record

## Identity
- Gate: GATE-1 (Phase 1 - identity, tenancy and governance)
- Scope: T1.01, T1.02, T1.03, T1.04
- Captured by (role): orchestrator, SIMULATED (sequential passes in one context; no independent reviewer agent was configured in this environment)
- Original capture: 2026-10-26, scored 100/100
- Independent review pass: 2026-10-27. The review scored the original record 89/100 and raised four findings. This version records the fixes and the re-score.

## Review findings and fixes (2026-10-27)

| # | Finding | Fix |
| --- | --- | --- |
| 1 | `format` failed in both workspaces (the 20-point rubric row names format), and no CI job enforced it | Prettier ran over `apps/api` and `apps/web`. 25 API files had content drift; the 33 web files differed only by line endings. `format:check` scripts added to `apps/api` and to the root, plus a `format` job in `.github/workflows/ci.yml` and a Format row in TESTING.md section 2. A second failure appeared after the merge: `core.autocrlf=true` rewrote the merged files to CRLF, and Prettier's default `endOfLine` is `lf`, so correct code was flagged on line endings alone. `endOfLine: auto` is now set in both Prettier configs; the check was re-run after a fresh checkout and merge and exits 0 |
| 2 | AC-F03-1 was mapped to a passing test, but no governance endpoint exists | The claim was withdrawn at review time, then closed properly on 2026-10-27: `GovernanceController` implements create tenant, set tenant status and replace membership role behind the real guard chain. `governance.controller.integration.spec.ts` asserts persistence and audit emission for all three actions |
| 3 | AC-F03-2 covered only the role half | Two tests added to `tickets.controller.integration.spec.ts`: unknown tenant identifier rejected (403) and body/query identifier mismatch rejected (400). Role and user halves were already covered by `database-role-resolver.spec.ts` |
| 4 | Migration `0003_support_schema` was recorded in Supabase's history only, so `prisma migrate deploy` would re-run it and fail | Its row was inserted into `public._prisma_migrations` with the SHA-256 checksum that matches the local `migration.sql` (the same algorithm verified against `0001_init` and `0002_roles_and_audit`). Rule recorded in DATABASE.md section 7 |

Also fixed: `scripts/audit-baseline.json` dropped the 5 advisories that are already fixed, so the gate can no longer mask a regression in those packages. The baseline is now 8 entries, matching the current audit.

## Commands (all re-run on the fixed state, exit codes captured without a pipeline)

| # | Command | Exit code | Result |
| --- | --- | --- | --- |
| 1 | `npm run test` | 0 | 109 tests, 17 files, all pass |
| 2 | `npm run test:cov --workspace apps/api` | 0 | 100% statements/branches/functions/lines, all files |
| 3 | `npm run e2e` (API boot spec) | 0 | 1 test pass |
| 4 | `npm run lint` (API oxlint, web ESLint) | 0 | 0 errors, 0 warnings |
| 5 | `npm run typecheck` | 0 | exit 0 |
| 6 | `npm run build` | 0 | nest + next build green |
| 7 | `npm run format:check` | 0 | both workspaces Prettier-clean |
| 8 | `npm run audit:check` | 0 | 8 advisories in baseline, PASS, no fixed package left in the baseline |
| 9 | `python scripts/check_docs.py --draft` | 0 | 0 errors, 0 warnings, 100/100 |
| 10 | `npm run e2e:web` (rendering) | 0 | 3/3 AC-F01-1 journeys pass against the rebuilt app |

## Live evidence (real Supabase project, read-only SQL re-run on 2026-10-27)

| Path | Observed result |
| --- | --- |
| No credential to `GET /auth/session` | 401, consistent body (run log 2026-10-26, not re-run in this pass) |
| Forged/expired bearer token | 401, same body (run log 2026-10-26, not re-run in this pass) |
| Real token to `GET /auth/session` | 200, identity and tenant context resolved (run log 2026-10-26, not re-run in this pass) |
| Real token to `POST /tickets?tenantId=<own>` | 201; 3 `ticket.created` rows in `audit_events` |
| Second user without `ticket.read` | 403 `Missing permission: ticket.read`; 1 `permission.denied` row with real actor, role and tenant |
| Migration `0003_support_schema` | applied: `customers`, `conversations`, `messages`, `tickets` exist with the expected columns; 4 CHECK constraints read back from `pg_constraint`; 3 rows now present in `public._prisma_migrations`, checksums matching the local files |

## Acceptance criteria mapping

| Criterion | Proof | Status |
| --- | --- | --- |
| AC-F02-1 | `auth.controller.integration.spec.ts`, `tenants.service.spec.ts` + live session call | pass |
| AC-F02-2 | `supabase-auth.guard.spec.ts`, `supabase-token-verifier.service.spec.ts` + live 401 matrix | pass |
| AC-F02-3 | `permissions.integration.spec.ts`, `tickets.controller.integration.spec.ts` + live R-developer 403 | pass |
| AC-F03-1 | `governance.controller.integration.spec.ts` (10 cases: three audited writes plus denial and validation) | pass |
| AC-F03-2 | unknown tenant identifier and body/query mismatch in `tickets.controller.integration.spec.ts`; unknown role code and absent user row in `database-role-resolver.spec.ts` | pass (after fix 3) |
| AC-F03-3 | `authorization.service.spec.ts`, `permissions.integration.spec.ts` (tenant admin lacks platform governance) | pass |
| AC-F04-1 | `tickets.controller.integration.spec.ts` (scope check per request) | pass |
| AC-F04-2 | `authorization.service.spec.ts` (disabled tenant rejects operations) | pass |
| AC-F04-3 | cross-tenant guess 403, live and in specs | pass |
| AC-F11-1 | audit rows carry actor, tenant, resource and metadata | pass |
| AC-F11-3 | restricted audit read gated by `AUDIT_READ`; R-developer denied | pass |

All 10 Phase 1 criteria are satisfied.

## Denial and validation checks
- Missing credential, malformed header, forged token: 401 (live + specs).
- Authenticated principal without permission: 403 with audit emission (live + specs).
- Cross-tenant resource guess: 403 (live + specs).
- Unknown tenant identifier: 403 (new test).
- No tenant scope supplied: 400 (deny by default).
- Body tenant identifier that contradicts the query: 400 (new test).
- Unknown/absent role resolves to deny (resolver specs).
- Disabled tenant: rejected (authorization specs).
- Audit write failure cannot mask a 403 (regression spec from the live FK finding).
- Residual: request-body field validation is absent. `main.ts` has no `ValidationPipe` and the DTOs carry no decorators. Adding `class-validator` is a new runtime dependency and needs a D-xx decision first.

## Scope check
- Changes stayed inside each task's declared `files:` scope. This review added the format scripts, the CI `format` job, the two AC-F03-2 tests, the migration-history reconciliation rule and the documentation sync.
- New runtime dependencies: none. `class-validator` was deliberately not added (see above).
- One write to the development database: the `0003_support_schema` row inserted into `public._prisma_migrations`. Reversible with a single DELETE, development project only.

## Score (AGENTS.md section 4)

| Check | Points | Evidence |
| --- | --- | --- |
| RED seen | 15 | RED recorded in the run log for T1.02, T1.03, T1.04 and T2.01 with the failing reason for each. The 2026-10-27 additions are regression tests for behaviour that already passed, so they carry no RED |
| Task tests pass | 20 | 109/109 |
| Full suite, format, lint, type check and build pass | 20 | all six exit 0, including `format:check` after the fix |
| Criteria map to tests | 15 | 10 of 10 Phase 1 criteria map to a passing test |
| Denial and validation tests | 9 | full denial matrix plus identifier validation; body-field validation still absent |
| Diff within scope | 10 | per-task scope respected, no unlogged dependency |
| Docs synced | 10 | plan run log, TESTING matrix and note, DATABASE tracking rule, audit counts corrected in AGENTS.md and TESTING.md |
| **Total** | **99** | threshold for the gate is 90 |

## Residual risks and open items
1. Governance covers tenant create, tenant status change and membership role change. Enterprise-organization administration and per-user disable are still absent, and no route exists to delete a tenant.
2. Request-body field validation is absent for the ticket and auth routes; governance validates its own fields in the service. Adding `class-validator` would need a D-xx decision.
3. `prisma migrate status` / `prisma migrate deploy` are not verified locally: `prisma.config.ts` reads `datasource.url` from `DATABASE_URL`, and the workspace has no `.env`.
4. Role/status enum values are Proposed defaults; the owner must confirm them before production.
5. RLS is not configured on the Supabase project; DATABASE.md section 5 lists it as defense-in-depth to add before production.
6. The live HTTP 401/403/200 matrix comes from the 2026-10-26 run log and was not re-executed in this review pass; the audit and migration rows were re-read from the live database.
7. No independent fresh-context reviewer or security agent was configured; the review passes are SIMULATED. AGENTS.md section 3.3 requires this disclosure.
8. Phase 1 covers identity, tenancy, RBAC and audit only. Customer/conversation/message/ticket behavior is Phase 2.
