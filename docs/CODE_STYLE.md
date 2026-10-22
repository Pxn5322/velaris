---
doc: CODE_STYLE
version: 0.1
status: Draft
owner: Engineering owner
depends_on: [ARCHITECTURE]
---
# Code Style — VELARIS

## 1. Status and scope
The conventions below are Proposed repository standards based on the PRD. No command is claimed to have been run successfully because the target application repository has not been inspected or configured as part of this documentation generation. Commands remain **Not configured** until verified in the repository.

## 2. TypeScript and architecture
- Use TypeScript strict mode for web, API and workers.
- Keep NestJS modules aligned to domain boundaries; avoid cross-module reach-through into private internals.
- Prefer small public interfaces and deep modules. Controllers parse transport concerns; application services orchestrate use cases; domain logic owns invariants; repositories/adapters own persistence/provider details.
- Use dependency injection and constructor injection; avoid service locator patterns and hidden global state.
- Keep business/domain code independent of specific identity, LLM, vector-store, queue and object-storage SDKs.
- Avoid circular dependencies. Introduce an interface at a real boundary rather than adding abstractions without a change/use case.
- No authorization decisions in React components or LLM prompts alone. Enforce them in server-side guards/policies and domain/application services.
- Use explicit result/error types for expected failures; throw mapped framework exceptions at transport boundaries.

## 2A. OOP, SOLID and MVC-inspired NestJS conventions
- **S — Single Responsibility:** controllers translate HTTP; application services coordinate use cases; domain policies/entities protect invariants; repositories persist data; provider adapters speak external protocols.
- **O — Open/Closed:** extend integrations/providers through stable interfaces and adapters instead of scattering provider checks throughout business logic.
- **L — Liskov Substitution:** implementations of a port must preserve its documented behavior and error semantics; test adapters against shared contract tests where practical.
- **I — Interface Segregation:** define small capability-specific ports (for example, `EmbeddingProvider`, `ChatModel`, `KnowledgeRepository`) rather than one giant infrastructure interface.
- **D — Dependency Inversion:** application/domain code depends on interfaces owned by inner layers; Prisma, Supabase SDKs, Redis, storage and model SDKs are injected adapters.
- **MVC-inspired layering:** NestJS controllers are the controller/transport boundary, not the home for domain logic. The frontend is a presentation layer and must never enforce security. Avoid forcing classic MVC where a use-case/service/domain boundary is clearer.
- **OOP pragmatism:** prefer composition, explicit types and cohesive domain behavior. Do not create an interface for every class or a repository for every trivial query unless it establishes a real boundary, policy or test seam.
- **Review rule:** PR reviewers should flag business logic in controllers, provider SDK imports in domain/application code, circular module dependencies, broad `any`, hidden global state, and client-side-only authorization.

## 3. Naming and file organization
- Types/classes/interfaces: `PascalCase`; functions/variables: `camelCase`; constants: `UPPER_SNAKE_CASE` only for true constants; file names follow framework convention consistently.
- Permission codes use stable lowercase dot notation, e.g. `ticket.read`, `ai.agent.deploy`.
- Database fields use one consistent naming strategy (Proposed: `snake_case` in PostgreSQL, mapped to `camelCase` in TypeScript).
- Use domain terms consistently: Conversation is communication history; Ticket is operational work item; Tenant/Company is the primary data-isolation boundary.
- Keep DTOs, domain entities, persistence models and API response schemas distinct where their invariants differ.
- Avoid `any`; if unavoidable at an external boundary, validate/narrow immediately and document why.

## 4. Validation and errors
- Validate inbound DTOs and environment configuration at startup.
- Zod is selected for frontend form/schema validation; NestJS DTO validation approach must be standardized before API scaffolding (Proposed: class-validator/class-transformer or shared Zod contracts; choose one canonical server pattern).
- Return `{ code, message, details?, requestId }`; details must not contain secrets or sensitive internal context.
- Use domain errors for invalid transitions, ownership violations and policy denial; map them consistently to HTTP status codes.
- Never catch and ignore an error. When recovering, log safe context and return a defined result.

## 5. Data and tenant context
- A tenant-scoped repository/service operation must require `TenantContext` explicitly.
- Never use client-supplied tenant ID as proof of membership.
- Include tenant scope in cache keys, jobs, object paths, vector retrieval and idempotency scope.
- Use optimistic concurrency/version checks for concurrent ticket updates where required.
- Use transactions for multi-record domain changes and reliable outbox/audit behavior where necessary.
- Do not put plaintext provider credentials in database JSON or source control.

## 6. AI and integrations
- Provider SDKs live behind adapters; application services depend on stable interfaces.
- Every AI/tool execution carries correlation ID, tenant scope, agent/version and bounded timeout/retry policy.
- Treat LLM output, retrieved text, uploaded documents, webhook payloads and tool results as untrusted data.
- Validate tool arguments against schema and recheck authorization/policy at execution time.
- Version agent configuration, prompt/instruction configuration and evaluation datasets.
- Log metadata and failure reasons; redact secrets and minimize personal content.
- Idempotent handlers are required for retryable webhooks, jobs and external actions.

## 7. Formatting, lint and type checks
| Purpose | Command | Status |
| --- | --- | --- |
| Format | `npm run format --workspace apps/api` (Prettier) | Verified 2026-10-22; web has no format script yet |
| Lint | `npm run lint` (root; runs oxlint for API, ESLint for web) | Verified command; web lint reports 12 pre-existing errors to fix in a follow-up task |
| Type check | `npm run build` (nest build + next build include type checking) | Verified 2026-10-22 |
| Build | `npm run build` (root, all workspaces) | Verified 2026-10-22 |
| Unit test | `npm run test` (root; vitest for API) | Verified 2026-10-22 |

Repository tooling (T0.01 partial): npm workspaces (`apps/*`, `packages/*`) with a single root lockfile; no build orchestrator yet. Per-package type-check scripts (`tsc --noEmit`) are still to be added under T0.02.

## 8. Dependency policy
- A new runtime dependency requires a D-xx decision entry describing why built-in/platform capability is insufficient, maintenance/security posture, license, and test impact.
- Pin package manager and lockfile; use reproducible installs in CI.
- Keep provider SDKs isolated and avoid adding multiple libraries for the same responsibility without a documented reason.
- Run dependency and secret scanning in CI before production release; exact tools/commands are Not configured.

## 9. Comments and documentation
- Prefer clear names and simple code over comments that restate code.
- Comment domain invariants, security rationale, non-obvious trade-offs and external provider quirks.
- Update docs/API schemas/tests in the same change when contracts or decisions change.
- Use IDs from PRD and link to them in implementation tasks/tests.

## 10. Pull request / commit expectations
- One task or concern per change where practical; keep diff within the task's `files:` scope.
- Tests are written first and observed failing for the expected reason, then implementation, refactor and full verification.
- Review authorization, tenant isolation, data lifecycle, observability and accessibility impact for relevant changes.
- Never commit secrets, real customer data, generated build artifacts or unreviewed migrations.
