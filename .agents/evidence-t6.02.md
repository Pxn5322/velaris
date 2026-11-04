# T6.02 evidence — load profile, accessibility review and security scans

Task: `[QA] Run load profile, accessibility review and security/dependency scans` (NFR-01, NFR-02, NFR-04, NFR-08).
Branch: `test/T6.02-release-readiness`, from `b7c4716` (T6.01 merge).
Date: 2026-11-04. Role passes: all steps ran in one session, so the review, critic and verification passes were SIMULATED (sequential passes with fresh questions), not independent agents.

## 1. What the task required

| Requirement | Target | Evidence |
| --- | --- | --- |
| NFR-04 | Fast non-AI APIs at p95 < 200 ms under a documented load | Section 3 |
| NFR-02 | 100% of protected APIs enforce authentication and the required permission | Section 4 |
| NFR-01 | Tenant isolation holds across the defined suite | Section 4 |
| NFR-08 | WCAG 2.2 AA for critical journeys: automated checks plus manual review | Section 5 |
| Security | No new dependency advisory; no credential in the tree | Section 6 |

## 2. Outcome

Two defects that block a release were found and fixed, one defence gap was closed, and two T6.01 gaps were closed. Summary: p95 2.33–3.48 ms against the 200 ms budget; 39 routes inventoried with an unauthenticated prototype removed; six axe scans plus a keyboard journey green after fixing contrast, target size and focus visibility; 620 unit tests, 39 journeys, coverage 97.56% in the eval package; audit baseline unchanged.

## 3. Load profile (NFR-04)

`scripts/load-profile.mjs` is the repeatable harness: fixed concurrency, a warmup that is measured and discarded, keep-alive sockets, nearest-rank percentiles, a budget check and optional JSON output. It refuses a probe that answers 404, so a path typo cannot pass as a fast result.

Command (built API started with `PORT=3100 node apps/api/dist/main.js`):

```
MSYS_NO_PATHCONV=1 node scripts/load-profile.mjs --url http://127.0.0.1:3100 \
  --path / --path "/tickets?tenantId=11111111-1111-4111-8111-111111111111" \
  --path "/auth/session" --concurrency 8 --duration 10 --warmup 2 \
  --out .agents/load-profile.json
```

| Path | Responses | Requests | req/s | mean | p50 | p90 | p95 | p99 | max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (public) | 200 | 37,540 | 3,754 | 2.11 | 2.11 | 2.27 | 2.33 | 2.64 | 11.28 |
| `/tickets?tenantId=…` (guard rejection) | 401 | 24,442 | 2,444 | 3.25 | 3.17 | 3.39 | 3.48 | 4.03 | 11.12 |
| `/auth/session` (guard rejection) | 401 | 24,871 | 2,487 | 3.20 | 3.12 | 3.32 | 3.41 | 4.03 | 10.00 |

Zero server errors. Times are milliseconds. Node v24.19.0, Windows, loopback, single API process.

A second run of the same command after the harness refactor (probe before warmup) measured p95 1.63 ms on `/` (66,455 requests, 6,645 req/s), 2.73 ms on the guarded ticket path (39,725 requests) and 2.57 ms on `/auth/session` (41,191 requests), maximum 16.47 ms, zero errors. The committed `.agents/load-profile.json` is that second run. The two runs show the variance a loopback measurement carries; both are far under the budget.

Reading of these numbers: they measure routing, middleware order and the authentication guard, which is the fixed cost every fast request pays. They do not measure a database round trip, because an authenticated request needs a live Supabase token and this machine has no test user credential. The first measurement attempt was invalid: Git Bash rewrote the bare `--path /` into a Windows path, all three paths answered 404, and the numbers looked excellent. The script now refuses a 404 probe, and the run above shows its status counts.

**Limitation, recorded:** authenticated database-backed p95 (for example `GET /tickets` with a token) belongs to T6.03, where staging has a seeded dataset and a real sign-in. T6.03 must repeat this command against the staging origin and record the same table.

## 4. Route inventory and tenant isolation (NFR-02, NFR-01)

`scripts/check-route-inventory.mjs` (exposed as `npm run inventory:check`, CI job `inventory`) parses every controller, prints each route with its guards and permission codes, and fails when a route has no authentication guard or no permission code and is not on a documented public list. Public entries carry a reason in the script: `GET /` (liveness), `POST /auth/signup` (AC-F01-2), `POST /webhooks/:provider/:endpointId` (signed delivery). `GET /auth/session` is authenticated but declares no resource permission, which is also listed with a reason.

Result after the fix: 39 routes in 12 controller files, 36 protected, 3 public, 35 declaring at least one permission code, exit 0.

**Finding S-1 (fixed).** The first run failed on `GET /agents` in `apps/api/src/domains/agents/`. `AgentsController` served an in-memory array with no guard, no permission code and no tenant enforcement; omitting `tenantId` returned every tenant's rows. The route is not in the API contract (the agent API is API-10 under `/ai/agents`), no client calls it, and its only test asserted the in-memory filter. It is removed with its module and spec (D-33), and the inventory job now fails such a route on every push.

Tenant isolation: 15 API spec files assert cross-tenant behaviour and the suite holds 105 explicit 403/404 denials. No cross-tenant read or write passed.

## 5. Accessibility (NFR-08)

### 5.1 Automated

`tests/a11y.js` runs axe-core 4.14.0 (through the `@axe-core/playwright` devDependency) with an explicit WCAG 2.0, 2.1 and 2.2 A/AA tag list, and fails a journey on a critical or serious violation. Six journeys scan the state they render: landing hero, agent inbox timeline, customer portal sign-in error, customer portal timeline, knowledge source detail with a failed source, analytics KPIs.

Findings on the first run:

| ID | Finding | Severity | Fix |
| --- | --- | --- | --- |
| A-1 | `color-contrast` on timeline metadata: slate-500 on slate-900 measured about 4.1:1, under the 4.5:1 floor for normal text (agent inbox and customer portal) | serious | metadata text moved to slate-400 (about 7.5:1) in `apps/web/src/app/inbox/page.tsx`, `portal/conversations/page.tsx` and `portal/sign-in/page.tsx` |
| A-2 | `target-size` (WCAG 2.2 2.5.8) on five desktop navigation links, each about 20 px tall | serious | `py-1.5 -my-1.5` on the links: a 32 px target with no visual movement (D-34) |

### 5.2 Manual keyboard, reflow and reading order

| Check | Result |
| --- | --- |
| Focus visibility on the first six tab stops | **Failed first, fixed.** Controls that set `focus:outline-none` replaced the ring with nothing, so the logo link and header buttons showed no position. A global `:focus-visible` rule (2 px `--accent-cyan`, 2 px offset) now applies outside the Tailwind layers, so a utility class cannot remove it. New journey: `every keyboard stop shows a visible focus ring`. |
| Tab order follows the visual order on landing | Pass: logo, theme, sign in, start free, then main content |
| Landmarks and language | Pass: `header`, `main`, `footer`, one `nav`, `lang="en"` |
| Skip link | Absent. The `bypass` rule passes because landmarks exist; a skip link is still the better experience for a repeated header. Recorded as recommendation R-1, not a WCAG failure. |
| Reflow at 320 px width | Pass: document scroll width 303 px at a 320 px viewport, no horizontal scroll |
| Mouse users see no ring | Pass by construction: the rule is `:focus-visible` only |

### 5.3 Not done

**M-1 (open): a screen-reader pass with real assistive technology.** No screen reader is installed on this machine, and an emulated announcement log would not prove landmark, form-error or live-region behaviour. NFR-08 asks for it. Owner: QA owner, before T6.04 release approval. The automated scan covers only what axe can detect; it cannot hear the page.

## 6. Dependency and credential scans

| Check | Result |
| --- | --- |
| `npm run audit:check` | PASS, 6 advisories unchanged (1 critical, 2 high, 1 moderate, 2 low) against `scripts/audit-baseline.json` |
| Credential pattern scan over every tracked file (`git grep` for service-role keys, provider keys, private keys and JWT prefixes) | No credential. The only matches are the synthetic `sb_secret_test` stubs in `auth/signup.integration.spec.ts` and `auth/supabase-admin.service.spec.ts` |
| New dependencies | `@axe-core/playwright` 4.14.0 as a root devDependency; `@vitest/coverage-v8` declared in `packages/ai-evals` at the version already hoisted. No runtime dependency (D-34) |

## 7. T6.01 gap register after this task

| ID | Status | Detail |
| --- | --- | --- |
| O-1 | **Open, needs an owner decision** | API-13 (`POST /conversations/{id}/messages` answering through the AI runtime) is blocked by the current permission matrix, not by missing code: `R-customer` holds only `ticket.read` in `role-permissions.ts`, and `conversations.controller.integration.spec.ts` proves "R-customer cannot post a message (AC-F05-3)". Letting a customer message reach the runtime therefore changes an acceptance criterion and a security baseline: it needs an owner decision to grant a reply capability to `R-customer`, and to run the runtime synchronously inside that route. Recommended: grant `message.create` to `R-customer` with the existing own-conversation check, run the runtime only for customer-authored messages, persist the reply as a SYSTEM message and return the outcome in the same response. Estimated as its own task. |
| O-2 | Open, blocked on a requirement | No document defines a memory read API and no client or view consumes one. Building it now would be speculative surface. Owner: backlog with F-10, when a memory view is specified |
| O-3 | **Closed** | Automated accessibility scan configured and running in six journeys; manual keyboard and reflow review recorded above; screen-reader pass split out as M-1 |
| O-4 | Open, blocked on infrastructure | J-01 and J-06 journeys need a live Supabase project with credentials in CI; J-06 has no UI. Owner: T6.03 staging |
| O-5 | **Closed** | `packages/ai-evals` has a coverage gate: 97.56 statements, 97.22 branches, 100 functions, 97.36 lines against the 80% floor, run by the root `npm run test:cov` |
| O-6 | Open, provisioning | A tenant TRACES retention row is created when a staging tenant is provisioned. Owner: T6.03 |

## 8. Verification commands and results

| Command | Result |
| --- | --- |
| `npm run test` | exit 0, 620 tests (598 API in 62 files, 22 ai-evals in 2 files) |
| `npm run test:cov` (eval package) | exit 0, 97.56 / 97.22 / 100 / 97.36 against 80 |
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0, 14 known warnings, 0 errors |
| `npm run format:check` | exit 0 |
| `npm run build` | exit 0 |
| `npm run e2e:web` | exit 0, 39/39 journeys in 15.5 s |
| `npm run inventory:check` | exit 0, 39 routes, 0 findings |
| `node scripts/load-profile.mjs …` | exit 0, p95 2.33 / 3.48 / 3.41 ms, then 1.63 / 2.73 / 2.57 ms |
| `npm run audit:check` | exit 0, baseline unchanged |
| `python scripts/check_docs.py --draft` | exit 0, 100/100, 35/37 tasks |

## 9. Confidence score

| Check | Points | Score | Evidence |
| --- | --- | --- | --- |
| RED seen before the change | 15 | 15 | axe failed twice (contrast, target-size) and the keyboard journey failed on `outline: none`; the inventory failed on `GET /agents`; the first load run was refused as a 404 probe |
| Task checks pass | 20 | 20 | Section 8 |
| Full suite, format, lint, typecheck and build pass | 20 | 20 | Section 8 |
| Each acceptance criterion maps to a passing test | 15 | 15 | NFR-01, NFR-02, NFR-04 and NFR-08 rows in `docs/TESTING.md` section 5 |
| Denial and validation tests pass | 10 | 10 | 105 explicit 403/404 denials; inventory allowlist requires a reason |
| Diff inside the declared scope | 10 | 5 | The task's `files:` line says test reports and security configuration. The `/agents` deletion touches `app.module.ts`, and the accessibility fixes touch `globals.css` and three pages. Each is recorded with a decision (D-33, D-34) |
| No unlogged assumption; docs synced | 10 | 10 | D-33, D-34, M-1, R-1 and the gap register above |
| **Total** | **100** | **95** | Above the 90 threshold |

## 10. Residual risks

1. **The load profile does not include a database round trip.** The 200 ms budget is met by a wide margin for the fixed cost, but a slow query behind a fast route is invisible here. T6.03 must repeat it with a token.
2. **The accessibility scan covers six states, not every view.** The studio tabs, workspace and admin views are not scanned. Adding them is cheap and belongs with the next UI change.
3. **The axe dependency is a new dev tool.** It pins axe-core 4.14.0; a major axe upgrade can add rules and fail journeys, which is intended, and the tag list prevents silent rule-set shrinkage.
4. **O-1 remains the largest product gap.** A production agent still cannot answer a real customer message, and this task did not change that because it needs an owner decision on the permission matrix.
