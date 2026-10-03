# VELARIS — Page Structure & Interaction Design Specification

**Document Version:** 1.2 (Reviewed Requirements Integrated)  
**Product:** VELARIS Enterprise AI Customer Operations Platform  
**Phase:** Page Structure & Interaction Design Phase  
**Status:** Approved Architectural Baseline  

---

## 1. Executive Summary & Design Principles

### 1.1 Overview
VELARIS is an enterprise-grade multi-tenant customer operations platform combining human support workflows with governed AI agents, RAG knowledge retrieval, schema-driven workflows, and real-time observability. 

This document defines the **Information Architecture (IA)**, **Page Structures**, **Layout Specifications**, **Role-Based Access Maps**, **State Machines**, and **Interaction Design Patterns** across all 5 operational surfaces:
1. **Public Marketing SaaS Site** (`/`) — *Referencing MotionSites.ai & Viio-Astro*
2. **Enterprise Admin Console** (`/admin/*`)
3. **Tenant Admin Workspace / Studio** (`/app/*`)
4. **Human Support Agent Workspace** (`/agent/*`)
5. **Customer Self-Service Portal** (`/portal/*`)

---

### 1.2 Core Design Principles

1. **Deterministic Governance Over AI Autonomy**  
   AI models recommend, classify, summarize, and draft. Deterministic application code strictly enforces multi-tenancy, RBAC authorization, policy validation, human approvals, and consequential tool execution.
2. **Role-Tailored Operational Density**  
   - *Support Agents:* High-density 3-column operational layout with immediate copilot access and timeline context.
   - *Tenant Admins:* Structured configuration cards, schema builders, evaluation test benches, and retention controls.
   - *Enterprise Admins:* Clean multi-tenant compliance tables, global audit streams, and governance tools.
   - *Customers:* Frictionless, low-cognitive-load conversational threads with instant deflection widgets.
3. **Transparent Escalation & Contextual Handoff**  
   Every AI-to-human transition displays explicit handoff reasons, full conversation timeline, AI traces, grounding metrics, and recommended next steps.
4. **Zero Cross-Tenant Leakage UI Boundary**  
   Contextual topbars display active Tenant, User, and Permission scopes. Switching tenants triggers immediate client state and cache cleanup.
5. **Accessibility & Micro-Interaction Standards (WCAG 2.2 AA)**  
   Keyboard-first navigation, screen-reader live regions for streaming AI responses, high-contrast indicators, and zero layout shift.

---

### 1.3 Product Boundary & Operational Principles

```text
  Customer Request / UI Input
              │
              ▼
   [ Application Middleware ] ─── (Tenant Context & Authentication)
              │
              ▼
    [ Deterministic RBAC ]   ─── (Permission Check: ticket.read / ai.agent.execute)
              │
              ▼
    [ AI Engine (LangGraph) ] ─── (Prompt, RAG Retrieval, Intent Detection)
              │
              ▼
    [ Policy & Guardrails ]  ─── (Deterministic Rule Engine & Tool Schema Check)
              │
              ├──────────────────────────────────┐
              │ Safe & Grounded                  │ Requires Approval / Low Grounding
              ▼                                  ▼
      [ Execute / Respond ]            [ Escalate to Human Workspace ]
```

---

## 2. Global Information Architecture & Sitemap

```text
VELARIS Platform
│
├── Public SaaS (Guest) [/] (Motion & Bento Reference Architecture)
│   ├── Landing Page [/]
│   ├── Product Showcase [/product]
│   ├── Solutions [/solutions]
│   ├── Enterprise Security [/security]
│   ├── Pricing [/pricing]
│   ├── Resources & Docs [/resources]
│   ├── Sign In [/auth/signin]
│   └── Onboarding / Sign Up [/auth/signup]
│
├── Enterprise Admin Console [/admin]
│   ├── Dashboard [/admin/dashboard]
│   ├── Tenants Management [/admin/tenants]
│   ├── User Management [/admin/users]
│   ├── Roles & Permissions [/admin/roles]
│   ├── Platform AI Governance [/admin/ai-agents]
│   ├── Platform Analytics [/admin/analytics]
│   ├── Global Audit Logs [/admin/audit-logs]
│   └── Platform Settings [/admin/settings]
│
├── Tenant Admin Workspace [/app]
│   ├── Dashboard [/app/dashboard]
│   ├── Inbox / Overview [/app/inbox]
│   ├── Tickets [/app/tickets]
│   ├── Customers [/app/customers]
│   ├── AI Agent Studio [/app/ai-agents]
│   │   ├── Overview [/app/ai-agents/[id]/overview]
│   │   ├── Instructions [/app/ai-agents/[id]/instructions]
│   │   ├── Knowledge [/app/ai-agents/[id]/knowledge]
│   │   ├── Tools & Actions [/app/ai-agents/[id]/tools]
│   │   ├── Guardrails [/app/ai-agents/[id]/guardrails]
│   │   ├── Permissions [/app/ai-agents/[id]/permissions]
│   │   ├── Workflows [/app/ai-agents/[id]/workflows]
│   │   ├── Evaluation Sandbox [/app/ai-agents/[id]/evaluation]
│   │   ├── Version Control [/app/ai-agents/[id]/versions]
│   │   └── Observability & Traces [/app/ai-agents/[id]/observability]
│   ├── Knowledge Base [/app/knowledge]
│   │   ├── Ingestion Sources [/app/knowledge/sources]
│   │   ├── Ingestion Status [/app/knowledge/status]
│   │   └── Retrieval Test Bench [/app/knowledge/test-bench]
│   ├── Workflows & Automation [/app/automation]
│   ├── Analytics & Reports [/app/analytics]
│   ├── Integrations [/app/integrations]
│   └── Tenant Settings [/app/settings]
│       └── Retention & Privacy Policy [/app/settings/retention]
│
├── Human Support Agent Workspace [/agent]
│   ├── My Inbox [/agent/inbox]
│   ├── Assigned to Me [/agent/assigned]
│   ├── Ticket Workspace [/agent/tickets/[id]] (3-Column View)
│   ├── Customer Directory [/agent/customers]
│   └── Knowledge Search [/agent/knowledge]
│
└── Customer Self-Service Portal [/portal]
    ├── My Support Dashboard [/portal/dashboard]
    ├── My Tickets [/portal/tickets]
    ├── Create New Request [/portal/tickets/new]
    ├── Conversation View [/portal/conversations/[id]]
    └── User Profile & Security [/portal/profile]
```

---

### 2.1 Access Control & Navigation Matrix

| Surface / Route | ENTERPRISE | ADMIN (Tenant) | AGENT | USER (Customer) | Required Permissions |
|---|---|---|---|---|---|
| `/admin/*` | **Full Access** | Denied | Denied | Denied | `tenant.manage`, `audit.read` |
| `/app/dashboard` | Read Only | **Full Access** | Denied | Denied | `tenant.read` |
| `/app/ai-agents/*` | Read Only | **Full Access** | Denied | Denied | `ai.agent.read`, `ai.agent.update`, `ai.agent.deploy` |
| `/app/knowledge/*` | Read Only | **Full Access** | Read Only | Denied | `knowledge.read`, `knowledge.ingest` |
| `/agent/*` | Denied | Read/Execute | **Full Access** | Denied | `ticket.read`, `ticket.update`, `ticket.assign` |
| `/portal/*` | Denied | Denied | Denied | **Full Access** | `ticket.create.own`, `ticket.read.own` |

---

## 3. Surface Specifications & Layout Structures

### 3.1 Surface 1: Public SaaS Website (`/`)
* **Design References:** MotionSites.ai (High-performance micro-animations & glassmorphism) & sijad/viio-astro (Bento box component layouts & modern AI SaaS aesthetics).
* **Theme:** Dark mode baseline (`#090D16` deep void) with indigo/cyan radial gradient ambient light accents (`indigo-500/15` glow), backdrop blur panels, and sleek metallic borders.

#### 3.1.1 Landing Page Bento Architecture

```text
+---------------------------------------------------------------------------------------+
| [STATIONARY GLASS NAVBAR] Logo: VELARIS  Product Solutions Security Pricing  [Sign In] [Start Free] |
+---------------------------------------------------------------------------------------+
|                                                                                       |
| HERO SECTION (Motion-enhanced)                                                        |
| Tagline Badge: [✦ Next-Gen Customer Operations]                                       |
| Headline: Intelligent Customer Operations, Powered by AI.                             |
| Subheadline: Seamlessly integrate governed AI agents, permission-aware RAG,           |
|              and human support teams on one auditable enterprise platform.             |
| CTAs: [Start Free Trial ->]  [View Interactive Demo ▷]                                 |
|                                                                                       |
| INTERACTIVE DEMO SHOWCASE WIDGET                                                      |
| Left Panel: Simulated Customer Query  | Right Panel: Live VELARIS Execution Engine    |
| - "I need a refund for Order #9182"   | - Grounding Confidence Score: 94% (PASS)      |
| - AI streaming answer + Citation      | - Policy Check: Allowed (Within $50 threshold)|
| - Instant Tool Execution Card         | - Trace ID: trc_8492019 (Audited)             |
|                                                                                       |
+---------------------------------------------------------------------------------------+
| FEATURE BENTO GRID (Inspired by Viio-Astro & MotionSites)                             |
| +---------------------------------------------------+-------------------------------+ |
| | CARD 1 (2-Col): Governed AI Support Agent         | CARD 2 (1-Col): RAG Knowledge | |
| | - Interactive Guardrail Simulator                 | - Node graph visual of vector | |
| | - Dynamic System Prompt editor preview            |   document chunk retrieval    | |
| +---------------------------------------------------+-------------------------------+ |
| | CARD 3 (1-Col): Transparent Human Handoff         | CARD 4 (2-Col): Observability | |
| | - Auto-escalation trigger visual showing          | - Interactive trace timeline  | |
| |   confidence score drop -> Agent queue            |   with latency & token metrics| |
| +---------------------------------------------------+-------------------------------+ |
|                                                                                       |
+---------------------------------------------------------------------------------------+
| LIVE ROI & RESOLUTION CALCULATOR WIDGET                                               |
| Slider: Monthly Support Ticket Volume [ 10,000 tickets/mo ]                           |
| Real-time Output: ~78% AI Resolution Rate | $14,200/mo Savings | 420 Agent Hours Saved  |
+---------------------------------------------------------------------------------------+
```

---

### 3.2 Surface 2: Enterprise Admin Console (`/admin/*`)
* **Role Requirement:** `ENTERPRISE` role.
* **Layout Grid:** Two-column App Layout (Fixed 240px Left Navigation + Fluid Topbar & Main Canvas).

#### Core Pages:
1. **Tenants Management (`/admin/tenants`):**
   - *Header:* Search bar, Tenant Status Filter (`Active`, `Disabled`, `Onboarding`), `+ Create Tenant` primary button.
   - *Data Table:* Tenant Name, Domain, Status Badge, Plan, Active Users, Monthly Ticket Volume, Created Date, Actions (`Manage`, `Disable`, `Audit Logs`).
2. **Global Audit Logs (`/admin/audit-logs`):**
   - *Filters:* Date Range, Tenant Picker, Actor ID, Event Type (`USER_CREATED`, `PERMISSION_CHANGED`, `AI_AGENT_PUBLISHED`), Severity.
   - *Log Stream:* Timestamp, Correlation ID, Tenant, Actor, Action Badge, Target Resource, JSON Metadata Inspector drawer.

---

### 3.3 Surface 3: Tenant Admin Workspace & AI Studio (`/app/*`)
* **Role Requirement:** `ADMIN` role within the active tenant context.
* **Layout Grid:** Left Nav Bar + Sub-navigation (for AI Studio) + Header + Content Area.

#### AI Agent Studio 10-Tab Navigation (`/app/ai-agents/[id]`)

```text
+-----------------------------------------------------------------------------------+
| Agent: Customer Support Agent v1.2 (STATUS: Published) | [Test Sandbox] [Publish Draft] |
+-----------------------------------------------------------------------------------+
| [Overview] [Instructions] [Knowledge] [Tools] [Guardrails] [Permissions]           |
| [Workflows] [Evaluation] [Versions] [Observability]                               |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  LEFT PANEL: Prompt & Guardrail Editor       | RIGHT PANEL: Real-time Test Sandbox   |
|  - System Prompt textarea                    | - Conversation simulator              |
|  - Grounding confidence threshold (0.75)     | - Grounding debug inspector           |
|  - Required citation enforcement             | - Tool execution preview & traces     |
|  - Escalation rule triggers                  | - Latency & token telemetry           |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

### 3.4 Surface 4: Human Support Agent Workspace (`/agent/*`)
* **Role Requirement:** `AGENT` or `ADMIN` role.
* **Layout Structure:** High-density 3-Column Split View.

```text
+---------------------------------------------------------------------------------------+
| VELARIS Agent Hub | Active Tenant: Acme Corp | Status: Online  | [Search Cmd+K]       |
+---------------------------------------------------------------------------------------+
| COL 1: Ticket Queue (300px) | COL 2: Active Ticket Thread (Fluid) | COL 3: AI Copilot (340px)|
|-----------------------------+-------------------------------------+-------------------|
| [Filter: Assigned to Me v]  | Header: #TK-8492 - Order Refund     | AI SUMMARY        |
| Search tickets...           | Customer: Sarah Jenkins (VIP)       | "Customer requests|
|                             | Tags: [Billing] [Escalated-AI]      | refund for late   |
| > TK-8492 Sarah J. 2m ago   |-------------------------------------| delivery #8942."  |
|   "Requesting refund..."    | Timeline:                           |-------------------|
|   [VIP] [Pending Agent]     | 10:14 AI Agent: Processed order...  | SUGGESTED REPLY   |
|                             | 10:15 Escalation: Low grounding.    | [Insert & Edit]   |
|   TK-8490 Alex M.  15m ago   | 10:16 System: Assigned to Jane.     | "Hi Sarah, I see  |
|   "Unable to reset..."      |-------------------------------------| your order was..."|
|                             | Customer Message: "I need refund."  |-------------------|
|                             |-------------------------------------| GROUNDED CITATIONS|
|                             | Reply Box:                          | - Policy: Refund  |
|                             | [ Public Reply | INTERNAL NOTE ]    |   Section 4.2 [88%]|
|                             | [Send & Mark Resolved            v] | - SLA Policy      |
|                             |                                     |-------------------|
|                             |                                     | RECOMMENDED ACTION|
|                             |                                     | [Execute Refund Tool]|
+---------------------------------------------------------------------------------------+
```

---

### 3.5 Surface 5: Customer Self-Service Portal (`/portal/*`)
* **Role Requirement:** `USER` (Customer) role.
* **Layout Structure:** Single-column centered container (Max-width 960px).

#### Core Pages:
1. **New Request (`/portal/tickets/new`):**
   - Form fields: Subject, Category select, Description, Attachment upload.
   - **Instant AI Deflection Widget:** Real-time RAG suggestions presented before submission.
2. **Conversation View (`/portal/conversations/[id]`):**
   - Clean chat thread with visual distinction between AI Support Assistant and Human Agent.
   - Persistent `[ Request Human Agent ]` button.

---

### 3.6 Ticket State Machine & Visibility Rules

#### State Transition Diagram
```text
        ┌────────────────────────────────────────────────────────┐
        │                                                        │
        ▼                                                        │
    [  NEW  ] ──> [  OPEN  ] ───┬──> [ PENDING_CUSTOMER ] ──> [ OPEN ]
                     │          │                                │
                     │          └──> [ PENDING_INTERNAL ] ──> [ OPEN ]
                     ▼                                           │
              [ RESOLVED ] <─────────────────────────────────────┘
                     │
                     ▼
              [  CLOSED  ] (Immutable except for audited admin action)
```

#### Message Visibility & Concurrency Rules:
- **Public Customer Messages:** Light neutral card background. Dispatched to customer socket feed.
- **Internal Notes (`INTERNAL_NOTE`):** Distinct amber accent background (`bg-amber-500/10 border-amber-500/30`) with clear `INTERNAL NOTE — Invisible to Customer` banner. Code enforces zero customer socket emission.
- **Optimistic Concurrency Control:** Ticket edits send `version` key; conflicts trigger a banner: *"Ticket updated by Jane Doe — Click to refresh."*
- **SLA Breach Indicators:** Red countdown timer pill (`SLA Breach in 14m` / `SLA Breached 2m ago`).

---

### 3.7 API Contract, Correlation & Standardized Error UI

Every API response returns standard error headers and payload formats. The UI handles errors gracefully:

```json
{
  "statusCode": 422,
  "errorCode": "ERR_GUARDRAIL_VIOLATION",
  "message": "AI action blocked by policy: Tool requires human approval.",
  "correlationId": "trc_9401829104",
  "timestamp": "2026-09-24T03:00:00Z"
}
```

#### Error Toast & Banner Design:
- **Red Alert Banner:** Displays `message` and machine-readable `errorCode`.
- **Developer Debug Drawer:** Expandable section displaying `correlationId` with a `Copy Correlation ID` button.
- **Idempotency Status Badge:** Indicates whether a retried request was safely de-duplicated (`Idempotency Key Validated`).

---

### 3.8 Data Retention & Privacy Settings UI (`/app/settings/retention`)

Tenant Administrators can configure data retention and deletion lifecycles:

| Data Category | Configurable Range | Default Policy | Deletion Action |
|---|---|---|---|
| **Conversations & Messages** | 30 Days – 7 Years | 365 Days | Soft delete then purge |
| **Tickets** | 90 Days – Permanent | Permanent | Hard delete with audit record |
| **AI Traces & Logs** | 7 Days – 90 Days | 30 Days | Automated database cleanup job |
| **AI Memory Context** | 1 Hour – 30 Days | 7 Days | Expire & delete vector chunks |
| **Knowledge Documents** | Manual / On Source Delete | Active | Immediate vector cascade delete |
| **Audit Logs** | 1 Year – Permanent | 7 Years | Restricted append-only storage |

---

## 4. Key User Interaction Flows & State Transitions

### 4.1 Flow 1: Onboarding & Tenant Setup

```text
[Landing Page] --Click "Start Free"--> [Sign Up / Auth]
                                             │
                                     (Create Account)
                                             │
                                             ▼
                                   [Create Tenant Screen]
                                   (Company Name, Domain)
                                             │
                                     (Tenant Provisioned)
                                             │
                                             ▼
                                   [Onboarding Checklist]
                                   ├── 1. Invite Team Members
                                   ├── 2. Upload Knowledge (PDF/Web)
                                   ├── 3. Configure AI Agent
                                   └── 4. Test & Publish Agent
```

---

### 4.2 Flow 2: Ticket Escalation & AI-to-Human Handoff

```text
[Customer sends message] ──> [AI Agent Engine]
                                   │
                           (Grounding Check)
                                   │
               ┌───────────────────┴───────────────────┐
               │ Grounding >= 0.75                     │ Grounding < 0.75 OR Policy Triggers
               ▼                                       ▼
     [AI Responds & Cites]                    [Trigger Escalation Engine]
               │                                       │
     (Customer Satisfied?)                    (Generate Ticket & AI Summary)
       │              │                                │
      YES            NO ("Talk to human")              ▼
       │              │                       [Assign to Agent Queue]
       ▼              └───────────────────────────────>│
   [Resolved]                                          ▼
                                            [Agent Inbox Notification]
                                                       │
                                                       ▼
                                            [Agent Opens Workspace]
                                            - Views Handoff Summary
                                            - Inspects AI Trace
                                            - Uses Suggested Reply
                                                       │
                                                       ▼
                                            [Agent Resolves Ticket]
```

---

### 4.3 Flow 3: AI Agent Evaluation & Gated Publishing

```text
[Admin Edits Agent Prompt/Tools] ──> [Saved as Draft v1.3-draft]
                                                │
                                                ▼
                                     [Run Evaluation Suite]
                                     (Runs 50 Standard Test Cases)
                                                │
                                    ┌───────────┴───────────┐
                                    │                       │
                             [Score >= 90%]           [Score < 90%]
                                    │                       │
                                    ▼                       ▼
                           [Pass Release Gate]    [Block Release Gate]
                                    │                       │
                                    ▼                       ▼
                           [Enable "Publish"]     [Display Failure Report]
                                    │             (Inspect Failed Traces)
                                    ▼
                          [Publish Version 1.3]
                                    │
                                    ▼
                         [Log Audit & Deploy]
```

---

### 4.4 Flow 4: Provider Outage & Degradation Fallback

```text
[Primary LLM Request] ──> (Timeout / Error 5xx) ──> [Provider Abstraction Layer]
                                                            │
                                                            ▼
                                                [Switch to Fallback LLM]
                                                            │
                                             ┌──────────────┴──────────────┐
                                             │ Success                     │ All Providers Fail
                                             ▼                             ▼
                                  [Attach Fallback Header]      [Graceful Escalation]
                                  "Model: Claude 3.5 (Fallback)" "AI Unavailable - Route to Agent"
```

---

## 5. UI Component Library & System Design Standards

### 5.1 System Color Tokens
* **Brand Primary:** Deep Void & Navy (`#090D16` / `#0F172A`)
* **Accent Violet (AI Features & Landing Page):** Electric Indigo (`#6366F1` / Indigo 500)
* **Accent Cyan (Glow Highlights):** Neon Cyan (`#06B6D4` / Cyan 500)
* **Success Green:** Emerald (`#10B981` / Emerald 500)
* **Warning Yellow (Escalation & Notes):** Amber (`#F59E0B` / Amber 500)
* **Danger Red (Blockers/Errors):** Rose (`#F43F5E` / Rose 500)
* **Background Surface:** Translucent Dark Glass (`bg-slate-900/60 backdrop-blur-xl`)

### 5.2 Status Indicator Badges

| Entity | Status Badge | Visual Style |
|---|---|---|
| **Ticket** | `NEW` | Solid Blue (`#3B82F6`) |
| **Ticket** | `OPEN` | Solid Amber (`#F59E0B`) |
| **Ticket** | `PENDING_CUSTOMER` | Soft Purple (`#A855F7`) |
| **Ticket** | `PENDING_INTERNAL` | Soft Indigo (`#6366F1`) |
| **Ticket** | `RESOLVED` | Solid Emerald (`#10B981`) |
| **Ticket** | `CLOSED` | Muted Gray (`#64748B`) |
| **AI Agent** | `Draft` | Bordered Gray Badge |
| **AI Agent** | `Testing` | Amber Pulse Badge |
| **AI Agent** | `Published` | Emerald Solid Badge |
| **AI Agent** | `Disabled` | Rose Border Badge |
| **Guardrail** | `Passed` | Check Icon + Emerald Text |
| **Guardrail** | `Violated` | Alert Icon + Rose Text |

---

### 5.3 Evaluation Release Gate Components

```text
+-----------------------------------------------------------------------------------+
| RELEASE GATE STATUS: [ PASS ] — Ready for Production Deployment                   |
| Overall Score: 94.2% (Threshold: 90.0%) | Evaluation Suite: Support_Queries_v2    |
+-----------------------------------------------------------------------------------+
| Category                 | Tests  | Passed | Failed | Accuracy Rate | Status     |
|--------------------------+--------+--------+--------+---------------+------------|
| Intent Classification    | 15     | 15     | 0      | 100.0%        | [ PASS ]   |
| Knowledge RAG Grounding  | 15     | 14     | 1      | 93.3%         | [ PASS ]   |
| Tool Selection & Schema  | 10     | 10     | 0      | 100.0%        | [ PASS ]   |
| Safety & Guardrail Rules | 10     | 9      | 1      | 90.0%         | [ PASS ]   |
+-----------------------------------------------------------------------------------+
| [View Failed Cases Drawer]                              [PUBLISH VERSION v1.3 ->] |
+-----------------------------------------------------------------------------------+
```

---

## 6. Accessibility & Responsive Breakpoints

### 6.1 Responsive Layout Grid
* **Desktop (`>= 1280px`):** Full 3-column Agent view, expanded sidebars, dual-panel AI Studio, 2-column Bento grids.
* **Tablet (`768px - 1279px`):** Collapsible 1-column left sidebar, 2-column ticket view (AI Copilot becomes a slide-over drawer), 1-column Bento layout.
* **Mobile (`< 768px`):** Stacked 1-column navigation, mobile bottom navigation bar for Customer Portal & Agent Inbox, full-screen overlay drawers.

### 6.2 WCAG 2.2 AA Compliance Standards
- **Screen Reader Announcements (`aria-live="polite"`):** Real-time streaming AI response chunks and WebSocket ticket notifications announced cleanly.
- **Keyboard Navigation Shortcuts:**
  - `Cmd / Ctrl + K`: Global Command Palette.
  - `Alt + R`: Focus Reply Textarea.
  - `Alt + E`: Trigger Escalation to Human.
  - `Escape`: Close Modals / Drawers.
- **Contrast Ratios:** Minimum text contrast ratio of `4.5:1` for regular text and `3:1` for UI components and large text.

---

## 7. Architecture Decision Records (ADR) Summary

| ADR ID | Topic | Decision |
|---|---|---|
| **ADR-001** | System Architecture | NestJS Modular Monolith with Clean Architecture boundaries |
| **ADR-002** | Multi-Tenancy | Row-Level Tenant Isolation enforced at repository layer |
| **ADR-003** | Auth Provider | Abstraction interface supporting Clerk / Auth0 / Custom OIDC |
| **ADR-004** | Authorization Model | Granular Permission-Based RBAC (`role.manage`, `ticket.update`) |
| **ADR-005** | LLM Abstraction | Unified adapter layer with automated fallback provider routing |
| **ADR-006** | Vector Storage | PostgreSQL + `pgvector` for unified tenant data management |
| **ADR-007** | Ticket State Model | Explicit state machine (`NEW` -> `OPEN` -> `RESOLVED` -> `CLOSED`) |
| **ADR-008** | API Standards | REST `/api/v1` with JSON Error schema & Correlation IDs |
| **ADR-009** | Data Lifecycle | Tenant-configurable retention tables with hard-purge queues |
| **ADR-010** | AI Evaluation | Mandatory release gate enforcement before publishing agents |

---

## 8. Engineering Implementation Milestones (R01 - R40)

```text
R01 Product & Repository Foundation       R21 AI RAG Integration
R02 NestJS Architecture                   R22 AI Tools & Actions Execution
R03 Next.js Frontend Foundation           R23 AI Guardrails & Policy Engine
R04 Database & Prisma Models              R24 Human Escalation Engine
R05 Authentication Infrastructure          R25 AI Memory & Retention Context
R06 Multi-Tenancy Enforcer                R26 AI Observability & Tracing
R07 RBAC & Permission Guards              R27 AI Evaluation Framework
R08 Audit Logging Middleware              R28 Agent Studio Configuration UI
R09 Enterprise Management Console         R29 Agent Versioning & Rollback
R10 Customer Data Domain                  R30 AI Workflow Schemas
R11 Conversation Management               R31 Draft/Test/Publish Lifecycle
R12 Ticket Domain State Machine           R32 AI Copilot Drawer UI
R13 Human Agent Inbox (3-Column View)     R33 Operational Analytics Dashboard
R14 Knowledge Sources Ingestion           R34 Webhooks & Integration Layer
R15 Document Parsing & Chunking           R35 CI/CD Pipeline & Automated Tests
R16 Embeddings & pgvector Storage         R36 Production Hardening & Security
R17 Retrieval & Citation Engine           R37 Motion-Enhanced Landing Page
R18 AI Provider Abstraction Layer         R38 Self-Serve Onboarding Flow
R19 LangGraph Orchestration Engine        R39 Usage Metering & Business Analytics
R20 AI Intent Detection & Routing         R40 MVP Release & Final Handoff
```

---

## 9. Next Steps & Phase Handoff

With the completion of `DESIGN.md` (v1.2), all reviewed requirements, state machines, API contracts, retention specifications, and design references are fully integrated.

**Immediate Next Actions:**
1. Execute **Milestone R01 & R02:** NestJS backend initialization and modular domain directory structure setup.
2. Execute **Milestone R03:** Next.js 14+ frontend application setup with Tailwind CSS, Framer Motion, and design system tokens.


---

## V2 Prototype Updates (2026)

The following prototype files contain v2 design updates:
- prototypes/landing-v2.html
- prototypes/admin-v2.9.html
- prototypes/velaris-logo-v2.svg

### V2 Design Changes

1. **Typography**
   - Primary font: Inter (was Plus Jakarta Sans)
   - Display font: Space Grotesk (new)
   - Monospace: JetBrains Mono (unchanged)

2. **Color Updates**
   - brand.purple: #2563EB
   - brand.cyan: #0284C7
   - brand.emerald: #059669

3. **Theme**
   - data-theme="dark" attribute on html element
   - scroll-pt-10 class for scroll padding
