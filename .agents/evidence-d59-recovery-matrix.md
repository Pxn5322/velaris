# D-59 decision packet: recovery matrix and approval rules

Date: 2026-11-18
Status: **Draft for owner sign-off. Not approved.**
Decision record: D-59, currently **Blocked**.
Scope owner: Product/security owner; Operations owner for the sealed account and mailer.

This packet is the draft for `.agents/evidence-d59-recovery-matrix.md`. It records the proposed recovery rules, the facts that constrain them, and the decisions the owners must make. A signature on this packet does not mark D-59 Recorded. D-59 also needs the mailer and sealed-account artifacts listed in section 10.

T6.09 has not started. No recovery route, MFA reset route, approval store, mailer change or sealed account was implemented for this packet.

## 1. Purpose

D-59 decides who can recover a human account when the password or the second factor is lost. It must answer four questions for each role:

1. What can the user do alone?
2. Who can help when the user cannot sign in?
3. Which two people must approve a privileged recovery?
4. What must happen before the recovered account is used again?

The rules must preserve these existing controls:

- `aal2` is required for administrator MFA-protected actions (D-58).
- A password change or global session revocation advances `users.token_invalid_before`, so earlier access tokens are refused.
- A sensitive action needs a short-lived, single-use step-up grant.
- The API denies a verified identity that has no application account row.
- Support cannot read MFA secrets, recovery codes or passwords.

## 2. Facts that constrain the decision

| Fact | Effect on D-59 |
| --- | --- |
| Supabase Auth TOTP has no end-user recovery codes on the hosted project. The official MFA guide says Supabase does not return recovery codes and recommends a backup TOTP factor. Recovery-code methods in the JavaScript SDK are experimental and hosted enrollment is disabled. | The current D-59 text says users own "TOTP recovery codes". That feature does not exist on the current provider. The owner must choose a backup factor or fund a custom recovery-code feature. |
| Supabase allows up to 10 TOTP factors per user. A second TOTP factor on a different device is the supported lost-device path. | A backup factor is available without custom secret storage. The app must make enrollment and factor management clear. |
| `supabase.auth.admin.mfa.deleteFactor({ id, userId })` deletes a factor and signs the user out of all sessions when the deleted factor was verified. It uses the secret key on a trusted server. | A reset must run server-side only. It must revoke sessions and must not expose the secret key to the browser. |
| The Supabase built-in mailer allows 2 Auth emails per hour for the whole project. The limit cannot be raised without custom SMTP or a Send Email hook. | Production recovery and invitation volume cannot rely on the built-in mailer. A mailer decision is a hard precondition. |
| The current app has password change, session revocation and TOTP step-up. It has no recovery request, no MFA reset, no approval record and no sealed account. | This packet defines policy and evidence. T6.09 implements it after D-59 is Recorded. |

Sources: Supabase MFA guide (`https://supabase.com/docs/guides/platform/multi-factor-authentication`), Supabase Admin MFA reference (`https://supabase.com/docs/reference/javascript/auth-admin-mfa-deletefactor`), and the live mailer evidence in `docs/SETUP_GUIDE.md` section 5.5.

## 3. Decision D-59-R1: recovery model

**Recommended: option A.**

| Option | Description | Consequence |
| --- | --- | --- |
| A. Backup TOTP factor (recommended) | Each MFA user enrolls a primary and a backup TOTP factor on separate devices. Lost-device recovery uses the backup factor. If both factors are lost, the approved reset path deletes the factors and requires enrollment before normal use. | Uses a supported provider feature. No recovery-code secrets in VELARIS. The D-59 text must replace "TOTP recovery codes" with "backup TOTP factor". |
| B. Custom recovery codes | VELARIS generates one-time recovery codes, stores only hashes, and verifies them before deleting a lost factor. | Adds a new credential type, rate limits, rotation, support procedure and threat tests. It must never be the only factor. More work and more risk in T6.09. |
| C. Email-only factor reset | A recovery email removes the second factor without another proof. | Not acceptable for administrators. A compromised mailbox would become a full account takeover. Reject. |

If the owner selects A, the D-59 text and the event list must change. `auth.mfa_recovery_used` has no producer if no recovery codes exist. The packet does not silently keep an event for a feature that is not built.

**Owner selection:** [ ] A (recommended) [ ] B [ ] C

## 4. Recovery matrix

The matrix applies to human accounts. Machine identities and API keys are out of scope. Tenant support sessions are D-63 and are separate read-only grants, not impersonation.

| Account | Password forgotten | Second factor lost | Who may approve | Before normal use | Required audit |
| --- | --- | --- | --- | --- | --- |
| Customer | Self-service recovery email, then set a new password. | Tenant admin of the customer's own tenant, with `user.mfa.reset`, may require re-enrollment. No platform-wide reset. | One tenant admin. The requester cannot approve their own reset. | Enroll a new factor if MFA was enrolled; otherwise normal sign-in. | `auth.password_reset_requested`, `auth.password_changed`, `auth.mfa_reset_requested`, `auth.mfa_reset_approved`, `auth.mfa_enrolled` |
| Agent | Self-service recovery email, then set a new password. | Tenant admin of the agent's own tenant, with `user.mfa.reset`, may reset the factor and sessions. | One tenant admin, same tenant. A peer agent cannot reset another agent. | Enroll a new factor, then sign in with `aal2`. | Same as customer, plus `auth.sessions_revoked` |
| Tenant administrator | Self-service recovery email, then set a new password. A password reset does not remove the factor. | Enterprise administrator plus platform security owner. A peer tenant administrator cannot approve. A foreign tenant administrator cannot approve. | Two distinct people: one enterprise administrator and one platform security owner. | Enroll a new factor before any administrator action; earlier sessions stay revoked. | Same as agent, plus the approval record id |
| Enterprise administrator | Self-service recovery email, then set a new password. A password reset does not remove the factor. | Platform security owner plus a second platform owner. The target cannot approve its own recovery. | Two distinct platform owners, one of whom is the platform security owner. | Enroll a new factor before any platform action; earlier sessions stay revoked. | Same as tenant administrator |
| Sealed platform owner | No self-service path while sealed. Use the custody runbook in section 6. | Use the sealed material and the two-person procedure. Then rotate and re-seal. | Both custodians plus two distinct platform owners, or the approved quorum in section 6. | Rotate password and factor, revoke all sessions, enroll a new factor, re-seal, record the incident. | All reset events, the incident id and the custody log |
| Support operator | Self-service recovery email only. | No reset right. Support cannot read or reset MFA secrets, recovery codes or passwords. | None. Escalate to the platform security owner. | Not applicable. | Denial event or support ticket reference |

### 4.1 Tenant administrator limits

A tenant administrator may reset only a member of the same tenant. The target must be an active agent or customer. The actor needs `user.mfa.reset`.

A tenant administrator may not:

- reset another tenant administrator's factor without the enterprise administrator and platform security owner;
- reset a member of another tenant;
- reset an enterprise administrator or platform owner;
- approve their own request;
- read the target's password, TOTP secret or recovery codes.

A password reset by an administrator sends a recovery link. The administrator must not choose or see the new password. If the product later needs a temporary password, that is a separate decision and needs a forced-change control.

### 4.2 Password reset does not bypass MFA

A recovery email proves control of the mailbox, not the second factor. After a password reset:

- the account keeps its existing factors;
- administrator routes still require `aal2`;
- a privileged password reset revokes all sessions and advances the token cutoff;
- if the factor is also lost, the factor reset path runs separately with its own approval.

This prevents a mailbox compromise from becoming an administrator takeover.

## 5. Two-person approval rules

These rules apply to every privileged recovery and to every sealed-account use.

1. **Two distinct humans.** The requester and the approver are different people. One person cannot supply both approvals.
2. **Required roles.** Tenant administrator recovery: enterprise administrator plus platform security owner. Enterprise administrator recovery: platform security owner plus a second platform owner. Sealed account: the custody quorum in section 6.
3. **Active and authenticated.** Each approver must be active, must sign in with `aal2`, and must hold the required role at approval time.
4. **Reason and ticket.** The request names the target, the reason, the incident or support ticket, and the recovery path.
5. **Short expiry.** An approval expires after 30 minutes. An expired approval cannot be reused.
6. **Single use.** One approval authorizes one reset for one target. A retry needs a new request.
7. **No self-approval and no peer bypass.** An administrator cannot approve their own recovery or a peer's recovery outside the matrix.
8. **Execution is server-side.** The API performs the reset with the provider secret key. The browser never receives the key or the factor secret.
9. **Denial is recorded.** A denied request records the actor, target, reason and request id.
10. **No emergency bypass in Phase 1.** The sealed account is the emergency path. An operator must not disable the approval rule during an incident.

### 5.1 Approval mechanism (open decision)

| Option | Description | Assessment |
| --- | --- | --- |
| A. In-app recovery request (recommended) | A server-side `auth_recovery_requests` record holds requester, target, reason, ticket, required approvers, status, expiry and execution time. Approvers act in the app with `aal2`. | Strongest evidence and enforceable single use. Adds schema, routes, permissions and tests to T6.09. |
| B. Signed operations ticket | Two approvers sign a ticket; an operator executes the reset with a controlled admin command and attaches the ticket. | Faster to start. The audit trail depends on manual discipline and a controlled command. Weaker enforcement. |
| C. Email approval | Approvers reply to an email thread. | Reject. Mailbox compromise and ambiguous identity make it unsuitable for privileged recovery. |

If the owner selects A, the implementation must enforce requester ≠ approver in the database and in the service, not only in the UI. If the owner selects B, T6.09 must still write the same audit events and record the ticket id.

**Owner selection:** [ ] A (recommended) [ ] B [ ] C

## 6. Sealed platform-owner account runbook

The sealed account is a break-glass platform identity. It is not a normal administrator account and it is not shared for daily work.

### 6.1 Custody

- Use a dedicated identity and a controlled mailbox. Do not use a personal mailbox.
- Split the sign-in material so that no one custodian can sign in alone. The exact split method is an owner decision; examples are two sealed envelopes in separate safes or a threshold secret store.
- Name two custodians and one successor for each custodian.
- Record the custody holders, storage locations, seal numbers and rotation dates in a restricted register. Do not store the secret values in the repository, chat, tickets or the application database.
- Two-person access means two authorized people participate. A single custodian must not open both parts.

### 6.2 Use

1. Open an incident or emergency record with the reason, affected platform function and the normal owner who is unavailable.
2. Obtain the required approvals. At minimum: both custodians and two distinct platform owners, or the quorum the owner approves in section 11.
3. Retrieve the material with both authorized people present. Record the time, seal numbers and people.
4. Sign in, perform only the approved action, and sign out.
5. Revoke all sessions for the sealed account.
6. Rotate the password and the TOTP factor. Re-seal the material with new seal numbers.
7. Record the incident, actions and post-incident review. Link the audit event ids.

### 6.3 Successor and annual test

- Each custodian names a successor. A custodian change triggers re-sealing within five business days.
- Run an annual test. The test checks that the custodians can retrieve the material, that the seal records match, and that the documented procedure is current.
- Do not perform a production write during the annual test. A controlled read-only sign-in is allowed only with the same approvals and must be revoked immediately. If a read-only test is not approved, record a tabletop test and state that sign-in was not exercised.
- Record the test date, participants, result and follow-up actions.

### 6.4 Incident record

The incident record must contain:

- incident id and date;
- target account and reason;
- approvers and custodians;
- actions performed and timestamps;
- audit event ids;
- rotation and re-seal confirmation;
- post-incident review owner and due date.

## 7. Mailer readiness

Custom SMTP or the Supabase Send Email hook is required before recovery email is a production path. The built-in 2-email-per-hour limit is not sufficient.

The owner and Operations owner must decide:

- custom SMTP or Send Email hook;
- provider and sending domain;
- sender address and reply-to address;
- SPF, DKIM and DMARC ownership;
- bounce and complaint handling;
- alert threshold and on-call owner.

Acceptance checks for `.agents/evidence-d59-mailer.md`:

- [ ] One real recovery email reaches an external mailbox.
- [ ] The link returns to the exact approved callback origin.
- [ ] The link expires and cannot be reused after the password change.
- [ ] At least 10 recovery emails in one hour are accepted, or the approved limit is documented.
- [ ] Logs and error responses contain no token, password or TOTP secret.
- [ ] A failed send is visible to the operator and does not report success.
- [ ] The sender domain passes the recorded authentication checks.

No provider is selected by this packet. T6.09 must not assume that the built-in mailer is sufficient.

## 8. Audit events

| Event | When | Required fields | Forbidden fields |
| --- | --- | --- | --- |
| `auth.password_reset_requested` | A reset email is accepted for sending | actor or system, target user id, request id, result | token, password, mailbox content |
| `auth.password_changed` | A password change succeeds | actor, target, session id, request id | old or new password |
| `auth.mfa_enrolled` | A factor is verified | actor, target, factor type, request id | TOTP secret, QR payload |
| `auth.mfa_recovery_used` | A recovery code is used | actor, target, request id | the code |
| `auth.mfa_reset_requested` | A reset request is created | requester, target, tenant, reason, ticket, request id | factor secret |
| `auth.mfa_reset_approved` | The required approvals are complete | approvers, target, request id, expiry | factor secret |
| `auth.sessions_revoked` | Sessions are revoked | actor, target, scope, request id | bearer token, refresh token |
| `auth.mfa_reset_completed` (proposed) | The factor reset finishes | executor, target, request id, approval id | factor secret |
| `auth.mfa_reset_denied` (proposed) | A request is denied or expires | actor, target, request id, reason | factor secret |

`auth.mfa_recovery_used` applies only if option B in section 3 is selected. Under option A, remove it or record that it is not emitted; do not ship an event with no producer.

The two proposed events close a gap: approval is not execution. Without them, the audit trail cannot show whether an approved reset completed or was denied.

## 9. Implementation boundary for T6.09 (not started)

D-59 must be Recorded before T6.09 starts. When it does, the expected scope is:

- seed `user.mfa.reset` and grant it only to the approved role;
- add recovery request and approval persistence if option A is selected;
- add server-side MFA factor reset through the provider admin API;
- revoke sessions and advance the token cutoff after a privileged reset;
- require factor enrollment before normal use;
- emit the approved audit events;
- add denial tests for self-approval, peer approval, cross-tenant reset, wrong role, expired approval, replay and missing `aal2`;
- add the web recovery request and approval surfaces if option A is selected.

This packet does not authorize any of that work.

## 10. Evidence checklist

D-59 can move to Recorded only when every item is true.

- [ ] This packet is signed by the product/security owner and the operations owner.
- [ ] The owner selected a recovery model in section 3.
- [ ] The owner selected an approval mechanism in section 5.1.
- [ ] Named people hold the platform security owner, second platform owner and custodian roles.
- [ ] `user.mfa.reset` is approved for the role baseline and seeded.
- [ ] `.agents/evidence-d59-mailer.md` passes section 7.
- [ ] `.agents/evidence-d59-sealed-account.md` names custodians, successor, storage, annual test date and incident record location.
- [ ] The audit event list in section 8 is approved, including the two proposed events.
- [ ] D-59 in `docs/ARCHITECTURE.md` is amended if the recovery model or event list changes.
- [ ] D-59 state is changed to Recorded by the owner, not by an agent.

## 11. Open decisions

| Id | Decision | Recommended answer | Owner |
| --- | --- | --- | --- |
| OD-1 | Backup TOTP factor or custom recovery codes? | Backup TOTP factor. It is supported and avoids a new secret type. | Product/security owner |
| OD-2 | In-app approval or signed ticket? | In-app request with enforced requester ≠ approver. | Product/security owner; Engineering owner |
| OD-3 | Who is the platform security owner and who is the second platform owner? | Name both people and one alternate for each. | Owner |
| OD-4 | How is the sealed material split and stored? | Two sealed parts in separate safes, with two custodians and successors. | Operations owner |
| OD-5 | Custom SMTP or Send Email hook, and which provider? | Select after a deliverability and data-terms review; do not use the built-in mailer. | Operations owner |
| OD-6 | May a tenant administrator set a temporary password? | No. Send a recovery link; never let the administrator see the password. | Product/security owner |
| OD-7 | Add `auth.mfa_reset_completed` and `auth.mfa_reset_denied`? | Yes. Approval and execution are distinct facts. | Product/security owner |
| OD-8 | What is the annual sealed-account test date and who owns it? | Set a fixed month and name the operations owner. | Operations owner |

## 12. Sign-off

Signing records a decision. It does not deploy code, change a provider setting or mark T6.09 started.

| Role | Name | Decision | Date | Signature or approval reference |
| --- | --- | --- | --- | --- |
| Product/security owner |  | [ ] Approved [ ] Approved with changes [ ] Rejected |  |  |
| Operations owner |  | [ ] Approved [ ] Approved with changes [ ] Rejected |  |  |
| Engineering owner (noted) |  | [ ] Noted [ ] Changes required |  |  |

**Change control:** if an owner changes a recommended answer, update sections 3, 4, 5, 7, 8 and 11 before signature. Do not record D-59 as Recorded while any checklist item in section 10 is unchecked.
