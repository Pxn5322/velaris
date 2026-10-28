# GATE-2 evidence package (Phase 2 — core support vertical slice)

Status: DRAFT for owner review. Prepared 2026-10-28, finalized 2026-10-29.
Gate line (docs/IMPLEMENTATION_PLAN.md): "J-03 and J-04 critical support flow
passes E2E; state transitions and message visibility verified."

Capture type: SIMULATED review passes (single agent, separate sequential
review passes; AGENTS.md section 3.3 requires this disclosure). Live checks
below ran EXECUTED against the real Supabase project.

## 1. Scope of this gate

| Task | Status | Evidence |
| --- | --- | --- |
| T2.01 schema (customer/conversation/message/ticket + CHECKs) | done, live-applied | migration 0003 in live DB; run log 2026-10-26 |
| T2.02 ticket rules, transitions, assignment, optimistic concurrency | done | run log 2026-10-28; live transitions below |
| T2.03 conversation/message APIs, visibility boundaries | done | run log 2026-10-28; TH-05 live below |
| T2.04 role-aware inbox, assigned-to-me, timeline states | done this session | journeys below; run log this session |
| Per-customer data scoping (R-customer sees own rows only) | done this session | unit + integration + live below |

## 2. Criterion -> evidence map

| Gate criterion | Evidence | Result |
| --- | --- | --- |
| J-03 customer flow (portal sign-in -> own timeline) | tests/customer-portal.spec.js: 6 journeys (signed-out prompt, bad-credential refusal, empty-form validation, sign-in success landing on timeline, empty state, error state); live: real R-customer GoTrue sign-in -> 200 session, scoped conversation list, timeline without internal notes | pass |
| J-04 agent flow (inbox -> timeline -> status update -> resolve) | tests/inbox.spec.js: 7 journeys (signed-out denial, loading, empty, error+retry, 401 denial, assigned-to-me tab, timeline + stale-update conflict); live: agent create conversation/ticket, post visible + internal messages | pass |
| State transitions verified | live: OPEN->IN_PROGRESS 200 v1; IN_PROGRESS->CLOSED 409 after fix D-16; IN_PROGRESS->RESOLVED 200 (resolvedAt set); RESOLVED->IN_PROGRESS reopen 200 (resolvedAt cleared); RESOLVED->CLOSED 200 with BOTH resolvedAt and closedAt set; stale expectedVersion 409 on ticket and conversation | pass |
| Message visibility verified | live: agent timeline contains CUSTOMER_VISIBLE + INTERNAL; R-customer timeline of the SAME conversation contains only CUSTOMER_VISIBLE; conversation of another customer reads 404 for R-customer | pass |
| Per-customer scoping (TH-01/AC-F04-3) | 8 new integration tests (conversations/customers/tickets list + findOne + deny-by-default); live: R-customer list = own rows only; foreign customer row 403; foreign conversation 404; cross-tenant 403; POST message 403 (no ticket.write) | pass |
| Audit coverage | live DB rows: conversation.created x2, message.created x3 (incl. INTERNAL) with actor and metadata (audit_events read-only query) | pass |

## 3. Finding found by the live check (fixed)

- F-G2-1 (fixed): PATCH ticket to CLOSED directly returned 500 against the
  live database. Root cause: migration 0003 CHECK
  tickets_closed_requires_timestamp requires resolved_at AND closed_at on a
  CLOSED row, but ALLOWED_TRANSITIONS allowed OPEN/IN_PROGRESS/
  PENDING_CUSTOMER -> CLOSED and lifecycleTimestamps cleared resolvedAt on
  the way to CLOSED. Unit tests could not see it (fake Prisma has no CHECK).
  Fix: CLOSED reachable only from RESOLVED; closing keeps resolvedAt.
  Recorded as Proposed D-16 (docs/PRD.md decision log row, marked for owner
  confirmation); 3 new tests pin the invariant;  re-verified live (409 on
  direct close; both timestamps set on RESOLVED->CLOSED).
- F-G2-2 (fixed, self-review pass 2026-10-29): after a 409 conflict the
  inbox detail pane kept the stale ticket version, so J-04's "current
  state shown" recovery was incomplete. Fix: the conflict path now
  reloads the list and re-selects the ticket by id. Covered by the
  existing conflict journey; re-verified by the full 16-journey run.

## 4. Residual risks and follow-ups (owner decisions wanted)

1. R-D16 owner confirmation: the decision-log row in docs/PRD.md section 11
   was added by the agent and needs owner sign-off (revert or approve).
2. R-customer cannot POST replies: role-permissions grants R-customer only
   ticket.read. F-05 says customers communicate; a reply path needs a
   write-limited customer permission decision (owner + security review).
3. Identity -> customer mapping is by verified email match inside the
   tenant. An R-customer with no matching customer row gets deny-all
   (empty list, 404/403). Provisioning that link automatically is a later
   task; document the operational step for tenant admins.
4. CI journeys mock every API/Supabase call with page.route and NEXT_PUBLIC
   stubs in .github/workflows/e2e.yml; the live checks in this package are
   the real-endpoint evidence. A scheduled live-check job against a
   staging environment is still Not configured (Phase 6).
5. The inbox loads the first tenant of the session context (multi-tenant
   switching UI does not exist yet).
6. docs/PRD.md decision table now carries D-16 added by the agent; AGENTS
   section 6 allows doc sync in the same change, but the product owner
   should confirm the row wording.

## 5. Confidence score (AGENTS.md section 4 matrix)

| Check | Points | Evidence |
| --- | --- | --- |
| RED seen (tests failed before change for expected reason) | 15 | 8 integration tests failed pre-implementation with wrong-scope results (200/200 where 403/404 expected); live 500 on direct close |
| Task tests pass | 20 | API 211 tests / 26 files pass; coverage 100% on all four metrics |
| Full suite, format, lint, typecheck, build pass | 20 | npm run test 0; format:check 0; lint 0/0; typecheck 0; build 0; web eslint 0; web tsc 0; docs checker 100/100 (commands re-run on final state) |
| Acceptance criteria map to passing tests | 15 | docs/TESTING.md section 3 rows updated for AC-F05-1/2/3, AC-F06-1/2/3, TH-05 with named spec files |
| Denial/validation tests pass | 10 | 401/403/404/409/400 paths in 3 integration specs + 16 web journeys (3 landing, 7 inbox, 6 customer portal) + live denial matrix |
| Diff within scope | 10 | 20 files API/web/tests/workflows/docs; no dependency added; no secret in diff |
| No unlogged assumption; docs synced | 10 | D-16 proposed; residual risks listed above |

Total: 100/100 (SIMULATED single-pass score). Independent fresh-context
review and a security pass were not separately configured; the security-
relevant parts (scoping, TH-01/TH-05) were re-checked against SECURITY.md
sections 3-4 within this pass. Per AGENTS.md section 4, the gate score is
advisory until the owner reviews this package.
