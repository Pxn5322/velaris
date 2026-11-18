# OD-2 approval mechanism options

Date: 2026-11-18
Status: **Draft decision brief. No option is selected. D-59 remains Blocked.**
Decision owner: Product/security owner
Engineering owner: Noted

This brief records the approval mechanism options for D-59. It does not approve a mechanism, add an approval store or start recovery work.

## 1. Scope

OD-2 covers the approval record for privileged recovery and sealed-account use. Customer and agent recovery use one tenant administrator and do not need two approvers.

The mechanism must record:

- the requester, target, recovery path, reason, ticket and request id;
- two distinct approvers for each privileged path;
- the approver role at approval time and an `aal2` session;
- a 30-minute expiry and single use for one target;
- request, approval, completion and denial audit events;
- the executor and provider result after a reset.

The requester must not approve their own request. A peer administrator must not bypass the matrix.

## 2. Options

### Option 1: Reuse the D-62 approval service

The recovery request uses the D-62 request and approval model. T6.09 does not add a second approval store.

**Needs**

- D-62 exposes an approval contract that T6.09 can call.
- D-62 stores requester, approvers, state, expiry and target.
- D-62 enforces requester ≠ approver.
- D-62 sends the approval notification.
- D-62 records the audit references.

**Advantages**

- One approval model for recovery, access review and other high-risk grants.
- No duplicate approval tables or approval UI.
- The audit and notification path is consistent.

**Costs and risks**

- D-62 is Blocked. Its scope, permission seeds and notification channel are not approved.
- T6.09 waits for D-62, so recovery slips.
- D-62 must support a recovery-specific target and path without exposing general grant data.

**Use when**

D-62 can expose the contract before T6.09 starts.

### Option 2: Signed operations ticket as an interim

Two approvers sign an operations ticket. An operator runs a controlled server-side reset command and attaches the ticket id.

**Needs**

- A ticket schema with target, path, reason, approvers, expiry and single-use marker.
- A named operator group and a controlled command.
- A rule that the requester cannot be an approver.
- The same audit events and request id as the permanent service.
- A closure date and migration path to D-62.

**Advantages**

- Recovery can start before D-62 is ready.
- The approval evidence is visible to Operations.
- No new application approval table.

**Costs and risks**

- Manual discipline enforces the two-person rule.
- A ticket can be copied or edited outside the application.
- The operator can make a mistake unless the command checks the ticket and target.
- The manual path can become permanent without a closure date.

**Use when**

D-62 cannot expose the contract in time and the owner accepts a time-boxed interim with a named operator group.

### Option 3: Add a T6.09-local approval store

T6.09 adds its own recovery approval table, routes and UI.

**Assessment:** Rejected as written by the D-59 product/security review. It creates a second approval system, duplicates D-62, and expands T6.09. Reconsider only if D-62 is cancelled and the owner approves a replacement design.

### Option 4: Email approval

Approvers reply to an email thread.

**Assessment:** Reject. Mailbox compromise and ambiguous identity make email unsuitable for privileged recovery.

## 3. Comparison

| Criterion | Option 1: D-62 service | Option 2: Signed ticket | Option 3: Local store | Option 4: Email |
| --- | --- | --- | --- | --- |
| Requester ≠ approver enforcement | Service-enforced | Manual plus command check | Service-enforced | Manual |
| Single use and expiry | Service-enforced | Ticket and command check | Service-enforced | Weak |
| Audit evidence | Strong | Strong if ticket is linked | Strong | Weak |
| Additional T6.09 scope | Low | Low to medium | High | Low |
| Dependency | D-62 | Operations process | None | Mailbox |
| Main risk | D-62 delay | Manual error or bypass | Duplicate system | Identity ambiguity |
| Recommendation | Preferred if ready | Time-boxed interim | Reject | Reject |

## 4. Recommendation

Use Option 1 if D-62 can expose the approval contract before T6.09 starts.

Use Option 2 only as a time-boxed interim when D-62 cannot meet the date. The owner must name the operator group, the ticket system, the closure date and the migration path to D-62.

Do not select Option 3 or Option 4.

## 5. Owner questions

1. Can D-62 expose an approval contract before T6.09 starts?
2. If not, does the owner approve a signed-ticket interim with a closure date?
3. Which operator group may execute a signed-ticket reset?
4. Which ticket system holds the approval record?
5. Which two roles approve tenant-administrator, enterprise-administrator and sealed-account recovery?
6. Which audit events must exist before the first recovery?
7. Who reviews the interim path before it becomes permanent?

## 6. Decision record

No option is selected.

D-59 remains **Blocked**. T6.09 remains **unchecked**. This brief does not authorize recovery work.
