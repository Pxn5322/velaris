# T6.03 hosted deployment evidence (2026-11-10)

Commit: `a725bdd78ddcd127241a4cec8c440d4c82fd01e7`

## Artifacts

| Component | Current artifact | Result |
| --- | --- | --- |
| Vercel web | `dpl_32vtLnQUS1vW5nq1fpnioXGxdXSq` | READY; production aliases assigned |
| Render API | `dep-dbpert2jnfac73985n0g`, then roll-forward `dep-dbpetitbedkc738i7plg` | live |
| Supabase database | `lygekvhwmhbonsdeiaot` | TLS `verify-full` with the committed Supabase Root 2021 CA |

The API deploy with `sslrootcert=certs/supabase-root-2021.crt` failed with
`ENOENT`. Render runs `npm run start:prod --workspace apps/api` from
`apps/api`, so the deployed value is
`sslrootcert=../../certs/supabase-root-2021.crt`. The corrected deploy was
`dep-dbpepu3bc2fs73a0i8a0`, live at 10:09:37 UTC.

## Hosted smoke

Command:

```bash
node --env-file=.env scripts/deployment-smoke.mjs --url https://velaris-api-aral.onrender.com
```

The smoke passed on `dep-dbpepu3bc2fs73a0i8a0` and again on the final
roll-forward `dep-dbpetitbedkc738i7plg`:

| Check | HTTP |
| --- | --- |
| Signup | 201 |
| Password login | 200 |
| Own retention read | 200 |
| Cross-tenant retention read | 403 |
| Retention save (TRACES, 45 days) | 200 |
| Retention audit read-back | 200 |

The audit read found the matching `retention.policy_changed` row with category
`TRACES` and 45 days.

## Load profile

Command:

```bash
node --env-file=.env scripts/load-profile.mjs \
  --url https://velaris-api-aral.onrender.com \
  --path "/settings/retention?tenantId={tenantId}" \
  --auth-signup --concurrency 8 --duration 10 --warmup 3 \
  --out .agents/evidence-t6.03-load-hosted.json
```

| Metric | Value |
| --- | --- |
| Requests | 90, all HTTP 200 |
| Throughput | 9 req/s |
| Mean | 915.32 ms |
| p50 | 825.31 ms |
| p90 | 1293.12 ms |
| p95 | 1350.52 ms |
| p99 | 1391.14 ms |
| Errors | 0 |

NFR-04 is not met: the p95 budget is 200 ms. The measured host is a Render free
instance in Singapore and the database is in Tokyo. The token cache removes
repeated Supabase Auth checks, but the database round trips remain cross-region.
The script exited 1 because the budget failed, which is the expected result for
this measurement.

## Cleanup

The dry run found six synthetic tenants and six Auth accounts. The delete run
removed all six tenants and all six accounts. A later dry run reported zero. The
final smoke created one tenant and one account; the cleanup after that smoke
removed both.

## Rollback rehearsal

Vercel:

- Rolled back to immediate predecessor `dpl_CbaTyj8hZZ5mxP3ri3y152TrRFGD`.
  `https://velaris-web-bice.vercel.app/` returned 200 about 20 s later.
- Restored `dpl_32vtLnQUS1vW5nq1fpnioXGxdXSq`; the alias was assigned again.
- Hobby rejected an older target, `dpl_3HqWrmxcy11cQyZnFhnhZK1YFxeK`, with HTTP
  402: “To rollback further than the previous production deployment, upgrade to
  pro.” Only one step back is available on this plan.

Render:

- Rolled back from `dep-dbpert2jnfac73985n0g` to
  `dep-dbpepu3bc2fs73a0i8a0`. Render created
  `dep-dbpet2s9v7es73bn764g`, live in 53 s.
- During the rollback, `GET /` returned 200 and the protected retention route
  returned 401.
- Rolled forward to `dep-dbpert2jnfac73985n0g`; Render created
  `dep-dbpetitbedkc738i7plg`, live in 34 s. The full hosted smoke passed on this
  build.
- No schema migration ran. A rollback target must contain
  `certs/supabase-root-2021.crt`; both tested API builds did.

## Supabase Auth

`SUPABASE_GET_AUTH_CONFIG` read back:

- Site URL: `https://velaris-web-bice.vercel.app`
- Allowlist: `https://velaris-web-bice.vercel.app`,
  `https://velaris-web-bice.vercel.app/**`, the two other Vercel aliases with
  `/**`, and `http://localhost:3000` / `http://localhost:3001` with `/**`.

The configuration is correct. Recovery and confirmation email delivery was not
exercised.

## Residual risks

1. NFR-04 remains unmet on the cross-region free instance.
2. Vercel Hobby permits only one rollback step and is not approved for
   commercial use.
3. The hosted retention panel was not manually inspected.
4. Auth email delivery and the post-click callback were not exercised.
5. No migration history exists in the repository; reconcile it before
   production.
