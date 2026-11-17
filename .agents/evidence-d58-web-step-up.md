# D-58 web step-up dialog evidence

Date: 2026-11-17
Status: pass for the live browser dialog, first-time TOTP enrollment and the denied-then-granted role write; D-58 remains Blocked on the remaining owner and operations items.

## Scope

- Development Supabase project: `lygekvhwmhbonsdeiaot.supabase.co`.
- Local API: `http://localhost:3000`.
- Local production web build: `http://localhost:3001`, built with `NEXT_PUBLIC_API_URL=http://localhost:3000`.
- One synthetic account only: `smokecheck-mfa-web-*@velaris.test`.
- No existing, human, owner, customer or production account was created, changed, enrolled or deleted.
- The browser printed no password, access token, refresh token, TOTP secret or QR payload.

## Browser result

| Check | Observed |
| --- | --- |
| Synthetic signup | 201; tenant `65facc83-bd40-4ac9-ace3-16f018c18cf5` |
| Browser session | 200; `R-tenant-admin`; role list 200 |
| First role write, before TOTP | 403 `MFA_REQUIRED` |
| Step-up dialog | opened in the Roles & RBAC panel |
| First-time TOTP enrollment | enrollment form shown; secret used only in memory |
| Step-up before TOTP | 403 `MFA_REQUIRED` |
| Step-up after TOTP | 200; grant issued |
| Browser session token after verification | `aal` `aal2`; `session_id` present |
| Granted retry of the same role write | 201; role `R-web-mfa-mwkkazzq-0656c8` |
| Success notice | `Web MFA mwkkazzq-0656c8 was created.` |
| New role card | visible |

The first denial is `MFA_REQUIRED`, not `STEP_UP_REQUIRED`, because the initial browser token is `aal1`. The API's `STEP_UP_REQUIRED` path after `aal2` is covered by `.agents/evidence-d58-password-mfa-tests.md`.

## Cleanup

The verifier ran `scripts/cleanup-load-tenants.mjs --delete --email <synthetic email>` after the browser closed. It reported `cleanup: "removed"`. The follow-up dry run reported zero synthetic tenants and zero synthetic accounts.

## Artifacts

- `.agents/evidence-d58-web-step-up.json` contains the status-only machine record.
- `.agents/verify-d58-web-step-up.mjs` is the browser verifier.
- The web build used only local API overrides. No application source was changed for this run.

## Limits

This proves the real web dialog, live Supabase TOTP enrollment, the `aal2` session replacement and the granted admin write in a browser. It does not verify the project password-policy values, test-account rotation, recovery, MFA reset, sealed-account custody or a hosted deployment. D-58 stays Blocked until the owner and operations items close.
