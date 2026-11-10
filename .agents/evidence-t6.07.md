# T6.07 — Supabase Auth email links

Date: 2026-11-10
Branch: `feature/auth-email-links`
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

## Hosted checks still required
- Send a real recovery email to a disposable inbox and open the link against the Vercel origin.
- Send a real confirmation email to a disposable inbox and open the link.
- Confirm the email link contains the approved `/auth/callback` redirect.
- Inspect the hosted retention History panel with a signed-in synthetic tenant.

## Note
`POST /auth/signup` creates an already-confirmed account through the Supabase admin API, so the product signup journey does not send a confirmation email. The confirmation page supports Supabase Auth confirmation links; it does not change the signup contract.
