# OD-2 approval mechanism options

Date: 2026-11-18
Status: **Option 1 selected by the owner on 2026-11-18. D-59 remains Blocked until D-62 exposes the approval contract.**
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
| Decision | Selected | Fallback only | Reject | Reject |

## 4. Recommendation

**Selected: Option 1, reuse the D-62 approval service.** The owner selected this mechanism on 2026-11-18. One approval model is safer than a parallel recovery store.

Conditions:

- D-62 records its scope and approval contract before T6.09 starts.
- D-62 enforces requester ≠ approver, expiry and single use.
- D-62 exposes the audit references that T6.09 needs.

If D-62 cannot meet that condition, the only acceptable fallback is Option 2 with:

- a named operator group;
- a named ticket system;
- a closure date of no more than 90 days;
- the same audit events and request id as the permanent service.

Do not select Option 3 or Option 4.

### 4.1 Evidence still needed

| Option | Evidence still needed | Evidence before first use |
| --- | --- | --- |
| Option 1: D-62 service | Signed D-62 scope decision; approval contract; permission seeds; notification channel; concurrency, expiry and single-use rules; audit mapping; machine-identity inventory; owner approval of the D-62 scope | Integration test that creates a recovery approval, denies self-approval, expires a request, rejects replay and records completion and denial |
| Option 2: Signed ticket | Only if D-62 misses the date: ticket schema; named operator group; ticket system; approver roles; closure date; migration path to D-62; owner approval to activate the fallback | Dry run with two approvers, one requester, one target and one expired ticket; audit event mapping; controlled-command test |
| Option 3: Local store | Not recommended. A full replacement design, migration, permission seeds, approval UI, concurrency rules and security review only if D-62 is cancelled | Not applicable until the owner reopens the design |
| Option 4: Email | Reject. Identity verification and mailbox-compromise controls would still be insufficient for privileged recovery | Not applicable |

## 5. Owner questions

1. Can D-62 expose an approval contract before T6.09 starts?
2. If not, does the owner approve a signed-ticket interim with a closure date?
3. Which operator group may execute a signed-ticket reset?
4. Which ticket system holds the approval record?
5. Which two roles approve tenant-administrator, enterprise-administrator and sealed-account recovery?
6. Which audit events must exist before the first recovery?
7. Who reviews the interim path before it becomes permanent?

## 6. Decision record

Option 1, the D-62 approval service, is selected. D-62 remains Blocked. The approval contract and the evidence above are still required before D-59 can be Recorded or T6.09 can use the service.

D-59 remains **Blocked**. T6.09 remains **unchecked**. This brief does not authorize recovery work.
