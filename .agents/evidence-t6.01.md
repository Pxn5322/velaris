# T6.01 evidence package (full regression and critical gaps)

Status: COMPLETE, awaiting merge. The plan line stays unticked until CI is green
on the merge commit.

Task line: `T6.01 [QA] Run full unit/integration/E2E/AI regression suites and
resolve critical gaps — NFR-03,NFR-08,NFR-09 · files: test suites,
packages/ai-evals/ · verify: all configured test commands pass and report is
attached`.

Capture type: SIMULATED. One agent ran every command sequentially and wrote this
report; AGENTS.md section 3.3 requires that disclosure. All commands ran
EXECUTED on the development machine against branch
`test/T6.01-full-regression` (master `b0dd48e`).

## 1. What this task does and does not cover

The task is a regression pass, not a feature. It has three outputs:

1. Every configured command runs against the current tree, with observed exit
   codes and counts (section 3).
2. Gaps found by the pass are closed in the same change, first with a failing
   test (section 5).
3. Gaps that belong to product work are written down with an owner, so they are
   visible at the GATE-6 decision instead of being implied (section 6).

## 2. Environment

| Item | Value |
| --- | --- |
| Branch | `test/T6.01-full-regression` from master `b0dd48e` |
| Runtime | Node with npm workspaces (D-09); Windows development machine, CI runs Ubuntu |
| Database | Not used: every suite stubs Prisma, Supabase Auth and the LLM provider, so the pass is provider-free and safe to repeat |
| Browser | Playwright Chromium against the production build of `apps/web` |

## 3. Commands executed

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | `npm run test` | 0 | 601 tests in 63 files (apps/api) plus 22 tests in 2 files (`packages/ai-evals`), 623 total |
| 2 | `npm run test:cov --workspace apps/api` | 0 | coverage gate passes: statements 99.38% (967/973), branches 98% (591/603), functions 99.51% (207/208), lines 99.36% (946/952) |
| 3 | `npm run test:e2e --workspace apps/api` | 0 | 3/3 boot cases against the real `AppModule`, including the CORS preflight |
| 4 | `npm run typecheck` | 0 | `tsc --noEmit` in api, web, worker, contracts, test-utils and ai-evals |
| 5 | `npm run lint` | 0 | 0 errors; 14 warnings, all in two existing spec files (section 6, G-4) |
| 6 | `npm run format:check` | 0 | Every workspace with a formatter conforms |
| 7 | `npm run build` | 0 | nest, next, worker, contracts, test-utils and ai-evals build |
| 8 | `npm run audit:check` | 0 | 6 advisories against the baseline (1 critical, 2 high, 1 moderate, 2 low); no new advisory |
| 9 | `python scripts/check_docs.py --draft` | 0 | 0 errors, 0 warnings, 100/100 |
| 10 | `npm run e2e:web` | 0 | 38/38 journeys in 15.4 s |

NFR-03 is met with margin: the 80% threshold applies to
`src/domains/**/*.service.ts` and every metric is above 98%.

## 4. E2E journey inventory (NFR-08 scope)

| Suite | Journeys | Covers |
| --- | --- | --- |
| `tests/landing.spec.js` | 4 | AC-F01-1 marketing page, section anchors, sign-in and registration entry points |
| `tests/inbox.spec.js` | 7 | AC-F06/J-04 agent inbox: loading, empty, error retry, assignment filter, detail, 409 conflict |
| `tests/customer-portal.spec.js` | 6 | J-03 customer sign-in refusal, sign-in, conversation timeline |
| `tests/knowledge.spec.js` | 6 | T3.05/AC-F07 knowledge list, detail, retry resubmit |
| `tests/ai-agents.spec.js` | 5 | F-08 agent studio: denial, empty create, blocking findings, publish, rollback |
| `tests/governance.spec.js` | 10 | T5.04/AC-F11-3, AC-F12-1, AC-F12-3 governance views and denials |

Total: 38 journeys. The automated accessibility scan is not part of this suite;
it belongs to T6.02 (gap G-2).

## 5. Gaps found by the pass and closed here

### G-1 — the eval scorer had no suite in its own workspace (NFR-09)

`npm run test` fans out over workspaces, and `packages/ai-evals` had no `test`
script, so the package that decides whether an agent release may publish was
silently skipped by the root command. Its rules were exercised only from
`apps/api` specs, which means a scoring change could pass locally while the
package it changes stays untested.

RED: `npm run test --workspace packages/ai-evals` answered
`npm error Missing script: "test"` — zero of the new assertions could run.

GREEN: `packages/ai-evals` now has `test` (`vitest run`), `typecheck` against a
new `tsconfig.test.json`, and two spec files:

- `src/scoring.spec.ts` (13 tests): a satisfied case passes with no findings;
  intent mismatch names both intents, and a missing intent reports `none`;
  a missing citation, a missing escalation and a called forbidden tool each
  fail; containment checks ignore case; every finding is collected rather than
  the first; `summarise` reports counts, pass rate and status, counts CRITICAL
  failures separately, and fails the run for a MEDIUM failure too because
  AC-F08-1 requires a passing suite; an empty run rates 0; `scoreDataset` fails
  a case the run never answered.
- `src/datasets.spec.ts` (9 tests): every required version resolves and has
  cases, the adversarial sets are inside the required suite, versions and case
  ids are unique, every dataset holds at least one CRITICAL case, an unknown
  version returns nothing, and the adversarial fixtures are complete: every
  reference answer passes every adversarial case and every hostile answer fails
  its targeted case with the finding that must catch it (TST-TH-04).

`tsconfig.json` now excludes `src/**/*.spec.ts` so specs stay out of `dist`,
and `tsconfig.test.json` typechecks them.

### G-2 — TH-07 had no redaction test (SECURITY.md TH-07)

The GATE-5 package recorded that no test asserted a log line or trace row omits
personal content. `apps/api/src/domains/ai/ai-trace.redaction.spec.ts` (6 tests)
now proves it with a canary that travels through the run: the canary is in the
customer message, in the retrieved chunk and in the model reply, so its absence
from operational metadata is evidence of redaction.

- The trace writer receives exactly the eight allowed fields
  (`correlationId`, `tenantId`, `outcome`, `model`, `attempts`, `citationCount`,
  `latencyMs`, `traceId`) and no canary, on `respond` and on an escalation.
  Positive controls assert the canary IS in the reply and in the escalation
  context, so the fixture cannot pass vacuously.
- The failure path keeps the reply and returns `traceId: null`.

RED: the failure-path test exposed a real leak. `recordTrace` logged
`error.stack`, whose first line is `Error: <message>`, so an error message that
quotes the failing value — a Prisma error quoting a parameter, for example —
put content into the server log. Observed:
`AI trace write failed for correlationId=req-th07-fail","Error: write failed for CANARY-7f3e9a-…`.

GREEN: `safeErrorDetail(error)` (exported from `ai-runtime.service.ts`) keeps the
error name and the stack frames and drops the message, so the log still names
the request through its correlation id and still points at the code frame.
Three tests pin the helper: frames kept and message dropped, a non-Error value
reported by its type only, and a stack-less error reported by name alone.
D-32 records the decision.

### G-3 — a documented rule contradicted the code (documentation drift)

`packages/ai-evals/src/types.ts` said a failed MEDIUM case "only lowers the
score", but `summarise` fails the whole run for any failed case, and the publish
gate requires every required run to be PASSED. AC-F08-1 ("passing required
evaluation suite") makes the code right and the comment wrong. The comment now
states the rule the code enforces, and `scoring.spec.ts` pins it.

### G-4 — the verified-command claim for lint was stale

`npm run lint` exits 0 but reports 14 warnings: 13 `unbound-method` references in
`apps/api/src/domains/ai/ai-runtime.service.spec.ts` and 1 unused variable in
`apps/api/src/domains/ai/tools/tool-execution.service.spec.ts`. They pre-date this
task (the new spec contributes none) and they do not fail CI. AGENTS.md said
"0 errors, 0 warnings", so the claim was corrected to the observed state instead
of the warnings being silenced. Removing them is ordinary clean-up, not a release
condition.

## 6. Gaps found and left open, with an owner

| ID | Gap | Severity | Owner / next step |
| --- | --- | --- | --- |
| O-1 | No customer conversation route (API-13). The AI producer is the configuration-time `POST /ai/runs`, so no real customer message reaches the runtime | blocks production AI, not this gate | T6.04 / backlog: build API-13 before a customer-facing agent ships |
| O-2 | No memory read API; `ai_memories` rows are created by tests only | does not block | backlog (F-10 follow-up) |
| O-3 | Automated accessibility scan (axe or equivalent) is not configured (NFR-08) | blocks nothing before T6.02 | T6.02 |
| O-4 | J-01 and J-06 have no browser journey. J-01 registration is proven at API level by the T5.06 live probe (201 with a real workspace); a browser journey would need a live Supabase project and secrets in CI | recorded | T6.02/T6.03 with a staging project; J-06 has no UI to drive, and its contract is covered by the webhook integration specs |
| O-5 | Coverage is measured for `apps/api` only. `packages/ai-evals` has a suite but no coverage gate | low | T6.02 may add the package to the gate |
| O-6 | No tenant TRACES policy row exists in the development project, so every live probe used the 30-day default | low | proven by unit tests; add a policy row when a tenant is provisioned for staging |

## 7. Score

| Check | Points | Evidence |
| --- | --- | --- |
| RED seen for each closed gap | 15 | G-1: `Missing script: "test"`; G-2: the observed log line carrying the canary; G-3 and G-4 are doc/claim drift with the observed command output |
| Task tests pass | 20 | 623 tests (601 api + 22 ai-evals); the new tests are 6 redaction cases and 22 package cases |
| Full suite, format, lint, typecheck, build | 20 | Commands 1 and 4-10 exit 0; command 5 exits 0 with the 14 pre-existing warnings recorded in G-4 |
| Acceptance criteria mapped to tests | 15 | NFR-03: coverage 99.38/98/99.51/99.36 against the 80% gate. NFR-09: the publish gate specs plus the new package suite. TH-07: the redaction spec |
| Denial and validation tests | 10 | Unchanged and green: guard chains, tenant scope, webhook refusals, publish gate findings |
| Diff stays within scope | 10 | `packages/ai-evals/` and test suites, plus the one logging fix G-2 required (disclosed as a deviation); no new runtime dependency; `vitest` added as a devDependency at the version already hoisted |
| No unlogged assumption; docs synced | 10 | G-3 and G-4 correct the docs in the same change; O-1 to O-6 are written down here; D-32 records the logging decision |

Total: **100/100**. The one deviation (production code touched) is the minimum
change a security test could not otherwise justify, and it is recorded.

## 8. Residual risks

1. The pass uses stubs, so it does not prove live provider behaviour. The live
   Supabase path is covered by the T5.06 probe (`POST /ai/runs` 201, trace row
   readable, latency KPI sampled).
2. The 38 browser journeys run against mocked API responses in the web build, so
   they prove rendering and client states, not database round trips.
3. The audit baseline still holds 1 critical advisory. It is a known, recorded
   dev-toolchain advisory; T6.02 re-runs the scan.

## 9. Follow-up for T6.02

T6.02 owns the load profile (NFR-01, NFR-04), the accessibility review (NFR-08)
and the security and dependency scans. This report hands it: a green baseline at
623 tests, a provider-free repeatable command list, O-3 as its accessibility
item, and the audit baseline to re-check.
