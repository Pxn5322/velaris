---
doc: DATABASE
version: 0.1
status: Draft
owner: Product/architecture owner
depends_on: [ARCHITECTURE, SECURITY]
---
# Database — VELARIS

## 1. Storage model
Provider: Supabase-managed PostgreSQL + Prisma, with pgvector proposed for initial vector retrieval and subject to project/extension verification. Ownership model: platform → enterprise organization → tenant/company; the tenant/company is the primary data-isolation boundary in V1. Redis is for cache/queues, not the authoritative domain store.

## 2. Entities
| ID | Entity | Purpose | Owner | Classification | Retention | Used by |
| --- | --- | --- | --- | --- | --- | --- |
| E-enterprise | EnterpriseOrganization | Platform-level grouping for multiple tenants | Platform | internal | while active; lifecycle policy not yet selected | F-03,F-04 |
| E-tenant | Tenant | Company/workspace and isolation boundary | Platform/enterprise admin | internal | tenant lifecycle policy not yet selected | F-02,F-03,F-04,F-14 |
| E-user | User | Human identity and status | Identity adapter/platform | personal | account lifecycle policy not yet selected | F-02,F-03,F-04 |
| E-membership | TenantMembership | User-to-tenant relationship and active membership | Tenant/platform | personal | while membership/audit obligations exist | F-02,F-03,F-04 |
| E-role | Role | Named permission bundle | Platform/tenant policy | internal | retain version/history as needed | F-03,F-04 |
| E-permission | Permission | Stable authorization capability code | Platform | internal | version-controlled | F-03,F-04,F-10 |
| E-customer | Customer | End customer profile within tenant | Tenant | personal | tenant-configurable | F-05,F-06,F-09,F-14 |
| E-conversation | Conversation | Communication history | Tenant | personal | tenant-configurable | F-05,F-06,F-09,F-14 |
| E-message | Message | Customer-visible message or internal note | Tenant | personal/restricted based on type | tenant-configurable | F-05,F-06,F-09,F-14 |
| E-ticket | Ticket | Operational support work item | Tenant | personal | tenant-configurable | F-05,F-06,F-12,F-14 |
| E-assignment | TicketAssignment | Assignment/reassignment history | Tenant | internal/personal | ticket retention | F-05,F-06,F-11 |
| E-knowledge-source | KnowledgeSource | Source metadata, ingestion status and provenance | Tenant | internal/personal if source contains customer data | active while retained; deletion lifecycle | F-07,F-09,F-14 |
| E-knowledge-chunk | KnowledgeChunk | Parsed chunk and source offsets/metadata | Tenant | classification inherits source | deleted/rebuilt with source | F-07,F-09,F-14 |
| E-embedding | KnowledgeEmbedding | Vector representation linked to chunk/model | Tenant | inherits source classification | deleted/rebuilt with source | F-07,F-09,F-14 |
| E-agent | AiAgent | Agent identity and tenant-scoped configuration | Tenant | internal | while active plus version history | F-08,F-09,F-10,F-11 |
| E-agent-version | AiAgentVersion | Immutable published/draft configuration snapshot | Tenant | internal/restricted | retention policy not yet selected | F-08,F-11 |
| E-tool | AiToolDefinition | Tool schema, risk, timeout and approval metadata | Tenant/platform | internal/restricted | versioned while referenced | F-08,F-10 |
| E-agent-tool-grant | AgentToolGrant | Explicit agent-to-tool capability grant | Tenant | restricted | retain audit history | F-08,F-10 |
| E-workflow | AiWorkflow | Versioned schema-driven workflow | Tenant | internal | while active plus versions | F-08,F-09 |
| E-evaluation-run | EvaluationRun | Dataset/agent version and result summary | Tenant/platform | internal/restricted | governance policy not yet selected | F-08,F-11 |
| E-ai-trace | AiTrace | AI run metadata, spans, outcomes and correlation | Tenant | restricted; minimize personal data | short operational retention by default | F-09,F-11,F-12 |
| E-audit-event | AuditEvent | Append-oriented security/admin action history | Tenant/platform | restricted | longer restricted retention; exact period not yet selected | F-03,F-10,F-11,F-14 |
| E-integration | IntegrationConnection | Provider config metadata and status; secrets externalized | Tenant | restricted | while connected plus audit requirements | F-13,F-14 |
| E-idempotency | IdempotencyRecord | Prevent repeated side effects for retried operations | Tenant/platform | internal | bounded TTL by operation type | F-05,F-10,F-13 |
| E-outbox-event | OutboxEvent | Reliable publication of committed domain events | Tenant/platform | internal | until delivered plus bounded retention | F-05,F-11,F-13 |
| E-kpi-snapshot | KpiSnapshot | Optional materialized KPI values with formula version | Tenant/platform | internal | analytics retention policy not yet selected | F-12 |
| E-memory | AiMemory | Explicitly enabled scoped memory with provenance/confidence/expiry | Tenant/customer | personal/restricted | opt-in with explicit expiration | F-09,F-14 |

## 3. Schema
Proposed baseline fields and constraints; exact Prisma schema and field types are implementation deliverables. IDs should use UUIDs unless a documented decision selects otherwise.

- `enterprise_organizations(id, name, status, created_at, updated_at)`; name required, status enum, unique constraints only where product rules require.
- `tenants(id, enterprise_organization_id, name, slug, status, created_at, updated_at, version)`; unique slug policy to be decided globally vs per enterprise; status rechecked for every operation/job.
- `users(id, external_subject, email_normalized, display_name, status, created_at, updated_at)`; external subject unique per provider; email verification and provider constraints handled by identity decision.
- `tenant_memberships(id, tenant_id, user_id, status, created_at, updated_at)`; unique `(tenant_id,user_id)`; tenant and user FKs; tenant-scoped lookup index.
- `roles(id, tenant_id nullable, code, name, system_managed, created_at)`; system roles and tenant-custom roles separated by constraints; role code unique in scope.
- `permissions(id, code, description)`; unique code; seeded/version-controlled.
- `role_permissions(role_id, permission_id)`; unique pair.
- `membership_roles(membership_id, role_id)`; unique pair and scope validation.
- `customers(id, tenant_id, external_ref nullable, display_name, email nullable, phone nullable, metadata_json, created_at, updated_at, deleted_at nullable)`; indexes by tenant and normalized lookup fields; avoid unrestricted metadata secrets.
- `conversations(id, tenant_id, customer_id, channel, status, created_at, updated_at, version)`; tenant/customer composite ownership checks; tenant + updated time index.
- `messages(id, tenant_id, conversation_id, author_type, author_id nullable, visibility, body, metadata_json, idempotency_key nullable, created_at)`; `visibility` distinguishes customer-visible from internal; tenant/conversation/time index; unique idempotency scope where used.
- `tickets(id, tenant_id, customer_id, primary_conversation_id nullable, title, status, priority, sla_state, assignee_membership_id nullable, tags, version, created_at, updated_at, resolved_at nullable, closed_at nullable)`; valid status enum; tenant/status/assignee indexes; optimistic concurrency through version.
- `ticket_assignments(id, tenant_id, ticket_id, from_membership_id nullable, to_membership_id nullable, actor_id, reason nullable, created_at)`; append history, tenant/time index.
- `knowledge_sources(id, tenant_id, source_type, source_uri nullable, object_key nullable, status, content_hash, provenance_json, error_code nullable, created_by, created_at, updated_at, deleted_at nullable)`; unique tenant/source/content identity as appropriate; status index.
- `knowledge_chunks(id, tenant_id, source_id, chunk_index, content, metadata_json, token_count, created_at)`; unique `(source_id,chunk_index)`; tenant/source index.
- `knowledge_embeddings(id, tenant_id, chunk_id, embedding vector, model, dimensions, created_at)`; unique chunk/model version; vector index chosen after query benchmark; filter by tenant and permission metadata before returning content.
- `ai_agents(id, tenant_id, name, description, status, owner_membership_id, active_version_id nullable, created_at, updated_at)`; tenant/name index.
- `ai_agent_versions(id, tenant_id, agent_id, version, config_json, created_by, created_at, published_at nullable, status)`; unique `(agent_id,version)`; published versions immutable.
- `ai_tool_definitions(id, tenant_id nullable, name, input_schema_json, output_schema_json, required_permission, risk_level, approval_required, timeout_ms, retry_policy_json, enabled)`; unique name in scope; schemas validated on registration.
- `agent_tool_grants(id, tenant_id, agent_version_id, tool_id, granted_by, created_at)`; unique version/tool; execution rechecks current authorization.
- `ai_workflows(id, tenant_id, name, version, trigger_json, nodes_json, guardrails_json, enabled, created_at)`; unique tenant/name/version.
- `evaluation_runs(id, tenant_id, agent_version_id, dataset_version, provider, model, status, aggregate_json, failure_reasons_json, created_at, completed_at nullable)`.
- `ai_traces(id, tenant_id, correlation_id, agent_id, agent_version_id, provider, model, outcome, latency_ms, usage_json, spans_metadata_json, created_at, expires_at)`; avoid raw secrets and minimize message content.
- `audit_events(id, tenant_id nullable, actor_id nullable, action, resource_type, resource_id, metadata_json, request_id, created_at)`; append-oriented, restricted; index tenant/time and resource/time.
- `integration_connections(id, tenant_id, provider, status, config_json, secret_reference, created_at, updated_at)`; never store plaintext credentials in config JSON.
- `idempotency_records(id, scope, key, request_hash, response_reference, status, expires_at, created_at)`; unique `(scope,key)` and conflict if same key has a different request hash.
- `outbox_events(id, tenant_id nullable, event_type, schema_version, payload_json, correlation_id, occurred_at, published_at nullable, attempts)`; indexed unpublished events.
- `kpi_snapshots(id, tenant_id nullable, metric_code, formula_version, period_start, period_end, dimensions_json, value_numeric, calculated_at)`; unique metric/scope/period/dimension hash.
- `ai_memories(id, tenant_id, customer_id nullable, scope, content, provenance_json, confidence, permission_scope_json, created_at, expires_at, deleted_at nullable)`; opt-in, tenant-filtered, expiring and source-deletion-aware.

## 4. Relationships and delete behavior
- EnterpriseOrganization has many Tenants; tenant deletion is a lifecycle workflow, not an uncontrolled cascade.
- Tenant owns memberships, customers, conversations, tickets, knowledge, agents, integrations, traces and tenant audit events. Tenant scoping is explicit on each tenant-owned record even where derivable through a parent.
- Customer has many Conversations and Tickets; Conversation has many Messages and may be associated with a Ticket. A conversation may exist without a ticket.
- Ticket has assignment history and timeline events; ticket status changes preserve audit/timeline history.
- KnowledgeSource has many KnowledgeChunks; chunks have embeddings. Source deletion invalidates/removes chunks, vectors, cache entries and derived references.
- AiAgent has many immutable AiAgentVersions; each version references explicit tool grants/workflow configuration and evaluation runs.
- Audit events are retained under policy and must not be silently cascaded away to conceal actions. Tenant deletion may require anonymization or controlled retention rather than hard delete.
- Idempotency records and outbox events use bounded cleanup after the retry/replay window.

## 5. Access rules
Authoritative matrix is `docs/SECURITY.md` section 3. Every tenant-owned table has a tenant ID or enforceable tenant ownership path; application repository methods require a `TenantContext`. Cross-tenant constraints should be reinforced with composite foreign keys/unique keys where practical. Supabase PostgreSQL Row Level Security (RLS) is a defense-in-depth control to configure and test, not a substitute for service-level authorization. Database service accounts use least privilege. Production data access and migrations require explicit owner approval.

## 5A. Supabase-specific operational requirements
- Treat Supabase as managed PostgreSQL, not as a reason to move authorization into the browser. Supabase Auth is the selected identity/session provider, but NestJS remains the authoritative authorization layer. Supabase Auth is the selected identity/session provider, but NestJS remains the authoritative authorization layer.
- Decide explicitly whether application requests connect through NestJS only (recommended for the initial architecture) or whether any client-side direct database access is required. Default: domain/business writes go through NestJS APIs.
- If direct client access is later approved, require authenticated identity, carefully designed RLS policies, least-privilege grants and automated cross-tenant negative tests for every exposed table/view/function.
- Keep service-role credentials server-only; do not use service-role access for end-user requests without application authorization checks.
- Separate migration credentials/process from normal runtime access where feasible. Verify pooler mode and prepared-statement compatibility for Prisma in the chosen deployment.
- Confirm pgvector extension support, vector dimensions, index strategy, tenant/permission filtering, connection limits, region, backups and restore process in the actual Supabase project.
- RLS policy changes are security-sensitive migrations and require security-agent review plus human approval before production rollout.

## 6. Queries and indexes
| Query (filter, sort, pagination) | Index | Reason |
| --- | --- | --- |
| Tenant tickets by status and updated time | `(tenant_id,status,updated_at DESC,id)` | Inbox and deterministic pagination |
| Tickets assigned to membership | `(tenant_id,assignee_membership_id,status,updated_at DESC)` | Assigned-to-me queue |
| Conversation timeline | `(tenant_id,conversation_id,created_at,id)` | Stable chronological history |
| Messages idempotency lookup | Unique `(tenant_id,conversation_id,idempotency_key)` when key supplied | Prevent duplicate message side effects |
| Tenant membership by user | Unique `(tenant_id,user_id)` and index `(user_id,status)` | Tenant context resolution |
| Knowledge chunks by source | Unique `(source_id,chunk_index)` | Re-indexing and source lifecycle |
| Vector similarity search | pgvector index plus mandatory tenant/permission filters | Retrieval performance without scope leakage |
| Audit events by tenant/time | `(tenant_id,created_at DESC,id)` | Restricted audit browsing |
| AI traces by correlation ID | `(correlation_id)` and `(tenant_id,created_at DESC)` | Debugging and operations |
| Pending outbox jobs | `(published_at,occurred_at)` partial index for unpublished events | Reliable event dispatch |

Pagination must have maximum page size, stable ordering and tenant scope. Cursor pagination is preferred for high-volume timelines/feeds where offset pagination degrades.

## 7. Migrations, seed, backup
- Migration tool: Prisma Migrate (Proposed based on stack and Supabase compatibility; validate the chosen direct/pooler connection and migration role before use). Migrations are reviewed, tested on synthetic data, and run through a controlled deployment step.
- Seed data: synthetic development fixtures only; never import production customer data into local tests by default.
- Backup/restore: use the selected Supabase plan/project capabilities only after confirming backup/PITR availability, retention, RPO/RTO and restore-test cadence; define before production launch. A backup is not considered verified until a restore drill succeeds.
- Verify: `npx prisma validate` and `npx prisma format` pass with Prisma 7.10.1 on 2026-10-25 (config lives in `prisma.config.ts`; Prisma 7 stores datasource URLs outside the schema file). `npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` produces 87 SQL lines on Windows and on Linux CI (the `Prisma schema` job in `.github/workflows/ci.yml`). The command needs `datasource.url` in `prisma.config.ts`; without it the schema engine fails with a usage error, the CLI swallows the error, and the command prints nothing with exit 0. - Live state (2026-10-27): `0001_init`, `0002_roles_and_audit` and `0003_support_schema` are applied to the Supabase development project. Tables, enums, indexes, foreign keys and all four CHECK constraints were verified by read-only SQL. All three rows sit in `public._prisma_migrations` with SHA-256 checksums that match the local `migration.sql` files.
- Tracking rule: `0003_support_schema` was applied through the Supabase tracked-migration API, which writes to `supabase_migrations.schema_migrations` only. Prisma does not read that table, so its row was added to `public._prisma_migrations` by reconciliation on 2026-10-27. Without that row `prisma migrate deploy` would treat `0003_support_schema` as pending and fail on tables that already exist.
- `prisma migrate status` and `prisma migrate deploy` stay **Not verified** locally: `prisma.config.ts` reads `datasource.url` from `DATABASE_URL`, and no `.env` file exists in the workspace. Apply every future migration with one tool only, so both history tables stay in step.
