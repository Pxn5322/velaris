# GATE-4 evidence package (governed AI agent MVP)

Status: CLOSED 2026-11-03 on owner instruction, Option A. The owner accepted
the gate mechanics at 95/100 with the missing evaluation runner recorded as a
production condition (D-23, `docs/IMPLEMENTATION_PLAN.md` Phase 6) rather than
as Phase 5 work. The score is unchanged and the gap stays visible in section 4.

Gate line: "Required AI evaluation gates, permission checks, citations,
escalation and immutable version behavior are green."

Capture type: SIMULATED. One agent ran the verification commands sequentially
and wrote this package; AGENTS.md section 3.3 requires this disclosure. The
commands in section 2 ran EXECUTED on the development machine, and the CI
checks in section 2 ran EXECUTED on GitHub Actions.

## 1. Scope of this gate

| Task | What shipped | Status | Evidence |
| --- | --- | --- | --- |
| T4.01 | LLM and embedding ports; Groq development adapter; offline deterministic adapter | done | run log 2026-11-02; `llm.provider.spec.ts`, `groq.llm.provider.spec.ts`, `embedding.provider.spec.ts` |
| T4.02 | Agent, immutable version, tool grant and evaluation-run tables; migration `0005` with the PUBLISHED-row trigger | done, applied live | run log 2026-11-02; `agent-schema.spec.ts` (7); live probe on the Supabase project |
| T4.03 | LangGraph runtime with retrieval, server-computed citations, abstain and escalate outcomes | done | run log 2026-11-02; `ai-runtime.service.spec.ts` (17) |
| T4.04 | Deterministic tool authorization, policy validation and approval gate; migration `0006` | done, applied live | run log 2026-11-02; `tool-execution.service.spec.ts` (24), `tool-approval.service.spec.ts` (11), `tool-proposal.guard.spec.ts` (12) |
| T4.05 | Versioned datasets, evaluation runs and publish gate | done | run log 2026-11-03; `evaluation.service.spec.ts` (9), `agent-publish.service.spec.ts` (12), `eval-datasets.spec.ts` (7) |
| T4.06 | Guarded `/ai/agents` lifecycle API and studio tabs 8 and 9 | done | run log 2026-11-03; `ai-agent.service.spec.ts` (18), `ai-agent.controller.integration.spec.ts` (10), 5 Playwright journeys |
| T4.07 | Adversarial injection and tenant-boundary datasets in the publish suite | done | run log 2026-11-03; `adversarial-datasets.spec.ts` (6) |
| D-23, D-24, D-25 | Evaluation-runner requirement, view/tooling deviation, self-hosted fonts | recorded | `docs/ARCHITECTURE.md` decision log |

The AI surface holds 141 unit and integration tests across 12 spec files
(counted from the JSON reporter in section 2).

## 2. Commands executed on master `0cd34cd`

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `npx vitest run --coverage` (apps/api) | 0 | 497 tests in 50 files passed; coverage statements 100% (824/824), branches 99.6% (499/501), functions 100% (171/171), lines 100% (808/808) |
| 2 | `npx vitest run src/domains/ai src/domains/ai-agent src/domains/knowledge/knowledge-retrieval.service.spec.ts --reporter=json` | 0 | 141 tests in 12 files (per-file counts in section 3) |
| 3 | `npm run typecheck` | 0 | `tsc --noEmit` clean in every workspace |
| 4 | `npm run lint` | 0 | 0 errors; 14 warnings, all in specs outside the AI surface |
| 5 | `npm run format:check` | 0 | All matched files use Prettier code style |
| 6 | `npm run build` | 0 | nest build and next build succeed; fonts served from `static/media` (D-25) |
| 7 | `npm run e2e:web` | 0 | 28 journeys passed, including the 5 agent lifecycle journeys |
| 8 | `npm run audit:check` | 0 | PASS against the baseline: 6 advisories (1 critical, 2 high, 1 moderate, 2 low), no new entry |
| 9 | `python scripts/check_docs.py --draft` | 0 | 0 errors, 0 warnings, 100/100, 27/36 tasks |
| 10 | CI check runs for `0cd34cd` (GitHub Actions) | green | Build, Type check, Lint, Format, Unit tests, Prisma schema, Docs checker, Dependency audit and Landing journeys all `success`; "Human approval required" is `skipped` because there is no pull request |

## 3. Gate criterion to evidence

| Gate criterion | Evidence | Result |
| --- | --- | --- |
| Required AI evaluation gates (AC-F08-1, AC-F08-2, AC-F11-2) | `agent-publish.service.spec.ts` (12): a clean gate publishes with `publishedAt` and the active version; one `missing_evaluation` per required version; `evaluation_failed` plus `critical_regression` naming the case; every blocking reason in one 422; uncompilable tool schema blocks; already-published 409. `evaluation.service.spec.ts` (9): summary and findings persisted, unanswered case and throwing runner both fail, unknown dataset 400, no runner 503, other-tenant version 404, role without `ai.agent.configure` 403 before any read | pass |
| Publish suite covers adversarial regressions (AC-F09-3, AC-F10-3; TH-03, TH-04) | 4 required dataset versions, 13 synthetic cases: `support-triage@1.0.0` (3), `safety-refusal@1.0.0` (3), `adversarial-injection@1.0.0` (3), `adversarial-boundary@1.0.0` (4). `adversarial-datasets.spec.ts` (6) proves every version is required, reference answers score every case PASSED, and each hostile answer fails its target with the named finding, including answers that call `refund.create`, `ticket.list`, `knowledge.search` or `audit.read` | pass |
| Permission checks on the agent surface (AC-F08-3) | `ai-agent.service.spec.ts` (18) and `ai-agent.controller.integration.spec.ts` (10): 401 unauthenticated, 403 without `ai.agent.configure`, 403 for a guessed tenant, 400 without tenant scope, 403 without `ai.agent.publish` audited as `permission.denied` with the publish gate unreached, rollback to a non-published version refused | pass |
| Tool authorization and approval (AC-F10-1, AC-F10-2, AC-F10-3; TH-03) | `tool-execution.service.spec.ts` (24): the handler is never called on unknown, disabled, ungranted, invalid-argument, scope-forging, unapproved, timed-out or failing calls; role comes from server context so an R-customer proposal is denied and invented fields are ignored. `tool-approval.service.spec.ts` (11) and `tool-proposal.guard.spec.ts` (12) cover the approval claim and schema rejection | pass |
| Citations are server-computed and grounded (AC-F09-1) | `ai-runtime.service.spec.ts` (17): citations come from grounded retrieval hits, never from model text. `knowledge-retrieval.service.spec.ts` (8): deny-by-default before any query, tenant filter, non-READY and deleted exclusion, provenance payload | pass |
| Abstention and escalation (AC-F09-2) | `ai-runtime.service.spec.ts` (17): empty input clarifies, no hit above threshold abstains, provider outage after the bounded retry escalates with handoff context, denied retrieval escalates before the model, explicit human request escalates. `adversarial-boundary@1.0.0` requires escalation on every boundary case | pass |
| Immutable published version (AC-F08-1) | `agent-schema.spec.ts` (7) pins the BEFORE UPDATE trigger and the unique agent/version constraint; migration `0005` was applied live and a direct UPDATE of a PUBLISHED row failed with `P0001` on the Supabase project (T4.02 run log). `agent-publish.service.spec.ts` sets PUBLISHED and `activeVersionId` in one transaction; rollback only accepts a PUBLISHED version and moves the pointer | pass |
| Agent lifecycle UI and denial handling | 5 Playwright journeys in `tests/ai-agents.spec.js`: empty tenant creates the first draft, a blocked publish lists every finding, a passing run publishes, versions tab rolls back, a refusal without findings shows a message. 28/28 journeys green | pass |
| Core-domain coverage target (NFR-03) | 100% statements, lines and functions; 99.6% branches against the 80% threshold | pass |

## 4. Residual risks and open items (owner action wanted)

1. **Blocking for real evaluation: no runner is registered.** `EVALUATION_SUBJECT`
   has no default provider (D-23), so `POST /ai/agents/:id/versions/:versionId/evaluations`
   answers 503 and records no run. Every publish in this evidence package is
   proven against runs that tests wrote, not against scores a real agent
   produced. Wiring the runner to `AiRuntimeService` is the missing piece.
2. **The live model provider is unproven.** CI uses the offline deterministic
   adapter. The adversarial datasets have never been scored against Groq
   (`openai/gpt-oss-120b`), so real-model behaviour on injection and boundary
   cases is unknown.
3. **The studio journeys mock the API.** Tabs 8 and 9 were never driven in a
   browser against the real API and database in this session; the API itself is
   covered by HTTP integration tests.
4. **Permission naming needs acknowledgement.** D-22 keeps
   `ai.agent.configure` and `ai.agent.publish`; the PRD names `ai.agent.create`,
   `ai.agent.test` and `ai.agent.deploy`. The mapping covers the intent of
   AC-F08-3 but the codes differ from the requirement text.
5. **Approval expiry and the one-time claim are unit-tested only**, not
   exercised against live Postgres.
6. **The immutability probe was live at T4.02**, not in this session. The
   database trigger is still in place; a re-probe is cheap if the owner wants
   fresh evidence.
7. **14 lint warnings** exist in specs outside the AI surface; they are
   pre-existing and do not fail the gate.

## 5. Confidence score (AGENTS.md section 4 matrix)

| Check | Points | Evidence line |
| --- | --- | --- |
| RED seen before the change | 15 | Run log: T4.03 `Cannot find module './ai-runtime.service.js'`; T4.04 `Cannot find module './tool-execution.service.js'`; T4.05 wrong export name; T4.06 service spec failed before the service existed and the controller returned 403 where 400 was required; T4.07 `adversarial-datasets.spec.ts` failed 6/6 and the publish spec failed 9/12 |
| Task tests pass | 20 | 497/497 in 50 files; 141 AI-surface tests in 12 files; coverage 100/99.6/100/100 |
| Full suite, format, lint, typecheck and build pass | 20 | Commands 1-10 above all exit 0; CI green on `0cd34cd` |
| Every acceptance criterion maps to a passing test | 10 of 15 | AC-F08-1/2/3, AC-F09-1/2/3, AC-F10-1/2/3, AC-F11-2 and TH-03/TH-04 map to named specs; AC-F08-2 is proven with recorded runs that no live agent produced (risk 1), so the mapping is partial |
| Denial and validation tests pass | 10 | 401/400/403/404/409/422 matrices on the agent, evaluation and tool surfaces; every tool denial asserts the handler was never called; every publish refusal asserts no write |
| Diff stays within scope | 10 | T4.07 touched `packages/ai-evals`, one spec, one web constant and docs; the font fix is a separate recorded change (D-25); no secret in the diff |
| No unlogged assumption; docs synced | 10 | D-18 to D-25 recorded; run log rows for every task and both fixes; TESTING rows name the adversarial datasets |

Total: **95/100**. The five withheld points are the AC-F08-2 half of the
criteria row: the gate mechanics are proven, but no real agent has been scored
because the runner is not wired.

## 6. Owner decision requested

Option A (recommended, SELECTED by the owner on 2026-11-03): approve GATE-4 as
green for the gate mechanics, tick the gate line, and record "wire the
evaluation runner" as a condition that blocks the first production agent
publish, not Phase 5 work. The evidence above is complete for what T4.01 to
T4.07 promised.

Option B: hold GATE-4 until the runner lands, so every criterion is proven
end to end, including one live evaluation of a real agent version.

Either way, risk 2 (no live model run against the adversarial sets) stays open
until the owner decides whether to spend provider credits on an evaluation
run.
