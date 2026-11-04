# GATE-5 evidence package (observability, analytics and lifecycle)

Status: OPEN, awaiting the owner tick. The owner chose Option B on 2026-11-04:
hold the gate and add T5.06. T5.06 shipped as `2579261`, and section 7 records
the re-run that closes finding F-1. This package still does not tick the gate
line.

Gate line: "Trace/audit completeness, retention, analytics scope and
idempotency checks green."

Capture type: SIMULATED. One agent ran the verification commands sequentially
and wrote this package; AGENTS.md section 3.3 requires this disclosure. The
commands in section 2 ran EXECUTED on the development machine, the live probe
ran EXECUTED against the Supabase development project, and the CI checks ran
EXECUTED on GitHub Actions.

## 1. Scope of this gate

| Task                         | What shipped                                                                                                                  | Status                        | Evidence                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| T5.01                        | Request correlation through HTTP, jobs, AI traces and audit                                                                   | done                          | run log 2026-11-03; `correlation.spec.ts` (7)                                                                                               |
| T5.02                        | Retention and expiry for knowledge, traces and memory; migration `0007`                                                       | done, applied live 2026-11-04 | run log 2026-11-03; `retention.spec.ts` (13)                                                                                                |
| T5.03                        | Six documented KPIs, tenant-scoped summary, EMPTY and STALE states                                                            | done                          | run log 2026-11-03; `analytics-range.spec.ts` (7), `analytics.service.spec.ts` (7), `analytics.controller.integration.spec.ts` (6)          |
| T5.04                        | Analytics, audit and trace views with permission-aware states; guarded read routes                                            | done                          | run log 2026-11-04; `audit-query.service.spec.ts` (7), `audit-query.controller.integration.spec.ts` (8), 10 Playwright journeys             |
| T5.05                        | Webhook signature checks and idempotent delivery; migration `0008`                                                            | done, applied live 2026-11-04 | run log 2026-11-04; `webhook-signature.spec.ts` (7), `integrations.service.spec.ts` (9), `integrations.controller.integration.spec.ts` (10) |
| D-26, D-27, D-28, D-29, D-30 | Correlation contract, retention contract, KPI versioning and missing cost data, governance route deviations, webhook contract | recorded                      | `docs/ARCHITECTURE.md` decision log                                                                                                         |

The Phase 5 surface holds 84 unit and integration tests across 11 spec files,
and the governance journeys add 10 browser journeys.

## 2. Commands executed on master `40809bf`

| #   | Command                                                                                                                                    | Exit  | Result                                                                                                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `npx vitest run --coverage` (apps/api)                                                                                                     | 0     | 581 tests in 60 files passed; coverage statements 99.36% (941/947), branches 98.1% (568/579), functions 99.5% (202/203), lines 99.35% (921/927)                                                                                                                                                        |
| 2   | `npx vitest run src/domains/analytics src/domains/audit src/domains/integrations src/domains/retention src/common/logging --reporter=json` | 0     | 84 tests in 11 files (per-file counts in section 3)                                                                                                                                                                                                                                                    |
| 3   | `npm run typecheck`                                                                                                                        | 0     | `tsc --noEmit` clean in both workspaces                                                                                                                                                                                                                                                                |
| 4   | `npm run lint`                                                                                                                             | 0     | Found 0 warnings and 0 errors                                                                                                                                                                                                                                                                          |
| 5   | `npm run format:check`                                                                                                                     | 0     | All matched files use Prettier code style                                                                                                                                                                                                                                                              |
| 6   | `npm run build`                                                                                                                            | 0     | nest build and next build succeed                                                                                                                                                                                                                                                                      |
| 7   | `npm run e2e:web`                                                                                                                          | 0     | 38 journeys passed in 12.9 s, including the 10 governance journeys                                                                                                                                                                                                                                     |
| 8   | `npm run audit:check`                                                                                                                      | 0     | PASS against the baseline: 6 advisories (1 critical, 2 high, 1 moderate, 2 low), no new entry                                                                                                                                                                                                          |
| 9   | `python scripts/check_docs.py --draft`                                                                                                     | 0     | 0 errors, 0 warnings, 100/100, 32/36 tasks                                                                                                                                                                                                                                                             |
| 10  | `npx prisma migrate status` (before)                                                                                                       | 0     | 8 migrations found; `0007_retention_lifecycle` and `0008_webhook_integrations` reported as NOT applied (finding F-2)                                                                                                                                                                                   |
| 11  | `npx prisma migrate deploy`                                                                                                                | 0     | Both migrations applied; `migrate status` then reports "Database schema is up to date!"                                                                                                                                                                                                                |
| 12  | `node .agents/probe-gate5.mjs` (live, one transaction, rolled back)                                                                        | 0     | 8/8 checks PASS: five tables present; `knowledge_sources` expiry columns present; both unique pairs unique; a second delivery for one id rejected with 23505; exactly one row per delivery id; retention window 5000 rejected with 23514; window 30 accepted; `ai_traces.expires_at` NOT NULL enforced |
| 13  | CI for `40809bf` (GitHub Actions)                                                                                                          | green | CI, E2E and Merge gate all `success`; 0 failing, 0 in progress                                                                                                                                                                                                                                         |

## 3. Gate criterion to evidence

| Gate criterion                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                 | Result      |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| Correlation and trace context propagate (AC-F11-1, AC-F13-1)                      | `correlation.spec.ts` (7): a safe client id is echoed, an unsafe or overlong value is replaced by a generated UUID, nested contexts restore, the header is echoed, and an error body carries `requestId`. `AuditService.record` fills `request_id` from that context, and the ingestion job keeps the id of the request that queued it                                                                                   | pass        |
| Trace and audit records are readable under permission and tenant scope (AC-F11-3) | `audit-query.service.spec.ts` (7) and `audit-query.controller.integration.spec.ts` (8): 401 unauthenticated, 403 without `audit.read`, 403 for a guessed tenant, 400 without a tenant scope, no query on denial, expired traces excluded, page limit 1..100 default 25. `tests/governance.spec.js` shows the denial in the browser                                                                                       | pass        |
| Audit rows exist for sensitive actions (AC-F11-1)                                 | `audit.service.spec.ts` (3); `tool-execution.service.spec.ts` writes an audit row per tool decision; `integrations.service.spec.ts` writes one audit row per accepted delivery and none for a duplicate; `permission.denied` is audited on refusals                                                                                                                                                                      | pass        |
| Trace rows exist for AI runs (AC-F11-1, F-11 "trace metadata")                    | `ai-runtime.service.ts` returns `AiTraceMetadata`, but no code calls `prisma.aiTrace.create` anywhere, and no route calls `AiRuntimeService.handle`, so no run produces a row                                                                                                                                                                                                                                            | **gap F-1** |
| Retention makes expired records unreachable (AC-F14-1, AC-F14-2)                  | `retention.spec.ts` (13): availability filters, sweep expiring sources and removing their chunks, deleting expired traces, soft-deleting expired memory, stable idempotency key, correlation id carried into the job; retrieval, source list and detail route ignore expired and deleted rows; one HTTP test proves an expired source is absent and answers 404. Live probe check 6 rejects a 5000-day window with 23514 | pass        |
| Analytics uses documented formulas in tenant scope (AC-F12-1, AC-F12-3)           | `analytics-range.spec.ts` (7), `analytics.service.spec.ts` (7), `analytics.controller.integration.spec.ts` (6): six definitions with label, unit, formula and version 1.0.0; every query filtered by the caller tenant; 403 for a guessed tenant; 400 without a scope and no query runs                                                                                                                                  | pass        |
| Empty and stale telemetry is honest (AC-F12-2)                                    | `analytics.service.spec.ts` returns `EMPTY` with null values and zero samples, and `STALE` with the last event instant past the 60-minute window; `tests/governance.spec.js` renders both states                                                                                                                                                                                                                         | pass        |
| Webhook delivery is idempotent (AC-F13-2, TH-08)                                  | `integrations.service.spec.ts` (9) and `integrations.controller.integration.spec.ts` (10): a repeat with the same payload hash answers 200 with `duplicate: true` and writes neither a delivery row nor an audit row; a reused id with another body answers 409; a P2002 race re-reads the winner. Live probe check 4 rejects the second row with 23505 and check 5 counts one row                                       | pass        |
| Webhook delivery is authentic (AC-F13-3, TH-08)                                   | `webhook-signature.spec.ts` (7) verdicts; HTTP tests answer 401 for a missing, stale, tampered or wrong-secret delivery and write no row, 404 for an unknown endpoint or provider mismatch, 403 for a paused endpoint, 413 above 1 MiB                                                                                                                                                                                   | pass        |
| Analytics and audit views are permission-aware in a browser                       | 10 Playwright journeys in `tests/governance.spec.js`: signed-out denial, loading, EMPTY, unit formatting, STALE, error with Retry, 403 denial for analytics and audit, event and trace listing, both empty states; 38/38 journeys green                                                                                                                                                                                  | pass        |

## 4. Findings and residual risks

1. **F-1, blocking for the gate line as written: no trace producer exists.**
   The trace pipeline is complete as a read path. `ai_traces` has the table,
   the tenant filter, the expiry filter, the retention sweep, the read route
   and the view, and the `ai_latency_p95_ms` KPI sources it. Nothing writes a
   row: no `aiTrace.create` call exists, and no HTTP route calls
   `AiRuntimeService.handle`, so a fresh deployment shows an empty traces tab
   and a permanently `EMPTY` latency KPI. AC-F11-1 accepts "a correlation/trace
   or audit event" per policy, and admin actions do produce audit events; an AI
   run produces neither, because an AI run cannot happen through the product
   yet. The gate criterion says "trace ... completeness", so this needs an
   owner decision, not a silent pass.
2. **F-2, resolved during this pass: the development schema had drifted.**
   `npx prisma migrate status` reported `0007_retention_lifecycle` and
   `0008_webhook_integrations` unapplied on `db.lygekvhwmhbonsdeiaot.supabase.co`.
   T5.02 and T5.05 had recorded `prisma validate` only, so no run log claimed a
   live application. Both migrations are additive (new tables, two nullable
   columns, indexes), they are now applied, and the live probe proves the
   constraints. Until this pass, "retention checks green" and "idempotency
   checks green" rested on unit tests and fake Prisma objects.
3. **Memory is stored and expired but never captured.** No memory write or read
   API exists, so `ActiveMemory` filters are proven at service level only
   (`retention.spec.ts`). AC-F14-3 (restricted audit scope) is covered by the
   existing permission suites, and no lifecycle HTTP route exists.
4. **The webhook secret has no rotation route.** `secretRef` names an
   environment variable (D-30), so rotating the variable rotates every endpoint
   that names it; there is no per-endpoint rotation and no route that reveals
   whether the variable is set.
5. **Cost per resolution is not reported.** D-28 records that provider billing
   data does not exist, so the KPI carries a definition without a live source.
6. **The browser journeys mock the API.** The governance journeys were never
   driven against the live API and database. The API routes are covered by HTTP
   integration tests that build the real Nest application.
7. **TH-07 has no dedicated test.** Correlation ids are sanitised before use,
   and `AiTraceMetadata` excludes message content by construction, but no test
   asserts that a log line or trace row omits a secret or personal content.
8. **Six statements stay uncovered** in `apps/api` (941/947), plus 11 branches.
   The phase-5 surface is fully covered; the gap sits in earlier code.

## 5. Confidence score (AGENTS.md section 4 matrix)

| Check                                              | Points   | Evidence line                                                                                                                                                                                                                                            |
| -------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED seen before the change                         | 15       | Run log: T5.01 `Cannot find module './correlation.js'`; T5.02 `Cannot find module './retention-policy.js'`; T5.03 both specs failed with a missing module; T5.04 both specs failed with a missing module; T5.05 three specs failed with a missing module |
| Task tests pass                                    | 20       | 581/581 in 60 files; 84 phase-5 tests in 11 files; coverage 99.36/98.1/99.5/99.35                                                                                                                                                                        |
| Full suite, format, lint, typecheck and build pass | 20       | Commands 1 and 3-9 exit 0; CI green on `40809bf`                                                                                                                                                                                                         |
| Every acceptance criterion maps to a passing test  | 10 of 15 | AC-F11-2, AC-F11-3, AC-F12-1, AC-F12-2, AC-F12-3, AC-F13-1, AC-F13-2, AC-F13-3, AC-F14-1, AC-F14-2 and TH-08 map to named tests with observed output. AC-F11-1 is mapped for admin actions but not for AI runs, because no run produces a record (F-1)   |
| Denial and validation tests pass                   | 10       | 401/400/403/404/409/413 matrices on analytics, audit and webhook surfaces; denials assert no query runs and no row is written; the live probe repeats the two schema refusals                                                                            |
| Diff stays within scope                            | 10       | Five tasks stayed inside their `files:` lists; deviations are recorded in D-27 to D-30; no secret in the diff; no new runtime dependency                                                                                                                 |
| No unlogged assumption; docs synced                | 5 of 10  | Every task, deviation and decision is logged, but the plan never assigned a trace-writer task to anyone. F-1 is therefore a coverage hole in the plan, not only in the code, and it stays unrecorded until the owner decides                             |

Total: **90/100**. The ten withheld points are AC-F11-1 for AI runs (5) and the
plan-coverage hole behind it (5). Everything the five tasks promised is proven
by observed output, including the live schema that had drifted.

## 6. Owner decision requested

Option A (recommended): tick GATE-5 as green for audit completeness, retention,
analytics scope and idempotency, and record F-1 as a Phase 6 production
condition, in the style of D-23. The condition: the first production AI run
needs a trace writer at the runtime boundary, because the traces tab and the
latency KPI stay empty until a run persists one. This accepts that "trace
completeness" is proven for the read, retention and permission paths only.

Option B: hold GATE-5 and add T5.06 "persist one `ai_traces` row per runtime
run and expose the run route that calls the runtime", then re-run this package.
That closes AC-F11-1 end to end and is the smaller trust debt, but it adds a
task to Phase 5 after the phase was reported done.

Option C: tick GATE-5 now and start T5.06 immediately as Phase 6 work, so the
gate closes on schedule and the trace writer lands before T6.01 runs the full
regression suite.

Owner decision (2026-11-04): Option B. T5.06 shipped as `2579261` on master,
and section 7 records the re-run against that commit.

F-2 needs no decision; it is fixed and the probe is repeatable with
`node .agents/probe-gate5.mjs` after loading `.env`.

## 7. Re-run after T5.06 (master `2579261`)

T5.06 adds the producer finding F-1 named: `AiTraceService` writes one
`ai_traces` row per runtime run, and POST `/ai/runs` is the guarded route that
calls the runtime. D-31 records the contract.

### 7.1 Commands executed on master `2579261`

| #   | Command                                 | Exit    | Result                                                                                            |
| --- | --------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| 1   | `npm run test`                          | 0       | 595 tests in 62 files passed (was 581 in 60); 13 of them are the new trace-writer and route tests |
| 2   | `npm run test:e2e --workspace apps/api` | 0       | 3/3, including the Nest boot spec that resolves `AiModule` with the new controller                |
| 3   | `npm run typecheck`                     | 0       | `tsc --noEmit` clean in every workspace                                                           |
| 4   | `npm run lint`                          | 0       | Found 0 warnings and 0 errors                                                                     |
| 5   | `npm run format:check`                  | 0       | All matched files use Prettier code style                                                         |
| 6   | `npm run build`                         | 0       | nest build, next build and the package builds succeed                                             |
| 7   | `npm run e2e:web`                       | 0       | 38 journeys passed in 15.0 s                                                                      |
| 8   | `python scripts/check_docs.py --draft`  | 0       | 0 errors, 0 warnings, 100/100, 33/37 tasks                                                        |
| 9   | CI on `2579261`                         | success | 3/3 workflows success (CI, E2E, Merge gate); 0 failures, 0 in progress                            |

### 7.2 Live probe (EXECUTED against the development project)

The probe registers a synthetic workspace, signs in through Supabase Auth,
calls POST `/ai/runs` with an `x-request-id`, then reads the row back through
GET `/audit/traces` and the summary through GET `/analytics/summary`.

| #   | Check                                                | Result                                          |
| --- | ---------------------------------------------------- | ----------------------------------------------- |
| 1   | Registration answers 201                             | PASS                                            |
| 2   | Password grant returns a token                       | PASS                                            |
| 3   | Session resolves one tenant with role R-tenant-admin | PASS                                            |
| 4   | POST `/ai/runs` answers 201                          | PASS                                            |
| 5   | The run reports an outcome                           | PASS (abstain: the new tenant has no knowledge) |
| 6   | The run reports a trace id                           | PASS                                            |
| 7   | The trace carries the request correlation id         | PASS (`x-request-id` echoed)                    |
| 8   | The trace reports a measured latency                 | PASS (247 ms)                                   |
| 9   | GET `/audit/traces` reads the row back               | PASS (1 item, matching id)                      |
| 10  | The AI latency KPI has a sample                      | PASS (sample 1, value 247 ms)                   |
| 11  | The stored trace holds no message content            | PASS                                            |

All 11 checks passed. Checks 9 and 10 are the two surfaces the gate finding
said would stay empty: the traces view now has a row and the latency KPI now
has a sample.

### 7.3 Score after the re-run

| Check                                              | Points | Evidence                                                                                                                                                               |
| -------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RED seen before the change                         | 15     | Run log 2026-11-04: both new specs failed with `Cannot find module`, and the runtime spec failed because the third constructor argument was still the threshold        |
| Task tests pass                                    | 20     | 595/595 in 62 files; 13 new tests                                                                                                                                      |
| Full suite, format, lint, typecheck and build pass | 20     | Commands 1 and 3-9 exit 0; CI green on `2579261`                                                                                                                       |
| Every acceptance criterion maps to a passing test  | 15     | AC-F11-1 now maps for AI runs: one row per run, including escalation, with no content; the route denial matrix is covered. The section 3 criteria are unchanged        |
| Denial and validation tests pass                   | 10     | The route refuses 401, 403 without `ai.agent.configure`, 400 without a scope, 403 for a foreign tenant and 400 for a malformed body, and asserts no write in each case |
| Diff stays within scope                            | 10     | T5.06 stayed inside `apps/api/src/domains/ai/` plus the provider-name helper; D-31 records the decisions; no new runtime dependency                                    |
| No unlogged assumption; docs synced                | 10     | The plan carries T5.06 and its run-log row; DATABASE, TESTING and ARCHITECTURE D-31 are updated in the same change                                                     |

Total: **100/100**. The two withheld points groups from section 5 are earned by
observed output, not by an argument.

### 7.4 Residual risks that stay open

1. The customer conversation route (API-13) still does not exist. The producer
   is a configuration-time preview under `ai.agent.configure`, so a real
   customer message does not reach the runtime yet.
2. Memory capture and a memory read API are still missing, so `ai_memories`
   rows are created only by tests.
3. TH-07 still has no dedicated redaction test. Trace rows exclude content by
   construction and the live probe checks one row, which is not the same as a
   test suite for redaction.
4. Six statements in `apps/api` stay uncovered (941/947); the phase-5 and trace
   surfaces are fully covered.
5. No tenant has a TRACES policy row in the development project, so every
   probe row used the 30-day default. The policy path is proven by unit tests
   only.

### 7.5 Decision requested

Option A (recommended): tick GATE-5. Trace completeness now has a producer, a
reader and a live probe; audit, retention, analytics scope and idempotency were
already green.

Option B: hold GATE-5 until API-13 (the customer conversation route) exists, so
a real customer message produces the trace. That is product work beyond the
gate criterion, and residual risk 1 records it either way.

Option C: tick GATE-5 and open API-13 as the first Phase 6 item, before T6.01
runs the full regression suite.
