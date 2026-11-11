# Evidence — same-region authenticated retention load (T6.04 preparation)

Date: 2026-11-10. Owner approval: cutover preparation only. No production action ran.

## Scope

- Goal: measure NFR-04 with the API and PostgreSQL in the same region.
- The owner chose a Singapore Supabase project and approved cutover preparation.
- The test used a separate free-plan candidate project. It did not change the production target.

## Candidate

| Item         | Value                                                          |
| ------------ | -------------------------------------------------------------- |
| Project name | `velaris-singapore-candidate`                                  |
| Project ref  | `wibajihrywsdxgcxikfl`                                         |
| Region       | `ap-southeast-1` (Singapore)                                   |
| Engine       | PostgreSQL 15.19                                               |
| Plan         | Free                                                           |
| Connection   | Session pooler `aws-1-ap-southeast-1.pooler.supabase.com:5432` |
| API          | Render `srv-dbpe5arrjlhs73fm2or0`, Singapore, free plan        |

- The `aws-0` Singapore pooler host returned `tenant/user ... not found`; the `aws-1` host worked.
- Creating the project with `desired_instance_size` failed: `Instance size cannot be specified for free plan organizations.`
- The candidate accepted all nine tracked migrations from `prisma/migrations` on an empty database:
  - `0001_init`
  - `0002_roles_and_audit`
  - `0003_support_schema`
  - `0004_knowledge_schema`
  - `0005_agent_schema`
  - `0006_tool_definitions`
  - `0007_retention_lifecycle`
  - `0008_webhook_integrations`
  - `0009_retention_policy_defaults`
- A direct query confirmed six seeded roles and the `vector` extension before the run.
- The candidate held zero tenants before the run.

## Run

1. Save the current Render `DATABASE_URL` outside the repository.
2. Point `DATABASE_URL` at the candidate pooler and deploy. Deploy `dep-dbpfs33bc2fs73a33f7g` was live at `2026-11-10T11:22:39Z`.
3. Confirm the candidate holds the schema and the seeded roles.
4. Run the authenticated profile:
   `node --env-file=.env scripts/load-profile.mjs --url https://velaris-api-aral.onrender.com --path "/settings/retention?tenantId={tenantId}" --auth-signup --concurrency 8 --duration 10 --warmup 2 --budget-ms 200`
5. Repeat with `--warmup 5`.
6. Delete the synthetic tenants and Auth users.
7. Restore the previous `DATABASE_URL` and deploy.

## Results

| Run   | Warmup | Requests         | HTTP 200 | p95        | Errors | Report                                            |
| ----- | ------ | ---------------- | -------- | ---------- | ------ | ------------------------------------------------- |
| First | 2 s    | 165 (16.5 req/s) | 165      | 1094.14 ms | 0      | `.agents/evidence-t6.04-load-singapore.json`      |
| Warm  | 5 s    | 195 (19.5 req/s) | 195      | 994.47 ms  | 0      | `.agents/evidence-t6.04-load-singapore-warm.json` |

- Both runs exceed the 200 ms budget.
- The API and database were in the same region, so cross-region database distance is not the only constraint.
- The free Render instance remains a likely limit. The test did not isolate CPU, memory or cold-start behaviour.
- The candidate is a free-plan project with no backups or PITR. Do not treat it as production.
- NFR-04 remains unmet.

## Cleanup and restore

- Two synthetic tenants and two synthetic Auth users were deleted.
- The candidate tenant count returned to 0.
- The previous Render `DATABASE_URL` was restored. Deploy `dep-dbpfudegekts739rjpt0` finished live at `2026-11-10T11:27:42Z`.
- After the restore, `GET https://velaris-api-aral.onrender.com/` returned 200 and `GET /settings/retention?tenantId=...` without a token returned 401.
- The temporary `.env.candidate`, `.env.render-new` and `.env.render-backup` files were deleted. No secret value was printed or committed.

## Limits

- One run pair on one free instance is not a capacity study.
- The candidate Auth project was not configured with production redirect URLs or keys, because the candidate is not a production target.
- No backup, restore drill, key rotation or production deployment ran.

## Follow-up

- Repeat the profile on paid always-on hosting with a same-region database.
- If p95 stays over budget, profile the retention route database round trips and the token verification path.
- Keep NFR-04 open until the paid-hosted same-region run meets the budget.
