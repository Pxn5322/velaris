# Evidence — production cutover checklist

Date: 2026-11-10; decision recorded 2026-11-11. Preparation only; no production action ran. The owner held the release.

## Verified now

- T6.03 deployment, hosted smoke, cleanup, TLS verification and rollback rehearsal passed on the single environment.
- T6.07 hosted Auth verification passed:
  - a real Supabase recovery email was delivered to a disposable inbox;
  - the link used `redirect_to=https://velaris-web-bice.vercel.app/auth/callback`;
  - the recovery page removed the fragment, updated the password and a new-password login returned 200;
  - a real confirmation email was delivered, the page showed `Email confirmed`, and the confirmed login returned 200.
- The hosted retention History panel was inspected with a signed-in synthetic tenant. `KNOWLEDGE 365` and `MEMORY 30` produced two `retention.policy_changed` rows, and the filtered audit link was present.
- The final cleanup dry run reported zero synthetic tenants and zero synthetic Auth accounts.
- The owner approved cutover preparation on 2026-11-10.
- A free-plan Singapore candidate project (`wibajihrywsdxgcxikfl`) was created in `ap-southeast-1`.
- All nine tracked Prisma migrations applied to the empty candidate. Six system roles and the `vector` extension were verified.
- The authenticated retention profile ran with the Render Singapore API and the candidate database in the same region:
  - first run p95 1094.14 ms, 165/165 HTTP 200, zero errors;
  - warm run p95 994.47 ms, 195/195 HTTP 200, zero errors.
- Both results exceed the 200 ms budget. NFR-04 remains unmet.
- The previous Render `DATABASE_URL` was restored. Deploy `dep-dbpfudegekts739rjpt0` is live; API `/` returned 200 and the protected retention route returned 401.
- The two synthetic tenants and two Auth users were deleted. The candidate tenant count is 0.
- The temporary secret files were deleted.

## What the same-region run shows

- Cross-region database distance is not the only cause of the over-budget p95.
- The free Render instance is a likely remaining limit.
- The candidate proves the migration chain works on an empty project.
- The candidate has no backups or PITR and is not a production target.

`docs/SETUP_GUIDE.md` section 6.2 holds the controlled cutover (D-37). Section 6.4 holds the candidate settings and results.

## Recorded decision (2026-11-11)

The owner reviewed this package and decided to hold the MVP release. T6.04 is not approved and GATE-6 stays open (D-41). The hold stays until these conditions close:
- paid always-on hosting and a same-region production database, with the authenticated retention p95 under 200 ms;
- production backups or PITR and one recorded restore drill;
- custom domain and production Auth redirect URLs and keys;
- key rotation and a development data clear;
- reconciliation of the development database migration history;
- a new owner decision that approves T6.04 and GATE-6.

No production action ran.

## Conditions for the next review

1. **Production performance plan.** Choose paid always-on hosting and a same-region production database. Then repeat the NFR-04 profile and show p95 under 200 ms.
2. **Production cutover.** Provision the production project and region, plan and spend, backups or PITR plus one restore drill, paid hosting, a domain, key rotation and clearing development data.
3. **Release approval.** Record a new owner decision on T6.04/GATE-6 after conditions 1 and 2 close. This agent cannot self-approve production.

## What was not done

- No production Supabase project, backup, restore drill, migration deploy or key rotation ran.
- No production hosting upgrade, custom domain or DNS change ran.
- No development data was deleted outside the disposable checks described above.
- No candidate Auth redirect URLs or keys were configured, because the candidate is not a production target.
- No production deployment or release approval ran. The owner decided to hold the release on 2026-11-11.

## Next step

Close the conditions in section 6.2 in order and record each result in `docs/TESTING.md` section 9. Then request a new release decision. No automated production deployment exists.
