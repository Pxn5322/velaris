# T6.07 — Supabase Auth email links

Date: 2026-11-10
Branch: `feature/auth-email-links`
Follow-up branch: `test/T6.07-hosted-evidence`
Decision: D-03 (Supabase Auth remains the identity provider)

## Implemented
- `apps/web/src/app/auth/callback/page.tsx` accepts recovery and confirmation links.
- The page stores the fragment session, removes the token from the address bar and offers a new-password form for `type=recovery`.
- `apps/web/src/lib/auth/session.ts` adds `storeSession`, `requestPasswordReset` and `updatePassword`.
- `LandingAuthModal` adds a "Forgot password?" request path and an account-enumeration-safe notice.

## Local evidence
- `npm run test`: 648/648 (626 API in 66 files, 22 ai-evals).
- `npm run e2e:web`: 56 passed, 2 skipped (the live registration spec) in 21.6 s.
- Focused `npx playwright test tests/auth-recovery.spec.js`: 5/5.
- `npm run typecheck`: exit 0.
- `npm run lint`: exit 0 with 14 known warnings.
- `npm run format:check`: exit 0.
- `npm run build:web`: exit 0; `/auth/callback` is in the route table.

## Hosted evidence (2026-11-10)
- Vercel deployment `dpl_DgWjALjWD12Y6aasX8moiRJK31U2` for commit `ea086f3` served `/auth/callback` with HTTP 200. The production alias `https://velaris-web-bice.vercel.app` answered 200.
- Recovery: a real Supabase email arrived at a disposable Mail.tm inbox. The link carried `redirect_to=https://velaris-web-bice.vercel.app/auth/callback`. The page removed the fragment, accepted a new password, and a password login with the new value returned 200.
- Confirmation: a real Supabase confirmation email arrived at the same inbox. Its link carried the same callback redirect. The page showed `Email confirmed`, and a password login after confirmation returned 200.
- The two sends stayed within the configured email limit of two messages per hour. No token, link or password entered the repository or the terminal output.
- Hosted retention: a disposable tenant signed in through the deployed form, saved `KNOWLEDGE 365` and `MEMORY 30`, and the Admin → System Settings → Data retention History panel showed two `retention.policy_changed` rows. The filtered audit link was present.
- Cleanup: the final dry run reported zero synthetic tenants and zero synthetic Auth accounts.
- Screenshots captured during the run: `.agents/auth-recovery-hosted.png`, `.agents/auth-confirmation-hosted.png`, `.agents/retention-history-hosted.png` (local run artifacts, not committed).
- Hosted smoke: API root 200, protected retention route without a token 401, web root 200.

## Still open
- NFR-04: no same-region API and database p95 exists. Render Singapore and Supabase Tokyo are different regions. The cross-region warm p95 remains 1350.52 ms at concurrency 8, over the 200 ms budget.
- T6.04 and GATE-6: owner approval and the production cutover remain open. A production Supabase project, backups/PITR, paid hosting, a domain, key rotation and a clean migration history are not in place.

## Note
`POST /auth/signup` creates an already-confirmed account through the Supabase admin API, so the product signup journey does not send a confirmation email. The confirmation page supports Supabase Auth confirmation links; it does not change the signup contract.
