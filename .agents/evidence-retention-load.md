# Evidence — authenticated load profile, retention settings

Date: 2026-11-05. Target: built API on `http://127.0.0.1:3000`, database and
Supabase Auth in the development project. Token: a synthetic tenant
administrator created by `POST /auth/signup`.

## Command

The original manual form keeps the token in the shell:

```bash
node scripts/load-profile.mjs --url http://127.0.0.1:3000 \
  --path "/settings/retention?tenantId=<uuid>" \
  --header "Authorization: Bearer $TOKEN" \
  --concurrency 8 --duration 10 --out /tmp/retention-load.json
```

The one-command form for T6.03 creates the tenant, token and path itself.
`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` must be in the environment:

```bash
node scripts/load-profile.mjs --url http://127.0.0.1:3000 \
  --path "/settings/retention?tenantId={tenantId}" --auth-signup \
  --concurrency 1 --duration 2 --warmup 0 --out retention-load.json
```

The script printed the synthetic email and tenant id, and the JSON report
recorded only `auth.mode`, `auth.email` and `auth.tenantId`. A search of the
report found no `access_token` and no password field. The generated password
and the token were never printed.

## Result against the 200 ms budget

| Run | Statuses | Requests | p50 | p95 | p99 | Errors | Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |
| concurrency 8, 10 s | 200x64 | 64 | 1263.67 ms | 1445.18 ms | 1501.97 ms | 0 | fail |
| concurrency 1, 5 s | 200x5 | 5 | 1222.52 ms | 1257 ms | 1257 ms | 0 | fail |
| concurrency 1, 2 s, `--auth-signup` | 200x2 | 2 | 1227.04 ms | 1243.75 ms | 1243.75 ms | 0 | fail |

Every response was 200. No request failed. The route returned the seeded
retention rows, so the measurement covers the real read path.

## Why the local number is high

- `SupabaseTokenVerifier` calls `GET /auth/v1/user` on every request. Direct
  calls took 282.79 ms, 253.51 ms and 418.98 ms.
- `pg` `SELECT 1` took 102, 98, 99 and 101 ms per round trip to the development
  PostgreSQL instance.
- One retention read resolves the session, the membership, the tenant scope and
  the retention rows in sequence, so several 100 ms round trips add up.
- The same route without a credential answered 401 in p95 2.96 ms, because the
  guard rejects before any remote call.
- Public `GET /` answered in p95 1.65 ms with `MSYS_NO_PATHCONV=1`, which shows
  the local process and harness are fast.

At concurrency 1 the p95 stays at 1257 ms, so contention is not the cause.
Network distance to Supabase Auth and PostgreSQL is the cause.

## Panel link verification

`tests/retention.spec.js` now has seven journeys. The new journeys assert that
the panel shows `MEMORY · 7 days · actor user-1 · 2026-11-05 10:00:00 UTC` from
`GET /audit/events?limit=1&action=retention.policy_changed`, links to
`/audit#retention`, and hides the line when the audit read returns 403.

`tests/governance.spec.js` now has twelve journeys. The new journey opens
`/audit#retention`, sees `aria-pressed="true"` on the filter and confirms the
server request carried `action=retention.policy_changed`.

`npm run e2e:web` passed 51 journeys with 2 skipped. The focused retention and
governance run passed 19/19.

## Conclusion

NFR-04 is not proven by a loopback run against a remote database. The route
logic needs an in-region measurement. T6.03 must run the same authenticated
profile against the deployed origin before the budget is called met or missed.
This run does not change the budget, the route or the guard.

## Side effects

Three synthetic tenant administrators and their tenants exist in the development
project: two from the manual runs and `loadcheck-mw3rbv5u-78a981@velaris.test`
(tenant `0e1e6d60-39bf-4236-b07b-da103c6ba82f`) from the one-command run. D-37
covers clearing them before production. No token or key was printed.

## Possible follow-up, owner decision

A cached token verification or local JWKS verification would remove the remote
call from each request. Both change revocation behaviour, so they need a D-xx
decision and a security review. They are not implemented here.
