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
| Synthetic signup | 201; tenant `1d87e537-2d94-47d5-9dc1-f4223e28057a` |
| Browser session | 200; `R-tenant-admin`; role list 200 |
| First role write, before TOTP | 403 `MFA_REQUIRED` |
| Step-up dialog | opened in the Roles & RBAC panel |
| First-time TOTP enrollment | enrollment form shown; secret used only in memory |
| Step-up before TOTP | 403 `MFA_REQUIRED` |
| Step-up after TOTP | 200; grant issued |
| Browser session token after verification | `aal` `aal2`; `session_id` present |
| Granted retry of the same role write | 201; role `R-web-mfa-mwkkpc8r-959d2a` |
| Success notice | `Web MFA mwkkpc8r-959d2a was created.` |
| New role card | visible |

The first denial is `MFA_REQUIRED`, not `STEP_UP_REQUIRED`, because the initial browser token is `aal1`. The API's `STEP_UP_REQUIRED` path after `aal2` is covered by `.agents/evidence-d58-password-mfa-tests.md`.

## Cleanup

The verifier ran `scripts/cleanup-load-tenants.mjs --delete --email <synthetic email>` after the browser closed. It then ran the targeted dry run and required `Synthetic tenants: 0` and `Synthetic auth accounts: 0` before it reported `cleanup: "removed"`. A failed delete or a non-zero check now fails the run.

## Artifacts

- `.agents/evidence-d58-web-step-up.json` contains the status-only machine record.
- `.agents/verify-d58-web-step-up.mjs` is the browser verifier. It asserts the denied `403`, granted `201`, `aal2`, session and role-card results.
- `tests/roles.spec.js` covers the tenant-load gate: the create control stays disabled while the tenant request is delayed and enables after it resolves.
- The web build used only local API overrides.

## Limits

This proves the real web dialog, live Supabase TOTP enrollment, the `aal2` session replacement and the granted admin write in a browser. It does not verify the project password-policy values, test-account rotation, recovery, MFA reset, sealed-account custody or a hosted deployment. D-58 stays Blocked until the owner and operations items close.
