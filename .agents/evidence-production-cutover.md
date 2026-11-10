# Evidence — production cutover checklist

Date: 2026-11-10. Preparation only; no production action ran. Owner approval is still required.

## Verified now

- T6.03 deployment, hosted smoke, cleanup, TLS verification and rollback rehearsal passed on the single environment.
- T6.07 hosted Auth verification passed:
  - a real Supabase recovery email was delivered to a disposable inbox;
  - the link used `redirect_to=https://velaris-web-bice.vercel.app/auth/callback`;
  - the recovery page removed the fragment, updated the password and a new-password login returned 200;
  - a real confirmation email was delivered, the page showed `Email confirmed`, and the confirmed login returned 200.
- The hosted retention History panel was inspected with a signed-in synthetic tenant. `KNOWLEDGE 365` and `MEMORY 30` produced two `retention.policy_changed` rows, and the filtered audit link was present.
- The final cleanup dry run reported zero synthetic tenants and zero synthetic Auth accounts.
- The same-region p95 is not measured. Render Singapore and Supabase Tokyo remain in different regions; the cross-region warm p95 is 1350.52 ms at concurrency 8, over the 200 ms budget.

`docs/SETUP_GUIDE.md` section 6.2 holds the controlled cutover (D-37).

## Owner decisions still required

1. **Same-region performance.** Choose either a Tokyo host for the NestJS API or a Singapore Supabase project. Neither exists. A new service or project needs explicit approval and credentials; an existing provider region cannot be changed.
2. **Production cutover.** Approve the production project and region, plan and spend, backups or PITR plus one restore drill, paid hosting, a domain, key rotation, clearing development data and reconciliation of the missing Prisma migration history.
3. **Release approval.** Review the evidence and approve T6.04/GATE-6. This agent cannot self-approve production.

## What was not done

- No production Supabase project, backup, restore drill, migration deploy or key rotation ran.
- No production hosting upgrade, custom domain or DNS change ran.
- No development data was deleted outside the disposable checks described above.
- No production deployment or release approval ran.

## Next step

The owner answers decisions 1 and 2. Then execute section 6.2 in order, record each result in `docs/TESTING.md` section 9, and request release approval. No automated production deployment exists.
