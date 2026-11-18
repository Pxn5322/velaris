# D-59 decision packet: recovery matrix and approval rules

Date: 2026-11-18
Status: **Draft for owner sign-off. Not approved.**
Decision record: D-59, currently **Blocked**.
Scope owner: Product/security owner; Operations owner for the sealed account and mailer.

This packet is the draft for `.agents/evidence-d59-recovery-matrix.md`. It records the proposed recovery rules, the facts that constrain them, and the decisions the owners must make. A signature on this packet does not mark D-59 Recorded. D-59 also needs the mailer and sealed-account artifacts listed in section 10.

T6.09 is not complete and remains unchecked. On 2026-11-18 the owner selected section 3 Option A, the backup TOTP factor recovery model, and directed the backup-factor slice. The web app now lists verified TOTP factors, selects one during step-up and enrolls one backup factor after AAL2 verification. No recovery route, MFA reset route, approval store, mailer change or sealed account was implemented.

## Recorded choice and open decisions (2026-11-18)

**Recorded:** D-59-R1 Option A is the backup TOTP factor recovery model. This is the only recovery-model option selected.

**Not recorded:** OD-2 approval mechanism. The D-62 approval service is recommended but **not selected**. The 2026-11-18 Option A choice does not apply to section 5.1.

**Still open:** OD-2, OD-3, OD-4, OD-5, OD-8, OD-9 and OD-10. D-59 remains **Blocked**.

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
- Support cannot read MFA secrets, backup factors or passwords.

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

**Recorded owner choice: option A, the backup TOTP factor recovery model (2026-11-18).**

This choice applies only to this section. It does not select the D-62 approval service or any other approval mechanism in section 5.1. OD-2 remains open.

| Option | Description | Consequence |
| --- | --- | --- |
| A. Backup TOTP factor (recommended) | Enterprise and tenant administrators enroll a primary and a backup TOTP factor on separate devices after the enrollment flow and support evidence are ready. Other MFA users may enroll a backup factor. Lost-device recovery uses the backup factor. If both factors are lost, the approved reset path deletes the factors and requires enrollment before normal use. | Uses a supported provider feature. No recovery-code secrets in VELARIS. The D-59 text must replace "TOTP recovery codes" with "backup TOTP factor". |
| B. Custom recovery codes | VELARIS generates one-time recovery codes, stores only hashes, and verifies them before deleting a lost factor. | Adds a new credential type, rate limits, rotation, support procedure and threat tests. It must never be the only factor. More work and more risk in T6.09. |
| C. Email-only factor reset | A recovery email removes the second factor without another proof. | Not acceptable for administrators. A compromised mailbox would become a full account takeover. Reject. |

The owner selected A on 2026-11-18. The D-59 text and the event list must change. `auth.mfa_recovery_used` has no producer if no recovery codes exist. The packet does not silently keep an event for a feature that is not built. OD-1 records the selection. D-59 remains Blocked on the other decisions and evidence.

## 4. Recovery matrix

The matrix applies to human accounts. Machine identities and API keys are out of scope. Tenant support sessions are D-63 and are separate read-only grants, not impersonation.

| Account | Password forgotten | Second factor lost | Who may approve | Before normal use | Required audit |
| --- | --- | --- | --- | --- | --- |
| Customer | Self-service recovery email. A tenant admin may send a recovery link for an active customer if OD-5 keeps the path. | Tenant admin of the customer's own tenant, with `user.mfa.reset`, may require re-enrollment. No platform-wide reset. | One tenant admin, same tenant. The customer cannot approve the reset; the tenant admin may request and execute it. | Enroll a new factor if MFA was enrolled; otherwise normal sign-in. | `auth.password_reset_requested`, `auth.password_changed`, `auth.mfa_reset_requested`, `auth.mfa_reset_approved`, `auth.mfa_enrolled` |
| Agent | Self-service recovery email. A tenant admin may send a recovery link for an active agent if OD-5 keeps the path. | Tenant admin of the agent's own tenant, with `user.mfa.reset`, may reset the factor and sessions. | One tenant admin, same tenant. The agent cannot approve the reset and a peer agent cannot execute it. | Enroll a new factor, then sign in with `aal2`. | Same as customer, plus `auth.sessions_revoked` |
| Tenant administrator | Self-service recovery email, then set a new password. A password reset does not remove the factor. | Enterprise administrator plus platform security owner. A peer tenant administrator cannot approve. A foreign tenant administrator cannot approve. | Two distinct people: one enterprise administrator and one platform security owner. | Enroll a new factor before any administrator action; earlier sessions stay revoked. | Same as agent, plus the approval record id |
| Enterprise administrator | Self-service recovery email, then set a new password. A password reset does not remove the factor. | Platform security owner plus a second platform owner. The target cannot approve its own recovery. | Two distinct platform owners, one of whom is the platform security owner. | Enroll a new factor before any platform action; earlier sessions stay revoked. | Same as tenant administrator |
| Sealed platform owner | No self-service path while sealed. Use the custody runbook in section 6. | Use the sealed material and the two-person procedure. Then rotate and re-seal. | Two custodians plus the security owner; add a second platform-owner approval only if OD-4 proves four named, available people. | Rotate password and factor, revoke all sessions, enroll a new factor, re-seal, record the incident. | All section 8 reset events, the incident id and the custody log |
| Support operator | Self-service recovery email only. | No reset right. Support cannot read or reset MFA secrets, recovery codes or passwords. | None. Escalate to the platform security owner. | Not applicable. | Denial event or support ticket reference |

### 4.1 Tenant administrator limits

**Proposed rule (OD-5):** a tenant administrator may reset only a member of the same tenant. The target must be an active agent or customer. The actor needs `user.mfa.reset` for a factor reset. If OD-5 keeps administrator password reset, the actor needs `user.password.reset`. The reset path also needs identity verification, rate limits, target notification and abuse tests (OD-5).

A tenant administrator may not:

- reset another tenant administrator's factor; the enterprise-led path in OD-5 handles it;
- reset a member of another tenant;
- reset an enterprise administrator or platform owner;
- approve their own request;
- read the target's password, TOTP secret or recovery codes.

If OD-5 keeps administrator password reset, it sends a recovery link. The administrator must not choose or see the new password. If the product later needs a temporary password, that is a separate decision and needs a forced-change control.

### 4.2 Password reset does not bypass MFA

A recovery email proves control of the mailbox, not the second factor. After a password reset:

- the account keeps its existing factors;
- administrator routes still require `aal2`;
- a privileged password reset revokes all sessions and advances the token cutoff;
- if the factor is also lost, the factor reset path runs separately with its own approval.

This prevents a mailbox compromise from becoming an administrator takeover.

## 5. Privileged recovery approval rules

These rules apply to every privileged recovery and to every sealed-account use.

1. **Two distinct humans.** The requester and the approver are different people. One person cannot supply both approvals.
2. **Required roles.** Tenant administrator recovery: enterprise administrator plus platform security owner. Enterprise administrator recovery: platform security owner plus a second platform owner. Sealed account: the quorum in OD-4.
3. **Active and authenticated.** Each approver must be active, must sign in with `aal2`, and must hold the required role at approval time.
4. **Reason and ticket.** The request names the target, the reason, the incident or support ticket, and the recovery path.
5. **Short expiry.** An approval expires after 30 minutes. An expired approval cannot be reused.
6. **Single use.** One approval authorizes one reset for one target. A retry needs a new request.
7. **No self-approval and no peer bypass.** An administrator cannot approve their own recovery or a peer's recovery outside the matrix.
8. **Execution is server-side.** For a privileged factor reset, the API performs the reset with the provider secret key. The browser never receives the key or the factor secret.
9. **Denial is recorded.** A denied request records the actor, target, reason and request id.
10. **No emergency bypass in Phase 1.** The sealed account is the emergency path. An operator must not disable the approval rule during an incident.

### 5.1 Approval mechanism (open decision — not selected)

The D-59 review rejects a separate approval store in T6.09. The 2026-11-18 Option A choice applies only to section 3 and does not select an approval mechanism here. OD-2 remains open.

| Option | Description | Assessment |
| --- | --- | --- |
| D-62 approval service (recommended; not selected) | The recovery request uses the D-62 request, approval and notification model. It does not add a second approval store. | Strongest consistency. D-62 is Blocked, so T6.09 waits for it. |
| Signed operations ticket (interim) | Two approvers sign a ticket; an operator executes the reset with a controlled admin command and attaches the ticket. | Acceptable only until D-62 is ready. The audit trail depends on manual discipline. |
| Email approval | Approvers reply to an email thread. | Reject. Mailbox compromise and ambiguous identity make it unsuitable for privileged recovery. |

If OD-2 selects the D-62 service, D-62 must expose the approval contract and enforce requester ≠ approver. If OD-2 selects the signed-ticket interim, T6.09 must write the same audit events and record the ticket id. The owner records the selection in OD-2. The D-62 service is not selected now.

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
2. Use the quorum in OD-4: two custodians plus the security owner. If OD-4 proves four named, available people, add a second platform-owner approval.
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

`auth.mfa_recovery_used` is not emitted under the selected section 3 option A. Do not ship it.

The two proposed events close a gap: approval is not execution. Without them, the audit trail cannot show whether an approved reset completed or was denied.

## 9. Implementation boundary for T6.09 (partial)

D-59 must be Recorded before the remaining T6.09 work starts. The section 3 Option A backup-factor slice is implemented. The remaining scope is:

- seed `user.mfa.reset` and `user.password.reset` if OD-5 keeps administrator password reset;
- integrate with the D-62 approval service if OD-2 selects it, or use the signed-ticket interim if OD-2 selects it;
- add server-side MFA factor reset through the provider admin API;
- revoke sessions and advance the token cutoff after a privileged reset;
- require factor enrollment before normal use;
- [done 2026-11-18] add backup-factor enrollment and selection in the web flow;
- emit the approved audit events;
- add denial tests for self-approval, peer approval, cross-tenant reset, wrong role, expired approval, replay and missing `aal2`;
- add the web recovery request and approval surfaces only when the selected mechanism needs them.

This packet does not authorize the remaining work.

## 10. Evidence checklist

D-59 can move to Recorded only when every item is true.

- [ ] This packet is signed by the product/security owner and the operations owner.
- [ ] The owner decision checklist in section 11 is complete.
- [ ] Named people hold the platform security owner, second platform owner and custodian roles.
- [ ] `user.mfa.reset` is approved for the role baseline and seeded.
- [ ] If OD-5 keeps administrator password reset, `user.password.reset` is approved and seeded.
- [ ] `.agents/evidence-d59-mailer.md` is complete and passes section 7. Template created 2026-11-18.
- [ ] `.agents/evidence-d59-sealed-account.md` is complete and names custodians, successor, storage, initial provisioning, annual test date and incident record location. Template created 2026-11-18.
- [ ] The audit event list in section 8 is approved, including the two proposed events.
- [ ] The owner approves the draft AC-F02-4 and AC-F02-5 in `docs/PRD.md`.
- [ ] Approval records exist for each path in OD-2.
- [ ] D-59 in `docs/ARCHITECTURE.md` is amended if the recovery model or event list changes.
- [ ] D-59 state is changed to Recorded by the owner, not by an agent.

## 11. Owner decision checklist (cross-check gaps)

Each item comes from the cross-check against `docs/ARCHITECTURE.md`, `docs/PRD.md`, `docs/SETUP_GUIDE.md` and `docs/IMPLEMENTATION_PLAN.md`. Mark each item accepted, or record a change in section 13. The recommended answer is the packet author's proposal, not an owner decision.

| Check | Gap the owner must resolve | Recommended answer | Owner |
| --- | --- | --- | --- |
| [x] OD-1 | D-59 requires TOTP recovery codes, but hosted Supabase does not provide them. The old T6.09 verification required a recovery code to work once. The backup factor is recommended but not required, and D-58 gives administrators a seven-day TOTP grace. | Section 3 option A selected on 2026-11-18. Amend D-59 and T6.09. Add second-factor enrollment and selection to the web flow (implemented 2026-11-18). Set the backup-factor deadline only after enrollment-completion and support-load evidence. Keep it optional for agents and customers until then. | Product/security owner |
| [ ] OD-2 | The approval mechanism is not selected. The plan requires an approval record for each path. T6.09 says two approvers are recorded, but customer and agent reset use one tenant admin. The 2026-11-18 Option A choice does not apply here. | Reuse the D-62 approval service. If D-62 is not ready, use a signed-ticket interim with the same audit events and ticket id. Do not add a separate approval store to T6.09. Require records for all paths and apply the two-approver test only to privileged and sealed paths. | Product/security owner; Engineering owner |
| [ ] OD-3 | The platform security owner, second platform owner and alternates are not named. | Name both people and one alternate for each role. Add availability and conflict-of-interest rules. Record the names in the evidence file, not in chat. | Product/security owner |
| [ ] OD-4 | D-59 says “two-person access,” but the packet can require four participants. The quorum, material split, initial provisioning and annual test date are undefined. The packet assumes the sealed material exists, and D-58 gives the sealed account no grace. | Use two custodians plus one security-owner approval. Require two platform-owner approvals only if at least four named, available people exist. Store two sealed parts in separate safes. Two custodians and the security owner create the account, enroll the first TOTP factor and seal it. Set the first test for November 2027, owned by Operations. | Operations owner; Product/security owner |
| [ ] OD-5 | D-59 allows a tenant admin to reset a same-tenant member's password and sessions. The packet leaves the target scope and permission open. D-59 also allows peer MFA reset with enterprise approval, while T6.09 says a tenant admin cannot recover a peer. | Keep tenant-admin password reset for active agents and customers only, conditional on identity verification, rate limits, target notification and abuse tests. Send a recovery link. Remove the tenant-admin actor from peer MFA recovery; the enterprise administrator plus platform security owner handle it. Test denial and the enterprise-led approval. Amend D-59. | Product/security owner |
| [ ] OD-6 | D-59 lists seven audit events. The packet adds completed and denied events. `auth.mfa_recovery_used` has no producer under the backup-factor model. | Approve `auth.mfa_reset_completed` and `auth.mfa_reset_denied`. Remove `auth.mfa_recovery_used` if OD-1 selects the backup factor, or record that it is not emitted. Amend D-59. | Product/security owner |
| [ ] OD-7 | No PRD acceptance criterion covers recovery. T6.09 maps to F-03 and AC-F03-1, which cover tenant create/disable and role change, not recovery. | Review and approve the draft `AC-F02-4` and `AC-F02-5` in `docs/PRD.md`. Map T6.09 to F-02 and AC-F02-4 for recovery, and keep F-03 and AC-F03-1 for the tenant user-management scope. | Product/security owner |
| [ ] OD-8 | `user.mfa.reset` has no permission code or role assignment. No password-reset permission exists. | Grant `user.mfa.reset` to `R-tenant-admin` only. If OD-5 keeps administrator password reset, add `user.password.reset` for `R-tenant-admin` only. Show the role matrix and denial tests; `user.password.reset` must not allow peer tenant-admin reset. The privileged path uses its approval, not these tenant permissions. | Product/security owner; Engineering owner |
| [ ] OD-9 | The setup guide requires custom SMTP before invitations, not recovery. Hosted recovery delivery used the built-in mailer at low volume. | Custom SMTP or the Send Email hook is required. Defer provider selection until the data terms, region, sending domain, deliverability and volume evidence exist. Justify the 10-email-per-hour threshold. Add the recovery check to the setup guide and mailer evidence. | Operations owner |
| [ ] OD-10 | T6.09 file scope has no `prisma/migrations` path and no web path. The in-app approval option needs both. Its verification names a recovery code. | Defer the scope change. It depends on OD-2 and D-62. Do not add migration or web approval paths until those are settled. Change the verification to factor reset and backup factor only after OD-1. Do not start T6.09 before D-59 is Recorded. | Engineering owner |

### 11.1 Product/security owner review (2026-11-18)

The product/security owner would not sign the packet with the recommendations as written. This review is recorded for the next revision; it is not a signature.

| Check | Review outcome | Required change or evidence |
| --- | --- | --- |
| OD-1 | Section 3 option A selected; deadline evidence required | Keep the backup-factor direction. Factor enrollment and selection are implemented in the web flow. Record enrollment completion and support load before a mandatory deadline. |
| OD-2 | Open; not selected | Reuse the D-62 approval service or record a signed-ticket interim. Do not add a separate approval store to T6.09 before that decision. The section 3 Option A choice is unrelated. |
| OD-3 | Evidence required | Add names, alternates, availability and conflict-of-interest rules. |
| OD-4 | Reject the fixed four-person quorum as written | Prove at least four named, available participants. Otherwise use two custodians plus one security-owner approval, with post-incident review. Keep the storage and provisioning recommendations. |
| OD-5 | Evidence required | Add identity verification, rate limits, target notification and abuse tests before a tenant admin may send a recovery link. Keep the ban on tenant-admin peer recovery. |
| OD-6 | Accept | Add the two events and remove `auth.mfa_recovery_used` if OD-1 selects backup factors. |
| OD-7 | Accept the need; criteria under review | AC-F02-4 and AC-F02-5 are now Draft PRD rows. They need owner approval and executable tests. |
| OD-8 | Evidence required | Show the role/permission matrix and denial tests. `user.password.reset` must not allow peer tenant-admin reset. |
| OD-9 | Reject the provider selection; accept the SMTP requirement | Select a provider only after data terms, region, sending domain, deliverability and volume review. Justify the 10-per-hour threshold. |
| OD-10 | Reject as written; defer | Scope depends on OD-2 and D-62. Do not add migration or web approval paths until those are settled. |

## 12. Draft PRD acceptance criteria (for owner approval)

Status: **Draft PRD criteria.** AC-F02-4 and AC-F02-5 were added to `docs/PRD.md` as Draft on 2026-11-18. The owner has not approved them. D-59 stays Blocked. AC-F02-5 assumes OD-5 keeps the absolute ban on tenant-admin peer, enterprise and platform recovery.

| AC ID | Feature | Given / When / Then | Kind |
| --- | --- | --- | --- |
| AC-F02-4 | F-02 | Given an active user who cannot sign in because of a lost password or second factor, when the recovery path approved for that user's role completes, then the password is reset or the MFA factors are removed, the recovery request and completion are audited, and after the MFA factors are removed the user enrolls a new factor before any protected route is allowed; if the user is an administrator, all earlier sessions for that user are revoked | happy |

The negative companion is also a draft PRD row:

| AC ID | Feature | Given / When / Then | Kind |
| --- | --- | --- | --- |
| AC-F02-5 | F-02 | Given a tenant administrator with recovery permission, when the administrator requests password or MFA recovery for a foreign-tenant user, a peer tenant administrator, an enterprise administrator or a platform owner, then the request is denied without a password, factor or session change and the denial is audited | unauthorized |

If the owner wants a different feature mapping, record it in OD-7 and draft the alternative criterion before approval. Do not use two IDs for one behavior.

### 12.1 Testability review (2026-11-18)

The Draft wording was tightened to remove ambiguous test targets and to match `docs/PRD.md`.

| AC | What a test can now assert | Remaining dependency |
| --- | --- | --- |
| AC-F02-4 | The user is active; the path is approved for the user's role; the password is reset or the MFA factors are removed; request and completion are audited; a new factor is enrolled before any protected route; earlier sessions are revoked for an administrator. | D-59 must name the approved path and audit events for each role. |
| AC-F02-5 | The actor has recovery permission; the request covers password or MFA recovery; the four target classes are named; no password, factor or session change occurs; the denial is audited. | OD-5 must keep the absolute ban and name the denial event. |

AC-F02-4 remains one criterion with two branches. A test must parameterize password recovery and MFA recovery. One passing branch does not prove the other.

## 13. Sign-off

Signing records a decision. It does not deploy code, change a provider setting or mark T6.09 started.

| Role | Name | Decision | Date | Signature or approval reference |
| --- | --- | --- | --- | --- |
| Product/security owner |  | [ ] Approved [ ] Approved with changes [ ] Rejected |  |  |
| Operations owner |  | [ ] Approved [ ] Approved with changes [ ] Rejected |  |  |
| Engineering owner (noted) |  | [ ] Noted [ ] Changes required |  |  |

**Change control:** if an owner changes a recommended answer, update every affected section before signature. Do not record D-59 as Recorded while any checklist item in section 10 is unchecked.
