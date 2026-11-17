# D-58 password and MFA test evidence

Date: 2026-11-17
Status: pass for the live synthetic TOTP and step-up path; D-58 remains Blocked on the remaining owner and operations items.

## Scope

- Development Supabase project: `lygekvhwmhbonsdeiaot.supabase.co`.
- Local built API: `http://127.0.0.1:3000`, connected to the development Supabase project and database.
- One synthetic account only: `smokecheck-mfa-*@velaris.test`.
- No existing, human, owner, customer or production account was created, changed, enrolled or deleted.
- The test printed no password, access token, refresh token, TOTP secret or QR payload.

## Result

| Check | Observed |
| --- | --- |
| Synthetic signup | 201; tenant `456300b3-8fae-4e1b-84d8-e42a9192493b` |
| Password grant | 200 |
| TOTP factor enrollment | 200; one `totp` factor; QR payload returned |
| TOTP challenge | 200 |
| TOTP verification | 200; replacement access and refresh tokens returned |
| Access-token `aal` claim | `aal2` |
| `session_id` claim | present |
| Refresh token replaced | yes |
| `GET /auth/session` with the `aal2` token | 200; role `R-tenant-admin` |
| Role write without a step-up grant | 403 `STEP_UP_REQUIRED` |
| `POST /auth/step-up` with the current password | 200; grant issued |
| Role write with the grant | 201; role `R-live-mfa-mwkjjqvn-551275`, 5 permissions |
| Replay of the same grant | 403 `STEP_UP_REQUIRED` |
| Role list after the write | 200; created role present |

## Cleanup

`node --env-file=.env scripts/cleanup-load-tenants.mjs --delete` removed the one synthetic tenant and the one synthetic Auth account. The follow-up dry run reported zero synthetic tenants and zero synthetic accounts.

## Artifacts

- `.agents/evidence-d58-live-totp.json` contains the status-only machine record.
- `.agents/verify-d58-live-totp.mjs` is the temporary verifier used for this run. It is not application source.

## Limits

This proves live TOTP enrollment, the `aal2` claim, the API `aal` gate, one-time grant consumption and one protected admin write against the development project. It does not verify the project password-policy values, test-account rotation, recovery, MFA reset, sealed-account custody or a hosted deployment. D-58 stays Blocked until the owner and operations items close.
