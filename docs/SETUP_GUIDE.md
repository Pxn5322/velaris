---
doc: SETUP_GUIDE
version: 0.1
status: Draft
owner: Engineering/operations owner
depends_on: [ARCHITECTURE, SECURITY, DATABASE]
---
# Setup Guide — VELARIS

Last verified: **2026-11-10** for the hosted deployment in sections 4, 6, 6.1, 6.3 and 6.4. Other sections remain proposed examples until they are rerun on a clean machine. Record the operator and date when a step is rerun.

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

**Current hosted deployment (2026-11-10).** `apps/web` runs on Vercel at `https://velaris-web-bice.vercel.app`. `apps/api` runs on Render at `https://velaris-api-aral.onrender.com`. Both use the current Supabase project and keys (D-37). Section 6.3 lists the exact settings and the manual steps.

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
| `NEXT_PUBLIC_API_URL` | Next.js browser client (`apps/web/src/lib/api/client.ts`); build-time value | no, public API origin | public app config; set it before the web build because Next.js bakes it into the bundle |
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

The deployed API uses the Supabase IPv4 session pooler because the direct database host has no IPv4 route. Use port 5432, username `postgres.<project-ref>` and `sslmode=verify-full`. Render runs `npm run start:prod --workspace apps/api` with `apps/api` as the working directory, so the deployed value is `sslrootcert=../../certs/supabase-root-2021.crt`. A command started at the repository root uses `sslrootcert=certs/supabase-root-2021.crt`. The committed certificate is the public Supabase Root 2021 CA. It is not a secret and expires on 2031-04-26. The pooler chain verifies fully with this root.

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
6. Recovery, invitation and confirmation links return to `/auth/callback`. The page reads the fragment, stores the session, removes the fragment from the address bar, and offers a new-password form for `type=recovery` and `type=invite`. A tenant admin invitation uses the same URL, so keep `/auth/callback` in the Supabase Auth redirect allowlist. GoTrue reads `redirect_to` for `/invite` from the query string, not the JSON body; the API sends it there so the link lands on `/auth/callback`. Product signup creates a confirmed account through the server admin API, so `/auth/signup` does not send a confirmation email; the confirmation page handles links created by Supabase Auth directly.
7. Hosted verification on 2026-11-10: real recovery and confirmation emails arrived at a disposable inbox. Both links carried the approved `/auth/callback` redirect. Recovery removed the fragment, updated the password, and a new-password login returned 200; confirmation showed `Email confirmed` and its login returned 200. A signed-in synthetic tenant saved `KNOWLEDGE 365` and `MEMORY 30`, and the History panel showed two `retention.policy_changed` rows. Cleanup left zero synthetic tenants and Auth accounts. See `.agents/evidence-t6.07.md`.
8. The built-in Supabase mailer allows 2 Auth emails per hour project-wide and cannot be raised without custom SMTP or a Send Email hook. Configure one before relying on invitations in production; a live invitation check hit that limit after two delivered emails on 2026-11-12.

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
- Hosting: Vercel hosts `apps/web` and Render hosts `apps/api` in Singapore. The current Supabase project is in `ap-northeast-1` (Tokyo), so the API crosses regions. A free-plan candidate project in `ap-southeast-1` (Singapore) was built from the nine tracked migrations on 2026-11-10 and measured over the 200 ms budget (section 6.4); the previous `DATABASE_URL` was restored. The current deployment is the single environment (D-37). Section 6.3 records the origins, settings and manual steps. Vercel Hobby and the Render free instance are development plans, not production commitments.
- Migrations must be reviewed and run as a controlled deploy step with a rollback/forward-fix strategy; destructive migrations require owner review.
- Environment: one deployment only until production (D-37). No staging project exists, so a live check targets the current environment with the current keys.
- Verify: 2026-11-10, the deployed API root returned 200, the protected retention route returned 401 without a token, the deployed web root returned 200, and the hosted smoke passed signup 201, login 200, own read 200, cross-tenant 403, retention save 200 and audit read 200. The authenticated retention p95 was 1350.52 ms at concurrency 8 with zero errors, over the 200 ms budget. The synthetic data cleanup returned zero remaining rows. The web and API rollback rehearsals passed. `npm run e2e:live` is the live registration check; it skips without `E2E_LIVE_API_URL`.

### 6.1 Single-environment deployment checklist (T6.03, D-37)
The first deployment ran on 2026-11-10. The deployment rows, the hosted smoke, cleanup, p95 measurement and rollback rehearsal are recorded. Unchecked items remain open.

**Owner inputs before deployment**
- [x] Hosting target: Vercel for `apps/web` and Render for `apps/api`, both with TLS.
- [x] Public web origin in `CORS_ORIGIN` and `APP_BASE_URL`; see section 6.3. The CORS preflight from the short alias returned 204.
- [x] `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SERVICE_ROLE_KEY` entered in the Render dashboard for the single environment. Values are not in this repository.
- [x] `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_API_URL` entered in the Vercel project for the web build.
- [ ] Approval to spend on a paid hosting plan. The current deployment uses Vercel Hobby and a Render free instance.

**Before the deploy**
- [ ] `npm run test`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run inventory:check` and `python scripts/check_docs.py --draft` pass on the commit to deploy. CI passed on `78e4327`; the full suite was not rerun for this deployment.
- [ ] `npx prisma migrate status` reports no pending migration against the deployment database. Not run against the development database. The repository now holds nine tracked migrations (`0001` to `0009`), and all nine applied cleanly to an empty candidate project on 2026-11-10 (section 6.4). Reconcile the development database before production.
- [ ] A database backup or snapshot exists, because migrations are forward-only. Not taken for this development deployment.
- [x] N/A: this is the first deployment, so no previous web or API artifact exists for rollback.

**Deploy**
- [x] N/A for this deployment: no schema change was applied. The repository now holds nine tracked migrations, and all nine applied cleanly to an empty candidate project on 2026-11-10 (section 6.4). Reconcile the development database before production.
- [x] Deploy the API to Render, then the web app to Vercel.
- [x] Record the deployment ids and commit SHA. First deploy: Render `dep-dbpedj942hec73cdnl6g` (first deploy `dep-dbpe5bbrjlhs73fm2qa0`), Vercel `dpl_3HqWrmxcy11cQyZnFhnhZK1YFxeK`, commit `78e4327`. Follow-up deploy: Render `dep-dbpepu3bc2fs73a0i8a0` then `dep-dbpert2jnfac73985n0g`, Vercel `dpl_32vtLnQUS1vW5nq1fpnioXGxdXSq`, commit `a725bdd`. T6.07 deploy: Vercel `dpl_DgWjALjWD12Y6aasX8moiRJK31U2` for commit `ea086f3`; `/auth/callback` returned 200 on the production alias.

**Smoke tests against the deployed origin**
```bash
# 1. Liveness: the API root answers 200 (no separate /health route exists)
curl -fsS -o /dev/null -w "%{http_code}\n" https://velaris-api-aral.onrender.com/

# 2. Protected route without a credential: expect 401
curl -s -o /dev/null -w "%{http_code}\n" "https://velaris-api-aral.onrender.com/settings/retention?tenantId=00000000-0000-0000-0000-000000000000"

# 3. Authorized tenant read: expect 200 and three categories
curl -s -H "Authorization: Bearer $TOKEN" "https://velaris-api-aral.onrender.com/settings/retention?tenantId=$TENANT_ID"

# 4. Cross-tenant denial: expect 403
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" "https://velaris-api-aral.onrender.com/settings/retention?tenantId=$OTHER_TENANT_ID"

# 5. Hosted smoke: cross-tenant 403, retention save and audit read-back
node --env-file=.env scripts/deployment-smoke.mjs \
  --url https://velaris-api-aral.onrender.com

# 6. Authenticated load: creates one synthetic tenant and fills {tenantId}
#    SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY must be in the shell.
node scripts/load-profile.mjs --url https://velaris-api-aral.onrender.com \
  --path "/settings/retention?tenantId={tenantId}" --auth-signup \
  --concurrency 8 --duration 10 --out retention-load.json

# 7. Remove synthetic load and smoke accounts. The first command is a dry run.
node --env-file=.env scripts/cleanup-load-tenants.mjs
node --env-file=.env scripts/cleanup-load-tenants.mjs --delete

# 8. Registration in a real browser (J-01): expect the admin view
E2E_LIVE_API_URL=https://velaris-api-aral.onrender.com E2E_BASE_URL=https://velaris-web-bice.vercel.app npm run e2e:live
```
- [x] Liveness returned 200 and the protected route returned 401 on 2026-11-10.
- [x] Hosted smoke passed on `a725bdd`: signup 201, login 200, own read 200, cross-tenant 403, retention save 200 and audit read 200. The audit row matched category `TRACES` and 45 days.
- [x] The retention panel has a ten-change recent history and links to the full filtered audit trail. Seven local retention journeys pass; the hosted panel was inspected on 2026-11-10 with a signed-in synthetic tenant, and `KNOWLEDGE 365` and `MEMORY 30` produced two history rows.
- [x] `node scripts/load-profile.mjs --auth-signup` recorded a warm p95 of 1350.52 ms at concurrency 8 with 90/90 responses, zero errors and 9 req/s. The budget is 200 ms, so NFR-04 is not met. Report: `.agents/evidence-t6.03-load-hosted.json`.
- [x] The same-region candidate run on 2026-11-10 measured p95 1094.14 ms and 994.47 ms at concurrency 8 with zero errors. Both are over the budget, so NFR-04 is still not met (section 6.4).
- [x] Cleanup removed seven synthetic tenants and seven Auth accounts across the initial and final runs; the final dry run reported zero.

**Rollback rehearsal**
- [x] Vercel rollback to immediate predecessor `dpl_CbaTyj8hZZ5mxP3ri3y152TrRFGD` answered 200 in about 20 s and was restored to `dpl_32vtLnQUS1vW5nq1fpnioXGxdXSq`. Hobby rejected a rollback to older `dpl_3HqWrmxcy11cQyZnFhnhZK1YFxeK` with HTTP 402, so only one step back was exercised.
- [x] Render rollback from `dep-dbpert2jnfac73985n0g` to `dep-dbpepu3bc2fs73a0i8a0` created `dep-dbpet2s9v7es73bn764g` live in 53 s; `/` answered 200 and the protected route 401. Roll-forward to `dep-dbpetitbedkc738i7plg` went live in 34 s and passed the full smoke.
- [x] No schema migration was needed for the rollback. The repository now holds nine tracked migrations, and all nine applied cleanly to an empty candidate project on 2026-11-10 (section 6.4).
- [x] No rollback attempt failed three times and no database restore ran. A rollback target must contain `certs/supabase-root-2021.crt`; both tested API builds did.

**After the smoke**
- [x] Recorded the evidence in `docs/TESTING.md` section 9 and `.agents/evidence-t6.03-hosted.md`.
- [ ] Ask the owner for release approval. No automated production deployment exists.

### 6.2 Production cutover checklist (D-37, T6.04)
The single development environment becomes production only through this controlled cutover. Do not copy development data into production.

**Preconditions**
- [x] T6.03 smoke tests and the rollback rehearsal passed on the deployed single environment.
- [x] `docs/TESTING.md` section 9 records the hosted Auth and retention results (2026-11-10).
- [ ] The owner approves the cutover. On 2026-11-11 the owner held the release: T6.04 is not approved and GATE-6 stays open (D-41). The conditions below remain open.
- [ ] The production Supabase project exists in the approved region and plan, with backups or PITR confirmed and one restore drill recorded.
- [ ] The hosting provider, domains and TLS are approved, and the spend is authorised.

**Clear development data**
- [ ] Export nothing that contains real or customer data. Development holds synthetic data only.
- [ ] Delete the synthetic Supabase auth accounts created by checks and journeys.
- [ ] Delete the tenant rows and their children through the controlled SQL path, in foreign-key order, or recreate the project if the owner prefers a clean start.
- [ ] Verify every application table returns zero rows: tenants, users, memberships, customers, conversations, messages, tickets, knowledge, agents, audit, traces, memory, retention and integrations.
- [ ] Keep the migration history (`_prisma_migrations`) and the seeded system roles; they are schema, not data.

**Provision production**
- [ ] Run `npx prisma migrate deploy` against the production connection string as a controlled step. Confirm the same migration names as the verified commit. Rehearsed on the Singapore candidate on 2026-11-10: all nine tracked migrations applied to an empty project (section 6.4).
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

### 6.3 Current hosted deployment (2026-11-10)
The single environment runs on two providers. Section 6.1 records the smoke checks, including the authorized tenant read, and the checks that remain open.

| Component | Provider | Public origin | Identifier |
| --- | --- | --- | --- |
| Next.js web | Vercel | `https://velaris-web-bice.vercel.app` | project `velaris-web`, `prj_ap7V5JjX0ux88ZNwloN4uVdnuPI8` |
| NestJS API | Render | `https://velaris-api-aral.onrender.com` | service `velaris-api`, `srv-dbpe5arrjlhs73fm2or0`, Singapore, free plan |
| Auth and PostgreSQL | Supabase | current project | project `lygekvhwmhbonsdeiaot`, region `ap-northeast-1` (Tokyo), D-37 single environment |

**Vercel settings**
- Repository `Pxn5322/velaris`, production branch `master`, root directory `apps/web`.
- Framework `nextjs`. Vercel selected Node `26.x`; CI uses Node 24. The build passed on Node 26.
- Install command `cd ../.. && npm ci`; build command `cd ../.. && npm run build:web`.
- Build variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_API_URL=https://velaris-api-aral.onrender.com`.
- Aliases: `velaris-web-bice.vercel.app`, `velaris-web-pxn5322s-projects.vercel.app` and `velaris-web-git-master-pxn5322s-projects.vercel.app`.
- Git auto-deploy is enabled. A push to `master` creates a production deployment. Vercel can stage a deployment without assigning the short alias, so check `aliasAssigned` and the production alias after each push.

**Render settings**
- Repository `Pxn5322/velaris`, branch `master`, root directory empty.
- Runtime Node, region Singapore, one instance, free plan.
- The API reaches PostgreSQL through the Supabase session pooler at `aws-0-ap-northeast-1.pooler.supabase.com:5432`. The direct `db.<ref>.supabase.co` host is IPv6-only and fails on Render with `ENETUNREACH`.
- The API verifies the pooler chain with the committed Supabase Root 2021 CA and `sslmode=verify-full`. The certificate is public, not a secret.
- Build command `npm ci --include=dev && npx prisma generate && npm run build:api`; start command `npm run start:prod --workspace apps/api`. The `--include=dev` flag is required because `NODE_ENV=production` makes `npm ci` omit `nest` and `prisma`, and the build then fails with `sh: 1: nest: not found`.
- Health check path `/`; the API has no separate `/health` route.
- Environment names: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NODE_ENV=production`, `CORS_ORIGIN` and `APP_BASE_URL`.
- `CORS_ORIGIN` lists the three Vercel aliases. `APP_BASE_URL` is the short alias.
- Auto-deploy is off. Use Manual Deploy in the Render dashboard.

**Manual recreation or change**
1. Vercel: import `Pxn5322/velaris`, set root `apps/web`, set the install and build commands above, add the three public variables, then deploy `master`.
2. Render: create a Web Service from `Pxn5322/velaris` on branch `master`, then set the runtime, region, plan, build, start and health values above.
3. Enter the secret values in the provider dashboards. Never add them to this repository.
4. Supabase Auth is configured: Site URL `https://velaris-web-bice.vercel.app`; allowlist `https://velaris-web-bice.vercel.app`, `https://velaris-web-bice.vercel.app/**`, both other Vercel aliases with `/**`, and `http://localhost:3000` / `http://localhost:3001` with `/**`. A configuration read verified these values. Real recovery and confirmation emails were delivered on 2026-11-10; both links used the approved callback, and the password update and confirmed login passed.
5. Redeploy the API after a `CORS_ORIGIN` change. Redeploy the web app after a `NEXT_PUBLIC_*` change, because Next.js bakes public values into the build.
6. For a custom domain, add it in Vercel, then replace the aliases in `CORS_ORIGIN` and `APP_BASE_URL`, and add it to the Supabase Auth allowlist.

**Known limits**
- The Vercel account is on the Hobby plan. Vercel does not allow commercial use on Hobby; upgrade to Pro before production. Hobby rolls back only one production deployment and rejects older targets with HTTP 402.
- The Render service uses a free instance. It sleeps after idle, so the first request is slow. Use a paid always-on instance for the T6.03 p95 run and production.
- No custom domain exists yet.
- The development database still has no recorded application of the tracked migrations. The repository holds nine migrations (`0001` to `0009`), and all nine applied cleanly to an empty candidate project on 2026-11-10. Reconcile the development database or create production from the migration chain (T6.04).
- `DATABASE_URL` uses the Supabase session pooler `aws-0-ap-northeast-1.pooler.supabase.com:5432`, username `postgres.lygekvhwmhbonsdeiaot`, `?sslmode=verify-full` and `sslrootcert=../../certs/supabase-root-2021.crt` on Render. The Render start command runs in `apps/api`, so the path goes up two levels to the repository root. The direct host is IPv6-only.
- The committed CA expires on 2031-04-26. Replace it before then, or enable the Supabase IPv4 add-on and use the direct host.
- Render Singapore and Supabase Tokyo are different regions. On 2026-11-10 the warm authenticated read measured p95 1350.52 ms at concurrency 8 (90 requests, 9 req/s, zero errors), over the 200 ms budget. A same-region candidate then measured p95 994.47 ms, also over the budget (section 6.4), so the free instance remains a likely constraint. NFR-04 is not met.

**Deployment evidence**
| Check | Result |
| --- | --- |
| API root | 200 on `dep-dbpetitbedkc738i7plg` |
| Protected retention route without a token | 401 |
| Web root | 200 on `dpl_DgWjALjWD12Y6aasX8moiRJK31U2` (commit `ea086f3`) |
| `/auth/callback` | 200 on the production alias; recovery and confirmation links accepted |
| Hosted Auth email | Real recovery and confirmation delivered; callback redirect; password update and confirmed login returned 200 |
| Hosted retention history | Two `retention.policy_changed` rows from `KNOWLEDGE 365` and `MEMORY 30`; cleanup zero |
| Hosted smoke | signup 201, login 200, own read 200, cross-tenant 403, save 200, audit 200 |
| Vercel deployment | `dpl_32vtLnQUS1vW5nq1fpnioXGxdXSq` READY; aliases assigned; rollback to `dpl_CbaTyj8hZZ5mxP3ri3y152TrRFGD` and forward passed |
| Vercel T6.07 deployment | `dpl_DgWjALjWD12Y6aasX8moiRJK31U2` READY for `ea086f3`; aliases assigned |
| Render deployment | `dep-dbpetitbedkc738i7plg` live; rollback to `dep-dbpet2s9v7es73bn764g` and forward passed |
| CORS allowlist | Preflight from `https://velaris-web-bice.vercel.app` returned 204 with `access-control-allow-origin` |
| Authorized retention read | 90/90 200, zero errors, p95 1350.52 ms at concurrency 8; over the 200 ms budget |
| Database TLS | `verify-full` with Supabase Root 2021 CA; hosted smoke passed |
| Supabase Auth | Site URL and redirect allowlist set and read back; real recovery and confirmation delivery verified |

Open: NFR-04 remains unmet on the free instance even with both services in Singapore. The owner held the release on 2026-11-11: T6.04 is not approved and GATE-6 stays open (D-41). Production cutover remains.

### 6.4 Same-region performance candidate (T6.04 preparation)
The owner approved this preparation on 2026-11-10. The test used a separate free-plan Supabase project and did not change the production target.

| Item | Value |
| --- | --- |
| Candidate project | `velaris-singapore-candidate`, ref `wibajihrywsdxgcxikfl` |
| Region and engine | `ap-southeast-1` (Singapore), PostgreSQL 15.19, free plan |
| Schema | Nine tracked migrations, `0001_init` through `0009_retention_policy_defaults`, applied to an empty database |
| Seed | Six system roles and the `vector` extension verified |
| Connection | Session pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432` |
| API | Render Singapore `srv-dbpe5arrjlhs73fm2or0`, free instance |

**Run**
1. Save the current Render `DATABASE_URL` outside the repository.
2. Set `DATABASE_URL` to the candidate pooler and deploy. Deploy `dep-dbpfs33bc2fs73a33f7g` was live at `2026-11-10T11:22:39Z`.
3. Confirm the candidate holds the schema and the seeded roles. A direct query reported zero tenants before the run.
4. Run the profile:
   `node --env-file=.env scripts/load-profile.mjs --url https://velaris-api-aral.onrender.com --path "/settings/retention?tenantId={tenantId}" --auth-signup --concurrency 8 --duration 10 --warmup 2 --budget-ms 200`
5. Repeat with `--warmup 5` for a warm run.
6. Delete the two synthetic tenants and two Auth accounts. The candidate tenant count returned to 0.
7. Restore the previous `DATABASE_URL` and deploy. Deploy `dep-dbpfudegekts739rjpt0` finished live at `2026-11-10T11:27:42Z`; API `/` returned 200 and the protected retention route returned 401.

**Results**
| Run | Warmup | Requests | HTTP 200 | p95 | Budget | Errors |
| --- | --- | --- | --- | --- | --- | --- |
| First | 2 s | 165 (16.5 req/s) | 165 | 1094.14 ms | 200 ms | 0 |
| Warm | 5 s | 195 (19.5 req/s) | 195 | 994.47 ms | 200 ms | 0 |

Both runs exceed the 200 ms budget. The API and database were in the same region, so cross-region database distance is not the only constraint. The free Render instance remains a likely limit; its CPU, memory and cold-start behaviour were not isolated by this test. The candidate is a free-plan test project with no backups or PITR. Do not treat it as production or claim NFR-04 is met. Reports: `.agents/evidence-t6.04-load-singapore.json` and `.agents/evidence-t6.04-load-singapore-warm.json`; `.agents/evidence-t6.04-inregion.md` holds the full sequence.

## 7. Operations
- T6.03 smoke and rollback steps live in section 6.1. Run them against the single environment; do not create a staging project (D-37).
- Monitoring: API error rate and p50/p95/p99 latency, queue depth/failures, provider availability, ingestion failures, AI evaluation/grounding/citation failures, cost, audit completeness and deployment health.
- Release: run all gates, deploy to the single environment, smoke test, review telemetry, obtain human production approval, then use the provider's verified process.
- Rollback: restore previous app artifact/config where safe; use forward fixes or tested restore for incompatible migrations. Agent rollback selects a prior immutable published version and preserves history.
- Smoke tests: health endpoint; protected endpoint returns 401 without credentials; one allowed tenant-scoped read; cross-tenant read denied; AI provider/queue health; audit/trace sample present.
- Verify: T6.03 evidence is in `.agents/evidence-t6.03-hosted.md` and `docs/TESTING.md`; record the deployment ID, test outputs, owner approval and rollback rehearsal result. The same-region candidate evidence is in section 6.4 and `.agents/evidence-t6.04-inregion.md`.

## 8. Checklists and troubleshooting
- [ ] Local: services healthy, migrations apply, app runs, tests pass, tenant isolation tests pass.
- [ ] Staging/production: keys separate per environment, least-privilege roles, backups/restore confirmed, secrets only in secret stores, MFA on every account.
- [ ] Before production AI use: provider data terms reviewed, retention policy approved, evaluation thresholds established, no compliance claim without evidence.

| Symptom (exact error) | Likely cause | Fix |
| --- | --- | --- |
| `Evaluation runner is not configured for this deployment` (503) | No `EVALUATION_SUBJECT` provider is registered in this environment | Register the evaluation runner; do not bypass the publish gate (ARCHITECTURE D-23) |
| Not yet observed | Application has not been scaffolded or run | Record exact error, command, environment and recovery after reproducing |
