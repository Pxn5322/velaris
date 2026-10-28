---
doc: PRD
version: 1.1-derived
status: Draft
owner: Product owner (user decision)
depends_on: []
---
# PRD — VELARIS

## 1. Context
- Vision: Enterprise-grade, multi-tenant customer operations combining human support workflows with governed AI agents, knowledge retrieval, automation, analytics, and enterprise security.
- Problem and evidence: Support work is fragmented across tickets, conversations, knowledge bases, internal tools, and automation, causing repetitive work, slower resolution, inconsistent answers, limited AI visibility, and governance challenges. This is the product problem statement from the source PRD; external validation is not yet provided.
- Target users: Enterprise administrators, tenant administrators, human support agents, customers, and platform/developer users.
- Desired outcome: Customers receive useful, grounded answers; agents retain full context at escalation; administrators can govern, audit, evaluate, and improve AI-assisted operations.
- Constraints: New project from scratch; previous implementation is reference only. Enterprise-grade tenant isolation and deterministic authorization are foundational. Supabase Auth is selected for identity/session; NestJS owns authorization. A monorepo and an orchestrated specialist-agent engineering workflow with independent verification/review are selected. AI providers, hosting/region, retention specifics, channel priority, workspace tooling, and compliance targets remain undecided.

## 2. Roles (canonical; other docs reference these IDs)
| Role ID | Description | Authenticated |
| --- | --- | --- |
| R-enterprise-admin | Platform/enterprise administrator managing tenants and platform governance | yes |
| R-tenant-admin | Tenant administrator managing support operations, users, knowledge, agents, integrations, and settings within own tenant | yes |
| R-agent | Human support agent handling assigned conversations and tickets | yes |
| R-customer | Customer creating requests and communicating with a business | yes for account-specific resources; public marketing is anonymous |
| R-developer | Platform/developer identity using authorized APIs, integrations, and tools | yes |
| R-anonymous | Public visitor viewing marketing content and starting signup | no |

## 3. Scope
- MVP (smallest useful set): Public landing page; authentication; tenant creation/isolation; users and RBAC; customers; conversations/tickets; human agent inbox; knowledge ingestion/retrieval with permission-aware citations; one production-ready AI support agent with LangGraph orchestration, guardrails, human escalation, audit logs, traces/evaluation, core analytics, automated tests, and CI/CD.
- Excluded/deferred: Full CRM/Salesforce replacement, accounting/billing platform, unrestricted autonomous AI employee, visual no-code workflow builder, many channels simultaneously, proprietary model training, unlimited memory, high-risk autonomous actions, unearned compliance certifications, native mobile apps, extensive integrations, complex SSO, advanced billing automation, large-scale microservices.

## 4. Journeys
| ID | Actor | Trigger | Steps (screen → action → result) | Success | Failure / recovery |
| --- | --- | --- | --- | --- | --- |
| J-01 | R-anonymous | Wants to evaluate VELARIS | Landing → Start Free → sign up → create company → tenant established | Organization can start onboarding | Validation/auth errors are visible and recoverable |
| J-02 | R-tenant-admin | Needs to configure support | Admin dashboard → invite agent → upload knowledge → configure agent → test/evaluate → publish | Agent is published only after required checks pass | Failed ingestion/evaluation is visible; agent remains unpublished |
| J-03 | R-customer | Needs support | Customer portal/web experience → ask question → authorized retrieval → grounded answer/citation or escalation | Useful answer or human handoff with context | Low confidence, missing knowledge, tool failure, or human request escalates |
| J-04 | R-agent | Receives escalated ticket | Inbox → inspect timeline/context → reply/update status → resolve | Ticket is resolved with audit trail | Concurrent update or invalid transition is rejected with current state shown |
| J-05 | R-enterprise-admin | Needs governance | Enterprise console → manage tenant/users/roles → inspect audit logs | Authorized governance actions are traceable | Unauthorized access is denied and security event is recorded where appropriate |
| J-06 | R-developer | Integrates an external system | API docs → authenticate → call versioned API/webhook → inspect response/correlation ID | Stable, documented integration contract | Validation/rate-limit/provider failures use consistent error contract and safe retries |

## 5. Features
| ID | User need | Behavior (inputs, result, permissions) | Journey | Priority |
| --- | --- | --- | --- | --- |
| F-01 | As R-anonymous, I need to understand the product and begin signup | Public marketing route `/` presents product value, capabilities, security, pricing, FAQ, and CTAs; no protected data exposed | J-01 | Must |
| F-02 | As a user, I need secure identity and tenant context | Authenticate, resolve tenant membership, roles and permissions; provider-independent domain boundary | J-01,J-02,J-03 | Must |
| F-03 | As R-enterprise-admin, I need to manage tenants and users | Tenant lifecycle, user status, roles, permissions, and audit visibility; platform-level access explicit | J-05 | Must |
| F-04 | As a tenant user, I need tenant-isolated access | All tenant-owned operations enforce server-side tenant scope including repositories, jobs, cache, files, and vectors | J-02,J-03,J-04 | Must |
| F-05 | As R-customer and R-agent, I need conversations and tickets | Create conversations/tickets, messages/internal notes, assignment, status, priority, tags, timeline, valid transitions and concurrency checks | J-03,J-04 | Must |
| F-06 | As R-agent, I need an efficient human workspace | Inbox, assigned-to-me, timeline, customer context, AI summary, suggested reply, relevant knowledge, next action, handoff context | J-04 | Must |
| F-07 | As R-tenant-admin, I need trusted knowledge retrieval | Ingest website/PDF/Markdown/FAQ/manual articles and explicitly enabled historical support information; parse, chunk, embed, retrieve, cite, track errors | J-02,J-03 | Must |
| F-08 | As R-tenant-admin, I need to configure and publish an AI agent safely | Versioned instructions, knowledge, tools, guardrails, permissions, workflows, tests/evaluation, publish and rollback | J-02 | Must |
| F-09 | As R-customer, I need a grounded AI response or human handoff | LangGraph runtime validates input, retrieves authorized knowledge, checks policies, responds/cites, requests clarification, invokes permitted tools, or escalates | J-03 | Must |
| F-10 | As an administrator, I need deterministic action governance | Server-side permission/policy/business-rule checks and required human approval precede consequential tool execution; audit action | J-02,J-03,J-05 | Must |
| F-11 | As an administrator, I need AI traces, evaluation and auditability | Correlation IDs, trace metadata, evaluation datasets/results, release gates, and append-oriented audit events | J-02,J-05,J-06 | Must |
| F-12 | As a tenant administrator, I need operational analytics | Measure support outcomes, AI outcomes, platform health, cost/latency, and governance using documented KPI formulas and tenant scope | J-05 | Must |
| F-13 | As R-developer, I need stable APIs and integrations | Versioned REST/OpenAPI contracts, standardized pagination/filtering/errors, idempotent retries, provider adapters and webhooks | J-06 | Should |
| F-14 | As a tenant administrator, I need controlled data lifecycle | Retention/deletion by category, knowledge-derived data cleanup, opt-in memory expiration, restricted audit history | J-02,J-05 | Must |

## 6. Acceptance criteria
Each criterion is observable and intended to map to a test. UI features need loading, empty, and error states; authorization-sensitive features include denial cases.

| AC ID | Feature | Given / When / Then | Kind |
| --- | --- | --- | --- |
| AC-F01-1 | F-01 | Given an anonymous visitor, when `/` loads, then all required marketing sections and primary CTAs render | happy |
| AC-F01-2 | F-01 | Given malformed signup input, when submitted, then validation errors appear without creating an account | invalid |
| AC-F01-3 | F-01 | Given an anonymous visitor, when requesting a protected admin page, then access is redirected/denied without protected data | unauthorized |
| AC-F02-1 | F-02 | Given valid credentials and membership, when sign-in completes, then session and authorized tenant context are resolved | happy |
| AC-F02-2 | F-02 | Given invalid/expired credentials, when a protected request is made, then a consistent 401 error is returned | invalid |
| AC-F02-3 | F-02 | Given a user without the required permission, when invoking a protected operation, then a 403 is returned | unauthorized |
| AC-F03-1 | F-03 | Given R-enterprise-admin, when creating/disabling a tenant or changing a user role, then the change is persisted and audited | happy |
| AC-F03-2 | F-03 | Given an invalid tenant/user identifier or invalid role assignment, when submitted, then validation rejects it | invalid |
| AC-F03-3 | F-03 | Given R-tenant-admin, when accessing platform-wide tenant governance beyond its scope, then access is denied | unauthorized |
| AC-F04-1 | F-04 | Given a valid tenant context, when reading/writing a tenant-owned resource, then only in-scope records are returned or changed | happy |
| AC-F04-2 | F-04 | Given a disabled tenant, when a new business operation is attempted, then it is rejected while defined cleanup jobs remain controlled | invalid |
| AC-F04-3 | F-04 | Given tenant A credentials, when requesting tenant B data by guessed ID, then no tenant B data is disclosed or modified | unauthorized |
| AC-F05-1 | F-05 | Given an authorized customer/agent, when a valid conversation or ticket operation occurs, then timeline and state update consistently | happy |
| AC-F05-2 | F-05 | Given an invalid ticket transition or stale version, when update is submitted, then it is rejected with a recoverable conflict/state response | invalid |
| AC-F05-3 | F-05 | Given a user without ticket access, when reading/updating/deleting a ticket, then the operation is denied | unauthorized |
| AC-F06-1 | F-06 | Given assigned work, when an agent opens the inbox, then timeline, customer context, and available AI assistance load | happy |
| AC-F06-2 | F-06 | Given no assigned tickets or a failed API request, when inbox loads, then empty and error/retry states are distinct | invalid |
| AC-F06-3 | F-06 | Given an agent without access to a ticket, when opening its deep link, then no ticket details are exposed | unauthorized |
| AC-F07-1 | F-07 | Given an allowed knowledge source, when ingestion completes, then status, provenance, chunks/embeddings and retrieval scope are recorded | happy |
| AC-F07-2 | F-07 | Given a malformed/unsupported source or partial ingestion failure, when processed, then the failure is reported and retry/re-index is possible | invalid |
| AC-F07-3 | F-07 | Given a user/agent without source permission, when retrieval is performed, then unauthorized chunks are excluded | unauthorized |
| AC-F08-1 | F-08 | Given a valid draft agent and passing required evaluation suite, when published, then an immutable version becomes active | happy |
| AC-F08-2 | F-08 | Given a failed evaluation or invalid tool schema, when publish is requested, then publication is blocked with actionable findings | invalid |
| AC-F08-3 | F-08 | Given a user without `ai.agent.deploy`, when publishing/rolling back an agent, then the operation is denied and audited | unauthorized |
| AC-F09-1 | F-09 | Given relevant authorized knowledge, when a customer asks an in-scope question, then the response is grounded and includes citations where applicable | happy |
| AC-F09-2 | F-09 | Given no sufficiently relevant knowledge, provider outage, repeated failure, or human request, when handling a message, then the system abstains/clarifies/escalates with context | invalid |
| AC-F09-3 | F-09 | Given a prompt injection or request for another tenant's data, when processed, then the agent cannot bypass authorization or reveal protected data | unauthorized |
| AC-F10-1 | F-10 | Given a permitted tool action, when application permission, policy, business rules, and required approval pass, then execution is audited | happy |
| AC-F10-2 | F-10 | Given a disallowed action, missing approval, timeout, or invalid tool arguments, when execution is requested, then it fails safely without unauthorized side effects | invalid |
| AC-F10-3 | F-10 | Given an LLM proposal without application permission, when execution is attempted, then deterministic server authorization denies it | unauthorized |
| AC-F11-1 | F-11 | Given a production AI run or sensitive admin action, when it completes, then a correlation/trace or audit event is available according to policy | happy |
| AC-F11-2 | F-11 | Given missing required trace metadata or a critical evaluation regression, when release checks run, then the check fails visibly | invalid |
| AC-F11-3 | F-11 | Given a user without audit/trace permission, when querying restricted records, then access is denied | unauthorized |
| AC-F12-1 | F-12 | Given tenant events and defined KPI formulas, when dashboard is queried, then metrics are scoped and definitions are documented | happy |
| AC-F12-2 | F-12 | Given no events or delayed telemetry, when dashboard loads, then empty/stale states are clearly represented | invalid |
| AC-F12-3 | F-12 | Given a tenant admin, when requesting another tenant's analytics, then the request is denied | unauthorized |
| AC-F13-1 | F-13 | Given a valid API request, when calling `/api/v1` endpoints, then OpenAPI-described response and correlation ID are returned | happy |
| AC-F13-2 | F-13 | Given invalid filters, repeated idempotency keys with mismatched payloads, or rate limit exceeded, when requested, then standardized errors are returned | invalid |
| AC-F13-3 | F-13 | Given invalid credentials or insufficient integration permission, when calling an API, then no protected operation occurs | unauthorized |
| AC-F14-1 | F-14 | Given expired knowledge or memory, when lifecycle processing runs, then source and derived records are removed or made unavailable per policy | happy |
| AC-F14-2 | F-14 | Given an invalid retention configuration, when saved, then validation rejects the configuration | invalid |
| AC-F14-3 | F-14 | Given a tenant admin without access to restricted audit data, when requesting deletion or viewing records outside scope, then access is denied | unauthorized |

## 7. Non-functional requirements
| ID | Category | Measurable requirement | Verification |
| --- | --- | --- | --- |
| NFR-01 | Tenant security | 100% of tenant-owned protected operations enforce tenant context; no cross-tenant disclosure in defined test suite (Confirmed target) | Automated repository/service/API isolation tests |
| NFR-02 | Authorization | 100% of protected APIs enforce authentication and required permissions (Confirmed target) | API denial tests and route inventory review |
| NFR-03 | Test coverage | Target >=80% coverage for core domain/application logic (Confirmed target) | Jest coverage report; exclude generated code only by documented rule |
| NFR-04 | API performance | Fast non-AI APIs target p95 <200 ms under a documented test load (Confirmed target; load profile remains Proposed) | Repeatable load test and report |
| NFR-05 | Availability | Critical production APIs target >=99.9% successful responses excluding intentional 4xx validation/auth responses (Confirmed target) | Production telemetry and agreed SLI calculation |
| NFR-06 | AI traceability | 100% of production AI runs have a correlation/trace ID (Confirmed target) | Trace completeness query/test |
| NFR-07 | Auditability | 100% of security-sensitive admin and AI lifecycle actions generate audit events (Confirmed target) | Event-to-action integration tests |
| NFR-08 | Accessibility | Target WCAG 2.2 AA for critical journeys (Confirmed direction) | Automated checks plus manual keyboard/screen-reader review |
| NFR-09 | AI release quality | Every production agent release passes configured regression/evaluation gates (Confirmed target) | CI/deploy-gate tests including critical guardrails |
| NFR-10 | API reliability | Versioned `/api/v1`, consistent errors, correlation propagation, and idempotency for retry-prone operations (Confirmed requirement) | Contract tests and duplicate-event tests |

## 8. Screens
| Screen | Journey | Roles | Required data |
| --- | --- | --- | --- |
| Public landing page | J-01 | R-anonymous | Product copy, features, pricing content, FAQ, CTAs |
| Sign up / create company | J-01 | R-anonymous | Identity fields, organization details, validation state |
| Enterprise dashboard / tenants / users / roles / audit | J-05 | R-enterprise-admin | Tenant/user/role summaries and restricted audit events |
| Tenant dashboard / settings | J-02,J-05 | R-tenant-admin | Tenant settings, onboarding progress, integrations |
| Knowledge sources and ingestion detail | J-02 | R-tenant-admin | Source metadata, status, errors, provenance, retrieval settings |
| AI Agent management (Overview, Instructions, Knowledge, Tools, Guardrails, Permissions, Workflows, Evaluation, Versions, Observability) | J-02 | R-tenant-admin | Agent config, tool grants, version/evaluation status and traces |
| Customer request/conversation | J-03 | R-customer | Conversation history, messages, citations, escalation status |
| Human agent inbox / ticket detail | J-04 | R-agent | Queue, assignment, timeline, customer context, AI copilot |
| Analytics | J-05 | R-tenant-admin,R-enterprise-admin | Tenant-scoped KPI definitions and values |
| API docs / integration configuration | J-06 | R-developer,R-tenant-admin | OpenAPI contract, webhook/integration state, credentials metadata |

## 9. Success metrics
- AI Resolution Rate: eligible conversations resolved by AI without human takeover / eligible conversations; baseline and target to be established from representative data (Proposed target).
- Escalation Rate: AI-handled conversations escalated / AI-handled conversations; segment by reason and tenant.
- First Response Time and Resolution Time: event-defined durations, reported by tenant and time period.
- Customer Satisfaction: defined survey response score and response rate; survey method remains Unknown.
- Cost per Resolution: attributable model/provider cost plus agreed operational cost / resolved conversations; attribution details Proposed.
- API error rate and p50/p95/p99 latency: telemetry by endpoint class, excluding intentional 4xx as defined for availability SLI.
- Tenant isolation and audit completeness: required test pass rate and audited-action coverage; release blockers on failures.

## 10. Assumptions and risks
| ID | Statement | Status | Owner | If wrong |
| --- | --- | --- | --- | --- |
| A-01 | PostgreSQL with pgvector is sufficient for V1 retrieval | Proposed | Product/architecture owner | Revisit vector-store decision before scale-critical work |
| A-02 | A modular monolith is preferable to initial microservices | Confirmed direction | Product/architecture owner | Revisit only with evidence of deployment/team boundary needs |
| A-03 | First production customer channel is web experience | Proposed | Product owner | Adjust channel-specific journey and integrations |
| A-04 | Supabase Auth provides identity/session; NestJS enforces authorization and tenant policy | Selected | Product/architecture owner | Token verification, onboarding, recovery and SSO details still require implementation decisions and tests |
| A-05 | AI memory is opt-in and has explicit expiration | Confirmed requirement | Product/security owner | Privacy and retrieval risks increase if changed |
| A-06 | Production compliance target is not yet selected | Unknown | Product owner | Do not make compliance claims; add controls once market is known |
| A-07 | MVP will use one primary channel and a limited integration set | Proposed | Product owner | Scope and staffing may increase materially |

## 11. Open decisions
| ID | Question | Recommended default | Needed before |
| --- | --- | --- | --- |
| D-01 | Which Supabase Auth integration details must be configured? | Verify access tokens in NestJS; keep application authorization and tenant policy in NestJS | Auth implementation: token/session handling, redirect URLs, account lifecycle and future SSO scope |
| D-02 | Which LLM providers in V1? | One primary provider plus adapter boundary; fallback only if safety/eval parity is established | AI runtime |
| D-03 | PostgreSQL/pgvector only or dedicated vector DB? | Start with PostgreSQL/pgvector | Retrieval implementation |
| D-04 | First production communication channel? | Web customer experience | MVP release planning |
| D-05 | Billing model? | Defer product billing; keep metering seams only | Commercial launch |
| D-06 | Enterprise hierarchy? | Platform → enterprise organization → tenant/company; no nested tenant support in V1 | Data model |
| D-07 | SSO/SAML in V1? | Defer complex SSO; preserve OIDC/SAML extension seam | Enterprise sales commitment |
| D-08 | Retention periods by category? | Define safe initial defaults and make tenant-configurable where appropriate; owner must approve exact durations | Production data handling |
| D-09 | Which fields need field-level encryption? | Classify data before production; encrypt secrets and sensitive fields per threat review | Production launch |
| D-10 | Which AI actions require mandatory human approval? | Require approval for consequential or high-risk actions until action-specific policy is approved | Tool execution |
| D-11 | Evaluation thresholds? | Derive from curated representative dataset; critical guardrail failures always block | Agent publishing |
| D-12 | SLA model? | Support first-response and resolution SLA foundation; defer complex calendars/policies | Ticket implementation beyond basic workflow |
| D-13 | First required integrations? | Webhooks and generic REST first; prioritize channel/CRM based on target market | Integration phase |
| D-14 | Usage-metering model? | Record model/provider usage and cost metadata where available, without committing pricing | Analytics/billing readiness |
| D-15 | Compliance targets? | No compliance claim until target and evidence are approved | Enterprise launch |
| D-16 | May a ticket close without being resolved first? | No: CLOSED is reachable only from RESOLVED, so every closed row carries both resolved_at and closed_at (migration 0003 CHECK); Proposed 2026-10-28, needs owner confirmation | Ticket lifecycle |

## 12. Definition of ready
- [ ] Scope, journeys, roles, and acceptance criteria approved.
- [ ] Blocking unknowns resolved or explicitly defaulted in decision log.
- [ ] Security, tenant isolation, and data classification reviewed before protected data is implemented.
- [ ] APIs and entities have traceable IDs in supporting documents.
- [ ] Test-first tasks and verification commands are configured and verified in the target repository.
