# Evidence — T6.03 preparation (single environment)

Date: 2026-11-05. This is preparation only; no deployment ran.

## What exists now

`docs/SETUP_GUIDE.md` section 6.1 holds the deployment checklist for the single
environment (D-37):

- the owner inputs that block the deploy: hosting target, public origins,
  database and Supabase values, web build variables and hosting approval;
- the pre-deploy checks on the commit to deploy;
- the controlled migration step and the artifact pair to keep for rollback;
- five smoke tests with exact commands: health, protected route 401,
  authorized tenant read, cross-tenant 403 and the live J-01 browser journey;
- the retention panel check with its `retention.policy_changed` audit row;
- a rollback rehearsal with the additive migration check and a three-attempt
  stop rule.

## What is still missing

- A hosting target for `apps/web` and `apps/api`. Without it, no smoke command
  has an origin to call.
- The deployment secrets. They stay outside the repository.
- Owner approval to spend on the hosting plan.

## Why no deployment was attempted

T6.03 requires a real origin and real secrets. A local run cannot prove TLS,
the deployed CORS allowlist, the migration step against the deployment
database or artifact rollback. The live registration journey runs locally
against the current Supabase project instead, which proves the identity and
tenant path but not the deployment.

## Next step

The owner supplies the hosting target and the secrets. Then follow
`SETUP_GUIDE` section 6.1 from the top and record each result in
`docs/TESTING.md` section 9.
