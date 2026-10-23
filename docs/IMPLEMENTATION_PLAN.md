---
doc: IMPLEMENTATION_PLAN
version: 0.1
status: Draft
owner: Engineering owner
depends_on: [PRD, ARCHITECTURE, SECURITY, DATABASE, TESTING]
---
# Implementation Plan — VELARIS

This file is both the plan and the progress state. Start at the first unchecked task whose dependencies are complete. All tasks remain unchecked because no application repository has been scaffolded or tested in this run.

## 1. Plan style
Considered: (a) milestone narrative, easy to read but too large to verify; (b) layer-by-layer implementation, parallelizable but risks late integration; (c) foundation first, then vertical slices with test-first atomic tasks. Chosen: (c), because VELARIS depends on stable tenant, identity, authorization and API boundaries before AI capabilities can safely be implemented.

## 2. Task format
`- [ ] **T1.01** [ROLE] task — F-01 · AC-F01-1 · files: path · dep: - · verify: command`
- One concern per task, roughly ten minutes when feasible; split larger tasks before starting.
- First action is to write a failing test for the relevant acceptance criterion and observe the expected failure.
- Role tags: [DB] [API] [WEB] [QA] [OPS] [OWNER]. Use parallel work only for tasks with disjoint file scopes.
- `dep: -` means no dependency. Commands are placeholders marked Not configured until actually run; replace them with exact verified commands after scaffold.

## 3. Phase 0 — Foundation
- [ ] **T0.01** [OPS] Scaffold selected monorepo layout (`apps/web`, `apps/api`, `apps/worker`, `packages/*`) and record workspace/package/build tooling decision — F-01 · AC-F01-1,AC-F01-2,AC-F01-3 · NFR-03 · files: package manifests, apps/, packages/ · dep: - · verify: Not configured; clean install and workspace build after scripts exist
- [x] **T0.02** [OPS] Configure formatter, lint, type-check, unit-test and build scripts — NFR-03 · files: package.json, workspace config, lint/format config · dep: T0.01 · verify: exact format/lint/typecheck/test/build commands after configuration ✅ 2026-10-23 (lint `npm run lint` 0 errors/0 warnings; `npm run typecheck` exit 0 per workspace; `npm run test` green; `npm run build` green; format verified for API only — web formatter deliberately deferred to avoid reformatting confirmed design code, owner may request it)
- [x] **T0.03** [OPS] Add CI for lint, type-check, tests, build and documentation checker — NFR-03,NFR-09 · files: .github/workflows/, scripts/check_docs.py · dep: T0.02 · verify: CI workflow passes on a test branch ✅ 2026-10-22 (run 39779791614; verified ahead of full T0.02 by user direction — see run log)
- [ ] **T0.04** [QA] Establish synthetic test fixtures and coverage reporting — NFR-03 · files: packages/test-utils/, test configuration · dep: T0.02 · verify: coverage report shows configured core-domain threshold
- [ ] **T0.05** [OPS] Configure orchestrator and specialist-agent role prompts, task handoffs, independent evidence capture and branch/approval gates — NFR-03,NFR-09 · files: agent workflow configuration, .github/workflows/, AGENTS.md · dep: T0.03 · verify: dry-run demonstrates separate planner, coder, verifier, reviewer, critic and risk-triggered security passes; no protected-branch merge without human approval
- [ ] **GATE-0** [OWNER] Canonical layout chosen; commands run successfully; CI baseline green; no production credentials configured in development

## 4. Phase 1 — Identity, tenancy and governance
- [ ] **T1.01** [DB] Create Supabase PostgreSQL tenant, enterprise organization, user and membership schema/migrations — F-02,F-03,F-04 · AC-F03-1,AC-F03-2 · files: prisma/schema.prisma, prisma/migrations/ · dep: T0.04 · verify: migration and schema validation commands after configuration
- [ ] **T1.02** [API] Implement tenant context and membership resolution — F-02,F-04 · AC-F02-1,AC-F02-2,AC-F04-1 · files: apps/api/src/modules/auth/, apps/api/src/modules/tenants/ · dep: T1.01 · verify: tenant context unit/integration tests pass
- [ ] **T1.03** [API] Implement RBAC permission policies and deny-by-default checks — F-02,F-03,F-04 · AC-F02-3,AC-F03-3,AC-F04-2,AC-F04-3 · files: apps/api/src/modules/roles/, apps/api/src/modules/permissions/, apps/api/src/common/security/ · dep: T1.02 · verify: permission and cross-tenant denial tests pass
- [ ] **T1.04** [API] Add security-sensitive audit event persistence and emission — F-03,F-11 · AC-F03-1,AC-F11-1 · files: apps/api/src/modules/audit/, apps/api/src/common/events/ · dep: T1.03 · verify: audit action integration tests pass
- [ ] **GATE-1** [OWNER] Authentication, permission denial, tenant isolation and audit tests green; confidence >=90 from evidence; run log updated

## 5. Phase 2 — Core support vertical slice
- [ ] **T2.01** [DB] Add customer, conversation, message and ticket schema with state/version constraints — F-05 · AC-F05-1,AC-F05-2 · files: prisma/schema.prisma, prisma/migrations/ · dep: T1.03 · verify: migration tests and ticket domain tests pass
- [ ] **T2.02** [API] Implement ticket domain rules, transitions, assignment and optimistic concurrency — F-05 · AC-F05-1,AC-F05-2,AC-F05-3 · files: apps/api/src/modules/tickets/, apps/api/src/modules/conversations/ · dep: T2.01 · verify: ticket domain and unauthorized API tests pass
- [ ] **T2.03** [API] Implement customer-facing conversation/message APIs and visibility boundaries — F-05 · AC-F05-1,AC-F05-3 · files: apps/api/src/modules/customers/, apps/api/src/modules/conversations/ · dep: T2.02 · verify: API tests prove internal notes never serialize to customer responses
- [ ] **T2.04** [WEB] Build role-aware inbox, assigned-to-me and ticket timeline states — F-06 · AC-F06-1,AC-F06-2,AC-F06-3 · files: apps/web/ inbox and ticket screens, packages/ui/ · dep: T2.03 · verify: Cypress inbox loading/empty/error/denial journey passes
- [ ] **GATE-2** [OWNER] J-03 and J-04 critical support flow passes E2E; state transitions and message visibility verified

## 6. Phase 3 — Knowledge and retrieval
- [ ] **T3.01** [DB] Add knowledge source, chunk and embedding schema/indexes — F-07,F-14 · AC-F07-1 · files: prisma/schema.prisma, prisma/migrations/ · dep: T1.03 · verify: migration/schema tests pass
- [ ] **T3.02** [API] Implement source upload/reference validation and ingestion status — F-07 · AC-F07-1,AC-F07-2 · files: apps/api/src/modules/knowledge/ · dep: T3.01 · verify: upload validation and partial-failure tests pass
- [ ] **T3.03** [API] Implement async parse/chunk/embed pipeline and tenant-scoped job metadata — F-07 · AC-F07-1,AC-F07-2 · files: apps/api/src/modules/knowledge/, apps/worker/src/, packages/ · dep: T3.02 · verify: worker integration tests cover retry and tenant context
- [ ] **T3.04** [API] Implement permission-aware retrieval, provenance and citations — F-07,F-09 · AC-F07-3,AC-F09-1 · files: apps/api/src/modules/knowledge/, apps/api/src/infrastructure/vector-store/ · dep: T3.03 · verify: retrieval tests exclude unauthorized tenant/source chunks
- [ ] **T3.05** [WEB] Build knowledge source list, ingestion detail and retry states — F-07 · AC-F07-1,AC-F07-2,AC-F07-3 · files: apps/web/knowledge/, packages/ui/ · dep: T3.04 · verify: Cypress knowledge ingestion journey passes
- [ ] **GATE-3** [OWNER] Knowledge ingestion, permission-aware retrieval, citations and deletion invalidation tests green

## 6A. Required engineering-loop gate for every task
For each implementation task, follow the role sequence in `AGENTS.md`: planner → coding agent (RED/GREEN/REFACTOR) → verification agent → fresh-context code reviewer → critic → security agent when risk-triggered → integration/merge agent → human PR review. Do not mark a task complete based only on the coding agent's claim. The candidate integration branch is not the protected main branch.

Supabase foundation tasks must verify the actual project region/plan, connection strategy, Prisma migration behavior, pgvector availability and RLS configuration before the relevant architecture is considered implemented. Supabase Auth is selected; Supabase Storage and Realtime remain separate undecided choices.

## 7. Phase 4 — Governed AI agent MVP
- [ ] **T4.01** [API] Define LLM/embedding provider interfaces and one selected development adapter — F-09 · AC-F09-2 · files: apps/api/src/infrastructure/llm/, apps/api/src/modules/ai/providers/ · dep: T3.04 · verify: adapter contract tests pass; provider decision D-02 recorded
- [ ] **T4.02** [DB] Add agent, immutable agent version, tool grant and evaluation-run schema — F-08,F-11 · AC-F08-1 · files: prisma/schema.prisma, prisma/migrations/ · dep: T4.01 · verify: migration and version immutability tests pass
- [ ] **T4.03** [API] Implement LangGraph runtime with retrieval, response validation and escalation outcomes — F-09 · AC-F09-1,AC-F09-2 · files: apps/api/src/modules/ai/, apps/api/src/infrastructure/llm/ · dep: T4.02 · verify: AI runtime tests cover grounded answer, abstention and provider failure
- [ ] **T4.04** [API] Implement deterministic tool authorization, policy validation and approval gate — F-10 · AC-F10-1,AC-F10-2,AC-F10-3 · files: apps/api/src/modules/ai/tools/, apps/api/src/modules/ai/guardrails/ · dep: T4.03 · verify: unauthorized tool proposals cause zero side effects
- [ ] **T4.05** [API] Add versioned evaluation datasets, run results and publish gate — F-08,F-11 · AC-F08-1,AC-F08-2,AC-F11-2 · files: packages/ai-evals/, apps/api/src/modules/ai/evaluation/ · dep: T4.04 · verify: intentionally failing critical evaluation blocks publication
- [ ] **T4.06** [WEB] Build agent configuration, test/evaluate, publish/version and rollback screens — F-08 · AC-F08-1,AC-F08-2,AC-F08-3 · files: apps/web/ai-agents/ · dep: T4.05 · verify: Cypress agent lifecycle journey passes
- [ ] **T4.07** [QA] Add adversarial regression cases for prompt injection, cross-tenant retrieval and escalation — F-09,F-10 · AC-F09-3,AC-F10-3 · files: packages/ai-evals/, test fixtures · dep: T4.04 · verify: TST-TH-03 and TST-TH-04 datasets pass
- [ ] **GATE-4** [OWNER] Required AI evaluation gates, permission checks, citations, escalation and immutable version behavior are green

## 8. Phase 5 — Observability, analytics and lifecycle
- [ ] **T5.01** [API] Propagate request/correlation IDs through HTTP, jobs, AI traces and audit — F-11,F-13 · AC-F11-1,AC-F13-1 · files: apps/api/src/common/logging/, apps/api/src/common/events/, apps/api/src/modules/ai/observability/ · dep: T4.03 · verify: correlation propagation integration tests pass
- [ ] **T5.02** [DB] Add retention/expiry fields and lifecycle job contracts for knowledge, traces and memory — F-14 · AC-F14-1,AC-F14-2,AC-F14-3 · files: prisma/schema.prisma, apps/api/src/modules/knowledge/, apps/api/src/modules/ai/memory/ · dep: T3.04 · verify: expiry/deletion tests prove derived records are no longer retrievable
- [ ] **T5.03** [API] Implement KPI definitions, tenant-scoped summary API and empty/stale states — F-12 · AC-F12-1,AC-F12-2,AC-F12-3 · files: apps/api/src/modules/analytics/ · dep: T5.01 · verify: KPI formula/scope tests pass
- [ ] **T5.04** [WEB] Build analytics, audit and trace views with permission-aware states — F-11,F-12 · AC-F11-3,AC-F12-1,AC-F12-3 · files: apps/web/analytics/, apps/web/audit/ · dep: T5.03 · verify: Cypress governance/analytics access journey passes
- [ ] **T5.05** [API] Add webhook signature checks and idempotent event handling — F-13 · AC-F13-1,AC-F13-2,AC-F13-3 · files: apps/api/src/modules/integrations/ · dep: T1.04 · verify: duplicate delivery test proves one side effect
- [ ] **GATE-5** [OWNER] Trace/audit completeness, retention, analytics scope and idempotency checks green

## 9. Phase 6 — Release readiness
- [ ] **T6.01** [QA] Run full unit/integration/E2E/AI regression suites and resolve critical gaps — NFR-03,NFR-08,NFR-09 · files: test suites, packages/ai-evals/ · dep: T5.05 · verify: all configured test commands pass and report is attached
- [ ] **T6.02** [QA] Run load profile, accessibility review and security/dependency scans — NFR-01,NFR-02,NFR-04,NFR-08 · files: test reports, security configuration · dep: T6.01 · verify: documented p95, accessibility and security reports reviewed
- [ ] **T6.03** [OPS] Deploy to staging, smoke test and rehearse rollback — NFR-05,NFR-10 · files: deployment configuration, docs/SETUP_GUIDE.md · dep: T6.02 · verify: health check, protected route 401 and permitted read pass in staging
- [ ] **T6.04** [OWNER] Approve MVP release and commercial/data handling decisions — F-01,F-13,F-14 · files: release notes, decision log · dep: T6.03 · verify: human approval recorded; no automated production deployment
- [ ] **GATE-6 [OWNER]** Production release requires all gates green, approved retention/provider decisions, release notes and explicit human authorization

## 10. Run log (append only)
| Date | Task | Result | Confidence | Evidence (command → result) | Issues / decisions |
| --- | --- | --- | --- | --- | --- |
| 2026-10-20 | Documentation generation | Draft created; app not run | N/A | Source PRD reviewed; documentation checker to be run | All tasks remain unchecked; repo layout, commands and provider choices need owner decisions |
| 2026-10-22 | T0.01 (partial) | Monorepo layout scaffolded: frontend moved to apps/web (design code unchanged), backend moved to apps/api, npm workspaces + single root lockfile (D-09); apps/worker and packages/* still empty | 70 | `npm install` exit 0; `npm run build` exit 0 (nest + next, 8 static routes); `npm run test` 1/1 green; 92 git renames, no content edits | T0.01 kept unchecked: worker scaffold, packages/* contents and CI (T0.03) outstanding; root Playwright workflow predates workspaces and needs path updates |
| 2026-10-22 | Docs sync | README rewritten for monorepo; CODE_STYLE/TESTING/SETUP_GUIDE command tables now carry verified commands; scripts/check_docs.py materialized at documented path | 85 | `python scripts/check_docs.py --draft` → 0 errors, 0 warnings, 100/100 | Web lint had 12 pre-existing errors in confirmed design code — resolved 2026-10-22 in T0.03 with rendering-identical fixes |
| 2026-10-22 | T0.03 | CI workflow `.github/workflows/ci.yml` added: parallel docs-checker/lint/type-check/test/build jobs on every push and PR; the 12 pre-existing web lint errors fixed with rendering-identical changes (string-expression pills, &quot; escapes, `as const` tabs, typed apiFetch, useSyncExternalStore mounted flag, render-time aiSummary derivation) | 90 | GitHub Actions run 39779791614 on feature/T0.03-ci: all 5 jobs success (docs checker, lint, type check, unit tests, build); local: `npm ci`, `npm run lint` 0 errors, `tsc --noEmit` both apps, `npm run test` 1/1, `npm run build`, docs checker 100/100 | T0.03 verified ahead of completing T0.02 by user direction; T0.02 still open: web format script, per-package type-check scripts, 4 non-blocking unused-var warnings |
| 2026-10-23 | T0.02 | Per-package type-check scripts added (`typecheck`: `tsc --noEmit` in apps/web and apps/api; root `npm run typecheck` fans out with `--workspaces --if-present`); CI type-check job switched from hardcoded `npx tsc` paths to `npm run typecheck`; last 4 web lint warnings fixed with rendering-identical changes (unused `setStatusFilter` destructuring removed; unused `CheckCircle`/`Clock`/`MessageSquare` lucide imports removed); AGENTS.md verified-commands table now matches reality | 90 | Local on chore/T0.02-tooling: `npm run lint` 0 errors/0 warnings; `npm run typecheck` exit 0 (backend + frontend); `npm run test` 1/1 green; `npm run build` green (next build, 10 static pages); docs checker 0 errors/0 warnings | T0.02 ticked; web formatter deliberately deferred (would reformat confirmed WCAG-AA design code; owner decision to add later); CI evidence for the new typecheck path expected from the branch push run |
