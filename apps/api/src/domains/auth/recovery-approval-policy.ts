/**
 * Privileged recovery approval policy (D-62 approval contract; D-59 matrix).
 *
 * The policy is code, not a caller input: a requester cannot choose how many
 * approvals a recovery needs or who may approve it. T6.09 reads this module
 * before it resets a factor, and T6.12 reuses it for high-risk grants.
 *
 * D-59 and D-62 remain Blocked. This module records the policy that the draft
 * `.agents/evidence-d62-recovery-approval-contract.md` states. It stores no
 * approval, sends no notification, resets no factor and adds no route.
 */

export const RECOVERY_STEP_UP_ACTIONS = {
  REQUEST: 'recovery.request',
  EXECUTE: 'recovery.execute',
} as const;

export type RecoveryStepUpAction =
  (typeof RECOVERY_STEP_UP_ACTIONS)[keyof typeof RECOVERY_STEP_UP_ACTIONS];

export const RECOVERY_PATHS = {
  TENANT_ADMIN_MFA_RESET: 'TENANT_ADMIN_MFA_RESET',
  ENTERPRISE_ADMIN_MFA_RESET: 'ENTERPRISE_ADMIN_MFA_RESET',
  SEALED_ACCOUNT_RECOVERY: 'SEALED_ACCOUNT_RECOVERY',
} as const;

export type RecoveryPath = (typeof RECOVERY_PATHS)[keyof typeof RECOVERY_PATHS];

/**
 * Policy roles are approval duties, not canonical VELARIS roles. D-62 maps each
 * one to an approved permission seed; CUSTODIAN has no canonical role.
 */
export const RECOVERY_POLICY_ROLES = {
  ENTERPRISE_ADMIN: 'ENTERPRISE_ADMIN',
  PLATFORM_SECURITY_OWNER: 'PLATFORM_SECURITY_OWNER',
  SECOND_PLATFORM_OWNER: 'SECOND_PLATFORM_OWNER',
  CUSTODIAN: 'CUSTODIAN',
} as const;

export type RecoveryPolicyRole =
  (typeof RECOVERY_POLICY_ROLES)[keyof typeof RECOVERY_POLICY_ROLES];

export interface RecoveryApprovalQuota {
  policyRole: RecoveryPolicyRole;
  count: number;
}

export interface RecoveryPolicyRule {
  recoveryPath: RecoveryPath;
  /** The target must be an active member of the request tenant. */
  tenantScoped: boolean;
  /** The request must name the active custody record (D-59 sealed account). */
  requiresCustodyRecord: boolean;
  requiredApprovals: number;
  approverRoles: readonly RecoveryApprovalQuota[];
  /** A recovered account enrolls a new factor before normal use (AC-F02-4). */
  requiresNewFactor: boolean;
}

/**
 * D-59 section 4 and D-62 section 3. OD-4 may raise the sealed-account count
 * to four; the table returns the count and the caller must not hard-code it.
 */
export const RECOVERY_POLICY: Record<RecoveryPath, RecoveryPolicyRule> = {
  [RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET]: {
    recoveryPath: RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET,
    tenantScoped: true,
    requiresCustodyRecord: false,
    requiredApprovals: 2,
    approverRoles: [
      { policyRole: RECOVERY_POLICY_ROLES.ENTERPRISE_ADMIN, count: 1 },
      { policyRole: RECOVERY_POLICY_ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
    ],
    requiresNewFactor: true,
  },
  [RECOVERY_PATHS.ENTERPRISE_ADMIN_MFA_RESET]: {
    recoveryPath: RECOVERY_PATHS.ENTERPRISE_ADMIN_MFA_RESET,
    tenantScoped: false,
    requiresCustodyRecord: false,
    requiredApprovals: 2,
    approverRoles: [
      { policyRole: RECOVERY_POLICY_ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
      { policyRole: RECOVERY_POLICY_ROLES.SECOND_PLATFORM_OWNER, count: 1 },
    ],
    requiresNewFactor: true,
  },
  [RECOVERY_PATHS.SEALED_ACCOUNT_RECOVERY]: {
    recoveryPath: RECOVERY_PATHS.SEALED_ACCOUNT_RECOVERY,
    tenantScoped: false,
    requiresCustodyRecord: true,
    requiredApprovals: 3,
    approverRoles: [
      { policyRole: RECOVERY_POLICY_ROLES.CUSTODIAN, count: 2 },
      { policyRole: RECOVERY_POLICY_ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
    ],
    requiresNewFactor: true,
  },
};

/** OD-2 requires a 30-minute approval window. */
export const RECOVERY_APPROVAL_TTL_MS = 30 * 60 * 1_000;

/** The execution is bound to one executor for five minutes. */
export const RECOVERY_EXECUTION_TTL_MS = 5 * 60 * 1_000;

export const RECOVERY_OPERATIONS = {
  CREATE: 'create',
  DECIDE: 'decide',
  CONSUME: 'consume',
  COMPLETE: 'complete',
  CANCEL: 'cancel',
  LIST_MINE: 'list_mine',
  GET: 'get',
} as const;

export type RecoveryOperation =
  (typeof RECOVERY_OPERATIONS)[keyof typeof RECOVERY_OPERATIONS];

export interface RecoveryOperationPolicy {
  /** The operation needs an `aal2` session before the handler runs. */
  mfa: boolean;
  /** The one-time step-up action the route must declare, when one is needed. */
  stepUpAction: RecoveryStepUpAction | null;
}

/**
 * D-62 section 5. `create` and `consume` are the two privileged steps, so they
 * consume a step-up grant. `decide` still needs `aal2`; the approver proves the
 * second factor at sign-in instead of a second time for one decision.
 */
export const RECOVERY_OPERATION_POLICY: Record<
  RecoveryOperation,
  RecoveryOperationPolicy
> = {
  [RECOVERY_OPERATIONS.CREATE]: {
    mfa: true,
    stepUpAction: RECOVERY_STEP_UP_ACTIONS.REQUEST,
  },
  [RECOVERY_OPERATIONS.DECIDE]: { mfa: true, stepUpAction: null },
  [RECOVERY_OPERATIONS.CONSUME]: {
    mfa: true,
    stepUpAction: RECOVERY_STEP_UP_ACTIONS.EXECUTE,
  },
  [RECOVERY_OPERATIONS.COMPLETE]: { mfa: true, stepUpAction: null },
  [RECOVERY_OPERATIONS.CANCEL]: { mfa: true, stepUpAction: null },
  [RECOVERY_OPERATIONS.LIST_MINE]: { mfa: false, stepUpAction: null },
  [RECOVERY_OPERATIONS.GET]: { mfa: false, stepUpAction: null },
};

export const RECOVERY_APPROVAL_STATES = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  CONSUMED: 'CONSUMED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  DENIED: 'DENIED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
} as const;

export type RecoveryApprovalState =
  (typeof RECOVERY_APPROVAL_STATES)[keyof typeof RECOVERY_APPROVAL_STATES];

export type RecoveryDecisionState =
  | typeof RECOVERY_APPROVAL_STATES.PENDING
  | typeof RECOVERY_APPROVAL_STATES.APPROVED
  | typeof RECOVERY_APPROVAL_STATES.DENIED;

export interface RecoveryApproval {
  actorSubject: string;
  policyRole: RecoveryPolicyRole;
  approvedAt: Date;
}

export type RecoveryApprovalDenial =
  | 'SELF_APPROVAL'
  | 'TARGET_APPROVAL'
  | 'ROLE_OUTSIDE_POLICY'
  | 'ROLE_QUOTA_FILLED';

export interface RecoveryApprovalAttempt {
  rule: RecoveryPolicyRule;
  approvals: readonly RecoveryApproval[];
  actorSubject: string;
  requestedBy: string;
  targetUserId: string;
  policyRole: RecoveryPolicyRole;
}

/**
 * Apply the two-person rules before a decision is stored. The requester and the
 * target can never approve, and one person cannot fill two quotas.
 */
export function approvalDenial(
  attempt: RecoveryApprovalAttempt,
): RecoveryApprovalDenial | null {
  if (attempt.actorSubject === attempt.requestedBy) {
    return 'SELF_APPROVAL';
  }
  if (attempt.actorSubject === attempt.targetUserId) {
    return 'TARGET_APPROVAL';
  }
  const quota = attempt.rule.approverRoles.find(
    (entry) => entry.policyRole === attempt.policyRole,
  );
  if (!quota) {
    return 'ROLE_OUTSIDE_POLICY';
  }
  if (distinctApprovers(attempt.approvals, attempt.policyRole) >= quota.count) {
    return 'ROLE_QUOTA_FILLED';
  }
  return null;
}

export interface RecoveryApprovalProgress {
  satisfied: number;
  missing: readonly RecoveryApprovalQuota[];
}

/** Count distinct approvers per policy role, capped by each role quota. */
export function approvalProgress(
  rule: RecoveryPolicyRule,
  approvals: readonly RecoveryApproval[],
): RecoveryApprovalProgress {
  const missing: RecoveryApprovalQuota[] = [];
  let satisfied = 0;
  for (const quota of rule.approverRoles) {
    const distinct = Math.min(
      distinctApprovers(approvals, quota.policyRole),
      quota.count,
    );
    satisfied += distinct;
    if (distinct < quota.count) {
      missing.push({
        policyRole: quota.policyRole,
        count: quota.count - distinct,
      });
    }
  }
  return { satisfied, missing };
}

/** A denial wins over pending approvals; otherwise the full quota approves. */
export function decisionState(input: {
  rule: RecoveryPolicyRule;
  approvals: readonly RecoveryApproval[];
  denied: boolean;
}): RecoveryDecisionState {
  if (input.denied) {
    return RECOVERY_APPROVAL_STATES.DENIED;
  }
  return approvalProgress(input.rule, input.approvals).missing.length === 0
    ? RECOVERY_APPROVAL_STATES.APPROVED
    : RECOVERY_APPROVAL_STATES.PENDING;
}

/** An approval past its window cannot be consumed. */
export function isApprovalExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export interface RecoveryExecution {
  state: RecoveryApprovalState;
  executionExpiresAt: Date;
  completedAt: Date | null;
}

/** One execution id is open once, for five minutes, and closes on completion. */
export function isExecutionOpen(
  execution: RecoveryExecution,
  now: Date,
): boolean {
  return (
    execution.state === RECOVERY_APPROVAL_STATES.CONSUMED &&
    execution.completedAt === null &&
    execution.executionExpiresAt.getTime() > now.getTime()
  );
}

function distinctApprovers(
  approvals: readonly RecoveryApproval[],
  policyRole: RecoveryPolicyRole,
): number {
  const subjects = new Set<string>();
  for (const approval of approvals) {
    if (approval.policyRole === policyRole) {
      subjects.add(approval.actorSubject);
    }
  }
  return subjects.size;
}
