# GATE-1 evidence record

## Identity
- Gate: GATE-1 (Phase 1 - identity, tenancy and governance)
- Scope: T1.01, T1.02, T1.03, T1.04
- Captured by (role): orchestrator, SIMULATED (sequential passes in one context; no independent reviewer agent was configured in this environment)
- Date: 2026-10-26

## Commands (all run on the merged master state unless noted)
| # | Command | Exit code | Result |
| --- | --- | --- | --- |
| 1 | `npm run test` | 0 | 107 tests, 17 files, all pass |
| 2 | `npm run test:cov --workspace apps/api` | 0 | 100% statements/branches/functions/lines on core domain services |
| 3 | `npm run test:e2e --workspace apps/api` | 0 | 1 test (boot spec) pass |
| 4 | `npm run lint` (API oxlint, web ESLint) | 0 | 0 errors, 0 warnings, both workspaces |
| 5 | `npm run typecheck` | 0 | exit 0 |
| 6 | `npm run build` | 0 | nest + next build green |
| 7 | `npm run audit:check` | 0 | no new advisories vs baseline |
| 8 | `python scripts/check_docs.py --draft` | 0 | 0 errors, 0 warnings, 100/100 |

## Live evidence (real Supabase project, ref `lygekvhwmhbonsdeiaot`)
| Path | Observed result |
| --- | --- |
| No credential to `GET /auth/session` | 401, consistent body |
| Forged/expired bearer token | 401, same body |
| Real token (password grant for `agent1@velaris.test`) to `GET /auth/session` | 200, identity + tenant context resolved from the database |
| Real token to `GET /tickets?tenantId=<own>` | 200 |
| Real token to `POST /tickets?tenantId=<own>` | 201; `ticket.created` row in `audit_events` with the real actor subject |
| Guessed foreign `tenantId` | 403 |
| Second user `developer1@velaris.test` (R-developer, no application permission) to `GET /tickets` | 403 `Missing permission: ticket.read`; `permission.denied` row in `audit_events` with real actor, role and tenant |
| Migration `0003_support_schema` via Supabase tracked-migration API | applied; 4 tables, 4 CHECK constraints and enum labels verified by read-only SQL |

## Acceptance criteria mapping
| Criterion | Proof | Observed |
| --- | --- | --- |
| AC-F02-1 | `auth.controller.integration.spec.ts` + live session call | pass (200 with context) |
| AC-F02-2 | `supabase-auth.guard.spec.ts`, `supabase-token-verifier.service.spec.ts` + live 401 matrix | pass |
| AC-F02-3 | `permissions.integration.spec.ts` + live R-developer 403 | pass |
| AC-F03-1 | migration 0002 seed + `ticket.created`/`permission.denied` audit rows in the live database | pass |
| AC-F03-2 | `database-role-resolver.spec.ts` (unknown/absent role denies) | pass |
| AC-F03-3 | `authorization.service.spec.ts` (tenant admin lacks platform governance) | pass |
| AC-F04-1 | `tickets.controller.integration.spec.ts` (scope check per request) | pass |
| AC-F04-2 | `authorization.service.spec.ts` (disabled tenant rejects operations) | pass |
| AC-F04-3 | cross-tenant guess 403, live and in specs | pass |
| AC-F11-1 | audit rows carry actor, tenant, resource and metadata | pass |
| AC-F11-3 | restricted audit read gated by `AUDIT_READ`; R-developer denied | pass (unit + guard chain) |

## Denial and validation checks
- Missing credential, malformed header, forged token: 401 (live + specs).
- Authenticated principal without permission: 403 with audit emission (live + specs).
- Cross-tenant resource guess: 403 (live + specs).
- Unknown/absent role resolves to deny (resolver specs).
- Disabled tenant: rejected (authorization specs).
- Audit write failure cannot mask a 403 (regression spec from the live FK finding).

## Scope check
- Diff stayed inside each task's declared `files:` scope. The only cross-cutting additions are the module-graph spec and the verifier fix, both logged in the run log as live-found regressions.
- New runtime dependencies: none. Dev tooling only; no unlogged dependency.

## Score (AGENTS.md section 4)
| Check | Points | Evidence |
| --- | --- | --- |
| RED seen | 15 | RED reproduced for the audit layer, module graph and audit-FK regression |
| Task tests pass | 20 | 107/107 |
| Full checks pass | 20 | lint 0/0 x2, typecheck 0, build 0, audit 0, docs 100/100 |
| Criteria map to tests | 15 | 11 Phase 1 ACs mapped above |
| Denial/validation tests | 10 | denial matrix, live and mocked |
| Scope clean | 10 | per-task scope respected |
| Docs synced | 10 | plan ticks, TESTING matrix, run log rows |
| **Total** | **100** | |

## Residual risks and open items
1. Role/status enum values are Proposed defaults; the owner must confirm them before production.
2. The live run rotated the development project database password; reversible, dev project only.
3. No independent fresh-context reviewer or security agent was configured; the review passes above are SIMULATED. AGENTS.md section 3.3 requires this disclosure.
4. RLS is not yet configured on the Supabase project; DATABASE.md section 5 lists it as defense-in-depth, to be added and tested before production.
5. Phase 1 covers identity, tenancy, RBAC and audit only. Customer/conversation/message/ticket behavior is Phase 2 and is not part of this gate.
