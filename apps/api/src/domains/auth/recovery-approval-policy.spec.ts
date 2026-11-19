/**
 * Recovery approval policy (D-62 contract; D-59 matrix; INV-04).
 *
 * These cases pin the policy table, the two-person rules and the execution
 * window. They do not approve D-59 or D-62 and they do not exercise a route.
 */

import { describe, expect, it } from 'vitest';
import {
  RECOVERY_APPROVAL_STATES,
  RECOVERY_APPROVAL_TTL_MS,
  RECOVERY_EXECUTION_TTL_MS,
  RECOVERY_OPERATION_POLICY,
  RECOVERY_OPERATIONS,
  RECOVERY_PATHS,
  RECOVERY_POLICY,
  RECOVERY_POLICY_ROLES,
  RECOVERY_STEP_UP_ACTIONS,
  approvalDenial,
  approvalProgress,
  decisionState,
  isApprovalExpired,
  isExecutionOpen,
} from './recovery-approval-policy.js';
import type { RecoveryApproval } from './recovery-approval-policy.js';
import { STEP_UP_ACTIONS } from './step-up.service.js';

const ROLES = RECOVERY_POLICY_ROLES;
const TENANT_RULE = RECOVERY_POLICY[RECOVERY_PATHS.TENANT_ADMIN_MFA_RESET];
const ENTERPRISE_RULE =
  RECOVERY_POLICY[RECOVERY_PATHS.ENTERPRISE_ADMIN_MFA_RESET];
const SEALED_RULE = RECOVERY_POLICY[RECOVERY_PATHS.SEALED_ACCOUNT_RECOVERY];

function approval(
  actorSubject: string,
  policyRole: (typeof ROLES)[keyof typeof ROLES],
): RecoveryApproval {
  return {
    actorSubject,
    policyRole,
    approvedAt: new Date('2026-11-18T10:00:00Z'),
  };
}

describe('recovery step-up registration', () => {
  it('registers both recovery actions as known MFA-protected actions', () => {
    expect(STEP_UP_ACTIONS.RECOVERY_REQUEST).toBe(
      RECOVERY_STEP_UP_ACTIONS.REQUEST,
    );
    expect(STEP_UP_ACTIONS.RECOVERY_EXECUTE).toBe(
      RECOVERY_STEP_UP_ACTIONS.EXECUTE,
    );
  });
});

describe('recovery approval policy table', () => {
  it('requires two distinct approvals for each administrator path', () => {
    expect(TENANT_RULE.requiredApprovals).toBe(2);
    expect(ENTERPRISE_RULE.requiredApprovals).toBe(2);
    expect(TENANT_RULE.approverRoles).toEqual([
      { policyRole: ROLES.ENTERPRISE_ADMIN, count: 1 },
      { policyRole: ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
    ]);
    expect(ENTERPRISE_RULE.approverRoles).toEqual([
      { policyRole: ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
      { policyRole: ROLES.SECOND_PLATFORM_OWNER, count: 1 },
    ]);
  });

  it('requires two custodians and the security owner for the sealed account', () => {
    expect(SEALED_RULE.requiredApprovals).toBe(3);
    expect(SEALED_RULE.requiresCustodyRecord).toBe(true);
    expect(SEALED_RULE.tenantScoped).toBe(false);
    expect(SEALED_RULE.approverRoles).toEqual([
      { policyRole: ROLES.CUSTODIAN, count: 2 },
      { policyRole: ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
    ]);
  });

  it('keeps each quota sum equal to the required approval count', () => {
    for (const rule of Object.values(RECOVERY_POLICY)) {
      const total = rule.approverRoles.reduce(
        (sum, quota) => sum + quota.count,
        0,
      );
      expect(total).toBe(rule.requiredApprovals);
      expect(rule.requiredApprovals).toBeGreaterThanOrEqual(2);
      expect(rule.requiresNewFactor).toBe(true);
    }
  });

  it('scopes the tenant administrator reset to one tenant', () => {
    expect(TENANT_RULE.tenantScoped).toBe(true);
    expect(TENANT_RULE.requiresCustodyRecord).toBe(false);
  });
});

describe('recovery approval progress', () => {
  it('reports the remaining approver after one approval', () => {
    const progress = approvalProgress(TENANT_RULE, [
      approval('user-enterprise', ROLES.ENTERPRISE_ADMIN),
    ]);
    expect(progress.satisfied).toBe(1);
    expect(progress.missing).toEqual([
      { policyRole: ROLES.PLATFORM_SECURITY_OWNER, count: 1 },
    ]);
  });

  it('counts one person once even with two rows for the same role', () => {
    const progress = approvalProgress(SEALED_RULE, [
      approval('custodian-a', ROLES.CUSTODIAN),
      approval('custodian-a', ROLES.CUSTODIAN),
    ]);
    expect(progress.satisfied).toBe(1);
    expect(progress.missing).toContainEqual({
      policyRole: ROLES.CUSTODIAN,
      count: 1,
    });
    expect(progress.missing).toContainEqual({
      policyRole: ROLES.PLATFORM_SECURITY_OWNER,
      count: 1,
    });
  });
});

describe('recovery approval denials', () => {
  const base = {
    rule: TENANT_RULE,
    approvals: [] as RecoveryApproval[],
    actorSubject: 'actor-1',
    requestedBy: 'requester-1',
    targetUserId: 'target-1',
  };

  it('refuses the requester as an approver', () => {
    expect(
      approvalDenial({
        ...base,
        actorSubject: 'requester-1',
        policyRole: ROLES.ENTERPRISE_ADMIN,
      }),
    ).toBe('SELF_APPROVAL');
  });

  it('refuses the target as an approver', () => {
    expect(
      approvalDenial({
        ...base,
        actorSubject: 'target-1',
        policyRole: ROLES.ENTERPRISE_ADMIN,
      }),
    ).toBe('TARGET_APPROVAL');
  });

  it('refuses a policy role outside the path', () => {
    expect(approvalDenial({ ...base, policyRole: ROLES.CUSTODIAN })).toBe(
      'ROLE_OUTSIDE_POLICY',
    );
  });

  it('refuses a second approval for a filled role quota', () => {
    expect(
      approvalDenial({
        ...base,
        approvals: [approval('enterprise-a', ROLES.ENTERPRISE_ADMIN)],
        policyRole: ROLES.ENTERPRISE_ADMIN,
      }),
    ).toBe('ROLE_QUOTA_FILLED');
  });

  it('accepts a distinct approver from a policy role with an open quota', () => {
    expect(
      approvalDenial({
        ...base,
        approvals: [approval('enterprise-a', ROLES.ENTERPRISE_ADMIN)],
        policyRole: ROLES.PLATFORM_SECURITY_OWNER,
      }),
    ).toBeNull();
  });
});

describe('recovery approval and execution windows', () => {
  it('approves only when every quota is filled', () => {
    expect(
      decisionState({ rule: TENANT_RULE, approvals: [], denied: false }),
    ).toBe(RECOVERY_APPROVAL_STATES.PENDING);
    expect(
      decisionState({
        rule: TENANT_RULE,
        approvals: [approval('enterprise-a', ROLES.ENTERPRISE_ADMIN)],
        denied: false,
      }),
    ).toBe(RECOVERY_APPROVAL_STATES.PENDING);
    expect(
      decisionState({
        rule: TENANT_RULE,
        approvals: [
          approval('enterprise-a', ROLES.ENTERPRISE_ADMIN),
          approval('security-owner', ROLES.PLATFORM_SECURITY_OWNER),
        ],
        denied: false,
      }),
    ).toBe(RECOVERY_APPROVAL_STATES.APPROVED);
  });

  it('lets one denial stop a request that already has approvals', () => {
    expect(
      decisionState({
        rule: TENANT_RULE,
        approvals: [
          approval('enterprise-a', ROLES.ENTERPRISE_ADMIN),
          approval('security-owner', ROLES.PLATFORM_SECURITY_OWNER),
        ],
        denied: true,
      }),
    ).toBe(RECOVERY_APPROVAL_STATES.DENIED);
  });

  it('expires an approval at its stated instant', () => {
    const expiresAt = new Date('2026-11-18T10:30:00Z');
    expect(isApprovalExpired(expiresAt, new Date('2026-11-18T10:29:59Z'))).toBe(
      false,
    );
    expect(isApprovalExpired(expiresAt, expiresAt)).toBe(true);
  });

  it('keeps one execution open for five minutes after consumption', () => {
    const executionExpiresAt = new Date('2026-11-18T10:05:00Z');
    expect(
      isExecutionOpen(
        {
          state: RECOVERY_APPROVAL_STATES.CONSUMED,
          executionExpiresAt,
          completedAt: null,
        },
        new Date('2026-11-18T10:04:59Z'),
      ),
    ).toBe(true);
    expect(
      isExecutionOpen(
        {
          state: RECOVERY_APPROVAL_STATES.CONSUMED,
          executionExpiresAt,
          completedAt: null,
        },
        executionExpiresAt,
      ),
    ).toBe(false);
  });

  it('refuses an approval that was not consumed or is already complete', () => {
    const executionExpiresAt = new Date('2026-11-18T10:05:00Z');
    expect(
      isExecutionOpen(
        {
          state: RECOVERY_APPROVAL_STATES.APPROVED,
          executionExpiresAt,
          completedAt: null,
        },
        new Date('2026-11-18T10:00:00Z'),
      ),
    ).toBe(false);
    expect(
      isExecutionOpen(
        {
          state: RECOVERY_APPROVAL_STATES.CONSUMED,
          executionExpiresAt,
          completedAt: new Date('2026-11-18T10:01:00Z'),
        },
        new Date('2026-11-18T10:02:00Z'),
      ),
    ).toBe(false);
  });

  it('states the approval and execution durations', () => {
    expect(RECOVERY_APPROVAL_TTL_MS).toBe(30 * 60 * 1_000);
    expect(RECOVERY_EXECUTION_TTL_MS).toBe(5 * 60 * 1_000);
  });
});

describe('recovery operation assurance', () => {
  it('needs MFA and a step-up grant to create or consume', () => {
    expect(RECOVERY_OPERATION_POLICY[RECOVERY_OPERATIONS.CREATE]).toEqual({
      mfa: true,
      stepUpAction: RECOVERY_STEP_UP_ACTIONS.REQUEST,
    });
    expect(RECOVERY_OPERATION_POLICY[RECOVERY_OPERATIONS.CONSUME]).toEqual({
      mfa: true,
      stepUpAction: RECOVERY_STEP_UP_ACTIONS.EXECUTE,
    });
  });

  it('needs MFA without a step-up grant to decide, complete or cancel', () => {
    for (const operation of [
      RECOVERY_OPERATIONS.DECIDE,
      RECOVERY_OPERATIONS.COMPLETE,
      RECOVERY_OPERATIONS.CANCEL,
    ]) {
      expect(RECOVERY_OPERATION_POLICY[operation]).toEqual({
        mfa: true,
        stepUpAction: null,
      });
    }
  });

  it('allows the requester read operations without MFA', () => {
    for (const operation of [
      RECOVERY_OPERATIONS.LIST_MINE,
      RECOVERY_OPERATIONS.GET,
    ]) {
      expect(RECOVERY_OPERATION_POLICY[operation]).toEqual({
        mfa: false,
        stepUpAction: null,
      });
    }
  });
});
