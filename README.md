# VELARIS - Enterprise AI Customer Operations Platform

## Overview

VELARIS is an enterprise-grade, multi-tenant customer operations platform that combines human support workflows with governed AI agents, permission-aware RAG knowledge retrieval, and deterministic enterprise rules.

## Project Structure

npm-workspaces monorepo (decision D-06, `docs/ARCHITECTURE.md`). The prototype phase is retired; `docs/old/` keeps the previous plan for reference only.

```
velaris/
├── apps/
│   ├── web/                        # Next.js 16 app: landing, admin, studio, workspace, portal, analytics
│   ├── api/                        # NestJS modular monolith (domain modules under src/domains/)
│   └── worker/                     # background workers (scaffold; jobs land with T3.03)
├── packages/
│   ├── contracts/                  # shared API schemas/types (error contract; no secrets)
│   └── config/                     # shared TypeScript configuration (tsconfig.base.json)
│                                   # ui/ai-evals/test-utils arrive with their owning tasks (T2.04/T4.05/T0.04)
├── docs/                           # source-of-truth documents (PRD, ARCHITECTURE, SECURITY, DATABASE,
│                                   # DESIGN_SYSTEM, CODE_STYLE, SETUP_GUIDE, TESTING, IMPLEMENTATION_PLAN)
│   └── old/                        # previous plan (reference only)
├── prototypes/                     # retired v2 prototype snapshots (reference only)
├── tests/                          # root Playwright harness
└── scripts/                        # repository scripts (docs checker)
```

## Technology Stack

### Current (Prototype Phase)
- Static HTML5 with semantic markup
- Tailwind CSS via CDN
- Vanilla JavaScript (ES6+)
- Three.js r128 (background animations)
- Lucide Icons

### Target Production Stack (Per PRD)
- **Frontend**: Next.js 14+, React, TypeScript, Tailwind CSS, TanStack Query
- **Backend**: NestJS, TypeScript, modular monolith architecture
- **Database**: PostgreSQL with Prisma ORM, pgvector for embeddings
- **AI**: LangGraph orchestration, LLM provider abstraction
- **Infrastructure**: Docker, GitHub Actions, Vercel/Render

## Getting Started

### Prerequisites
- Node.js LTS, npm (workspaces)

### Running Locally

```bash
npm install          # installs all workspaces from the root lockfile
npm run dev:api      # NestJS API on http://localhost:3000
npm run dev:web      # Next.js web on http://localhost:3001
```

Other root scripts: `npm run build`, `npm run lint`, `npm run test`, `npm run e2e`. See `docs/SETUP_GUIDE.md` for the full setup plan.

## Design System

### Color Tokens
- **Void**: #090D16 - Primary dark background
- **Surface**: #0F172A - Secondary surface
- **Brand**: #6366F1 - Indigo 500 (primary accent)
- **Accent**: #06B6D4 - Cyan 500 (secondary accent)
- **Success**: #10B981 - Emerald 500
- **Warning**: #F59E0B - Amber 500
- **Danger**: #F43F5E - Rose 500

### Typography
- **Primary**: Plus Jakarta Sans (weights 300-800)
- **Monospace**: JetBrains Mono (weights 400-500)

### Accessibility Standards
- WCAG 2.2 AA compliance target
- Minimum contrast ratio: 4.5:1 for text
- Keyboard navigation support
- Screen reader announcements via ARIA live regions
- Focus indicators on all interactive elements

## User Roles

| Role | Access Level |
|------|--------------|
| **ENTERPRISE** | Platform-wide tenant management, global audit, governance |
| **ADMIN** | Tenant-scoped configuration, AI Studio, knowledge, analytics |
| **AGENT** | Ticket queue, customer conversations, AI copilot |
| **USER** | Customer self-service portal, own tickets only |

## Key Features

### Governed AI Agents
- Configurable instructions, knowledge, tools, and guardrails
- Deterministic policy enforcement
- Release gate evaluation before deployment
- Full traceability and audit logging

### Permission-Aware RAG
- Tenant-isolated vector storage
- Document access controls
- Citation-backed responses
- <100ms vector latency

### Human-in-the-Loop Escalation
- Automatic escalation on low grounding confidence
- Full context handoff to human agents
- AI-suggested replies and actions
- Zero context loss on transfer

### Multi-Tenant Architecture
- Server-side tenant isolation enforcement
- Role-based access control (RBAC)
- Tenant-scoped data boundaries
- Cross-tenant access prevention

## Security Considerations

### Prototype Phase
- External scripts use SRI (Subresource Integrity) hashes
- No hardcoded secrets or API keys
- Input validation on all form fields
- XSS prevention through proper escaping

### Production Requirements (Per PRD)
- 100% tenant isolation enforced server-side
- 100% protected APIs enforce authentication and permissions
- Audit logging for all security-sensitive actions
- Correlation IDs for all AI traces
- CSP headers required in production

## Development Guidelines

### Code Style
- Use semantic HTML elements
- Include ARIA labels for accessibility
- Prefer ddEventListener over inline onclick
- Use const/let instead of ar
- Include JSDoc comments for functions

### Git Conventions
- Branch naming: eature/description, ix/description, docs/description
- Commit messages: Follow conventional commits
- PR descriptions: Include summary, testing notes, and screenshots

### Testing
- Jest for unit tests
- Supertest for API integration tests
- Cypress for E2E tests
- AI evaluation suites for agent quality

## Documentation

- **docs/PRD.md**: Product requirements
- **docs/ARCHITECTURE.md**: Stack, boundaries, API surface, decision log
- **docs/SECURITY.md / docs/DATABASE.md / docs/DESIGN_SYSTEM.md**: controls, data model, UI system
- **docs/IMPLEMENTATION_PLAN.md**: task plan and run log
- **docs/old/**: previous plan (reference only)

## License

Proprietary - VELARIS Inc. All rights reserved.

## Contributing

This is a private repository. Contact the development team for contribution guidelines.
