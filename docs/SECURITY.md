---
doc: SECURITY
version: 0.1
status: Draft
owner: Product/security owner
depends_on: [PRD, ARCHITECTURE]
---
# Security — VELARIS

This document describes intended controls; it does not establish regulatory compliance or claim that controls have been implemented or verified.

## 1. Assets and trust boundaries
- Protected data: tenant/customer profiles, conversations/messages, tickets, internal notes, knowledge files/chunks/embeddings, AI instructions and traces, tool credentials/metadata, user/role data, audit events and integration configuration.
- Trust boundaries: browser ↔ API; tenant ↔ tenant; human user ↔ AI agent; application ↔ LLM/embedding provider; API ↔ queue/worker; platform admin ↔ tenant admin; VELARIS ↔ external integrations.
- Untrusted inputs: user messages, uploads, website/PDF/Markdown content, webhook payloads, query filters, tool arguments, LLM output, retrieved content and external tool responses.
- Rule: retrieved text and tool output are data, never instructions that can override system policy. The model proposes; deterministic application code authorizes and executes.

## 2. Threats
| ID | Abuse case | Control | Verified by (test in TESTING.md) |
| --- | --- | --- | --- |
| TH-01 | User guesses another tenant's resource ID | Mandatory tenant context at controller/service/repository; scoped storage, cache, queue and vector queries | TST-TH-01 cross-tenant API/repository tests |
| TH-02 | Authenticated user invokes a forbidden operation | Central permission policy plus resource-level checks; deny by default | TST-TH-02 unauthorized matrix |
| TH-03 | LLM invokes a tool without authority | Tool allow-list, runtime permission check, policy/business validation, approval gate | TST-TH-03 unauthorized tool execution test |
| TH-04 | Prompt injection in customer or retrieved content | Treat content as untrusted; isolate instructions; validate tool proposals and outputs | TST-TH-04 injection regression dataset |
| TH-05 | Internal note or restricted knowledge leaks to customer | Separate message types and permission-aware retrieval/API serialization | TST-TH-05 visibility and retrieval tests |
| TH-06 | Malicious or oversized uploaded knowledge file | Type/size limits, safe parsing, malware scanning decision, quarantine and async processing | TST-TH-06 upload validation tests |
| TH-07 | Secret or personal data leaks through logs/traces | Redaction, data minimization, access controls, retention policies | TST-TH-07 log/trace redaction tests/review |
| TH-08 | Duplicate webhook/job causes duplicate side effect | Signature validation, idempotency keys, unique event constraints, bounded retries | TST-TH-08 duplicate delivery tests |
| TH-09 | AI provider outage or unbounded retries causes degradation/cost | Timeouts, retry budgets, rate limits, circuit breaker and human fallback | TST-TH-09 provider failure tests |
| TH-10 | Admin/audit event is altered or unavailable | Append-oriented restricted audit storage, least privilege, integrity/backup review | TST-TH-10 audit controls tests/review |
| TH-11 | Tenant disabled but old session/job continues business action | Tenant status rechecked at operation/job execution; controlled cleanup behavior | TST-TH-11 disabled tenant tests |
| TH-12 | Stale knowledge or memory remains retrievable after deletion/expiry | Lifecycle jobs invalidate source, chunks, vectors, cache and memory references | TST-TH-12 retention/deletion tests |

## 2A. Security verification workflow
- Security-agent review is mandatory for authentication, RBAC, tenant context, database/RLS policies, migrations, file ingestion, AI tools, secrets, audit/retention, webhooks and external integrations.
- Required checks include cross-tenant IDOR tests, role/permission denial matrices, RLS tests if RLS is enabled, prompt-injection/tool authorization regression tests, dependency and secret scans, unsafe upload tests, rate-limit/abuse checks and audit redaction review.
- Active penetration testing must be explicitly scoped and authorized, use synthetic data, and target local/test/staging environments only unless the owner separately approves a production test plan.
- A security agent reports findings and evidence; it does not independently waive findings or approve production. Critical/high findings block integration until fixed or explicitly risk-accepted by the human owner with documented compensating controls.
- The integration agent cannot merge a security-sensitive change into a protected branch before human approval.

## 3. Roles and permissions (canonical)
Canonical roles are defined in `docs/PRD.md` section 2. This table is a baseline authorization matrix; finer permission mapping is implemented as permission codes rather than hard-coded role names.

| Capability | R-anonymous | R-enterprise-admin | R-tenant-admin | R-agent | R-customer | R-developer |
| --- | --- | --- | --- | --- | --- | --- |
| View public marketing | allow | allow | allow | allow | allow | allow |
| Manage platform tenants | deny | allow | deny | deny | deny | deny unless explicitly granted platform scope |
| Manage tenant users/roles | deny | platform scope only | own tenant with `user.create`, `user.disable`, `role.manage` | deny by default | deny | API scopes only |
| Read/update tickets | deny | only through explicit support/governance permission | own tenant with relevant ticket permission | assigned/permitted tenant tickets | own customer-visible tickets only | explicit API scope only |
| Read/write internal notes | deny | explicit audit/support permission only | own tenant if granted | permitted tickets only | deny | explicit integration scope only |
| Manage knowledge | deny | platform metadata only unless explicitly granted | own tenant with knowledge permission | read only if granted | no direct source access | explicit API scope only |
| Configure/publish agents | deny | platform governance only unless explicit grant | own tenant with `ai.agent.*` permissions | deny by default | deny | explicit API scope only |
| Execute AI tools | deny | never bypass action policy | policy and permission bound | policy and permission bound | only approved user-facing actions | tool-specific scoped grants |
| Read audit logs | deny | platform-wide if explicitly permitted | own tenant if `audit.read` | deny by default | deny | explicit restricted API scope |
| Read analytics | deny | platform scope | own tenant | limited operational view if defined | own interaction only | scoped API permission |

Role-to-permission mapping and per-resource policies must be tested. Enterprise role is not a universal bypass for application actions; elevated access must be explicit, audited and least-privilege.

## 4. Authentication and sessions
- Identity provider selected: Supabase Auth. NestJS must validate access tokens server-side using the supported Supabase/JWT verification approach and enforce authorization independently of identity claims. Use trusted subject identity to look up active application user, tenant membership and permissions; do not trust user-editable metadata or client-supplied tenant IDs as authorization grants.
- Require authentication on protected APIs and routes. Validate Supabase access-token signature, issuer, expiry and expected claims using a maintained supported verifier/JWKS approach; define key rotation and failure behavior. Return 401 for absent/invalid credentials and 403 for authenticated principals lacking permission.
- Configure Supabase Auth account recovery and verification as required by the onboarding journey. Enforce application user active/disabled status, tenant membership, rate limits and security audit events in VELARIS. Define refresh/revocation behavior and ensure disabled users or revoked sessions cannot continue protected operations beyond the accepted token-validation window.
- Future OIDC/SAML/enterprise SSO remains an extension point; inclusion in V1 is not approved.
- Tenant context must be derived from validated membership and requested/selected tenant, never trusted solely from an arbitrary client-supplied tenant ID.

## 5. Secrets
- Never commit secrets or include them in browser bundles, logs, prompts, test fixtures or documentation.
- Store real credentials in environment-specific secret stores; `.env.example` contains names and safe placeholders only.
- Use separate credentials/projects for local, staging and production; least privilege and MFA for operator accounts.
- Rotate/revoke compromised credentials and document owner/runbook. Rotation automation is not yet configured.

## 6. Input, output and abuse handling
- Validate all DTOs, IDs, enum values, state transitions, upload MIME/type/size, pagination bounds, tool schemas and webhook signatures.
- Apply rate limits to authentication, public endpoints, uploads, AI inference and expensive operations; exact thresholds are Proposed and must be load-tested.
- Sanitize/encode output according to rendering context. Never render untrusted Markdown/HTML as trusted markup by default.
- LLM output is untrusted. Tool calls must match registered schemas and permissions. The LLM cannot choose tenant scope or override policy.
- Customer-visible messages and internal notes use separate types and serialization paths.
- Apply timeouts, bounded retries, idempotency and safe fallback for external calls.
- Return safe errors with `code`, `message`, optional validation `details`, and `requestId`; never return stack traces.

## 7. Audit and observability
- Required audit events include user/role/status changes, tenant changes, ticket creation/assignment/update/delete, agent create/update/publish/rollback, workflow execution, knowledge changes, integration connections and permission changes.
- Record actor, tenant scope, action, resource type/ID, timestamp, request/correlation ID and minimal metadata. IP/user-agent collection and retention are subject to privacy review.
- Audit records are restricted and append-oriented; do not rewrite history to conceal actions.
- AI traces may include model/provider/version, prompt version where permitted, retrieval source IDs, tool metadata, latency, token/cost metadata, guardrail outcomes, escalation and final outcome. Minimize raw personal data.

## 8. Data classification and privacy
- Public: approved marketing content.
- Internal: operational configuration and non-sensitive telemetry.
- Personal: customer identity/contact fields and conversation content that can identify a person.
- Sensitive/restricted: credentials, security-sensitive audit data, provider keys, and any fields classified as sensitive after review.
- Retention direction is in PRD section 19; exact durations remain a blocking production decision. Derived data such as embeddings, caches, summaries and AI memory must follow source lifecycle rules.
- Field-level encryption requirements are Unknown until the product owner approves the data classification and market requirements.

## 9. AI add-on
- Explicit allow-list of tools/actions per agent; agent permissions are distinct from human RBAC.
- At execution time, application authorization, policy validation and business rules run again, even if the agent was previously configured with a grant.
- High-risk/consequential actions require human approval until an action-specific policy is approved.
- Evaluation gates block release on critical guardrail failure, unauthorized tool execution, inadequate retrieval/citation/escalation behavior, or protected regression failure.
- Provider fallback must not bypass authorization, safety, retention or evaluation requirements.

## 10. Residual risks
| Risk | Owner | Accepted until |
| --- | --- | --- |
| Provider-specific data processing and regional residency are not selected | Product/security owner | Before production customer data is sent to providers |
| Exact retention periods and deletion SLAs are not selected | Product/security owner | Before production launch |
| Compliance framework and evidence requirements are unknown | Product owner | Before making any compliance claim or selling into a regulated segment |
| Threat model has not yet been validated against a running implementation | Engineering/security owner | Before production release |
