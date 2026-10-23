---
doc: TESTING
version: 0.1
status: Draft
owner: Engineering/QA owner
depends_on: [PRD, ARCHITECTURE, SECURITY, DATABASE]
---
# Testing — VELARIS

## 1. Strategy
Use Jest for unit/domain tests, Supertest for NestJS API/integration tests, Cypress for critical user journeys, and a versioned AI evaluation harness for retrieval, citations, tools, guardrails and escalation. Synthetic fixtures only. No test result below has been run against a working app repository; commands and results are **Not configured / Not run**.

## 2. Commands and thresholds
| Purpose | Command | Threshold / status |
| --- | --- | --- |
| Unit tests | `npm run test` (root, all workspaces) | Verified 2026-10-22; API suite green (1 file, 1 test) |
| Coverage | `npm run test:cov --workspace apps/api` | Configured (vitest v8); target >=80% core domain/application coverage per NFR-03 not yet measured |
| API/integration tests | Not configured | Required critical API contracts and authorization cases green |
| E2E | `npm run e2e` (API e2e config); root Playwright harness configured | Playwright workflow exists at .github/workflows/playwright.yml; journeys not yet written |
| AI evaluations | Not configured | Required configured thresholds pass; critical guardrail failures always block |
| Docs consistency | `python scripts/check_docs.py --draft` | Verified 2026-10-22: 0 errors, 0 warnings, 100/100 |
| Lint/type/build | `npm run lint` / `npm run typecheck` / `npm run build` (root); CI: `.github/workflows/ci.yml` runs lint, type-check, tests, build and the docs checker on every push/PR | Verified 2026-10-23 locally: lint 0 errors/0 warnings, typecheck exit 0, build green; CI run 39779791614 all 5 jobs green |
| Security/dependency scan | Not configured | Must be selected and configured before production release |

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
- Use synthetic tenant A and tenant B fixtures in every data-access test suite.
- Include a customer-visible message and an internal note in fixtures to verify serialization boundaries.
- Include permitted, denied, expired, disabled and malformed states; avoid testing only happy paths.
- Reset database state between tests or use isolated schemas/transactions with explicit cleanup.
- AI evaluation data must be approved, versioned, tenant-safe and free of secrets; provider data-use terms must be checked before sending any non-synthetic data.

## 7. Test pyramid and E2E journeys
- Unit: domain invariants, ticket transitions, permission decisions, retention rules, schema validation and policy logic.
- Integration: Prisma/repository scoping, transaction/audit/outbox behavior, queue idempotency, API error contracts and provider adapters with fakes. For Supabase Auth, cover valid, malformed, expired, wrong-issuer and key-rotation token cases plus disabled users, membership changes and authorization independent of client metadata. For Supabase Auth, cover valid, malformed, expired, wrong-issuer and key-rotation token cases plus disabled users, membership changes and authorization independent of client metadata.
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
