# Evidence — T6.05 (API-13 customer replies, gap O-1)

Date: 2026-11-05
Branch: `feature/T6.05-api13-customer-replies`
Task: close T6.01 gap O-1. API-13 `POST /api/v1/conversations/{id}/messages` must answer a customer message through the F-09 runtime.

## 1. Acceptance criteria in scope

| Criterion | What it requires                                                                              | Where it is proven                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-09      | The AI agent answers customers from authorized knowledge                                      | `conversations.ai-reply.spec.ts`, `conversations.controller.spec.ts`                                                                                                   |
| AC-F09-1  | A relevant authorized question gets a grounded answer with citations                          | TST-AC-F09-1a: the answer is stored as a SYSTEM `CUSTOMER_VISIBLE` message with the derived key `ai-reply:<messageId>`, and the response carries `reply.citationCount` |
| AC-F09-2  | No relevant knowledge, provider failure or a human request abstains or escalates with context | TST-AC-F09-2a: abstain, escalate and a runtime fault return `ai.handoff` with `reason` and `retrievedCount`, and no excerpt                                            |
| AC-F04-3  | Tenant A cannot read or write tenant B resources                                              | TST-AC-F04-3a: the tenant scope check and the 403 without `message.create`                                                                                             |
| API-13    | Contract in `docs/ARCHITECTURE.md` row API-13                                                 | Message accepted, AI outcome returned, 400/401/403 documented                                                                                                          |

## 2. RED

The first run of `conversations.ai-reply.spec.ts` failed for the expected reasons before the implementation existed:

- the message route was guarded by `ticket.read`, so the new `message.create` code and its role grants were absent from `permission.codes.ts` and `role-permissions.ts`;
- the controller never called `AiRuntimeService`, so no answer row and no `ai` summary were produced.

`npm run test --workspace apps/api` reported the four new cases failing on the missing permission constant and the absent runtime call.

## 3. GREEN

`npm run test --workspace apps/api` → 607 tests in 63 files pass.
`npm run test` → 629/629 (607 api + 22 ai-evals).
RED cases now pass:

1. A grounded reply is stored with the derived idempotency key, and a repeat posts no second answer.
2. An abstain stores no answer and returns the handoff reason.
3. An escalation returns a handoff with no excerpts.
4. A runtime fault returns the stored message with a handoff and logs `safeErrorDetail` without the question text (canary `CANARY-9c41f2-where-is-my-refund` absent from the log line).

Denial and scope cases:

- `authorization.service.spec.ts`: R-customer now resolves `['ticket.read', 'message.create']`, and an unknown role still receives nothing.
- `conversations.controller.integration.spec.ts`: a request without `message.create` receives 403; an unknown tenant receives 404/403 per the existing scope rule; an R-agent message skips the runtime.

## 4. REFACTOR

- The runtime call moved into one controller method, `answerAsCustomerMessage`, so the route handler keeps one responsibility per step: store, decide, answer, respond.
- The two new lint warnings came from referencing a mock through its object (`ai.handle`). The mock is now a standalone binding (`aiHandle`), so `npm run lint` stays at the 14 known warnings.

## 5. Verification commands

| Command                                | Result                              |
| -------------------------------------- | ----------------------------------- |
| `npm run test`                         | exit 0, 629/629                     |
| `npm run typecheck`                    | exit 0                              |
| `npm run lint`                         | exit 0, 0 errors, 14 known warnings |
| `npm run format:check`                 | exit 0                              |
| `npm run build`                        | exit 0, nest + next build           |
| `npm run e2e:web`                      | exit 0, 42/42 journeys in 19.8 s    |
| `npm run inventory:check`              | exit 0, 39 routes, 36 protected     |
| `python scripts/check_docs.py --draft` | 0 errors, 0 warnings, 100/100       |

Browser journeys added (J-03, `tests/customer-portal.spec.js`):

1. A customer asks a question and reads the grounded answer with its citation count; a seventh axe scan covers the answered state.
2. An unanswered question shows the handoff notice and adds no answer row.
3. A denied reply (403) shows an error and keeps the draft.

## 6. Confidence

| Check                                              | Points |
| -------------------------------------------------- | ------ |
| RED seen before the change                         | 15     |
| Task tests pass                                    | 20     |
| Full suite, format, lint, typecheck and build pass | 20     |
| Every acceptance criterion maps to a passing test  | 15     |
| Denial and validation tests pass                   | 10     |
| Diff inside the recorded scope                     | 10     |
| No unlogged assumption, docs synced                | 5      |

Score: **95**. The last row loses 5 points because the task's `files:` list named the API only. The portal composer and its three journeys were added because the portal had no way to send a message, so API-13 would have had no customer surface. The deviation is recorded in the run log.

## 7. Limits

- The portal journeys intercept the API with `page.route`; no live provider call is made.
- The seven axe scans cover the portal reply states. A screen-reader pass (M-1) is still open with the QA owner.
- This task adds no production deployment or migration.

## 8. Remaining gaps

| Gap | What it needs                                                                                                                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| O-2 | A requirement first: what a memory view shows, who reads it, and how retention or TTL is displayed. Then `GET /ai/memories?customerId=` with tenant and customer scope, an audit event, and a SECURITY row. |
| O-4 | A staging Supabase project, CI secrets, a seeded staging tenant, and a decision plus a surface for J-06, which has no UI today.                                                                             |
| O-6 | Default `retention_policies` rows at tenant provisioning, plus a migration for existing tenants, verified in staging under T6.03.                                                                           |
