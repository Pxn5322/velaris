# Evidence — authenticated load profile, retention settings

Date: 2026-11-05. Target: built API on `http://127.0.0.1:3000`, database and
Supabase Auth in the development project. Token: a synthetic tenant
administrator created by `POST /auth/signup`.

## Command

```bash
node scripts/load-profile.mjs --url http://127.0.0.1:3000 \
  --path "/settings/retention?tenantId=<uuid>" \
  --header "Authorization: Bearer $TOKEN" \
  --concurrency 8 --duration 10 --out /tmp/retention-load.json
```

The script now accepts repeated `--header "Name: value"` options. The token
stays in the shell; the printed table and the JSON contain no credential.

## Result against the 200 ms budget

| Run | Statuses | Requests | p50 | p95 | p99 | Errors | Budget |
| --- | --- | --- | --- | --- | --- | --- | --- |
| concurrency 8, 10 s | 200x64 | 64 | 1263.67 ms | 1445.18 ms | 1501.97 ms | 0 | fail |
| concurrency 1, 5 s | 200x5 | 5 | 1222.52 ms | 1257 ms | 1257 ms | 0 | fail |

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

## Conclusion

NFR-04 is not proven by a loopback run against a remote database. The route
logic needs an in-region measurement. T6.03 must run the same authenticated
profile against the deployed origin before the budget is called met or missed.
This run does not change the budget, the route or the guard.

## Side effects

Two synthetic tenant administrators and their tenants exist in the development
project (`loadcheck-<stamp>@velaris.test`, `loadcheck-b-<stamp>@velaris.test`).
D-37 covers clearing them before production. No token or key was printed.

## Possible follow-up, owner decision

A cached token verification or local JWKS verification would remove the remote
call from each request. Both change revocation behaviour, so they need a D-xx
decision and a security review. They are not implemented here.
