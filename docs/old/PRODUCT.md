# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Prototype baseline: static HTML with Tailwind CDN and browser-side JavaScript. The PRD identifies a future Next.js frontend and NestJS backend architecture; the production stack remains an implementation milestone.

## Users

- Enterprise administrators managing tenants, users, roles, permissions, platform governance, and audit records.
- Tenant administrators configuring customer operations, knowledge, AI agents, workflows, integrations, and settings.
- Human support agents resolving assigned conversations and tickets with AI-assisted handoff context.
- Customers seeking grounded self-service answers or human support.
- Platform and developer users working with APIs, integrations, tools, and observability.

The initial market focus is small and medium-sized businesses in Southeast Asia.

## Product Purpose

VELARIS is an AI-powered, multi-tenant customer operations platform. It unifies governed AI assistance, human support workflows, knowledge retrieval, automation, analytics, and enterprise security so businesses can resolve customer issues efficiently without losing human oversight, permission controls, or auditability.

Success means customers receive useful grounded help quickly; support teams inherit complete context when escalation is needed; and administrators can safely configure, evaluate, govern, and observe the system.

## Positioning

VELARIS combines permission-aware knowledge retrieval and governed AI agents with deterministic policy enforcement, human-in-the-loop escalation, tenant isolation, and auditable operational traces. AI can recommend and automate within explicit controls, while application code governs authorization and consequential actions.

## Operating Context

- Multi-tenant customer support and customer-operations environments.
- Support tickets, conversations, internal notes, assignments, priorities, tags, and timelines.
- Tenant-isolated knowledge sources, AI agent configurations, workflows, evaluations, release gates, and observability traces.
- Role- and permission-based access across enterprise administration, tenant administration, agent workspaces, and customer self-service.
- AI-to-human escalation, provider-degradation fallback, concurrent ticket updates, and auditable security-sensitive operations.

## Capabilities and Constraints

- Governed AI responses, RAG knowledge retrieval, automation, analytics, and integrations.
- Human support workspace with AI summaries, suggested replies, citations, recommended actions, and escalation context.
- Enterprise and tenant administration for users, roles, permissions, tenants, retention, knowledge, AI-agent lifecycle, and audit records.
- Every protected business operation must enforce tenant context, authentication, required permissions, and resource ownership server-side.
- AI actions requiring approval or violating policy must be blocked or escalated to a human.
- Production AI-agent releases require evaluation and release-gate validation.
- Customer-facing support must always allow a request for a human agent.
- Required accessibility standard: WCAG 2.2 AA.
- No additional product constraints, approved brand assets, or compliance standards were supplied beyond the PRD and design specification.

## Brand Commitments

- Product name: VELARIS.
- Working tagline: “Intelligent customer operations, powered by AI.”
- Existing prototype and design baseline use a dark, enterprise AI-product direction with indigo and cyan accents.
- `PRD.md` and `DESIGN.md` are the approved product and design references. The existing HTML files in `prototypes/` are reference prototypes.

## Evidence on Hand

- Product requirements: `PRD.md`.
- Approved page structure and interaction specification: `DESIGN.md`.
- Interactive reference prototypes: `prototypes/landing.html`, `prototypes/admin.html`, `prototypes/tenant-admin.html`, `prototypes/agent-workspace.html`, and `prototypes/customer-portal.html`.
- Product logo: `prototypes/velaris-logo.svg`.
- No verified customer testimonials, case studies, pricing, or compliance certifications are present; future work must not fabricate them.

## Product Principles

1. Govern AI with deterministic controls: authorization, policy, and consequential actions must remain enforceable and auditable.
2. Treat tenant isolation as a first-class security boundary.
3. Make human escalation clear, fast, and context-rich.
4. Ground AI assistance in authorized knowledge and make its reasoning traceable where appropriate.
5. Keep enterprise-grade governance usable for the initial Southeast Asian SME market.

## Accessibility & Inclusion

- Meet WCAG 2.2 AA.
- Support keyboard-first navigation, accessible focus management, and screen-reader announcements for streaming AI responses and ticket notifications.
- Preserve adequate contrast and avoid layout shift across responsive layouts.
