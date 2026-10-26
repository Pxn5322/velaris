---
doc: SETUP_GUIDE
version: 0.1
status: Draft
owner: Engineering/operations owner
depends_on: [ARCHITECTURE, SECURITY, DATABASE]
---
# Setup Guide — VELARIS

Last verified: **Not verified**. This guide was generated from the PRD; no application repository was installed or run. Replace this status only after running each step on a clean machine and recording the date, machine and operator. Every command below is a proposed example unless marked otherwise.

## Supabase setup decisions (required before database foundation)
- Create separate Supabase projects/environments for development, staging and production as appropriate to budget and risk.
- Record project region, plan capabilities, connection endpoints, pooler mode, migration role, backup/PITR policy and pgvector extension availability.
- Keep database passwords, service-role keys and provider credentials in server-side environment/secret management. Never expose service-role credentials in `NEXT_PUBLIC_*` variables or browser code.
- Verify Prisma schema validation and migration against a disposable development project before relying on commands. Do not run destructive migrations against production without a reviewed plan and human approval.
- Supabase Auth is selected for identity/session. Supabase Storage and Realtime remain undecided and must be evaluated separately against requirements.

## 1. What runs where
| Component | Local | Staging | Production |
| --- | --- | --- | --- |
| Next.js web | local dev process/container | selected web host | selected web host/CDN |
| NestJS API | local dev process/container | selected container host | selected container host |
| Worker | local worker process | worker process/container | isolated worker deployment |
| PostgreSQL/pgvector | Docker/local service | managed DB candidate | managed DB with backups/restore plan |
| Redis/BullMQ | Docker/local service | managed Redis candidate | managed Redis with access restrictions |
| Object storage | local test storage or provider sandbox | separate staging bucket | production bucket with tenant-scoped paths |
| Supabase Auth | local/test project/app configuration | separate staging configuration | production configuration with approved redirects and settings |
| LLM/embedding | fake adapter or development key | separate staging credentials | approved provider/region/data terms not yet selected |
| CI/CD | GitHub Actions | GitHub Actions + staging secrets | gated release workflow with human approval |

Region and data-residency note: **Unknown** until provider/market decisions are approved. Use synthetic data locally and in tests. Keep separate projects, keys and secrets per environment.

## 2. Accounts and access [Owner]
| Account | Purpose | Owner | MFA |
| --- | --- | --- | --- |
| Source-control organization | Repository and CI access | Repository owner | required |
| Hosting account | Web/API/worker deployments | Operations owner | required |
| Database provider | PostgreSQL, backups and restore | Operations owner | required |
| Supabase Auth | User identity, sign-in/session and access-token issuance | Security/product owner | required |
| AI/embedding provider | Model inference and embeddings | AI/platform owner | required |
| Object storage provider | Knowledge source files | Operations owner | required |

Create accounts only with explicit owner authorization. Do not paste credentials into this guide or commit them.

## 3. Prerequisites and repository
- Proposed prerequisites: supported Node.js LTS version pinned in `.nvmrc`/toolchain file; package manager and version pinned; Docker/Compose for local dependencies; Git; Python 3 for documentation checker.
- Clone the monorepo and install from the repository root with `npm install` (npm workspaces, single root lockfile; recorded as D-09 on 2026-10-22).
- Generate the Prisma client after every install with `npx prisma generate`. npm blocks install scripts here, so `@prisma/client` exports no `PrismaClient` until this command runs. Type check and build fail without it (observed in CI on 2026-10-26; the CI type-check and build jobs run this step).
- Configure package scripts and workspace tooling as described in `docs/CODE_STYLE.md`.
- Run locally: `npm run dev:api` (NestJS API on port 3000) and `npm run dev:web` (Next.js on port 3001), both from the repository root. These dev commands are documented here but not verified in a recorded run.
- Verify: root `npm install`, `npm run build`, `npm run test`, `npm run lint` and `npm run typecheck` were run on 2026-10-23 (Windows). Build, tests and type check pass; lint reports 0 errors and 0 warnings. Record tool versions with future runs.

## 4. Environment variables (canonical list of names)
Names below are proposed categories for the initial implementation. Add or remove names only when the architecture actually uses them; never record real values here.

| Name | Used by | Secret | Where the real value lives |
| --- | --- | --- | --- |
| `NODE_ENV` | web/API/worker | no | runtime environment configuration |
| `DATABASE_URL` | API/worker/migrations | yes | local ignored `.env`; CI/host secret store |
| `REDIS_URL` | API/worker | yes | local ignored `.env`; CI/host secret store |
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js browser client and server config | no, public project URL | public app config |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Next.js browser client | no, publishable key; RLS is still required for any direct database exposure | public app config |
| `SUPABASE_URL` | NestJS API/worker | no, project URL | server environment config |
| `SUPABASE_PUBLISHABLE_KEY` | NestJS API token verifier (apikey header on `GET /auth/v1/user`) | no, public project key | server environment config |
| `SUPABASE_JWT_ISSUER` | NestJS token verifier, if configured separately | no | server environment config |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only administrative operations, only where justified | yes | server secret store; never browser-exposed |
| `LLM_PROVIDER` | API/worker | no | environment config |
| `LLM_API_KEY` | AI adapter | yes | secret store |
| `EMBEDDING_PROVIDER` | worker/API | no | environment config |
| `EMBEDDING_API_KEY` | embedding adapter | yes | secret store |
| `OBJECT_STORAGE_ENDPOINT` | API/worker | usually no | environment config |
| `OBJECT_STORAGE_BUCKET` | API/worker | no | environment config |
| `OBJECT_STORAGE_ACCESS_KEY` | API/worker | yes | secret store |
| `OBJECT_STORAGE_SECRET_KEY` | API/worker | yes | secret store |
| `APP_BASE_URL` | web/API | no | environment config |
| `LOG_LEVEL` | API/worker | no | environment config |

Public browser variables must never contain server secrets. Validate required variables at startup and mention the missing variable name only, never its value. Verify: remove a required local variable and confirm startup fails with a clear safe error; exact test is **Not run**.

## 5. Modules
Each section remains a setup plan, not a verified instruction, until the provider and repository exist.

### 5.1 Local services (containers, init scripts)
1. Configure Docker Compose for PostgreSQL with pgvector and Redis after selecting image versions.
2. Add health checks and persistent local-only volumes; do not expose ports beyond development needs.
3. Start services using the committed Compose file.
4. **Verify:** Not configured; service health checks must pass and API connection checks must succeed.
5. Common failure: port conflict or incompatible extension image; check container logs and pinned versions.

### 5.2 Database platform (project, region, roles, connection strings, backups)
1. Select provider/region and least-privilege roles before staging/production setup.
2. Use separate database/project and credentials for each environment.
3. Configure encrypted connections and backups; define RPO/RTO and retention with the owner.
4. **Verify:** Not configured; confirm connection, backup completion and successful restore drill before production.

### 5.3 Database workflow (migrations, seed, isolation checks)
1. Generate Prisma migrations from reviewed schema changes; do not edit production schema manually.
2. Apply migrations to an empty local database and seed synthetic data.
3. Run tenant A/B isolation and permission-denial tests.
4. **Verify:** Not configured; `npx prisma validate` is a proposed command only and has not been run.

### 5.4 Cache/queue, file storage
1. Configure Redis/BullMQ with bounded retries, timeouts, dead-letter/replay strategy and tenant/correlation metadata.
2. Configure storage paths with tenant scope, upload limits and source lifecycle cleanup.
3. Keep credentials in secret stores and verify workers re-check tenant status at execution time.
4. **Verify:** Not configured; a duplicate job must not create duplicate side effects, and a deleted source must no longer be retrievable.

### 5.5 Supabase Auth and NestJS authorization
1. Configure Supabase Auth for development/test first; record project URL, allowed redirect URLs, email verification and recovery settings. Keep staging and production settings separate.
2. Configure the Next.js client with only the public project URL and publishable key. Keep service-role credentials server-only and use them only for explicitly justified administrative operations.
3. Configure NestJS access-token verification using a maintained supported Supabase/JWT verification approach. Validate issuer, signature, expiry and expected claims; handle key rotation and verifier outages safely.
4. After authentication, NestJS resolves the application user, active status, tenant membership and permission set from trusted application data. Do not grant roles from user-editable metadata or a client-supplied tenant ID.
5. **Verify:** Not configured; valid login/token succeeds; missing/invalid/expired token returns 401; authenticated user without permission returns 403; disabled user and cross-tenant access are denied; recovery/verification redirects are constrained to approved URLs.

### 5.6 AI provider and embeddings
1. Select provider/model, data processing terms, region and cost limits before production data use.
2. Configure provider adapter and model names through environment/config; never hard-code keys or assume fallback parity.
3. Use synthetic evaluation cases; verify timeout, rate-limit, outage, retrieval and citation behavior.
4. **Verify:** Not configured; evaluation suite passes and critical guardrail failures block publishing.

### 5.7 Other third-party services
N/A — no specific email, chat channel, CRM or external integration provider is confirmed for the first release. Add provider-specific setup only after the integration priority is approved.

## 6. CI, hosting, domains
- CI jobs (all verified): .github/workflows/ci.yml runs docs check, lint, type-check, unit tests, build and the npm audit gate on every push and PR; .github/workflows/e2e.yml runs the Playwright landing journeys; .github/workflows/merge-gate.yml blocks direct commits to master and pull requests without owner approval.
- Hosting: Vercel/Render are candidates, not selected production commitments. Decide hosting, regions, TLS, domains, migration execution and secret management before deployment.
- Migrations must be reviewed and run as a controlled deploy step with a rollback/forward-fix strategy; destructive migrations require owner review.
- Verify: Not configured; staging health check returns 200, protected route returns 401 without credentials, and one authorized read succeeds.

## 7. Operations
- Monitoring: API error rate and p50/p95/p99 latency, queue depth/failures, provider availability, ingestion failures, AI evaluation/grounding/citation failures, cost, audit completeness and deployment health.
- Release: run all gates, deploy to staging, smoke test, review telemetry, obtain human production approval, then deploy using the chosen provider's verified process.
- Rollback: restore previous app artifact/config where safe; use forward fixes or tested restore for incompatible migrations. Agent rollback selects a prior immutable published version and preserves history.
- Smoke tests: health endpoint; protected endpoint returns 401 without credentials; one allowed tenant-scoped read; cross-tenant read denied; AI provider/queue health; audit/trace sample present.
- Verify: Not configured; record deployment ID, test outputs, owner approval and rollback rehearsal result.

## 8. Checklists and troubleshooting
- [ ] Local: services healthy, migrations apply, app runs, tests pass, tenant isolation tests pass.
- [ ] Staging/production: keys separate per environment, least-privilege roles, backups/restore confirmed, secrets only in secret stores, MFA on every account.
- [ ] Before production AI use: provider data terms reviewed, retention policy approved, evaluation thresholds established, no compliance claim without evidence.

| Symptom (exact error) | Likely cause | Fix |
| --- | --- | --- |
| Not yet observed | Application has not been scaffolded or run | Record exact error, command, environment and recovery after reproducing |
