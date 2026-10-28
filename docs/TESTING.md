---
doc: TESTING
version: 0.1
status: Draft
owner: Engineering/QA owner
depends_on: [PRD, ARCHITECTURE, SECURITY, DATABASE]
---
# Testing — VELARIS

## 1. Strategy
Use Jest for unit/domain tests, Supertest for NestJS API/integration tests, Cypress for critical user journeys, and a versioned AI evaluation harness for retrieval, citations, tools, guardrails and escalation. Synthetic fixtures only. Commands and results below are marked **Verified** only after they run against the scaffolded repository; anything else stays **Not configured / Not run**.

## 2. Commands and thresholds
| Purpose | Command | Threshold / status |
| --- | --- | --- |
| Unit tests | `npm run test` (root, all workspaces) | Verified 2026-10-28; API suite green (146 tests, 20 files) using `packages/test-utils` tenant A/B fixtures |
| Coverage | `npm run test:cov --workspace apps/api` | Verified 2026-10-28: vitest v8 gate over `src/domains/**/*.service.ts` at >=80% lines/functions/branches/statements; measured 100% lines, functions, branches and statements - all four metrics at 100% (NFR-03) |
| API/integration tests | Supertest specs run inside `npm run test` (apps/api); `npm run test:e2e --workspace apps/api` boots the real AppModule | Verified 2026-10-26: `auth.controller.integration.spec.ts` drives 4 HTTP cases (no credential 401, invalid token 401, valid session with tenant context, unknown identity null context); `permissions.integration.spec.ts` drives 7 RBAC cases (401 before permission checks, 403 without permission, tenant-admin denied platform governance, disabled tenant rejected, cross-tenant denial); `tickets.controller.integration.spec.ts` drives 14 cases over the guarded ticket routes (401 without credential, 403 without permission, tenant scope enforcement, audit emission, valid transition 200, invalid transition 409, stale version 409); `tickets.service.spec.ts` and `ticket-transitions.spec.ts` cover the T2.02 domain rules against a fake Prisma client; `tickets.module.spec.ts` compiles the production module graph so a missing guard import fails CI; T2.03 adds `conversations.service.spec.ts` (Prisma-backed conversation/message rules: status transitions with optimistic concurrency, idempotency keys, TH-05 internal-note filtering), `conversations.controller.spec.ts` (the TH-05 write boundary: INTERNAL note needs `note.internal.write`, authorType derived from the caller's role), `conversations.controller.integration.spec.ts` (guarded routes: customer role sees only CUSTOMER_VISIBLE rows, agent role sees INTERNAL too, cross-tenant denial, audit emission), `customers.service.spec.ts` and `customers.controller.integration.spec.ts` (Prisma-backed customer routes with the ticket-style guard chain); the boot spec caught the T1.02 DI break and now runs in the CI `test` job; the live 200 session path is verified end to end against the real Supabase project, and both the allow (`ticket.created`) and deny (`permission.denied`) audit paths are proven against real infrastructure (run log 2026-10-26, T1.04 rows); the wider API contract suite remains Not configured |
| E2E | `npm run e2e:web` (root Playwright harness) | Verified 2026-10-24: 3/3 AC-F01-1 journeys pass against the production build of `apps/web`; CI workflow at .github/workflows/e2e.yml; J-01..J-06 journeys not yet written |
| AI evaluations | Not configured | Required configured thresholds pass; critical guardrail failures always block |
| Docs consistency | `python scripts/check_docs.py --draft` | Verified 2026-10-22: 0 errors, 0 warnings, 100/100 |
| Format | `npm run format:check` (root, all workspaces); fix with `npm run format` | Verified 2026-10-27: exit 0 in `apps/api` and `apps/web`, and stable after a fresh `git checkout` + merge; CI job `format` in .github/workflows/ci.yml runs it on every push/PR; Prettier run over both workspaces on 2026-10-27 fixed 25 API files (web content was already conforming; 33 web files differed only by line endings). `endOfLine: auto` is set in both Prettier configs because `core.autocrlf=true` on the Windows dev machine gives CRLF working copies while the git index stays LF; git commits LF, Prettier enforces style only |
| Lint/type/build | `npm run lint` / `npm run typecheck` / `npm run build` (root); CI: `.github/workflows/ci.yml` runs lint, format, type-check, tests, the API boot e2e spec, build, the docs checker and the npm audit gate on every push/PR | Verified 2026-10-26 locally: lint 0 errors/0 warnings, typecheck exit 0, build green, `npm run audit:check` exit 0; type-check and build jobs generate the Prisma client first (missing generate failed run 40298746838, fixed 2026-10-26) |
| Security/dependency scan | `npm run audit:check` (root; CI job `audit` in .github/workflows/ci.yml) | Verified 2026-10-27: exit 0 against scripts/audit-baseline.json (8 known advisories: 1 critical, 4 high, 1 moderate, 2 low; 5 fixed advisories removed from the baseline on 2026-10-27 so they can no longer mask a regression); fails on a new advisory or a severity increase; exit 2 when npm audit cannot run (fails closed) |

## 3. Acceptance criteria → tests
| Acceptance criterion | Test ID | Test intent |
| --- | --- | --- |
| AC-F01-1 | TST-AC-F01-1 | Public landing renders required sections and CTAs |
| AC-F01-2 | TST-AC-F01-2 | Invalid signup fields do not create account |
| AC-F01-3 | TST-AC-F01-3 | Anonymous protected-route request reveals no protected data |
| AC-F02-1 | TST-AC-F02-1 | Valid identity resolves session and tenant membership |
| AC-F02-2 | TST-AC-F02-2 | Invalid/expired credential returns 401 |
| AC-F02-3 | TST-AC-F02-3 | Authenticated principal lacking permission receives 403 |
| AC-F03-1 | TST-AC-F03-1 | Tenant/user/role governance persists and creates audit event |
| AC-F03-2 | TST-AC-F03-2 | Invalid identifiers/role assignments rejected |
| AC-F03-3 | TST-AC-F03-3 | Tenant admin cannot perform platform-wide tenant governance |
| AC-F04-1 | TST-AC-F04-1 | Tenant-scoped read/write returns and changes only own records |
| AC-F04-2 | TST-AC-F04-2 | Disabled tenant cannot start new business operations |
| AC-F04-3 | TST-AC-F04-3 | Tenant A cannot read/write tenant B resources |
| AC-F05-1 | TST-AC-F05-1 | Ticket/conversation operation updates timeline and state |
| AC-F05-2 | TST-AC-F05-2 | Invalid state transition and stale version are rejected |
| AC-F05-3 | TST-AC-F05-3 | Unauthorized ticket operation is denied |
| AC-F06-1 | TST-AC-F06-1 | Inbox renders authorized assignment, timeline and context |
| AC-F06-2 | TST-AC-F06-2 | Empty inbox differs from failed API state and allows recovery |
| AC-F06-3 | TST-AC-F06-3 | Unauthorized deep link exposes no ticket details |
| AC-F07-1 | TST-AC-F07-1 | Ingestion records status, provenance and retrieval-ready data |
| AC-F07-2 | TST-AC-F07-2 | Unsupported/partial failure is reported and retryable |
| AC-F07-3 | TST-AC-F07-3 | Retrieval excludes unauthorized chunks |
| AC-F08-1 | TST-AC-F08-1 | Passing evaluated draft can be published as immutable version |
| AC-F08-2 | TST-AC-F08-2 | Failed eval/invalid tool schema blocks publication |
| AC-F08-3 | TST-AC-F08-3 | Unauthorized publish/rollback denied and audited |
| AC-F09-1 | TST-AC-F09-1 | Relevant authorized knowledge produces grounded answer with citations |
| AC-F09-2 | TST-AC-F09-2 | Low grounding/provider failure/human request safely abstains or escalates |
| AC-F09-3 | TST-AC-F09-3 | Prompt injection cannot reveal cross-tenant data or bypass policies |
| AC-F10-1 | TST-AC-F10-1 | Permitted tool runs only after checks/approval and is audited |
| AC-F10-2 | TST-AC-F10-2 | Disallowed/invalid/failed tool action has no unauthorized side effect |
| AC-F10-3 | TST-AC-F10-3 | LLM proposal without server permission is denied |
| AC-F11-1 | TST-AC-F11-1 | AI run/admin action has required trace/audit metadata |
| AC-F11-2 | TST-AC-F11-2 | Missing trace metadata or critical regression fails release check |
| AC-F11-3 | TST-AC-F11-3 | Restricted audit/trace query is denied without permission |
| AC-F12-1 | TST-AC-F12-1 | KPI results use documented formula and tenant scope |
| AC-F12-2 | TST-AC-F12-2 | Empty/delayed telemetry is not misrepresented as zero success |
| AC-F12-3 | TST-AC-F12-3 | Tenant analytics endpoint blocks cross-tenant access |
| AC-F13-1 | TST-AC-F13-1 | Versioned API matches OpenAPI and includes correlation ID |
| AC-F13-2 | TST-AC-F13-2 | Invalid filters, idempotency mismatch and rate limit use standard errors |
| AC-F13-3 | TST-AC-F13-3 | Invalid credentials/integration scopes cannot invoke protected operations |
| AC-F14-1 | TST-AC-F14-1 | Expired/deleted knowledge and memory are no longer retrievable |
| AC-F14-2 | TST-AC-F14-2 | Invalid retention configuration is rejected |
| AC-F14-3 | TST-AC-F14-3 | Restricted audit/lifecycle operation is denied without permission |

AC-F03-1 is covered by `governance.controller.integration.spec.ts`, which drives 10 cases over the real guard chain on the real governance controller: create a tenant, set a tenant status and replace a membership role. Each success asserts both the Prisma write and the audit event (`tenant.created`, `tenant.status_changed`, `role.changed`). Denial cases cover R-tenant-admin refused platform governance (AC-F03-3) and validation cases cover a missing slug, an unknown role code, a status outside the allowed set, a tenant with no row and a membership in another tenant (AC-F03-2). AC-F03-2 identifier coverage also lives in `tickets.controller.integration.spec.ts` and `database-role-resolver.spec.ts`.

AC-F05-1 is covered by the create/read/update paths in `tickets.service.spec.ts` and `tickets.controller.integration.spec.ts` (audited create, field writes, assignment restricted to an ACTIVE membership of the same tenant), extended to conversations by `conversations.service.spec.ts` and `conversations.controller.integration.spec.ts` (conversation create, status update with version bump, message send appended to the timeline, each mutation audited). AC-F05-2 is covered by `ticket-transitions.spec.ts` (legal/illegal status map, CLOSED terminal, lifecycle timestamps) plus the service and HTTP cases for an invalid transition (409) and a stale `expectedVersion` (409); the conversation service mirrors both the transition map and the stale-version 409. AC-F05-3 is covered by the permission and tenant-scope denials in `tickets.controller.integration.spec.ts` and, for the customer-facing half, by `conversations.controller.integration.spec.ts` (no `ticket.read` gets 401/403 before any data) and `customers.controller.integration.spec.ts` (cross-tenant customer reads are 403).

## 4. Threat tests
| Threat | Test ID | Required evidence |
| --- | --- | --- |
| TH-01 | TST-TH-01 | Cross-tenant access matrix covers API, repository, cache, queue, vector and storage scopes |
| TH-02 | TST-TH-02 | Permission matrix tests deny-by-default and representative role/permission combinations |
| TH-03 | TST-TH-03 | Tool execution denies a forged LLM tool proposal without server authorization |
| TH-04 | TST-TH-04 | Prompt-injection evaluation set confirms retrieved/user content cannot override policy |
| TH-05 | TST-TH-05 | Customer API never returns internal notes; retrieval enforces source permissions |
| TH-06 | TST-TH-06 | Invalid type/size and parser-failure uploads are rejected or quarantined safely |
| TH-07 | TST-TH-07 | Logs/traces redact secrets and minimize personal content |
| TH-08 | TST-TH-08 | Repeated webhook/job delivery produces one intended side effect |
| TH-09 | TST-TH-09 | Provider timeout/rate-limit/outage respects retry budget and escalates safely |
| TH-10 | TST-TH-10 | Audit writes, access control, retention and append-oriented behavior reviewed/tested |
| TH-11 | TST-TH-11 | Disabled tenant sessions and queued jobs cannot perform new business mutations |
| TH-12 | TST-TH-12 | Source deletion/expiry removes or invalidates chunks, embeddings, cache and memories |

## 4A. Independent multi-agent verification gates
| Gate | Responsible role | Required evidence | Blocking condition |
| --- | --- | --- | --- |
| Implementation | Coding agent | RED failure, GREEN pass, refactor results, scoped diff | Acceptance criteria missing or test disabled/weakened |
| Test verification | Verification agent | Exact commands, exit codes, test reports, AC-to-test mapping | Required test/build/type/lint check fails or cannot be run |
| Code review | Fresh-context reviewer | Findings list covering correctness, boundaries, maintainability and regressions | Unresolved blocking finding |
| Critic review | Adversarial reviewer | Edge cases, counterexamples, abuse/failure scenarios and regression proposals | Critical requirement or failure path untested |
| Security review | Security agent | Threat-linked test/scan evidence, findings and severity | Critical/high unresolved security issue; scope not authorized |
| Integration | Merge agent | Conflict-free candidate branch, combined suite, changed-file and dependency review | Combined checks fail or unrelated changes are present |
| Human approval | Human owner | PR diff, acceptance mapping, CI evidence, residual risks, migration/rollback notes | Missing approval, unresolved high risk or unclear production impact |

A reviewer may use an LLM, but the record must distinguish a simulated review pass from an independently running agent/tool. Agent role names do not constitute proof that a tool executed. Active security testing is limited to authorized environments.

## 5. NFR verification matrix
| NFR | Verification ID | Method / pass condition |
| --- | --- | --- |
| NFR-01 | TST-NFR-01 | All tenant isolation tests pass; no unauthorized cross-tenant result |
| NFR-02 | TST-NFR-02 | Protected API inventory has auth/permission test coverage |
| NFR-03 | TST-NFR-03 | Coverage report shows >=80% for core domain/application logic |
| NFR-04 | TST-NFR-04 | Repeatable load profile reports fast API p95 <200ms under documented conditions |
| NFR-05 | TST-NFR-05 | Availability SLI query matches agreed numerator/denominator/exclusions |
| NFR-06 | TST-NFR-06 | All sampled production AI runs contain correlation/trace identifier |
| NFR-07 | TST-NFR-07 | Sensitive action matrix demonstrates 100% required audit events |
| NFR-08 | TST-NFR-08 | Automated accessibility scan plus manual critical-journey review |
| NFR-09 | TST-NFR-09 | Agent publish pipeline blocks when required AI eval gates fail |
| NFR-10 | TST-NFR-10 | Contract tests cover versioning, error schema, correlation and idempotency |

## 6. Test data and isolation
- Use synthetic tenant A and tenant B fixtures (`packages/test-utils`) in every data-access test suite.
- Include a customer-visible message and an internal note in fixtures to verify serialization boundaries.
- Include permitted, denied, expired, disabled and malformed states; avoid testing only happy paths.
- Reset database state between tests or use isolated schemas/transactions with explicit cleanup.
- AI evaluation data must be approved, versioned, tenant-safe and free of secrets; provider data-use terms must be checked before sending any non-synthetic data.

## 7. Test pyramid and E2E journeys
- Unit: domain invariants, ticket transitions, permission decisions, retention rules, schema validation and policy logic.
- Integration: Prisma/repository scoping, transaction/audit/outbox behavior, queue idempotency, API error contracts and provider adapters with fakes. For Supabase Auth, cover valid, malformed, expired, wrong-issuer and key-rotation token cases plus disabled users, membership changes and authorization independent of client metadata.
- E2E: J-01 signup/onboarding; J-02 knowledge-to-agent publish; J-03 grounded answer/handoff; J-04 agent resolves ticket; J-05 admin governance/audit; J-06 API/webhook contract.
- AI regression: intent, retrieval, grounding, citation correctness, tool choice/arguments, guardrails, abstention, escalation and adversarial cases.

## 8. Release gates
- Every Must feature acceptance criterion maps to a passing test before MVP sign-off.
- Core domain/application coverage reaches the stated target; exclusions are documented and not used to hide weak coverage.
- Critical tenant-isolation, authorization, internal-note visibility, tool-execution and audit tests must pass.
- Every production agent version passes configured evaluation thresholds; critical guardrail/unauthorized action failures always block.
- Build, type check, lint, unit/integration tests, Cypress critical journeys, docs checker, security checks and staging smoke tests must pass before production approval.
- Production deployment and production data migrations require explicit human approval.

## 9. Results log
| Date | Commit/task | Suite | Result | Evidence | Owner / follow-up |
| --- | --- | --- | --- | --- | --- |
| Not run | Documentation-only generation | App tests | Not run | No application repository was inspected or executed | Configure after repo scaffold |
