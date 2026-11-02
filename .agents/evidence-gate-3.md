# GATE-3 evidence package (knowledge ingestion, retrieval, citations, deletion invalidation)

Status: CLOSED 2026-11-01 on owner instruction — prepared 2026-10-29,
live happy path closed 2026-10-29, BullMQ-vs-real-Redis residual risk
closed 2026-11-01. Score rescored to 100 (section 5).

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
| D-17 BullMQ queue adapter | done, proven against real Redis Cloud | 7 adapter tests; run log 2026-11-01 |

## 2. Criterion -> evidence map

| Gate criterion | Evidence | Result |
| --- | --- | --- |
| Ingestion records status, provenance, retrieval-ready data (AC-F07-1) | knowledge.service.spec (18), knowledge-ingestion.service.spec (12), knowledge-schema.spec (6); HTTP integration spec asserts the enqueue contract and provenance on create; web journeys list sources with status badges | pass |
| Unsupported/partial failure reported and retryable (AC-F07-2) | permanent failure codes fail once (`FETCH_NOT_CONFIGURED`, `PARSE_FAILED`), transient retry is bounded at 3 attempts then `RETRY_EXHAUSTED`; idempotent resubmission resets FAILED -> PENDING; 6 web journeys cover empty, error-retry and retry resubmit | pass |
| Retrieval excludes unauthorized chunks (AC-F07-3, TH-01, TH-12) | knowledge-retrieval.service.spec (8): deny-by-default 403 before any query, tenant filter, non-READY/deleted exclusion, citation payload, page bounds | pass |
| Citations carry provenance for grounded answers (AC-F09-1 groundwork) | retrieval spec asserts sourceId/sourceType/provenance/chunkIndex/model/score on every hit | pass |
| Deletion invalidation | knowledge-schema.spec pins cascade source -> chunk -> embedding on hard delete; retrieval filters `deleted_at IS NULL` and non-READY rows; full retention/expiry lifecycle belongs to T5.02 (open) | partial (by design) |
| Guard chain and tenant scope on every knowledge route | 15 HTTP tests: 401 no credential, 403 missing `knowledge.manage`, 400 missing scope, 403 foreign tenant, 400 unsupported type, 413 oversized content, 404 foreign/soft-deleted id | pass |
| Live denial matrix (real Supabase project) | no credential -> 401; agent1 (R-agent) fresh token -> 403 `Missing permission: knowledge.manage`; R-enterprise-admin -> 403 (deliberately excluded from knowledge.manage); R-tenant-admin targeting a foreign tenant -> 403 (role resolves only inside its own membership); malformed tenantId -> 403 after F-G3-1 fix (was 500) | pass |
| Live happy path (real Supabase project, R-tenant-admin `tenant_admin@velaris.test`) | POST MARKDOWN -> 201 with contentHash, provenance and `createdBy` = auth sub; ingestion ran in-process PENDING -> READY in ~1s; GET list 200 and GET detail 200; database shows 1 `knowledge_chunks` row and 1 `knowledge_embeddings` row for that source; resubmit of identical READY content -> 201 same id, no duplicate row | pass |
| Live failure and retry (AC-F07-2) | POST WEBSITE -> 201 PENDING -> FAILED `FETCH_NOT_CONFIGURED` (crawler not built); identical resubmit -> 201, same id, PENDING with errorCode cleared; second pass -> FAILED with the same permanent code (fails once, no retry loop); audit rows `knowledge.source_created` x3 and `knowledge.source_retried` x1 with the real actor sub `95d87e96-...` | pass |
| E2E journeys for the knowledge tab | tests/knowledge.spec.js: loading, empty, error+retry, list with badges, failed source retry resubmit, signed-out sign-in path | pass |

## 3. Findings found this session

- F-G3-1 (fixed): a malformed `tenantId` (for example `not-a-uuid`) reached
  Postgres through `DatabaseRoleResolver.resolveRole` and failed with SQLSTATE
  22P02, which the API reported as HTTP 500. Found by the live check, not by
  the test suite (the unit fakes never parse UUIDs). Fix: the resolver denies
  a value that cannot name a tenant before any query (deny by default,
  SECURITY.md section 4); RED test first, then GREEN at 284 tests, then
  re-verified live: the same request now returns 403.
- F-G3-2 (fixed 2026-11-01): the same malformed-UUID class existed for
  other UUID route parameters. Every UUID `@Param` across the controllers
  now carries Nest `ParseUUIDPipe`, so the whole surface answers 400.
  Re-verified live: `/tenants/not-a-uuid/users` -> 400,
  `PATCH /tenants/not-a-uuid` -> 400 (both were 500/403 before).
- F-G3-3 (fixed 2026-11-01, found by the live Redis run): BullMQ rejects
  `:` inside a custom job id, so `queue.add` rejected the idempotency key
  `ingest:<sourceId>` and the unhandled rejection killed the API process.
  The unit fakes never parse job ids, so only a real Redis could show it.
  Fix: sanitise the key to `ingest-<uuid>` before `queue.add`; a regression
  spec pins the sanitised id and the no-unhandled-rejection behaviour.

## 4. Residual risks and open items (owner action wanted)

1. CLOSED 2026-10-29: the owner created `tenant_admin@velaris.test`; its
   app-side user, ACTIVE membership and R-tenant-admin role were seeded in
   the development database, then the happy path, the failure path and the
   retry path all passed against the real Supabase project (section 2).
   Credential stored in the gitignored `.env.livecheck`, never in the repo.
2. CLOSED 2026-11-01: the owner provisioned a Redis Cloud database and
   `REDIS_URL` now points the factory at the durable adapter. Live proof:
   POST MARKDOWN source -> 201 PENDING -> READY through the queue; the job
   `ingest-7e9de1a9-...` sits in the Redis `completed` set (4 completed,
   0 failed, 0 waiting); 1 chunk + 1 embedding row in Postgres. One live
   defect was found and fixed on the way (F-G3-3 above). Owner follow-up:
   the instance reports eviction policy `volatile-lru`; BullMQ wants
   `noeviction` (change in the Redis Cloud console).
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
| Task tests pass | 20 | API 311 tests / 36 files; coverage 100% on all four metrics; live happy path, failure path and retry path pass against the real database; the D-17 BullMQ adapter ran against real Redis Cloud (job in the `completed` set, READY source, chunks + embeddings rows) |
| Full suite, format, lint, typecheck, build pass | 20 | test 0; format:check 0; lint 0/0; typecheck 0; build 0; audit:check 0; docs checker 100/100; CI + Merge gate + E2E green on 601d5ba |
| Acceptance criteria map to passing tests | 15 | docs/TESTING.md section 3 rows AC-F07-1/2/3, AC-F09-1 with named spec files and journeys |
| Denial/validation tests pass | 10 | 401/400/403/404/413 integration matrix, 6 knowledge journeys, live denial matrix incl. both fixed malformed-UUID cases (F-G3-1 403, F-G3-2 400 via ParseUUIDPipe) |
| Diff within scope | 10 | api/web/tests/workflows/docs only; two runtime dependencies added under recorded decision D-17; no secret in the diff |
| No unlogged assumption; docs synced | 10 | D-17, F-G3-1/F-G3-2/F-G3-3 and every closed blocker recorded here and in the run log |

Total: 100/100 (SIMULATED single-pass score, rescored 2026-11-01 after
the real-Redis run closed residual risk 2 and F-G3-3 was fixed with a
regression spec). The gate line is ticked on the owner's instruction to
close GATE-3; per AGENTS.md section 4 the score stays advisory evidence
for the owner's review.
