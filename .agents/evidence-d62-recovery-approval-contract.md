# D-62 recovery approval contract

Date: 2026-11-18
Status: **Draft. Not implemented. D-59 remains Blocked.**
Owner: Product/security owner; Engineering owner
Consumer: T6.09

This contract defines the approval service that T6.09 calls before a privileged MFA recovery. D-62 owns the approval state. T6.09 owns the provider reset and session revocation.

## 1. Scope

This contract covers privileged MFA recovery:

- tenant-administrator MFA reset;
- enterprise-administrator MFA reset;
- sealed platform-owner recovery.

It does not cover:

- customer or agent self-service password reset;
- customer or agent MFA reset by one tenant administrator;
- tenant-administrator self-service password reset;
- support-session grants (D-63).

Those paths use their own T6.09 audit records. They do not call D-62.

## 2. Terms

| Term | Meaning |
| --- | --- |
| Requester | The authenticated human who creates the recovery request. |
| Approver | An authenticated human who records APPROVE or DENY. |
| Target | The account that needs a new MFA factor. |
| Approval | The D-62 record that authorizes one recovery attempt. |
| Execution | The T6.09 provider reset that follows a consumed approval. |
| `approvalId` | Stable id for the approval record. |
| `executionId` | One-time id returned by `consume` and required by `complete`. |
| `requestId` | Idempotency key supplied by T6.09. |

The browser never receives the provider secret key, TOTP secret or `executionId`.

## 3. Policy mapping

D-62 derives the policy from the target role and recovery path. The caller cannot set `requiredApprovals` or choose the approvers.

| Recovery path | Target | Required approvals | Required approver roles |
| --- | --- | --- | --- |
| `TENANT_ADMIN_MFA_RESET` | Active tenant administrator in the request tenant | 2 | `ENTERPRISE_ADMIN`, `PLATFORM_SECURITY_OWNER` |
| `ENTERPRISE_ADMIN_MFA_RESET` | Active enterprise administrator | 2 | `PLATFORM_SECURITY_OWNER`, `SECOND_PLATFORM_OWNER` |
| `SEALED_ACCOUNT_RECOVERY` | Sealed platform owner | 3 | `CUSTODIAN` ×2, `PLATFORM_SECURITY_OWNER` ×1 |

For the sealed account, OD-4 may add a second platform-owner approval and raise the count to four. The policy table returns that count; T6.09 must not hard-code it.

`CUSTODIAN` is a policy role, not a canonical VELARIS role. D-62 maps policy roles to the approved permission seeds. That mapping is an open D-62 evidence item.

## 4. Service interface

T6.09 calls this interface inside the API process. If D-62 is separated later, HTTP routes must preserve the same inputs, outputs and errors.

```ts
export type RecoveryPath =
  | "TENANT_ADMIN_MFA_RESET"
  | "ENTERPRISE_ADMIN_MFA_RESET"
  | "SEALED_ACCOUNT_RECOVERY";

export type RecoveryApprovalState =
  | "PENDING"
  | "APPROVED"
  | "CONSUMED"
  | "COMPLETED"
  | "FAILED"
  | "DENIED"
  | "EXPIRED"
  | "CANCELLED";

export type RecoveryStepUpAction =
  | "recovery.request"
  | "recovery.execute";

export interface RecoveryStepUpProof {
  action: RecoveryStepUpAction;
  grantId: string;
  tenantId: string | null;
  verifiedAt: string;
  expiresAt: string;
}

export interface RecoveryActor {
  subject: string;
  sessionId: string;
  aal: "aal1" | "aal2";
  stepUp: RecoveryStepUpProof | null;
}

export interface CreateRecoveryApprovalInput {
  requestId: string;
  recoveryPath: RecoveryPath;
  tenantId: string | null;
  targetUserId: string;
  reason: string;
  ticketId: string;
  custodyRecordId?: string;
}

export interface RecoveryApprovalView {
  approvalId: string;
  state: RecoveryApprovalState;
  recoveryPath: RecoveryPath;
  tenantId: string | null;
  targetUserId: string;
  requestedBy: string;
  requiredApprovals: number;
  requiredApproverRoles: { policyRole: string; count: number }[];
  approvals: {
    actorId: string;
    policyRole: string;
    approvedAt: string;
  }[];
  requestedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  completedAt: string | null;
  stateReason: string | null;
  failureCode: string | null;
  version: number;
}

export interface RecoveryApprovalSummary {
  approvalId: string;
  state: RecoveryApprovalState;
  recoveryPath: RecoveryPath;
  tenantId: string | null;
  targetUserId: string;
  requestedAt: string;
  expiresAt: string;
  requiredApprovals: number;
  approvalCount: number;
  stateReason: string | null;
  failureCode: string | null;
}

export interface ListMyRecoveryApprovalsInput {
  tenantId?: string | null;
  states?: RecoveryApprovalState[];
  cursor?: string;
  limit?: number;
}

export interface RecoveryApprovalPage {
  items: RecoveryApprovalSummary[];
  nextCursor: string | null;
}

export interface DecideRecoveryApprovalInput {
  decision: "APPROVE" | "DENY";
  reason?: string;
}

export interface ConsumeRecoveryApprovalInput {
  approvalId: string;
  tenantId: string | null;
}

export interface ConsumeRecoveryApprovalResult {
  approval: RecoveryApprovalView;
  executionId: string;
  executionExpiresAt: string;
}

export interface CompleteRecoveryApprovalInput {
  approvalId: string;
  executionId: string;
  result: "SUCCEEDED" | "FAILED";
  failureCode?: string;
}

export interface RecoveryApprovalService {
  create(
    actor: RecoveryActor,
    input: CreateRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView>;

  get(
    actor: RecoveryActor,
    approvalId: string,
  ): Promise<RecoveryApprovalView>;

  listMine(
    actor: RecoveryActor,
    input: ListMyRecoveryApprovalsInput,
  ): Promise<RecoveryApprovalPage>;

  listPending(
    actor: RecoveryActor,
    tenantId: string | null,
  ): Promise<RecoveryApprovalView[]>;

  decide(
    actor: RecoveryActor,
    approvalId: string,
    input: DecideRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView>;

  consume(
    actor: RecoveryActor,
    input: ConsumeRecoveryApprovalInput,
  ): Promise<ConsumeRecoveryApprovalResult>;

  complete(
    actor: RecoveryActor,
    input: CompleteRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView>;

  cancel(
    actor: RecoveryActor,
    approvalId: string,
  ): Promise<RecoveryApprovalView>;
}
```

`RecoveryActor` comes from the verified session. It is not accepted from a request body.

## 5. Inputs

### Assurance and step-up

`create` and `consume` use the existing T6.08 step-up guard. A step-up grant is one-time, expires after 10 minutes, and is bound to subject, session, action and tenant.

| Operation | AAL | Step-up action | Binding |
| --- | --- | --- | --- |
| `create` | `aal2` | `recovery.request` | Requester and request tenant |
| `consume` | `aal2` | `recovery.execute` | Executor and request tenant |
| `decide` | `aal2` | None | Approver session |
| `cancel` | `aal2` | None | Requester session |
| `complete` | `aal2` | None; same executor and `executionId` as `consume` | Execution |
| `listMine` | Any authenticated requester | None | Requester only |
| `get` | Any authenticated actor allowed by the read rule | None | Approval |

T6.09 applies `@RequireStepUp` to the create route and the consume route. The guard checks `aal2`, verifies the `x-step-up-token`, and consumes the grant. D-62 receives the verified proof in `RecoveryActor.stepUp`; it must not accept a step-up claim from a request body. D-62 rechecks the action, tenant, session and expiry before it changes state.

A missing or invalid proof is `STEP_UP_REQUIRED`. An `aal1` session is `MFA_REQUIRED`. A retry after a lost response needs a new grant because the guard consumes the old grant. The service still returns the existing approval for an idempotent retry.

`complete` does not need a second step-up. The execution is bound to the executor and expires after five minutes. This keeps the reset inside one approved execution.

### Create

| Field | Rule |
| --- | --- |
| `requestId` | UUID. Idempotency key for one T6.09 request. |
| `recoveryPath` | Must match the target role and tenant. |
| `tenantId` | Required for `TENANT_ADMIN_MFA_RESET`; null for enterprise and sealed paths. |
| `targetUserId` | Application user id. D-62 resolves the target state and role. |
| `reason` | 10–500 characters. Required. |
| `ticketId` | 1–100 characters. Required. |
| `custodyRecordId` | Required for `SEALED_ACCOUNT_RECOVERY`; must match the active custody record. |

T6.09 must already hold `user.mfa.reset` or the approved privileged recovery permission. D-62 rechecks the requester permission before it creates the record.

### Read and list

`get` is limited to the requester, an eligible approver, the target, or an audit reader with the approved permission. `listPending` returns only open requests (`PENDING` or `APPROVED`) where the actor is an eligible approver and is not the requester or target. A caller with no eligible request receives an empty list.

`listMine` is the requester-facing status list. It returns only records where `requestedBy` equals `actor.subject`. It supports `tenantId`, `states`, `cursor` and `limit`. The default limit is 20 and the maximum is 50. Results are newest first. The list returns `RecoveryApprovalSummary`, not approver identities, provider details or `executionId`.

### Requester list

| Field | Rule |
| --- | --- |
| `tenantId` | Optional. Null means platform scope. |
| `states` | Optional. If omitted, return every state. |
| `cursor` | Optional opaque cursor from the previous page. |
| `limit` | Optional. 1–50; default 20. |

The list shows state, target, path, approval count, required count, expiry, `stateReason` and `failureCode`. The requester cannot use this list to read another requester's records.

### Decide

| Field | Rule |
| --- | --- |
| `decision` | `APPROVE` or `DENY`. |
| `reason` | Required for `DENY`; optional for `APPROVE`. |

The actor must be eligible for one of the policy roles, must have `aal2`, must not be the requester and must not be the target.

### Consume

| Field | Rule |
| --- | --- |
| `approvalId` | Required. |
| `tenantId` | Required for a tenant approval; null for platform scope. Must match the approval tenant and the step-up grant tenant. |

Only an `APPROVED` approval can be consumed. The actor must have `aal2`, a valid `recovery.execute` step-up grant, and the executor permission from T6.09. Consumption is atomic and returns one `executionId`. A retry by the same executor returns the same id while the approval is `CONSUMED`; another executor receives `APPROVAL_ALREADY_CONSUMED`.

### Complete

The actor must have `aal2`, and the actor and `executionId` must match the consumer. `SUCCEEDED` moves the approval to `COMPLETED`. `FAILED` moves it to `FAILED` and records a safe `failureCode`. No second step-up is required.

### Cancel

The requester may cancel a `PENDING` or `APPROVED` approval before consumption. The requester must have `aal2`. A consumed approval cannot be cancelled.

## 6. Outputs

`RecoveryApprovalView` returns:

- the approval state and policy;
- the required approval count and policy roles;
- each recorded approval with actor, policy role and time;
- request and expiry times;
- the terminal time, state reason and failure code where applicable.

The requester list returns `RecoveryApprovalSummary`: state, target, path, approval count, required count, expiry, `stateReason` and `failureCode`. It does not return approver identities or `executionId`.

The `executionId` is returned only by `consume` to the server-side caller. It is not part of the general approval view.

It does not return provider secrets, TOTP secrets, recovery tokens, session tokens, passwords or full ticket bodies.

## 7. State transitions

| From | To | Trigger | Guard |
| --- | --- | --- | --- |
| — | `PENDING` | `create` | Target, tenant, path and requester permission are valid. |
| `PENDING` | `APPROVED` | `decide(APPROVE)` | Approval count reaches the policy count before `expiresAt`. |
| `PENDING` | `DENIED` | `decide(DENY)` | Eligible approver denies. |
| `PENDING` | `CANCELLED` | `cancel` | Requester cancels. |
| `PENDING` | `EXPIRED` | read, decide, consume or expiry job | `now >= expiresAt`. |
| `APPROVED` | `CONSUMED` | `consume` | Before `expiresAt`; actor is the authorized executor. |
| `APPROVED` | `CANCELLED` | `cancel` | Requester cancels before consumption. |
| `APPROVED` | `EXPIRED` | read, consume or expiry job | `now >= expiresAt`. |
| `CONSUMED` | `COMPLETED` | `complete(SUCCEEDED)` | Execution actor and id match. |
| `CONSUMED` | `FAILED` | `complete(FAILED)` or execution timeout | Execution actor and id match, or `now >= executionExpiresAt`. |

Terminal states are `COMPLETED`, `FAILED`, `DENIED`, `EXPIRED` and `CANCELLED`. No transition leaves a terminal state.

`expiresAt` is 30 minutes after creation. `executionExpiresAt` is 5 minutes after consumption. Expiry is checked lazily on every operation and by a background job. A failed or expired execution needs a new approval request.

`stateReason` is one of `APPROVER_DENIED`, `REQUESTER_CANCELLED`, `APPROVAL_EXPIRED`, `EXECUTION_TIMEOUT` or null. `failureCode` is a safe provider or validation code, never a provider message or secret.

## 8. Approval rules

1. The requester cannot approve.
2. The target cannot approve.
3. An approver must be active, hold an eligible policy role and have `aal2`.
4. One actor records one decision per approval.
5. A duplicate approval by the same actor is idempotent; a different decision is a conflict.
6. Approvals are immutable after they are recorded.
7. No decision is accepted after `expiresAt` or after a terminal state.
8. The required approval count comes from D-62 policy, not from the caller.
9. A tenant-scoped request must keep the target in the same tenant.
10. A sealed-account request must reference an active custody record before consumption.
11. An approval authorizes one execution only.
12. T6.09 must not execute a reset from `APPROVED` without `consume`.
13. The requester must have `aal2` and a valid `recovery.request` step-up grant.
14. The executor must have `aal2` and a valid `recovery.execute` step-up grant.
15. The step-up grant must match the subject, session, action and tenant.
16. A consumed or expired step-up grant is never accepted again.

## 9. Idempotency and concurrency

- `create` with the same `requestId` and same payload returns the existing approval.
- `create` with the same `requestId` and a different payload returns `IDEMPOTENCY_CONFLICT`.
- An idempotent `create` or `consume` retry still passes the step-up guard. A consumed grant is not reused; the caller needs a new grant.
- `decide` by the same actor with the same decision returns the current approval.
- `decide` by the same actor with a different decision returns `DECISION_ALREADY_RECORDED`.
- `consume` is a conditional update from `APPROVED`. A second consumer receives `APPROVAL_ALREADY_CONSUMED`.
- A `consume` retry by the same executor returns the existing `executionId` while the approval is `CONSUMED`.
- A `consume` retry after `COMPLETED`, `FAILED` or execution expiry returns `APPROVAL_TERMINAL` or `EXECUTION_EXPIRED` and does not create a new execution.
- `complete` with the same `executionId` and result returns the current approval.
- `complete` with a different result returns `EXECUTION_ALREADY_COMPLETED`.
- Every state change uses a version check or a conditional update. A stale write returns `APPROVAL_VERSION_CONFLICT`.

## 10. Audit events

Each event uses `approvalId` (optional for a denied create), `requestId`, `targetUserId`, `tenantId`, `recoveryPath` and the actor subject. Do not store secrets, tokens or full ticket bodies.

| Event | When | Required fields | Forbidden fields |
| --- | --- | --- | --- |
| `auth.mfa_reset_requested` | Request created | requester, target, tenant, path, required count, expiry, requester AAL, step-up grant id | TOTP secret, password, step-up token |
| `auth.mfa_reset_approval_recorded` | One approval recorded | approver, policy role, approval count, required count, approver AAL | TOTP secret, token |
| `auth.mfa_reset_approved` | Required approvals complete | approvers, target, expiry | TOTP secret, token |
| `auth.mfa_reset_denied` | Deny, cancel, expiry or assurance failure | actor, target, reason code, state | TOTP secret, token |
| `auth.mfa_reset_execution_started` | Approval consumed | executor, execution id, consumed time, executor AAL, step-up grant id | TOTP secret, step-up token |
| `auth.mfa_reset_completed` | Provider reset succeeds | executor, execution id, target, result | TOTP secret, password, token |
| `auth.mfa_reset_failed` | Provider reset fails or times out | executor, execution id, failure code | TOTP secret, password, token |
| `auth.sessions_revoked` | T6.09 revokes sessions | actor, target, scope, request id | bearer token, refresh token |

The three new events are `auth.mfa_reset_approval_recorded`, `auth.mfa_reset_execution_started` and `auth.mfa_reset_failed`. D-59 section 8 records them.

## 11. Denial cases

| Code | Status | When | State effect |
| --- | --- | --- | --- |
| `INVALID_INPUT` | 422 | Missing or invalid field | None |
| `REQUESTER_NOT_PERMITTED` | 403 | Requester lacks the recovery permission | None |
| `TARGET_NOT_FOUND` | 404 | Target does not exist or is outside the tenant | None |
| `TARGET_NOT_ACTIVE` | 409 | Target is disabled or removed | None |
| `RECOVERY_PATH_NOT_ALLOWED` | 422 | Path does not match target role | None |
| `TENANT_SCOPE_MISMATCH` | 404 | Target or consume tenant does not match the approval tenant | None |
| `CUSTODY_EVIDENCE_REQUIRED` | 409 | Sealed path has no active custody record | None |
| `CUSTODY_RECORD_MISMATCH` | 409 | Custody record does not match the target | None |
| `SELF_APPROVAL` | 403 | Requester tries to approve | None |
| `TARGET_APPROVAL` | 403 | Target tries to approve | None |
| `APPROVER_NOT_ELIGIBLE` | 403 | Actor lacks the policy role or active status | None |
| `MFA_REQUIRED` | 403 | An actor whose action requires `aal2` has an `aal1` session | None |
| `STEP_UP_REQUIRED` | 403 | Requester create or executor consume has no valid recent step-up. Reason is `MISSING`, `EXPIRED`, `ACTION_MISMATCH`, `SESSION_MISMATCH`, `TENANT_MISMATCH` or `REPLAYED` | None |
| `READ_NOT_PERMITTED` | 403 | Actor is not the requester, an eligible approver, the target or an audit reader | None |
| `EXECUTOR_NOT_PERMITTED` | 403 | Actor lacks the policy execution permission | None |
| `DUPLICATE_APPROVAL` | 409 | Actor already approved | None |
| `DECISION_ALREADY_RECORDED` | 409 | Actor tries to change a decision | None |
| `APPROVAL_EXPIRED` | 409 | Request is past `expiresAt` | `EXPIRED` |
| `APPROVAL_NOT_APPROVED` | 409 | Consume before required approvals | None |
| `APPROVAL_ALREADY_CONSUMED` | 409 | Another consumer already consumed | None |
| `APPROVAL_VERSION_CONFLICT` | 409 | Stale conditional update | None |
| `APPROVAL_TERMINAL` | 409 | Operation on a terminal approval | None |
| `CANCEL_NOT_ALLOWED` | 409 | Cancel after consumption or terminal state | None |
| `EXECUTION_NOT_FOUND` | 404 | Unknown `executionId` | None |
| `EXECUTION_ACTOR_MISMATCH` | 403 | Completing actor is not the consumer | None |
| `EXECUTION_EXPIRED` | 409 | Execution passed `executionExpiresAt` | `FAILED` |
| `EXECUTION_ALREADY_COMPLETED` | 409 | Different result for the same execution | None |
| `IDEMPOTENCY_CONFLICT` | 409 | Same `requestId`, different payload | None |

A denied create records `auth.mfa_reset_denied` with the request id and denial code. A denied approval records the same event with the `approvalId`.

## 12. T6.09 call sequence

1. T6.09 verifies the requester, target, tenant, recovery permission and path.
2. The requester obtains `aal2` and a `recovery.request` step-up grant for the tenant.
3. T6.09 calls `create`.
4. The requester sees status through `listMine`. The approval UI lists `PENDING` requests to eligible approvers.
5. Approvers call `decide`. D-62 becomes `APPROVED` when the required count is reached.
6. The executor obtains `aal2` and a `recovery.execute` step-up grant for the tenant.
7. T6.09 calls `consume` with the approval id and tenant id and receives `executionId`.
8. T6.09 performs the provider MFA factor reset and session revocation.
9. T6.09 calls `complete` with `SUCCEEDED` or `FAILED`. The same executor and `executionId` are required. No second step-up is required.
10. T6.09 emits `auth.mfa_reset_completed` or `auth.mfa_reset_failed`, and `auth.sessions_revoked` after a successful reset.

If T6.09 crashes after `consume`, the execution expires and the approval becomes `FAILED`. A new request is required.

## 13. Evidence before implementation

- D-62 policy role mapping and permission seeds.
- D-62 storage schema for approvals and decisions.
- Notification channel for approvers.
- Audit event registration and retention.
- Custody-record source for the sealed account.
- Concurrency and idempotency tests.
- Denial tests for every row in section 11.
- Registration of the `recovery.request` and `recovery.execute` step-up actions, with `mfa: true`.
- Step-up proof handoff from the guard, including the grant id and verified time.
- Proof that an `aal1` requester or executor is refused.
- Proof that an expired, replayed, wrong-action, wrong-session or wrong-tenant grant is refused.
- Proof that a requester cannot list another requester's approvals.
- Proof that T6.09 cannot execute without `consume`.
- Proof that a replayed `executionId` is refused.

This draft does not implement the service, change D-59 state or start T6.09 recovery work.
