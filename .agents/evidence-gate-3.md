# GATE-3 evidence package (knowledge ingestion, retrieval, citations, deletion invalidation)

Status: PRELIMINARY — prepared 2026-10-29. Not ready for owner sign-off:
two live verifications remain open (sections 4 and 5).

Gate line (docs/IMPLEMENTATION_PLAN.md): "Knowledge ingestion,
permission-aware retrieval, citations and deletion invalidation tests green."

Capture type: SIMULATED review passes (single agent, separate sequential
review passes; AGENTS.md section 3.3 requires this disclosure). The live
checks in section 2 ran EXECUTED against the real Supabase project.

## 1. Scope of this gate

| Task | Status | Evidence |
| --- | --- | --- |
| T3.01 knowledge schema + pgvector migration | done, live-applied | run log 2026-10-29; `_prisma_migrations` row `0004_knowledge_schema` |
| T3.02 source validation, ingestion status, idempotent retry | done | run log 2026-10-29; 15 HTTP integration tests |
| T3.03 async parse/chunk/embed pipeline + job metadata | done | run log 2026-10-29; 12 pipeline tests, 4 queue tests |
| T3.04 permission-aware retrieval, provenance, citations | done | run log 2026-10-29; 8 retrieval tests |
| T3.05 knowledge list/detail/retry states in the web tab | done this session | run log 2026-10-29; 6 Playwright journeys |
| D-17 BullMQ queue adapter | code done, Redis not provisioned | 7 adapter tests; run log 2026-10-29 |

## 2. Criterion -> evidence map

| Gate criterion | Evidence | Result |
| --- | --- | --- |
| Ingestion records status, provenance, retrieval-ready data (AC-F07-1) | knowledge.service.spec (18), knowledge-ingestion.service.spec (12), knowledge-schema.spec (6); HTTP integration spec asserts the enqueue contract and provenance on create; web journeys list sources with status badges | pass |
| Unsupported/partial failure reported and retryable (AC-F07-2) | permanent failure codes fail once (`FETCH_NOT_CONFIGURED`, `PARSE_FAILED`), transient retry is bounded at 3 attempts then `RETRY_EXHAUSTED`; idempotent resubmission resets FAILED -> PENDING; 6 web journeys cover empty, error-retry and retry resubmit | pass |
| Retrieval excludes unauthorized chunks (AC-F07-3, TH-01, TH-12) | knowledge-retrieval.service.spec (8): deny-by-default 403 before any query, tenant filter, non-READY/deleted exclusion, citation payload, page bounds | pass |
| Citations carry provenance for grounded answers (AC-F09-1 groundwork) | retrieval spec asserts sourceId/sourceType/provenance/chunkIndex/model/score on every hit | pass |
| Deletion invalidation | knowledge-schema.spec pins cascade source -> chunk -> embedding on hard delete; retrieval filters `deleted_at IS NULL` and non-READY rows; full retention/expiry lifecycle belongs to T5.02 (open) | partial (by design) |
| Guard chain and tenant scope on every knowledge route | 15 HTTP tests: 401 no credential, 403 missing `knowledge.manage`, 400 missing scope, 403 foreign tenant, 400 unsupported type, 413 oversized content, 404 foreign/soft-deleted id | pass |
| Live denial matrix (real Supabase project) | no credential -> 401; agent1 (R-agent) fresh token -> 403 `Missing permission: knowledge.manage`; admin1 (R-enterprise-admin, deliberately excluded from knowledge.manage) -> 403; malformed tenantId -> 403 after F-G3-1 fix (was 500) | pass |
| E2E journeys for the knowledge tab | tests/knowledge.spec.js: loading, empty, error+retry, list with badges, failed source retry resubmit, signed-out sign-in path | pass |

## 3. Findings found this session

- F-G3-1 (fixed): a malformed `tenantId` (for example `not-a-uuid`) reached
  Postgres through `DatabaseRoleResolver.resolveRole` and failed with SQLSTATE
  22P02, which the API reported as HTTP 500. Found by the live check, not by
  the test suite (the unit fakes never parse UUIDs). Fix: the resolver denies
  a value that cannot name a tenant before any query (deny by default,
  SECURITY.md section 4); RED test first, then GREEN at 284 tests, then
  re-verified live: the same request now returns 403.
- F-G3-2 (recorded, not fixed): the same 500-by-malformed-UUID class exists
  for other UUID route and query parameters (`knowledge-sources/:id`,
  governance `:tenantId`, tickets/conversations ids). Recommendation: add
  Nest `ParseUUIDPipe` to UUID parameters across controllers in a dedicated
  follow-up task, so the whole surface answers 400 instead of 500.
  Owner decides whether that task is scheduled now or under T6.01.

## 4. Residual risks and open items (owner action wanted)

1. Live happy path NOT verified: POST /knowledge-sources -> 201, ingestion to
   READY, GET list/detail 200 against the real Supabase project. Blocked:
   `knowledge.manage` is held only by R-tenant-admin and the project has no
   tenant-admin member. The owner chose to create that user; the check runs
   as soon as the email and password are available. Script ready:
   `.livecheck-knowledge.sh` (gitignored artifacts only).
2. BullMQ adapter never ran against a real Redis: automated provisioning is
   disabled, so the owner creates the Redis Cloud database and sets
   `REDIS_URL` (setup link handed over). Without that value the factory keeps
   the in-process adapter, which is the tested CI path.
3. pgvector index strategy stays deferred until a query benchmark exists
   (DATABASE.md section 6 rule).
4. Retrieval reuses `knowledge.manage` as its read gate until a distinct
   knowledge-read permission code is decided (Proposed).
5. `apps/worker` stays a scaffold; the D-17 consumer runs inside apps/api.
6. The knowledge job contract lives in `ingestion-types.ts`, not
   `packages/contracts`, until a second consumer exists (Proposed).

## 5. Confidence score (AGENTS.md section 4 matrix)

| Check | Points | Evidence |
| --- | --- | --- |
| RED seen before the change | 15 | F-G3-1 spec failed first with the resolver querying the database; T3.02-T3.04 RED records in the run log |
| Task tests pass | 15 | API 284 tests / 35 files; coverage 100% on all four metrics (knowledge 100%); deduction: the D-17 adapter ran only against fakes, never real Redis |
| Full suite, format, lint, typecheck, build pass | 20 | test 0; format:check 0; lint 0/0; typecheck 0; build 0; audit:check 0; docs checker 100/100; CI + Merge gate + E2E green on 601d5ba |
| Acceptance criteria map to passing tests | 15 | docs/TESTING.md section 3 rows AC-F07-1/2/3, AC-F09-1 with named spec files and journeys |
| Denial/validation tests pass | 10 | 401/400/403/404/413 integration matrix, 6 knowledge journeys, live denial matrix incl. the fixed malformed-UUID case |
| Diff within scope | 10 | api/web/tests/workflows/docs only; two runtime dependencies added under recorded decision D-17; no secret in the diff |
| No unlogged assumption; docs synced | 10 | D-17, F-G3-1/F-G3-2 and both blockers recorded here and in the run log |

Total: 95/100 (SIMULATED single-pass score). The 5 points stay out until the
BullMQ adapter runs against a real Redis, and owner sign-off waits on the
live happy-path check in section 4.1. Per AGENTS.md section 4 the gate score
is advisory until the owner reviews this package.
