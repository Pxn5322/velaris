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

Region and data-residency note: **Unknown** until provider/market decisions are approved. Use synthetic data locally and in tests.

**Single-environment decision (owner, 2026-11-05; D-37).** The project uses one Supabase project and one database for local development, CI live checks and the first hosted deployment. Current keys serve all three. A staging split is deliberately not created. Before production: clear all data in the current project, then provision the production environment with its own project, keys and secrets. The table above describes the target shape after that split, not the current state.

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
- Run locally: `npm run dev:api` (NestJS API on port 3000) and `npm run dev:web` (Next.js on port 3001), both from the repository root. Verified 2026-11-02: both servers answered HTTP 200 locally, and registration through the landing page created a workspace end to end.
- The API loads a local `.env` file itself (`apps/api/src/env.ts`, Node's built-in `process.loadEnvFile`, no extra package). It reads `<repo>/.env` first, then `apps/api/.env`. A value that already exists in the process environment always wins, so a deployment secret is never shadowed by a file. A missing file is not an error: CI and unit tests run without one.
- Create the local file once. Copy the names from section 4 and fill the values from your secret store. `apps/web/.env.local` holds the public `NEXT_PUBLIC_*` names and is read by Next.js automatically. Both files are git-ignored.
- If two terminals share one machine, set `PORT` explicitly for the API (`PORT=3000 npm run dev:api`). Node reads `PORT=0` as "pick any free port", so an inherited `PORT=0` moves the API off 3000 and the browser cannot reach it.
- Verify: root `npm install`, `npm run build`, `npm run test`, `npm run lint` and `npm run typecheck` were run on 2026-10-23 (Windows). Build, tests and type check pass; lint reports 0 errors. T6.02 re-ran all of them on 2026-11-04: lint exits 0 with 14 known warnings in two API spec files, and the count is recorded in `AGENTS.md`. Record tool versions with future runs.
- Release-readiness checks (T6.02): `npm run inventory:check` lists every API route and fails on an unguarded one. The load profile needs a running API: `PORT=3100 node apps/api/dist/main.js`, then `MSYS_NO_PATHCONV=1 node scripts/load-profile.mjs --url http://127.0.0.1:3100 --path / --concurrency 8 --duration 10`. The accessibility scan runs inside `npm run e2e:web`, which needs `npm run build:web` first.

## 4. Environment variables (canonical list of names)
Names below are proposed categories for the initial implementation. Add or remove names only when the architecture actually uses them; never record real values here.

| Name | Used by | Secret | Where the real value lives |
| --- | --- | --- | --- |
| `NODE_ENV` | web/API/worker | no | runtime environment configuration |
| `DATABASE_URL` | API/worker/migrations | yes | local ignored `.env`; CI/host secret store |
| `REDIS_URL` | API/worker BullMQ ingestion queue (D-17); when absent the API keeps the in-process adapter, so it is optional for CI and unit tests | yes | local ignored `.env`; CI/host secret store |
| `NEXT_PUBLIC_SUPABASE_URL` | Next.js browser client and server config | no, public project URL | public app config |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Next.js browser client (portal sign-in); `NEXT_PUBLIC_SUPABASE_ANON_KEY` is accepted as the same setting (T2.04) | no, publishable key; RLS is still required for any direct database exposure | public app config |
| `SUPABASE_URL` | NestJS API/worker | no, project URL | server environment config (local: `<repo>/.env`) |
| `SUPABASE_PUBLISHABLE_KEY` | NestJS API token verifier (apikey header on `GET /auth/v1/user`) | no, public project key | server environment config |
| `SUPABASE_JWT_ISSUER` | NestJS token verifier, if configured separately | no | server environment config |
| `GROQ_API_KEY` | API `GroqLlmProvider` development adapter (D-18); when absent the factory keeps the offline deterministic adapter, so it is optional for CI and unit tests | yes | local ignored `.env`; CI/host secret store |
| `GROQ_MODEL` | API Groq adapter model name (default `openai/gpt-oss-120b`) | no | runtime environment configuration |
| `WEBHOOK_SECRET_<NAME>` | API webhook signature verification; the `secretRef` column of `integration_endpoints` names the variable (for example `WEBHOOK_SECRET_STRIPE`), so one name serves every tenant that registers it | yes | local ignored `.env`; host secret store |
| `CORS_ORIGIN` | NestJS HTTP CORS allowlist (`src/app.setup.ts`); comma-separated origins | no, defaults to `http://localhost:3000,http://localhost:3001` | server environment config; set the real web origin in every deployment |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only administrative operations, only where justified; `POST /auth/signup` and member creation answer 503 "Account registration is not configured on this deployment" when this name or `SUPABASE_URL` is missing | yes | server secret store; never browser-exposed |
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
| `E2E_LIVE_API_URL` | Playwright live registration journey (`npm run e2e:live`); when absent the spec skips, so the default suite stays offline | no | shell environment for the check; the single environment's API origin |
| `E2E_LIVE_PASSWORD` | Password for the synthetic account the live registration journey creates (defaults to a documented test value) | yes | shell environment only; never commit a real password |

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
5. The evaluation runner is a code-level port, not an environment variable: `EVALUATION_SUBJECT` in `apps/api/src/domains/ai/evaluation/evaluation.service.ts` has no default provider. Until a runner is registered, the evaluation route answers 503 `Evaluation runner is not configured for this deployment` and records no run. The publish gate reads recorded runs only, so publishing stays blocked for that dataset. This fail-closed behaviour is deliberate (ARCHITECTURE D-23); do not bypass the gate.
   - **Verify:** `evaluation.service.spec.ts` case "answers 503 when no runner is configured instead of faking a run".

### 5.7 Other third-party services
N/A — no specific email, chat channel, CRM or external integration provider is confirmed for the first release. Add provider-specific setup only after the integration priority is approved.

## 6. CI, hosting, domains
- CI jobs (all verified): .github/workflows/ci.yml runs docs check, lint, type-check, unit tests, build and the npm audit gate on every push and PR; .github/workflows/e2e.yml runs the Playwright landing journeys; .github/workflows/merge-gate.yml blocks direct commits to master and pull requests without owner approval.
- Hosting: Vercel/Render are candidates, not selected production commitments. Decide hosting, regions, TLS, domains, migration execution and secret management before deployment.
- Migrations must be reviewed and run as a controlled deploy step with a rollback/forward-fix strategy; destructive migrations require owner review.
- Environment: one deployment only until production (D-37). No staging project exists, so a live check targets the current environment with the current keys.
- Verify: Not configured; the deployed health check returns 200, a protected route returns 401 without credentials, and one authorized read succeeds. Until the owner supplies the hosting target, `npm run e2e:live` is the live registration check and it skips without `E2E_LIVE_API_URL`.

### 6.1 Single-environment deployment checklist (T6.03, D-37)
This checklist is ready. No deployment has run. The owner supplies the hosting target before the first line below can execute.

**Owner inputs before deployment**
- [ ] Hosting target for `apps/web` and `apps/api`, with TLS and a public origin per app.
- [ ] The public web origin in `CORS_ORIGIN` and `APP_BASE_URL`.
- [ ] `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` for the single environment.
- [ ] `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` for the web build.
- [ ] Approval to spend on the hosting plan.

**Before the deploy**
- [ ] `npm run test`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run inventory:check` and `python scripts/check_docs.py --draft` pass on the commit to deploy.
- [ ] `npx prisma migrate status` reports no pending migration against the deployment database.
- [ ] A database backup or snapshot exists, because migrations are forward-only.
- [ ] The previous web and API artifacts are kept for rollback.

**Deploy**
- [ ] Apply migrations as a controlled step: `npx prisma migrate deploy`.
- [ ] Deploy the API, then the web app.
- [ ] Record the deployment id, commit SHA and the migration names applied.

**Smoke tests against the deployed origin**
```bash
# 1. Liveness: the API root answers 200 (no separate /health route exists)
curl -fsS -o /dev/null -w "%{http_code}\n" https://api.example.com/

# 2. Protected route without a credential: expect 401
curl -s -o /dev/null -w "%{http_code}\n" "https://api.example.com/settings/retention?tenantId=00000000-0000-0000-0000-000000000000"

# 3. Authorized tenant read: expect 200 and three categories
curl -s -H "Authorization: Bearer $TOKEN" "https://api.example.com/settings/retention?tenantId=$TENANT_ID"

# 4. Cross-tenant denial: expect 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "https://api.example.com/settings/retention?tenantId=$OTHER_TENANT_ID"

# 5. Authenticated load: creates one synthetic tenant and fills {tenantId}
#    SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be in the shell.
node scripts/load-profile.mjs --url https://api.example.com \
  --path "/settings/retention?tenantId={tenantId}" --auth-signup \
  --concurrency 8 --duration 10 --out retention-load.json

# 6. Registration in a real browser (J-01): expect the admin view
E2E_LIVE_API_URL=https://api.example.com E2E_BASE_URL=https://app.example.com npm run e2e:live
```
- [ ] A trace and an audit row exist for the smoke run: `GET /audit/traces` and `GET /audit/events` with the tenant scope.
- [ ] The retention panel loads in the admin settings tab, shows the newest change, opens the filtered audit trail and saves one window, and the audit trail shows `retention.policy_changed`.
- [ ] `retention-load.json` records the authenticated p95 against the 200 ms budget. If it exceeds the budget, record the cause and do not report NFR-04 as met. The script prints the synthetic email and tenant id for cleanup.

**Rollback rehearsal**
- [ ] Redeploy the previous artifact pair and repeat smoke tests 1 and 2.
- [ ] Confirm migration `0009_retention_policy_defaults` is additive: the previous API still reads the table, and no data is lost.
- [ ] Record the rehearsal result, the artifact ids and the time to restore.
- [ ] Stop after three failed attempts and report the failure with logs; do not improvise a database restore on production data.

**After the smoke**
- [ ] Record the evidence in `docs/TESTING.md` section 9 and a `.agents/evidence-*.md` file.
- [ ] Ask the owner for release approval. No automated production deployment exists.

### 6.2 Production cutover checklist (D-37, T6.04)
The single development environment becomes production only through this controlled cutover. Do not copy development data into production.

**Preconditions**
- [ ] T6.03 smoke tests and the rollback rehearsal passed on the deployed single environment.
- [ ] `docs/TESTING.md` section 9 records the results, and the owner approves the cutover.
- [ ] The production Supabase project exists in the approved region and plan, with backups or PITR confirmed and one restore drill recorded.
- [ ] The hosting provider, domains and TLS are approved, and the spend is authorised.

**Clear development data**
- [ ] Export nothing that contains real or customer data. Development holds synthetic data only.
- [ ] Delete the synthetic Supabase auth accounts created by checks and journeys.
- [ ] Delete the tenant rows and their children through the controlled SQL path, in foreign-key order, or recreate the project if the owner prefers a clean start.
- [ ] Verify every application table returns zero rows: tenants, users, memberships, customers, conversations, messages, tickets, knowledge, agents, audit, traces, memory, retention and integrations.
- [ ] Keep the migration history (`_prisma_migrations`) and the seeded system roles; they are schema, not data.

**Provision production**
- [ ] Run `npx prisma migrate deploy` against the production connection string as a controlled step. Confirm the same migration names as the verified commit.
- [ ] Confirm the system roles and permission codes from migration `0002` exist.
- [ ] Confirm the `vector` extension, indexes, CHECK constraints and row-level security policies exist.
- [ ] Set the production Auth redirect URLs and the allowed origins. Remove every development URL.
- [ ] Provision Redis and object storage if the release uses them; otherwise confirm the app starts without them.

**Rotate keys**
- [ ] Create the production publishable key, service-role key and JWT secret. Do not reuse a development key.
- [ ] Put the values only in the host secret store. Never in a repository file or a browser bundle.
- [ ] Update `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`, `APP_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- [ ] Rebuild the web app with the production public values, because `NEXT_PUBLIC_*` is baked into the bundle.
- [ ] Search the built web assets for the old project host and confirm no match.
- [ ] Revoke the development service-role key after the cutover, so an old copy cannot reach production.

**Verify isolation before release**
- [ ] Register one synthetic production workspace and confirm it sees only its own tenant.
- [ ] Confirm a cross-tenant read returns 403 and a missing credential returns 401.
- [ ] Confirm the retention panel shows the seeded TRACES window and one save writes `retention.policy_changed`.
- [ ] Confirm no development row, account or trace is visible.
- [ ] Run `npm run e2e:live` against the production origin and record the result.

**Release and observation**
- [ ] Run the smoke tests in section 6.1 against the production origin.
- [ ] Record the deployment id, commit SHA, migration names, key rotation time and smoke results.
- [ ] Watch error rate, p95 latency, queue depth and audit/trace presence for the agreed observation window.
- [ ] Keep the previous artifacts until the owner signs the release. Roll back by redeploying them; migrations are additive.

## 7. Operations
- T6.03 smoke and rollback steps live in section 6.1. Run them against the single environment; do not create a staging project (D-37).
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
| `Evaluation runner is not configured for this deployment` (503) | No `EVALUATION_SUBJECT` provider is registered in this environment | Register the evaluation runner; do not bypass the publish gate (ARCHITECTURE D-23) |
| Not yet observed | Application has not been scaffolded or run | Record exact error, command, environment and recovery after reproducing |
