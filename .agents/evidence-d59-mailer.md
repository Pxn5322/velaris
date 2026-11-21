# D-59 mailer readiness evidence

Status: **Template. Not evidence. D-59 remains Blocked.**
Date: [YYYY-MM-DD]
Owner: Operations owner
Reviewer: Product/security owner

This record covers Supabase Auth email for password recovery. It also covers invitations and confirmations when the same provider sends them. It does not select a provider by itself and does not approve a production change.

Do not record passwords, SMTP credentials, API keys, recovery tokens or message bodies in this file. Record only the secret location name.

## 1. Decision

| Item | Value |
| --- | --- |
| Delivery path | [ ] Custom SMTP [ ] Send Email hook |
| Provider | [provider name] |
| Region | [region] |
| Data-processing terms | [link or reference] |
| Sending domain | [domain] |
| Sender address | [address] |
| Reply-to address | [address] |
| Operations owner | [name] |
| Backup owner | [name] |
| Expected recovery volume | [messages per hour] |

## 2. Configuration evidence

| Check | Observed value | Evidence |
| --- | --- | --- |
| Supabase project ref | [ref] | [dashboard or ticket reference] |
| SMTP host, port and TLS mode, or hook endpoint | [value] | [reference] |
| Sender domain SPF | [pass or fail] | [record or link] |
| DKIM selector and result | [value] | [record or link] |
| DMARC policy and result | [value] | [record or link] |
| Auth Site URL | [URL] | [reference] |
| `/auth/callback` in the redirect allowlist | [yes or no] | [reference] |
| Recovery template uses the approved callback | [yes or no] | [reference] |
| Rate limit | [value] | [reference] |
| Secret location name | [name only] | [reference] |
| Bounce and complaint owner | [name] | [reference] |

## 3. Acceptance checks

| ID | Check | Result | Evidence |
| --- | --- | --- | --- |
| M-1 | One real recovery email reaches an external mailbox | [ ] pass [ ] fail | [message id or screenshot path] |
| M-2 | The link returns to the exact approved callback origin | [ ] pass [ ] fail | [URL and timestamp] |
| M-3 | An expired link is rejected | [ ] pass [ ] fail | [request id] |
| M-4 | A used link cannot be reused after the password change | [ ] pass [ ] fail | [request id] |
| M-5 | At least 10 recovery emails in one hour are accepted, or the owner records an approved limit | [ ] pass [ ] fail | [count and window] |
| M-6 | Logs and error responses contain no token, password or TOTP secret | [ ] pass [ ] fail | [scan path] |
| M-7 | A failed send is visible to the operator and does not report success | [ ] pass [ ] fail | [error and ticket] |
| M-8 | The sender domain passes the recorded authentication checks | [ ] pass [ ] fail | [SPF, DKIM and DMARC result] |
| M-9 | Bounce and complaint handling has a named owner | [ ] pass [ ] fail | [name and process] |

## 4. Test record

| Date | Actor | Target | Scenario | Result | Request id | Artifact |
| --- | --- | --- | --- | --- | --- | --- |
| [YYYY-MM-DD] | [synthetic account] | [mailbox] | Recovery email | [pass or fail] | [request id] | [path] |
| [YYYY-MM-DD] | [synthetic account] | [mailbox] | Expired link | [pass or fail] | [request id] | [path] |
| [YYYY-MM-DD] | [synthetic account] | [mailbox] | Reused link | [pass or fail] | [request id] | [path] |
| [YYYY-MM-DD] | [operator] | [provider] | Forced send failure | [pass or fail] | [request id] | [path] |

Use synthetic accounts only. Remove synthetic accounts and mailboxes after the test. Record the cleanup result.

## 5. Failure and rollback

- If recovery email fails, the recovery path is **not ready**. Do not fall back to the built-in mailer for production.
- If the provider is unavailable, record the user-facing message and the escalation owner.
- If a secret is exposed, stop the test, rotate the secret and record an incident.
- Rollback owner: [name]
- Rollback procedure: [steps]

## 6. Limits

This template does not prove recovery readiness until every acceptance check has a result and the cleanup is complete. It does not cover MFA factor reset, approval records or the sealed account.

## 7. Sign-off

| Role | Name | Decision | Date | Reference |
| --- | --- | --- | --- | --- |
| Operations owner | [name] | [ ] Accepted [ ] Rejected | [YYYY-MM-DD] | [ticket] |
| Product/security owner | [name] | [ ] Accepted [ ] Rejected | [YYYY-MM-DD] | [ticket] |
