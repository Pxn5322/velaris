---
doc: ARCHITECTURE
version: 0.1
status: Draft
owner: Product/architecture owner
depends_on: [PRD]
---
# Architecture — VELARIS

## 1. Platforms and stack
Platforms: responsive web application, REST API, background workers. Native mobile is deferred.

| Layer | Selected technology | Reason | Constraint | Alternative | Status |
| --- | --- | --- | --- | --- | --- |
| Frontend | Next.js, React, TypeScript, Tailwind/component system, TanStack Query, React Hook Form, Zod | Responsive public site and role-aware application | Keep client logic non-authoritative for access | React SPA | Proposed based on PRD |
| Backend/API | NestJS, TypeScript, modular monolith, DTOs, validation, guards/interceptors/pipes, DI | Explicit modules and testable business boundaries | Domain logic must not depend on provider SDKs | Fastify-based service | Confirmed direction |
| Database | Supabase-managed PostgreSQL + Prisma | Managed PostgreSQL foundation, relational tenant/domain data and migrations | Tenant scope, connection mode, migration ownership and RLS policy must be verified | Self-managed PostgreSQL | Supabase selected by product owner; connection details remain to be configured |
| Vector retrieval | pgvector on Supabase PostgreSQL, subject to project/extension verification | Initial retrieval alongside relational data | Filter by tenant and permission scope; benchmark index/query strategy | Dedicated vector DB | Proposed |
| Cache/queue | Redis + BullMQ | Async ingestion, retries, scheduled lifecycle jobs | Tenant and correlation context propagated | Managed queue | Confirmed direction |
| AI orchestration | LangGraph; LangChain where useful | Stateful agent/workflow execution | Model never authorizes actions | Custom orchestrator | Confirmed direction |
| Authentication | Supabase Auth for identity/session; NestJS owns authorization | Managed authentication with centralized server-side RBAC and tenant policy | NestJS validates Supabase access tokens; authorization is resolved from application membership/permission data, not client-supplied claims alone | Other OIDC provider | Selected by product owner; implementation not yet verified |
| Hosting | Docker, GitHub Actions; Vercel/Render are candidate options | Practical initial delivery and portability | Final environment/region not selected | Other container/cloud hosting | Proposed |
| Testing | Jest, Supertest, Cypress, AI eval datasets | Unit, API integration, E2E and AI regression | Commands are Not configured until verified in repository | Other test stack | Confirmed direction |

## 1A. Engineering principles and application structure
- **OOP:** use encapsulation and cohesive classes for domain behavior and infrastructure adapters where object boundaries add value; avoid class wrappers around trivial data transformations.
- **SOLID:** apply Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation and Dependency Inversion pragmatically. The most important boundaries are domain/application logic versus database, identity, queue, storage and LLM providers.
- **MVC-inspired transport layer:** NestJS controllers are the HTTP/controller boundary; application services/use cases orchestrate work; domain objects/policies enforce invariants; repositories and adapters handle persistence/infrastructure. Do not place business rules in controllers or React components.
- **Clean/layered dependency rule:** presentation/transport depends inward on application/domain contracts; infrastructure implements ports/interfaces owned by the inner layers. Domain logic must not import Prisma, Supabase SDKs, NestJS transport types or provider-specific LLM SDKs.
- **Modular monolith:** organize by business capability (auth, tenants, access, support, knowledge, AI, audit, analytics). Cross-module communication uses public application interfaces or explicit events, not private repository access.
- **Patterns are tools, not checkboxes:** use repositories, factories, strategies, adapters, domain events and CQRS only when they clarify a real boundary or use case. Avoid premature microservices and unnecessary abstraction.

### Supabase boundary
- Supabase is the selected managed database platform; PostgreSQL is the authoritative relational store. Prisma remains the proposed application ORM/schema-migration tool, pending a tested connection/migration setup.
- Supabase Auth is selected for identity, sign-in/session lifecycle and access-token issuance. NestJS remains the authorization authority: validate tokens server-side, resolve active user and tenant membership, and enforce RBAC/resource policies through guards and application services. Supabase Auth selection does not select Supabase Storage or Realtime; evaluate those only when requirements justify them.
- The NestJS server uses server-side credentials and least-privilege access. Never expose a service-role secret to the browser. Confirm the correct connection pooler/direct connection approach for runtime versus migrations. The Supabase publishable/anon key may be public by design but is not an authorization control. The Supabase publishable/anon key may be public by design but is not an authorization control.
- PostgreSQL RLS is defense in depth. Policies, database roles, connection identity and tenant context propagation must be tested end-to-end; RLS must not be assumed effective merely because it is enabled.
- pgvector extension availability, dimensions/index choice, Supabase project region, backup/restore, connection limits and migration procedure must be verified before production.

## 2. System boundaries
- Client owns: presentation, form state, accessible interaction, navigation, and rendering API responses. It may hide unavailable actions for UX but cannot enforce authorization.
- Server owns: authentication validation, tenant context, RBAC, resource ownership, domain rules, input validation, idempotency, AI policy checks, tool execution, audit and data lifecycle.
- Workers own: ingestion, embedding, async integrations, retries and retention jobs. Each job carries tenant ID, actor/system identity, correlation ID and idempotency key where applicable.
- External services own: identity verification, LLM inference, embedding inference, external channel delivery and object storage as configured. Provider failures must be bounded, observable and recoverable.
- Out of scope: microservice decomposition, custom foundation model training, full visual workflow builder, native mobile clients and a full CRM suite.

## 3. Request and data flow
1. User action enters a Next.js screen; client validates for usability and submits a typed request.
2. NestJS validates the request DTO, verifies the Supabase Auth access token (signature, issuer, audience/claims and expiry using the supported verification approach), then resolves active user status and explicit tenant membership/context.
3. Guards/policies verify permission; service/domain logic verifies resource ownership, valid state transitions, business rules and idempotency.
4. Repository operations require tenant context for tenant-owned data. Database constraints and query filters reinforce service-level rules.
5. For AI, the orchestrator retrieves authorized knowledge and builds a trace; proposed tools pass deterministic permission, policy, schema, risk and approval checks before execution.
6. Response returns a documented payload and correlation ID; UI presents success, loading, empty, validation, denial and retry states.
7. Audit/trace events are emitted for required sensitive actions; asynchronous work uses outbox/queue patterns where reliable delivery is needed.

## 4. Interfaces
Initial REST prefix is `/api/v1`. Exact payload schemas are implementation tasks; contracts must be documented in OpenAPI before dependent feature work.

| ID | Method + path | Feature | Auth (Role IDs) | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| API-01 | GET `/api/v1/health` | F-13 | public health metadata only | none | status/version, no secrets | 503 when unhealthy |
| API-02 | GET `/api/v1/auth/me` | F-02 | authenticated roles | session/token | principal, memberships and allowed context | 401, 403 |
| API-03 | POST `/api/v1/tenants` | F-02,F-03 | R-enterprise-admin or approved signup flow | company fields | tenant summary | 400, 401, 403, 409 |
| API-04 | GET `/api/v1/tenants` | F-03 | R-enterprise-admin | filters/pagination | tenant collection | 401, 403, 429 |
| API-05 | POST `/api/v1/tickets` | F-05 | R-customer,R-agent,R-tenant-admin with scoped rules | customer/conversation association, title, body, priority | ticket and timeline item | 400, 401, 403, 409 |
| API-06 | GET `/api/v1/tickets` | F-05,F-06 | authorized tenant members | filters, sort, page/cursor | scoped collection | 400, 401, 403, 429 |
| API-07 | PATCH `/api/v1/tickets/{id}` | F-05 | authorized ticket roles | versioned state/assignment/priority fields | updated ticket and version | 400, 401, 403, 404, 409 |
| API-08 | POST `/api/v1/knowledge-sources` | F-07 | R-tenant-admin | source type and source reference/upload metadata | source ID/status | 400, 401, 403, 413, 429 |
| API-09 | GET `/api/v1/knowledge-sources/{id}` | F-07 | R-tenant-admin with tenant scope | source ID | source status, errors and provenance | 401, 403, 404 |
| API-10 | POST `/api/v1/ai/agents` (also GET collection and GET `{id}`) | F-08 | R-tenant-admin with `ai.agent.configure` and tenant scope | agent name and draft config | draft/version summary, or agent with versions and evaluation evidence | 400, 401, 403, 404, 409 |
| API-11 | POST `/api/v1/ai/agents/{id}/versions` and POST `/api/v1/ai/agents/{id}/versions/{versionId}/evaluations` | F-08,F-11 | R-tenant-admin with `ai.agent.configure` | draft config, or dataset version with provider/model | version summary, or evaluation run ID/status/results summary | 400, 401, 403, 404, 503 |
| API-12 | POST `/api/v1/ai/agents/{id}/versions/{versionId}/publish` and POST `/api/v1/ai/agents/{id}/rollback` | F-08,F-10 | R-tenant-admin with `ai.agent.publish` | draft version or target version | published version, rollback target, or gate findings | 400, 401, 403, 404, 409, 422 |
| API-13 | POST `/api/v1/conversations/{id}/messages` | F-09 | customer/agent within conversation scope | message and optional idempotency key | message, AI outcome/handoff state | 400, 401, 403, 409, 429, 503 |
| API-14 | GET `/api/v1/audit-events` | F-03,F-11,F-14 | R-enterprise-admin or R-tenant-admin within permitted scope | filters and pagination | restricted audit event collection | 401, 403, 429 |
| API-15 | GET `/api/v1/analytics/summary` | F-12 | R-enterprise-admin or R-tenant-admin scoped | date range and dimensions | metric values with definitions/version | 400, 401, 403 |
| API-16 | POST `/api/v1/webhooks/{provider}` | F-13 | provider signature verification | provider event | accepted/idempotent event result | 400, 401, 409, 429 |

Error contract: `{ code, message, details?, requestId }`; details are safe validation metadata only. Never return stack traces, prompts containing secrets, or internal provider credentials. Collections standardize pagination, filtering, sorting, max page size and deterministic ordering. Event/job interfaces include tenant ID, correlation ID, idempotency key, actor/system identity, schema version and safe payload metadata.

## 5. External services
| Service | Purpose | Limits | Credential owner | Failure behavior |
| --- | --- | --- | --- | --- |
| Supabase Auth | Identity/session lifecycle | Token verification, refresh/revocation window and provider outage behavior must be tested | Platform owner | Fail closed for protected operations; no local auth bypass |
| LLM provider(s) | Responses, classification, summaries, tool planning | Rate limits, timeouts, cost and data handling vary | Platform owner | Bounded retries, timeout, circuit breaking; safe fallback only after evaluation parity |
| Embedding provider | Knowledge embeddings | Rate limits and model/version compatibility | Platform owner | Retry async job; surface ingestion status; avoid silently mixing incompatible dimensions |
| Object storage | Uploaded knowledge source files | Size/type/retention limits to define | Platform owner | Quarantine/validate uploads; retry or report failure |
| Email/webhook/channel integrations | Notifications and external events | Provider-specific limits | Tenant/platform owner as applicable | Idempotent delivery, retry with backoff, dead-letter/replay controls |

## 6. NFR mapping
| NFR | Mechanism |
| --- | --- |
| NFR-01 | Required TenantContext in service/repository APIs; tenant-scoped keys, jobs, vector filters, storage paths and cross-tenant tests |
| NFR-02 | NestJS guards/policies plus service-level authorization tests; generated route inventory review |
| NFR-03 | Jest coverage gates for core domain/application logic |
| NFR-04 | Endpoint-class load tests and p95 reports under documented load assumptions |
| NFR-05 | Availability SLI dashboard with explicit 4xx exclusions and provider health tracking |
| NFR-06 | Correlation ID propagated from HTTP to job/AI trace/audit where applicable |
| NFR-07 | Transactional/outbox-oriented audit emission and action-to-event integration tests |
| NFR-08 | Design system semantics, keyboard/focus patterns, automated and manual accessibility review |
| NFR-09 | Versioned evaluation datasets and required release gates |
| NFR-10 | OpenAPI contract tests, idempotency records, common error filter and correlation middleware |

## 7. Project structure
```text
apps/
  web/                         # Next.js public site and authenticated workspace
  api/                         # NestJS HTTP application and modular domain modules
  worker/                      # background workers; may initially be a NestJS process
packages/
  contracts/                   # shared API schemas/types; no secrets
  config/                      # shared lint/format/TypeScript configuration
  ui/                          # shared accessible components and tokens
  ai-evals/                    # versioned evaluation datasets and harness
  test-utils/                  # synthetic fixtures and test helpers
prisma/                        # Prisma schema and reviewed migrations
docs/                          # source-of-truth documents
scripts/                       # docs checker and repository scripts

# Suggested NestJS module areas inside apps/api/src/modules/
# auth/ tenants/ users/ roles/ permissions/ customers/ conversations/ tickets/
# inbox/ knowledge/ ai/agents/ workflows/ tools/ guardrails/ memory/ evaluation/
# observability/ integrations/ notifications/ analytics/ audit/
```
Repository strategy is **monorepo (selected)**. Keep web, API, worker, shared contracts/config/UI/test utilities, docs and scripts in one repository. Workspace manager, package manager, build orchestration tool, and exact package boundaries remain undecided until the scaffold task evaluates compatibility and records a verified choice.

## 8. Operations
Environments, deployment and rollback are in SETUP_GUIDE.md. Structured logs use request/correlation IDs; traces separate HTTP, queue, retrieval, model and tool spans. Redact credentials, raw secrets and unnecessary personal/customer content. Monitor API health/latency, queue depth/failures, provider rate limits, ingestion outcomes, AI quality/cost and audit completeness. Production deployment is a human-owned action.

## 9. Decision log
| ID | Decision | Status | Owner | Date |
| --- | --- | --- | --- | --- |
| D-01 | Use NestJS modular monolith with explicit domain modules | Confirmed direction | Product/architecture owner | Not recorded |
| D-02 | Use Supabase-managed PostgreSQL with Prisma; evaluate pgvector for initial retrieval | Supabase selected; Prisma proposed; pgvector pending verification | Product/architecture owner | 2026-10-20 |
| D-03 | Use Supabase Auth for identity/session; enforce application authorization in NestJS | Selected | Product/architecture owner | 2026-10-20 |
| D-04 | Standardize REST under `/api/v1` with OpenAPI and common errors | Confirmed requirement | Product/architecture owner | Not recorded |
| D-05 | Start with schema-driven workflows, not a visual no-code builder | Confirmed direction | Product owner | Not recorded |
| D-06 | Use a monorepo with `apps/web`, `apps/api`, `apps/worker` and shared `packages/*` | Selected | Product/architecture owner | 2026-10-20 |
| D-07 | Select primary LLM/embedding providers and data-processing terms before production AI use | Unknown | Product/security owner | Not recorded |
| D-08 | Orchestrated specialist agents with independent verification, code review, critic and risk-based security review; human approval for protected merge/release | Selected | Product/architecture owner | 2026-10-20 |
| D-09 | Use npm workspaces (single root lockfile, `apps/*` + `packages/*`) as workspace manager; no build orchestrator yet | Selected (revisitable under T0.02) | Engineering owner | 2026-10-22 |
| D-10 | Write agent replies and repository documentation in Simplified Technical English (ASD-STE100 style); rules in AGENTS.md §9 and CODE_STYLE §9; code, schemas and verbatim values are exempt | Selected (owner-requested) | Product owner | 2026-10-23 |
| D-11 | Reject a new business operation on a tenant whose status is not ACTIVE with HTTP 403 (`AuthorizationService.requireActiveTenant`), treating the disabled-tenant state as forbidden rather than as a validation error | Proposed (T1.03) | Engineering owner | 2026-10-26 |
| D-17 | Add `bullmq` and `ioredis` as the queue runtime for knowledge ingestion: `BullMqIngestionQueue` implements the existing `IngestionQueue` port and runs its consumer in `apps/api`; when `REDIS_URL` is absent the factory keeps the in-process adapter, so CI and tests need no Redis | Proposed (T3.05 follow-up) | Engineering owner | 2026-10-29 |
| D-18 | Select Groq as the development LLM provider (PRD D-02 development half): `GroqLlmProvider` implements the `LlmProvider` port behind `createLlmProvider`, selected when `GROQ_API_KEY` is set (`GROQ_MODEL` defaults to `openai/gpt-oss-120b`); without a key the factory keeps `LocalDeterministicLlmProvider`, so CI and tests need no network or secret. The key lives only in ignored env files. Embeddings stay local (no Groq embedding model in the owner-supplied list) and production provider/data terms remain open under D-07 | Selected (owner-supplied key and model list, T4.01) | Product/security owner | 2026-11-02 |
| D-20 | Tool governance for F-10: `ajv` validates untrusted tool arguments against each definition's registered JSON Schema (it is the only new runtime dependency of T4.04; `ajv-formats` is not added, the guard declares the `uuid` and `email` formats itself). Consequential actions persist a human decision in `tool_approval_requests`, bound by a proposal hash, an expiry and a one-time claim. Deciding needs the new permission code `ai.tool.approve`, held by R-enterprise-admin and R-tenant-admin only. HIGH and CRITICAL risk always require a decision even when `approval_required` is false, so a bad row cannot skip the gate | Proposed (T4.04) | Engineering + security owner | 2026-11-02 |
| D-21 | Evaluation datasets are versioned code, not database rows: `packages/ai-evals` holds immutable dataset objects keyed by an exact version string such as `support-triage@1.0.0`, and a stored `evaluation_runs.dataset_version` names one of them (D-20 covers tool schemas; this record covers F-08 evidence). Scoring is a pure function in the same package, so a run is reproducible offline and no provider judges a model. `REQUIRED_DATASET_VERSIONS` is the publish suite: a version without a recorded run for each entry, or with a failed entry, cannot publish. Editing a published dataset means adding a new version; the old one stays resolvable so historical runs keep their meaning | Proposed (T4.05) | Engineering + QA owner | 2026-11-03 |
| D-22 | Agent lifecycle permissions keep the shipped codes `ai.agent.configure` (create, configure, run evaluations) and `ai.agent.publish` (publish, rollback). The PRD (AC-F08-3) and the API table name `ai.agent.create`, `ai.agent.test` and `ai.agent.deploy`; the codebase implements two coarser capabilities, and a permission code is a stored authorization contract, so it is not renamed without the owner. The route table below is corrected to the implemented paths and codes. This mapping satisfies the intent of AC-F08-3: a role without the publish capability is refused and audited | Proposed (T4.06) | Owner + security owner | 2026-11-03 |
| D-23 | An evaluation run requires a registered runner. `EVALUATION_SUBJECT` is a dependency-injection port with no default provider: when no runner is registered, `EvaluationService.run` answers 503 and writes no `evaluation_runs` row, so the T4.05 publish gate stays blocked for that dataset. The gate reads recorded runs only, so a publish never rests on a fabricated, cached or self-reported score. Registering the real agent-under-test runner that calls `AiRuntimeService` for each case is a condition on the first production agent publish, recorded when the owner approved GATE-4 on 2026-11-03 (Option A, `docs/IMPLEMENTATION_PLAN.md` Phase 6). Until the runner lands, an environment without one cannot evaluate or publish; this fail-closed behaviour is intended | Proposed (T4.06 amendment; GATE-4 condition 2026-11-03) | Engineering owner | 2026-11-03 |
| D-24 | Studio screens live in `apps/web/src/components/` and browser journeys use Playwright in `tests/*.spec.js`. The implementation plan names `apps/web/ai-agents/` and Cypress journeys for T4.06, but this repository keeps views in one component tree and its verified end-to-end command is `npm run e2e:web` with Playwright (AGENTS.md section 2). The T4.06 screens therefore ship as `TenantStudioAgents.tsx` inside studio tabs 8 and 9, and their acceptance journey is `tests/ai-agents.spec.js`. A second runner or a parallel view tree would split verified tooling, so neither is added without the owner | Proposed (T4.06 amendment) | Engineering owner | 2026-11-03 |
| D-25 | Font families are self-hosted under `apps/web/src/app/fonts/` with `next/font/local`, not fetched from a font CDN. `next/font/google` made `next build` depend on fonts.googleapis.com, and Turbopack failed to resolve the generated font module in three runs (41426929417, 41629476374, 41656114439), each time while the same commit built locally. Four latin variable woff2 files (Inter, JetBrains Mono normal and italic, Space Grotesk) plus their SIL Open Font License texts remove the network call, so a build is reproducible offline and no font request carries visitor data. The CI build retries stay as general resilience | Proposed (build fix) | Engineering owner | 2026-11-03 |
| D-19 | Add `@langchain/langgraph` as the agent runtime orchestrator (ARCHITECTURE section 5 confirmed direction "LangGraph"): the F-09 pipeline runs as a `StateGraph` of validate -> retrieve -> ground -> generate -> validate-response nodes behind `AiRuntimeService`, with `LLM_PROVIDER` supplied by the D-18 factory. The package is the only new runtime dependency of T4.03; the runtime owns bounded retry and escalation policy around the LLM port (SECURITY section 6) | Proposed (T4.03) | Engineering owner | 2026-11-02 |
