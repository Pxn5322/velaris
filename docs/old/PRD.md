# Product Requirements Document (PRD)

## Product Identity

- **Product Name:** VELARIS
- **Product Type:** Enterprise SaaS / AI-powered customer operations platform
- **Primary Category:** AI-powered Customer Support & Customer Operations
- **Working Tagline:** Intelligent customer operations, powered by AI.
- **Status:** Confirmed product direction / development baseline
- **Version:** 1.1
- **Implementation Strategy:** New project built from scratch. The previous customer-support implementation is reference material only.

---

## 1. Overview

### Product Vision

**VELARIS is an enterprise-grade, multi-tenant customer operations platform that combines human support workflows with governed AI agents, knowledge retrieval, automation, analytics, and enterprise security.**

### Problem Statement

Customer-support teams often operate across tickets, conversations, knowledge bases, internal tools, and disconnected automation. This creates repetitive work, slow resolution, inconsistent answers, limited visibility into AI behavior, and security/governance challenges at scale.

VELARIS brings these capabilities into one platform where AI handles appropriate conversations, human agents take over with full context, knowledge is retrieved from trusted tenant-isolated sources, actions are controlled by application policies, and administrators can govern, audit, evaluate, and improve the system.

### Product Principles

1. AI assists and automates; deterministic application code governs permissions and execution.
2. Multi-tenancy is a first-class security boundary.
3. Human-in-the-loop is a core capability.
4. AI responses should be grounded in authorized knowledge whenever applicable.
5. Consequential AI actions must be observable and auditable.
6. Enterprise governance should coexist with a simple user experience.
7. The architecture should be able to grow from customer support into broader customer operations.

### Goals & Metrics

Initial engineering/product targets:

- 100% of protected business operations enforce tenant context.
- 100% of protected APIs enforce authentication and required permissions.
- Target >=80% automated coverage for core domain/application logic.
- Critical user journeys covered by Cypress.
- Production-ready critical APIs target >=99.9% successful responses, excluding intentional 4xx validation/auth responses.
- 100% of production AI runs have a correlation/trace identifier.
- 100% of security-sensitive administrative and AI lifecycle actions generate audit events.
- Every production AI-agent release passes the defined regression/evaluation suite.
- Establish p95 performance targets by endpoint class before production launch.

---

## 2. Users & User Stories

### Personas

- **Enterprise Administrator:** Manages tenants, users, roles, permissions, governance, and audit records.
- **Tenant Administrator:** Configures support operations, users, knowledge, AI agents, workflows, integrations, and settings.
- **Human Support Agent:** Handles assigned conversations/tickets and uses AI copilot capabilities.
- **Customer:** Creates support requests and communicates with the business.
- **Platform/Developer:** Uses APIs, integrations, tools, and observability capabilities.

### Core User Stories

- As an enterprise administrator, I want to create and manage tenants so multiple organizations can operate securely on one platform.
- As an administrator, I want to manage users, roles, and permissions so access follows organizational responsibilities.
- As a tenant administrator, I want to configure support operations so my organization can onboard without engineering assistance.
- As a tenant administrator, I want to manage knowledge sources so AI answers use trusted business information.
- As a tenant administrator, I want to configure AI instructions, tools, knowledge, guardrails, and policies so the agent follows business requirements.
- As a tenant administrator, I want to test an AI agent before publishing it so unsafe or low-quality behavior can be caught before production.
- As a customer, I want useful, grounded answers so I can resolve issues quickly.
- As a customer, I want to request a human so I am not trapped in automation.
- As a human agent, I want escalation context so I do not need to repeat the investigation.
- As a human agent, I want summaries and suggested replies so I can resolve tickets efficiently.
- As an administrator, I want AI traces and audit logs so I can understand what the system did and why.
- As a developer, I want stable APIs and integrations so external systems can participate in workflows.

### Edge Cases

- Cross-tenant resource access attempt.
- Authenticated user without required permission.
- Disabled tenant with active sessions/background jobs.
- No sufficiently relevant knowledge retrieved.
- Knowledge outside the requester's authorization.
- AI requests an unauthorized tool.
- Tool failure or timeout.
- Action requires human approval.
- Repeated AI failure requiring escalation.
- Partial knowledge-ingestion failure.
- AI provider outage.
- Duplicate webhook/event delivery.
- Published agent version rollback.
- Concurrent ticket updates.
- Sensitive audit metadata requiring restricted access.

---

## 3. Functional Requirements

### 3.1 Public SaaS Website

The public `/` route is the VELARIS marketing site and should include:

- Hero
- Problem/value proposition
- AI Support Agent
- Human Agent Workspace
- Knowledge/RAG
- Automation/workflows
- Analytics
- Enterprise security
- Multi-tenant architecture
- Integrations
- Pricing
- FAQ
- CTA

Primary CTAs: **Start Free** and **View Demo**.

### 3.2 Authentication & Tenant Context

- Authentication and secure session/token validation.
- Tenant context resolution.
- Role/permission resolution.
- Protected API and route enforcement.
- Authentication-provider abstraction.

### 3.3 Multi-Tenancy

Every tenant-scoped operation must enforce tenant isolation.

```text
Authentication
    ↓
Tenant Context
    ↓
Role
    ↓
Permission
    ↓
Resource Ownership / Tenant Scope
    ↓
Business Operation
```

Tenant isolation must be enforced server-side in application/repository boundaries, not only by frontend filtering.

### 3.4 Enterprise Management

Enterprise administrators can manage tenants, users, roles, permissions, tenant status, audit logs, and platform settings.

Default role direction:

- ENTERPRISE
- ADMIN
- AGENT
- USER

Roles map to permissions rather than hard-coding authorization around role names.

### 3.5 RBAC & Permissions

Representative permissions:

- `tenant.read`
- `tenant.update`
- `user.create`
- `user.disable`
- `role.manage`
- `ticket.read`
- `ticket.create`
- `ticket.update`
- `ticket.delete`
- `ticket.assign`
- `ticket.escalate`
- `ai.agent.read`
- `ai.agent.create`
- `ai.agent.update`
- `ai.agent.deploy`
- `ai.agent.test`
- `ai.workflow.execute`
- `ai.workflow.publish`
- `audit.read`

### 3.6 Customers, Conversations & Tickets

Core objects:

- Customer
- Conversation
- Ticket
- Message/event
- Assignment
- Status
- Priority
- Tags
- Internal notes
- Timeline

Core workflow:

```text
Customer Request
    ↓
Conversation
    ↓
AI or Human Handling
    ↓
Ticket Creation / Association
    ↓
Assignment / Routing
    ↓
Resolution or Escalation
    ↓
Audit + Analytics
```

### 3.7 Human Agent Workspace

The workspace should provide Inbox, Assigned-to-Me, ticket/conversation timeline, customer context, AI summary, suggested reply, relevant knowledge, recommended next action, translation where implemented, and AI-to-human handoff context.

### 3.8 Knowledge Management & RAG

Initial source direction:

- Website
- PDF
- Markdown
- FAQ
- Manual articles
- Explicitly enabled historical support information

Pipeline:

```text
Knowledge Source
    ↓
Ingestion → Parsing → Chunking → Embeddings
    ↓
Vector Storage
    ↓
Retrieval → Optional Reranking
    ↓
AI Agent
```

Requirements include tenant isolation, permission-aware retrieval, provenance, citations, ingestion status/error handling, re-indexing, and retrieval-quality evaluation.

### 3.9 AI Agent Platform

```text
Agent
├── Instructions
├── Tools
├── Knowledge
├── Guardrails
├── Permissions
├── Workflows
└── Evaluation
```

Runtime direction:

```text
Customer Message
    ↓
Input Validation
    ↓
Intent Detection
    ↓
Context Retrieval
    ↓
Knowledge Retrieval
    ↓
Policy / Guardrail
    ↓
LangGraph Workflow
    ↓
Decision
 ├── Answer
 ├── Tool / Action
 ├── Ask Clarification
 └── Escalate
    ↓
Response Validation
    ↓
Citation
    ↓
Human Escalation when required
    ↓
Trace / Analytics
```

### 3.10 AI Governance & Guardrails

The LLM must never directly control authorization.

```text
LLM proposes action
    ↓
Application permission check
    ↓
Policy validation
    ↓
Business-rule validation
    ↓
Human approval if required
    ↓
Tool execution
    ↓
Audit event
    ↓
Result returned to workflow
```

Guardrails cover allowed tools/actions, data access, sensitive operations, approvals, input/output safety, maximum action scope, and escalation conditions.

### 3.11 AI Workflows

Initial workflows should be schema-driven rather than requiring a full visual builder.

```ts
interface AiWorkflow {
  id: string;
  name: string;
  version: number;
  trigger: WorkflowTrigger;
  nodes: WorkflowNode[];
  guardrails: Guardrail[];
  enabled: boolean;
}
```

Lifecycle:

```text
Draft → Test → Evaluate → Publish → Observe → Improve → New Version
```

### 3.12 Human-in-the-Loop

Escalate when confidence/grounding is insufficient, an action requires approval, a tool fails, policy disallows autonomous execution, the customer asks for a human, or repeated AI attempts fail.

Escalation must preserve relevant conversation, customer, retrieval, tool, and AI context.

### 3.13 AI Memory

Architecture should support short-term conversation memory, customer memory, tenant context, optional long-term memory, provenance, permissions, timestamps, confidence, and retention/expiration policies.

Memory must never bypass tenant or authorization boundaries.

### 3.14 AI Observability & Evaluation

Capture appropriate AI trace information:

- Trace ID
- Agent/version
- Prompt/instruction version where permitted
- Retrieved sources
- Tool calls/results metadata
- Model/provider
- Latency
- Token/cost information where available
- Guardrail decisions
- Escalation
- Final outcome

Quality metrics include AI Resolution Rate, Escalation Rate, Tool Failure Rate, Grounding/Citation Failure Rate, Response Time, Human Override Rate, Customer Satisfaction, and Cost per Resolution.

### 3.15 Audit Logging

```text
AuditLog
- id
- tenantId
- actorId
- action
- resourceType
- resourceId
- metadata
- ipAddress
- userAgent
- createdAt
```

Example events:

- USER_CREATED
- USER_ROLE_CHANGED
- USER_DISABLED
- TICKET_CREATED
- TICKET_ASSIGNED
- TICKET_UPDATED
- TICKET_DELETED
- AI_AGENT_CREATED
- AI_AGENT_UPDATED
- AI_AGENT_PUBLISHED
- AI_WORKFLOW_EXECUTED
- KNOWLEDGE_CREATED
- KNOWLEDGE_UPDATED
- INTEGRATION_CONNECTED
- PERMISSION_CHANGED

### 3.16 Integrations

Architecture should support Webhooks, Email, Slack, WhatsApp, CRM systems, generic REST APIs, tool integrations, and MCP-compatible tools where appropriate.

External providers must be isolated behind adapters/interfaces.

---

## 4. Non-Goals

V1 will not attempt to build:

- A full Salesforce replacement.
- A complete CRM suite.
- A full accounting/billing platform.
- A general autonomous AI-employee platform.
- A full visual no-code workflow builder.
- Dozens of communication channels simultaneously.
- A proprietary foundation model or custom model training platform.
- Unlimited long-term memory without retention controls.
- Fully autonomous high-risk financial/legal/administrative actions.
- Compliance certifications that have not actually been obtained.
- Every possible third-party integration.
- Native mobile apps unless later prioritized.

---

## 5. Technical Architecture

### Architecture Style

The backend uses NestJS + TypeScript with OOP, SOLID, Dependency Injection, Clean/Layered Architecture, modular domain boundaries, DTOs, validation, guards/interceptors/pipes, repository abstractions, and infrastructure adapters.

The initial architecture is a **modular monolith** with clear boundaries that can support future service extraction.

### Backend Direction

```text
backend/
├── modules/
│   ├── auth/
│   ├── tenants/
│   ├── users/
│   ├── roles/
│   ├── permissions/
│   ├── customers/
│   ├── tickets/
│   ├── conversations/
│   ├── inbox/
│   ├── knowledge/
│   ├── ai/
│   │   ├── agents/
│   │   ├── workflows/
│   │   ├── tools/
│   │   ├── guardrails/
│   │   ├── memory/
│   │   ├── evaluation/
│   │   ├── observability/
│   │   └── providers/
│   ├── integrations/
│   ├── notifications/
│   ├── analytics/
│   ├── audit/
│   └── billing/
├── common/
│   ├── database/
│   ├── errors/
│   ├── logging/
│   ├── validation/
│   ├── security/
│   └── events/
└── infrastructure/
    ├── prisma/
    ├── auth/
    ├── llm/
    ├── vector-store/
    └── queue/
```

### Frontend

- Next.js
- TypeScript
- React
- React Hook Form
- Zod
- Tailwind/component system
- TanStack Query
- Responsive web application

Navigation must be permission-aware.

### Data Layer

- PostgreSQL
- Prisma
- pgvector
- Redis
- BullMQ
- Object storage for uploaded knowledge assets where required

### AI Stack

- LangGraph for agent/workflow orchestration.
- LangChain where useful.
- LLM provider abstraction.
- Embedding provider abstraction.
- RAG and vector retrieval.
- Tool calling.
- Guardrails.
- AI evaluation.
- AI observability.

Potential providers include OpenAI, Anthropic, Groq, or other compatible providers; provider-specific code must remain behind interfaces/adapters.

### Testing

- Jest for unit tests.
- Supertest for API/integration tests.
- Cypress for E2E.
- AI evaluation datasets and regression tests for intent, retrieval, tool selection, citations, guardrails, and escalation.

### CI/CD

```text
Developer → Git Push → GitHub → CI
                         ├─ Lint
                         ├─ TypeScript
                         ├─ Unit Tests
                         ├─ Integration Tests
                         ├─ Build
                         ├─ Security Checks
                         └─ E2E
                              ↓
                            CD
                         ├─ Backend
                         ├─ Frontend
                         └─ Smoke Tests
                              ↓
                          Production
```

Initial infrastructure may use Docker, Vercel, Render, and GitHub Actions while keeping deployment interfaces portable.

### Engineering Loop

```text
BUILD → TEST → EVALUATE → DEPLOY → OBSERVE → IMPROVE → BUILD
```

This loop applies to both normal software engineering and AI-agent engineering.

---

## 6. Data & Analytics

### Data Sources

- Application logs
- Audit logs
- API telemetry
- User events
- Ticket/conversation events
- AI traces
- Retrieval events
- Tool execution events
- Workflow events
- Evaluation results
- Deployment/system health metrics

### Product KPIs

- Active tenants/users
- Ticket volume
- Resolution rate
- AI resolution rate
- Human escalation rate
- Average resolution time
- First response time
- Customer satisfaction
- Agent productivity
- Knowledge usage
- Workflow execution volume
- AI cost per resolution
- AI latency
- Tool failure rate
- Grounding/citation failure rate

### Engineering KPIs

- API error rate
- p50/p95/p99 latency
- Throughput
- Queue depth
- Background-job failure rate
- Test pass rate
- Deployment success rate
- Regression rate
- AI evaluation pass rate
- Security findings

### Monitoring

Provide dashboards for application health, API performance, queues/jobs, AI quality, AI cost, audit/security, and deployments. Alert on actionable error, latency, queue, provider, and AI-quality regressions.

---

## 7. UX & Design

### Brand Direction

**VELARIS**

**Positioning:** Enterprise AI Customer Operations Platform

**Working tagline:** **Intelligent customer operations, powered by AI.**

Visual direction should communicate enterprise trust, modern AI, operational clarity, security/governance, technical sophistication, and simplicity despite platform complexity.

### Navigation

#### Public

```text
/
├── Product
├── Solutions
├── Security
├── Pricing
├── Resources
└── Sign In / Start Free
```

#### Enterprise Administrator

```text
Dashboard
Tenants
Users
Roles & Permissions
AI Agents
Analytics
Audit Logs
Settings
```

#### Tenant Administrator

```text
Dashboard
Inbox
Tickets
Customers
AI Agents
Knowledge
Automation
Analytics
Integrations
Settings
```

#### Human Agent

```text
My Inbox
Assigned to Me
Tickets
Customers
AI Copilot
Knowledge
```

#### Customer

```text
My Tickets
New Request
Conversations
Profile
```

### Key Onboarding Flow

```text
Landing Page
  ↓
Sign Up
  ↓
Create Company
  ↓
Tenant Created
  ↓
Invite Agent
  ↓
Upload Knowledge
  ↓
Configure AI Agent
  ↓
Test Agent
  ↓
Publish
  ↓
Customer Conversation
  ↓
AI Resolution / Human Escalation
```

### Accessibility

Target WCAG 2.2 AA direction, including keyboard navigation, visible focus, semantic HTML, accessible forms/validation, appropriate contrast, screen-reader support for core workflows, and accessible loading/error/success states.

### Design References

No final Figma or visual reference is locked yet. Future UI work should first establish the VELARIS design system, information architecture, responsive behavior, component standards, and visual language.

---

## 8. Open Questions

1. Which authentication provider is the final production choice?
2. Which LLM providers are supported in V1?
3. Should V1 use PostgreSQL/pgvector only, with a dedicated vector database considered later?
4. Which communication channel is the first production channel beyond the web experience?
5. What subscription/billing model should VELARIS eventually use?
6. What tenant hierarchy is required for enterprises with multiple business units?
7. Should SSO/SAML be V1 or later?
8. What retention policies apply to conversations, AI traces, memory, and audit logs?
9. Which customer fields require encryption at rest or field-level protection?
10. Which AI actions require mandatory human approval?
11. Which evaluation thresholds should block agent deployment?
12. What SLA model should be supported?
13. Which integrations are required for the first marketable release?
14. What usage-metering model should be used for AI cost attribution?
15. Which enterprise compliance targets are relevant to the intended market?

---

## 9. Acceptance Criteria

### Functional

- New organization can sign up and establish a tenant.
- Authorized users can be managed.
- Roles map to permissions and are enforced server-side.
- Cross-tenant access is prevented.
- Customers can create conversations/tickets.
- Agents can receive, assign, update, and resolve tickets.
- Knowledge sources can be ingested and retrieved.
- AI agents can use authorized knowledge.
- Responses can include citations where applicable.
- AI can escalate to a human with context.
- Tool calls pass authorization and policy validation.
- Security-sensitive actions create audit events.
- AI executions create traceable observability data.
- Agent versions can be tested before publication.
- Critical workflows have automated tests.

### Automated Testing

- >=80% coverage target for core domain/application logic.
- Unit tests for business rules and authorization.
- Integration tests for critical APIs.
- Cypress tests for critical user journeys.
- AI regression tests for core agent behavior.
- CI fails on required test/build/type-check failures.

### Performance

- Fast non-AI API operations target p95 <200ms under defined test load.
- AI latency is measured separately because provider/model latency varies.
- Ingestion/embedding workloads are asynchronous.
- Performance reports document load assumptions.

### Security

- Authentication required for protected resources.
- Server-side authorization required.
- Tenant isolation tested.
- Sensitive administrative operations audited.
- Secrets excluded from source control.
- Input validation enforced.
- Rate limiting/throttling applied where appropriate.
- External tool execution constrained by permissions/policies.

### AI Quality

Before an agent is published:

- Evaluation suite passes thresholds.
- Required guardrails pass.
- Tool permissions are verified.
- Retrieval/citation behavior is tested.
- Escalation behavior is tested.
- Known failure cases are represented in regression tests.

### User Validation

Before production launch:

- Core onboarding is usability-tested.
- Human escalation is tested with representative scenarios.
- Agent workspace is evaluated with representative support tasks.
- AI quality is evaluated against a curated test set.
- Accessibility checks cover critical journeys.

---

## 10. Release Plan

### Development Strategy

The project will be rebuilt from scratch. The previous implementation is reference material only and must not constrain the new architecture.

### Phase 1 — Foundation

- Repository setup
- Project structure decision
- NestJS backend
- Next.js frontend
- TypeScript configuration
- Environment configuration
- Docker/development infrastructure
- PostgreSQL/Prisma
- Global validation/error handling
- Logging
- Base security conventions
- CI baseline

### Phase 2 — Identity, Tenancy & Governance

- Authentication
- Tenant model
- User model
- Roles
- Permissions
- RBAC
- Tenant isolation
- Enterprise administration
- Audit logging

### Phase 3 — Core Support

- Customers
- Conversations
- Tickets
- Assignment
- Inbox
- Ticket timeline
- Status/priority/routing
- Agent workspace

### Phase 4 — Knowledge

- Knowledge sources
- File/document ingestion
- Parsing
- Chunking
- Embeddings
- pgvector
- Retrieval
- Permission-aware retrieval
- Citations
- Knowledge UI

### Phase 5 — AI Platform

- Provider abstraction
- LangGraph foundation
- Intent detection
- RAG
- Tool calling
- Guardrails
- Human escalation
- AI memory foundation
- AI traces/observability
- AI evaluation

### Phase 6 — Agent Lifecycle

- Agent configuration
- Instructions
- Tools
- Policies
- Workflows
- Versioning
- Draft/Test/Publish
- Rollback
- Evaluation gates

### Phase 7 — AI Copilot & Operations

- Ticket summarization
- Suggested replies
- Knowledge suggestions
- Recommended next actions
- Translation
- Conversation analysis
- AI analytics
- Cost/latency monitoring

### Phase 8 — Integrations

- Webhooks
- Email
- Slack
- WhatsApp
- CRM
- Generic REST tools
- MCP-compatible tools where appropriate

### Phase 9 — Production Engineering

- GitHub Actions CI/CD
- Jest CI
- Cypress CI
- Build verification
- Docker
- Environment management
- Deployment
- Smoke tests
- Production monitoring
- Security hardening

### Phase 10 — Business Readiness

- Landing page
- Pricing architecture
- Signup/onboarding
- Usage metering
- AI usage/cost dashboard
- Business analytics
- Subscription architecture

### MVP Scope

1. Public landing page
2. Authentication
3. Tenant creation and isolation
4. Users/RBAC
5. Customers
6. Conversations/tickets
7. Human agent inbox
8. Knowledge ingestion/retrieval
9. One production-ready AI support agent
10. LangGraph orchestration
11. Guardrails
12. Human escalation
13. Citations
14. Audit logging
15. AI traces/evaluation
16. Core analytics
17. Automated tests
18. CI/CD

### Deferred Features

- Large integration catalog
- Native mobile apps
- Full visual workflow builder
- Advanced billing/subscription automation
- Complex enterprise SSO
- Extensive channel coverage
- Advanced long-term memory
- Large-scale microservice decomposition
- Proprietary model training

### Fresh Engineering Milestones

```text
R01  Product & repository foundation
R02  NestJS architecture
R03  Next.js application foundation
R04  Database & Prisma foundation
R05  Authentication
R06  Multi-tenancy
R07  RBAC & permissions
R08  Audit logging
R09  Enterprise management
R10  Customer model
R11  Conversations
R12  Tickets
R13  Agent inbox
R14  Knowledge sources
R15  Document ingestion
R16  Embeddings & pgvector
R17  Retrieval & citations
R18  AI provider abstraction
R19  LangGraph foundation
R20  AI intent & routing
R21  AI RAG
R22  AI tools
R23  Guardrails
R24  Human escalation
R25  AI memory
R26  AI observability
R27  AI evaluation
R28  Agent configuration
R29  Agent versioning
R30  AI workflows
R31  Draft/Test/Publish lifecycle
R32  AI copilot
R33  Analytics
R34  Integrations
R35  CI/CD
R36  Production hardening
R37  Landing page
R38  Onboarding
R39  Business readiness
R40  MVP release
```

### Definition of Done

A milestone is complete only when:

1. Requirements are implemented.
2. Relevant unit/integration/E2E tests exist.
3. Authorization and tenant isolation are verified where applicable.
4. Error and edge cases are handled.
5. Logging/observability is sufficient.
6. Documentation is updated.
7. CI passes.
8. The feature is demonstrable through its intended workflow.
9. Security implications have been reviewed.
10. The next milestone can build on a stable baseline.

---

## Product Direction Summary

VELARIS is an **enterprise AI customer-operations platform**, not merely an AI chatbot or ticketing application.

Core architectural themes:

- Multi-tenant SaaS
- Enterprise RBAC
- Governed AI agents
- LangGraph orchestration
- RAG and permission-aware knowledge
- Tool/action execution
- Human-in-the-loop
- AI memory
- AI evaluation
- AI observability
- Auditability
- Workflow automation
- Developer/integration platform
- Continuous engineering and AI improvement loop

**Confirmed product name: VELARIS.**

---

# PRD v1.1 — Reviewed Requirements Addendum

This addendum incorporates the requirements identified during the PRD review. It supplements the original sections without changing the confirmed VELARIS product direction.

## 11. Product Definition Clarifications

### 11.1 Product Boundary

VELARIS is an **enterprise AI customer-operations platform**. The product boundary is the combination of:

- Human customer-support operations.
- Governed AI agents.
- Permission-aware knowledge and RAG.
- Controlled tools/actions.
- Human escalation.
- AI evaluation and observability.
- Auditability and enterprise governance.
- Workflow automation.
- Developer/integration capabilities.

VELARIS is not positioned as a generic chatbot, a complete CRM, or an unrestricted autonomous-agent platform.

### 11.2 Product Differentiation Principle

The central architectural/product principle is:

> **AI automation with deterministic enterprise governance.**

AI may recommend, reason, retrieve, classify, summarize, and propose actions. Deterministic application code remains responsible for authorization, tenant isolation, business rules, policy enforcement, and execution of consequential actions.

## 12. Tenant Model & Enterprise Hierarchy

### 12.1 V1 Hierarchy

The initial model is:

```text
VELARIS Platform
└── Enterprise Organization
    ├── Tenant / Company A
    │   ├── Users
    │   ├── Customers
    │   ├── Conversations
    │   ├── Tickets
    │   ├── Knowledge
    │   ├── AI Agents
    │   └── Integrations
    └── Tenant / Company B
```

The **Tenant / Company** is the primary data-isolation boundary in V1.

Enterprise-level administration may manage multiple tenants only through explicit platform permissions. Tenant administrators cannot access another tenant's resources.

### 12.2 Tenant Isolation Requirements

- Every tenant-owned entity contains an explicit tenant scope.
- Tenant scope is enforced server-side.
- Repository/service methods must require tenant context for tenant-owned resources.
- Background jobs must carry tenant context.
- Cache keys must include tenant scope.
- Vector retrieval must filter by tenant and authorization scope.
- File/object storage paths must include tenant scope.
- Cross-tenant access tests are mandatory.
- Tenant disablement must prevent new business operations while allowing defined cleanup/background behavior.

Future business-unit or nested-tenant support must be introduced through an explicit architecture decision rather than assumed implicitly.

## 13. Authentication & Identity Requirements

The final authentication provider remains an ADR decision. The product requirement is provider independence at the application/domain layer.

The identity architecture must support:

- Secure sign-in/session management.
- Account recovery and verification where applicable.
- Session/token revocation.
- Tenant membership.
- User status such as active/disabled.
- Role/permission resolution.
- Optional OAuth/social authentication.
- Future OIDC/SAML/enterprise SSO.
- Authentication security events and auditability.
- Rate limiting and abuse protection.

### 13.1 Provider Decision Criteria

The selected provider should be evaluated against:

1. Security maturity.
2. NestJS/TypeScript compatibility.
3. Organization/tenant support.
4. Session management quality.
5. SSO/OIDC/SAML roadmap.
6. Operational cost.
7. Local development experience.
8. Vendor lock-in.
9. Migration/export options.
10. Ability to keep domain authorization provider-independent.

## 14. Ticket Domain Specification

### 14.1 Conversation and Ticket Separation

A **Conversation** is the communication history. A **Ticket** is the operational work item.

A conversation may exist without a ticket. A ticket may be associated with a primary conversation and, in later versions, related conversations.

### 14.2 Initial Ticket States

```text
NEW
OPEN
PENDING_CUSTOMER
PENDING_INTERNAL
RESOLVED
CLOSED
```

Initial valid transitions:

```text
NEW → OPEN
OPEN → PENDING_CUSTOMER
OPEN → PENDING_INTERNAL
OPEN → RESOLVED
PENDING_CUSTOMER → OPEN
PENDING_INTERNAL → OPEN
RESOLVED → OPEN
RESOLVED → CLOSED
```

Invalid transitions are rejected by domain logic.

### 14.3 Ticket Rules

- Tickets are tenant-scoped.
- Assignment is tenant-scoped.
- Assignment/reassignment requires permission.
- Resolution and closure require appropriate permission.
- Reopen behavior is policy-driven and audited.
- Closed tickets are immutable except for explicitly permitted administrative actions.
- Customer-visible messages and internal notes are different message types.
- Internal notes must never be exposed through customer-facing APIs.
- Ticket priority and SLA state are separate concepts.
- Ticket timelines preserve important status, assignment, message, AI, and audit events.
- Retryable external events must be idempotent.
- Concurrent updates must use optimistic concurrency/version checks where necessary.

### 14.4 Merge / Split

Merge and split are not required for the first MVP workflow, but the domain model must not make them impossible.

If implemented:

- Original records remain traceable.
- Relationships are auditable.
- Customer-visible history is preserved.
- AI context is recalculated safely after the operation.

### 14.5 SLA

The ticket domain should support a configurable SLA foundation:

- First-response SLA.
- Resolution SLA.
- Business-hours calendar.
- Pause conditions.
- Breach state.
- Escalation event.

Complex enterprise SLA policies may remain post-MVP.

## 15. AI Agent Configuration Requirements

The AI Agent management experience should expose a clear lifecycle rather than a collection of disconnected settings.

### 15.1 Agent Navigation

```text
AI Agent
├── Overview
├── Instructions
├── Knowledge
├── Tools & Actions
├── Guardrails
├── Permissions
├── Workflows
├── Evaluation
├── Versions
└── Observability
```

### 15.2 Agent Overview

Show:

- Name and description.
- Draft/Testing/Published/Disabled status.
- Current version.
- Knowledge sources.
- Enabled tools.
- Last evaluation result.
- Recent usage.
- Last published time.
- Owner.

### 15.3 Instructions

Support configuration of:

- Role/purpose.
- Scope of responsibility.
- Tone/style.
- Required response behavior.
- Escalation rules.
- Citation requirements.
- Forbidden behaviors.

Instruction changes are versioned and evaluated.

### 15.4 Tools & Actions

Every tool has:

- Name.
- Description.
- Input schema.
- Output schema.
- Required permission.
- Allowed agents.
- Risk level.
- Approval requirement.
- Timeout/retry policy.
- Audit behavior.

### 15.5 Agent Permissions

Agent permissions are distinct from human RBAC. An AI agent receives only explicitly granted capabilities. Application authorization still runs at execution time.

### 15.6 Agent Versioning

Published versions are immutable. Configuration changes create a new draft/version.

```text
Draft
 ↓
Test
 ↓
Evaluate
 ↓
Publish
 ↓
Observe
 ↓
Improve
 ↓
New Version
```

Rollback must restore a previously published version without deleting the historical record.

## 16. AI Evaluation Specification

AI evaluation is a release-control mechanism, not only an analytics feature.

### 16.1 Evaluation Categories

Evaluation datasets should cover:

- Intent classification.
- Knowledge retrieval.
- Grounded response generation.
- Citation correctness.
- Tool selection.
- Tool argument/schema correctness.
- Guardrail behavior.
- Escalation behavior.
- Refusal/abstention behavior.
- Out-of-scope requests.
- Adversarial/safety cases.

### 16.2 Evaluation Case Model

An evaluation case should define expected behavior rather than relying only on exact text matching.

Conceptual result:

```text
PASS
FAIL
PARTIAL
NOT_APPLICABLE
```

Each run records:

- Dataset version.
- Agent version.
- Model/provider.
- Evaluation timestamp.
- Individual case results.
- Aggregate results.
- Failure reasons.

### 16.3 Deployment Gates

A production release should be blocked when:

- A critical guardrail test fails.
- Unauthorized tool execution is detected.
- Required retrieval/citation quality is below threshold.
- Required escalation behavior is below threshold.
- Protected regression cases fail.
- The configured overall quality threshold is not met.

Thresholds are to be established from representative test data rather than arbitrary scores.

## 17. AI Provider Strategy

VELARIS uses a provider abstraction so agent/business logic is not tied to one model vendor.

The provider layer should support:

- Primary model/provider.
- Optional fallback provider/model.
- Capability metadata.
- Timeout/retry policy.
- Rate-limit handling.
- Provider outage handling.
- Token/usage metadata where available.
- Cost metadata where available.
- Model/version traceability.
- Provider-specific adapters.

Provider fallback must not silently bypass safety, authorization, or evaluation requirements.

## 18. API Contract Standards

The API contract should be standardized before large feature development.

### 18.1 REST

- Resource-oriented plural nouns.
- HTTP methods represent operation semantics.
- Initial API version: `/api/v1`.
- OpenAPI documentation is generated and maintained.
- Breaking changes require versioning or an explicit migration strategy.

### 18.2 Collection APIs

Standardize:

- Pagination.
- Filtering.
- Sorting.
- Search.
- Maximum page size.
- Deterministic ordering.

Cursor pagination may be introduced for high-volume feeds where page/limit is insufficient.

### 18.3 Error Contract

Errors should consistently provide, where applicable:

- HTTP status.
- Machine-readable error code.
- Human-readable message.
- Validation details.
- Correlation/request ID.

Internal stack traces and secrets must never be returned to clients.

### 18.4 Idempotency

Idempotency is required for operations likely to be retried, including applicable:

- Webhook processing.
- Provider callbacks.
- Queue jobs.
- External action requests.
- Payment/billing operations if introduced later.

### 18.5 Correlation IDs

A request correlation ID must propagate through:

```text
HTTP Request
 ↓
Application Logs
 ↓
Background Job / Event
 ↓
AI Trace where applicable
 ↓
Audit Event where applicable
```

### 18.6 Rate Limiting

Rate limits should be defined by endpoint/resource category and may vary by tenant plan or risk level in the future.

## 19. Data Retention & Lifecycle

Retention policies must be explicit by data category.

| Data Category | Direction |
|---|---|
| Conversations/messages | Tenant-configurable retention within platform constraints |
| Tickets | Tenant-configurable retention within business/legal constraints |
| AI traces | Short operational retention by default; configurable where justified |
| AI memory | Explicit opt-in plus expiration/retention policy |
| Knowledge source files | Retained while active, subject to deletion policy |
| Embeddings | Deleted/rebuilt with source lifecycle |
| Audit logs | Longer, restricted, append-oriented retention |
| Application logs | Short operational retention with sensitive-data minimization |
| Evaluation datasets/results | Retained according to evaluation/governance requirements |

Requirements:

- Expired/deleted knowledge must not remain retrievable.
- Memory expiration must prevent stale facts from being reused.
- Derived data deletion must be considered when source data is deleted.
- Audit history must not be rewritten to hide actions.
- Logs/traces must minimize sensitive customer data.
- Tenant administrators should be able to understand applicable retention settings.

## 20. Billing Architecture — Future Scope

Billing is intentionally not an MVP product capability, but the architecture should leave room for:

- Subscription plans.
- Tenant entitlements.
- Seat limits.
- AI usage metering.
- Model/token cost attribution.
- Feature flags.
- Usage quotas.
- External billing-provider integration.

No production pricing, subscription behavior, or billing certification should be implied until the commercial model is approved.

## 21. Product Metrics & Measurement Rules

Every KPI should document:

- Name.
- Definition/formula.
- Population.
- Time period.
- Tenant scope.
- Source event/data.
- Refresh frequency.
- Owner.
- Known limitations.

### Initial KPI Families

**Customer outcomes**
- First response time.
- Resolution time.
- Customer satisfaction.
- Resolution rate.

**AI outcomes**
- AI resolution rate.
- Escalation rate.
- Human override rate.
- Grounding/citation failure rate.
- Tool failure rate.
- Cost per resolution.

**Platform health**
- API error rate.
- p50/p95/p99 latency.
- Queue depth.
- Background-job failure rate.
- Provider failure rate.

**Governance**
- Unauthorized-action attempts.
- Guardrail failure rate.
- Audit-event completeness.
- Tenant-isolation test status.

The product must establish baselines before using percentage-improvement claims.

## 22. Required Architecture Decision Records

The following ADRs should be completed before dependent milestones:

```text
ADR-001 NestJS / modular-monolith architecture
ADR-002 Multi-tenancy and tenant isolation
ADR-003 Authentication / identity provider
ADR-004 Authorization / RBAC model
ADR-005 LLM provider abstraction and fallback
ADR-006 Vector storage / pgvector strategy
ADR-007 Ticket state and SLA model
ADR-008 API conventions and versioning
ADR-009 Data retention and deletion
ADR-010 AI evaluation and deployment gates
```

Each ADR must document context, options, decision, rationale, consequences, and revisit conditions.

## 23. Updated MVP Exit Criteria

The MVP is complete only when the following end-to-end workflow is demonstrable:

```text
Visitor
 ↓
Sign Up
 ↓
Create Company / Tenant
 ↓
Invite Agent
 ↓
Upload Knowledge
 ↓
Configure AI Agent
 ↓
Test + Evaluate
 ↓
Publish
 ↓
Customer asks question
 ↓
AI retrieves authorized knowledge
 ↓
Grounded response + citation
 ↓
Customer requests sensitive action
 ↓
Permission + policy validation
 ↓
Human approval when required
 ↓
Ticket / action execution
 ↓
Agent receives full context
 ↓
Agent resolves
 ↓
Audit Log + AI Trace
 ↓
Analytics
```

MVP exit also requires:

- Tenant-isolation tests pass.
- Core authorization tests pass.
- Critical API contracts are documented.
- Critical ticket transitions are tested.
- AI evaluation gates are enforced before publishing.
- Retention behavior is documented for MVP data classes.
- Critical user journeys pass E2E tests.
- CI is green.
- Production smoke tests pass.

## 24. Updated Implementation Sequence

The recommended implementation sequence is:

```text
Product Requirements
  ↓
Tenant Model
  ↓
Identity / RBAC
  ↓
Core Support Domain
  ↓
API Contract
  ↓
Knowledge Domain
  ↓
AI Agent Model
  ↓
Agent Lifecycle
  ↓
AI Evaluation / Governance
  ↓
UX Refinement
  ↓
Production Hardening
```

This sequence deliberately prevents deep AI implementation before the underlying tenant, identity, domain, and API boundaries are stable.

## 25. Review Status

The PRD has been reviewed against product positioning, personas, core functions, page inventory, user flows, domain requirements, AI lifecycle, governance, and engineering readiness.

The review identified and this version addresses:

- Product metric definitions and baseline requirements.
- Tenant hierarchy and isolation rules.
- Authentication decision requirements.
- LLM provider/fallback requirements.
- Detailed ticket states, transitions, SLA, assignment, concurrency, and message visibility.
- AI-agent configuration and management UX.
- Concrete AI evaluation and release-gate requirements.
- Future billing architecture without expanding MVP scope.
- Formal data retention and lifecycle requirements.
- API conventions, versioning, pagination, filtering, sorting, error handling, idempotency, correlation IDs, OpenAPI, and rate limits.
- Complete role-based page inventory and core product flows.
- Architecture decision records and an implementation dependency sequence.

These additions are requirements and design constraints for future implementation; detailed implementation choices belong in the supporting architecture/ADR documents.
