/**
 * Privileged recovery approvals (T6.09; D-59 matrix, D-62 contract, D-66 policy).
 *
 * One request authorizes one execution. The approval count and the approver
 * duties come from `recovery-approval-policy.ts`, never from the caller. The
 * requester and the target can never approve, one person cannot fill two
 * duties, and a terminal state accepts no further change.
 *
 * This module stores and enforces the contract. It performs no provider reset:
 * the caller consumes an approval, performs the reset and reports the result.
 * The production mapping (D-68) resolves only `R-enterprise-admin` to a policy
 * duty, so a privileged request cannot reach its full quota until D-62 seeds
 * the security owner, second platform owner and custodian duties. That is
 * fail-closed by construction.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { ROLE_RESOLVER } from '../permissions/role-resolver.js';
import type { RoleResolver } from '../permissions/role-resolver.js';
import type { AuthAssurance } from './auth-assurance.js';
import type { AuthenticatedIdentity } from './auth.interface.js';
import {
  RECOVERY_APPROVAL_STATES,
  RECOVERY_APPROVAL_TTL_MS,
  RECOVERY_EXECUTION_TTL_MS,
  RECOVERY_POLICY,
  RECOVERY_POLICY_ROLES,
  approvalDenial,
  decisionState,
  isApprovalExpired,
  isExecutionOpen,
} from './recovery-approval-policy.js';
import type {
  RecoveryApproval,
  RecoveryApprovalState,
  RecoveryPath,
  RecoveryPolicyRole,
  RecoveryPolicyRule,
} from './recovery-approval-policy.js';
import {
  RecoveryResetService,
  type ResetResult,
} from './recovery-reset.service.js';
import { mfaRequired } from './step-up.service.js';

/** The only canonical role that maps to a policy duty today (D-68). */
const RECOVERY_ROLE_MAP: Partial<Record<CanonicalRole, RecoveryPolicyRole>> = {
  'R-enterprise-admin': RECOVERY_POLICY_ROLES.ENTERPRISE_ADMIN,
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECISIONS = { APPROVE: 'APPROVE', DENY: 'DENY' } as const;
const RESULTS = { SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED' } as const;

type DecisionKind = (typeof DECISIONS)[keyof typeof DECISIONS];
type ExecutionResult = (typeof RESULTS)[keyof typeof RESULTS];

export interface CreateRecoveryApprovalInput {
  requestId?: unknown;
  recoveryPath?: unknown;
  tenantId?: unknown;
  targetUserId?: unknown;
  reason?: unknown;
  ticketId?: unknown;
  custodyRecordId?: unknown;
}

export interface DecideRecoveryApprovalInput {
  decision?: unknown;
  reason?: unknown;
}

export interface ConsumeRecoveryApprovalInput {
  tenantId?: unknown;
}

export interface CompleteRecoveryApprovalInput {
  executionId?: unknown;
  /** Optional echo of the stored outcome; a different value is refused. */
  result?: unknown;
}

export interface ListRecoveryApprovalQuery {
  tenantId?: unknown;
  state?: unknown;
  limit?: unknown;
}

export interface RecoveryApprovalView {
  approvalId: string;
  state: RecoveryApprovalState;
  recoveryPath: string;
  tenantId: string | null;
  targetUserId: string;
  requestedBy: string;
  requiredApprovals: number;
  requiredApproverRoles: readonly { policyRole: string; count: number }[];
  approvals: readonly {
    actorId: string;
    policyRole: string;
    approvedAt: Date;
  }[];
  requestedAt: Date;
  expiresAt: Date;
  consumedAt: Date | null;
  completedAt: Date | null;
  stateReason: string | null;
  failureCode: string | null;
  version: number;
}

/** The requester list hides approver identities (D-62 section 5). */
export interface RecoveryApprovalSummary {
  approvalId: string;
  state: RecoveryApprovalState;
  recoveryPath: string;
  tenantId: string | null;
  targetUserId: string;
  requestedAt: Date;
  expiresAt: Date;
  requiredApprovals: number;
  approvalCount: number;
  stateReason: string | null;
  failureCode: string | null;
}

export interface ConsumeRecoveryApprovalResult {
  approval: RecoveryApprovalView;
  executionId: string;
  executionExpiresAt: Date;
  /** The provider reset outcome observed in this execution window. */
  result: ResetResult;
  failureCode: string | null;
}

interface RequestRow {
  id: string;
  requestId: string;
  recoveryPath: string;
  tenantId: string | null;
  targetUserId: string;
  targetSubject: string;
  requestedBy: string;
  reason: string;
  ticketId: string;
  custodyRecordId: string | null;
  state: string;
  requiredApprovals: number;
  approvalExpiresAt: Date;
  executionId: string | null;
  executionExpiresAt: Date | null;
  consumedAt: Date | null;
  resetOutcome: string | null;
  executedBy: string | null;
  completedAt: Date | null;
  stateReason: string | null;
  failureCode: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DecisionRow {
  id: string;
  requestId: string;
  actorSubject: string;
  policyRole: string;
  decision: string;
  reason: string | null;
  createdAt: Date;
}

type RequestWithDecisions = RequestRow & { decisions: DecisionRow[] };

@Injectable()
export class RecoveryApprovalService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ROLE_RESOLVER) private readonly roles: RoleResolver,
    private readonly resets: RecoveryResetService,
  ) {}

  async create(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance | undefined,
    input: CreateRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView> {
    this.requireMfa(assurance);
    const requestId = readUuid(input?.requestId, 'requestId');
    const recoveryPath = readPath(input?.recoveryPath);
    const rule = RECOVERY_POLICY[recoveryPath];
    const tenantId = readTenant(rule, input?.tenantId);
    const targetUserId = readUuid(input?.targetUserId, 'targetUserId');
    const reason = readText(input?.reason, 'reason', 10, 500);
    const ticketId = readText(input?.ticketId, 'ticketId', 1, 100);
    const custodyRecordId = readOptionalText(
      input?.custodyRecordId,
      'custodyRecordId',
      128,
    );

    if (!(await this.dutyOf(identity, tenantId))) {
      throw forbidden('REQUESTER_NOT_PERMITTED');
    }

    const existing = (await this.prisma.recoveryApprovalRequest.findFirst({
      where: { requestedBy: identity.subject, requestId },
    })) as unknown as RequestRow | null;
    if (existing) {
      const same =
        existing.recoveryPath === recoveryPath &&
        existing.tenantId === tenantId &&
        existing.targetUserId === targetUserId &&
        existing.reason === reason &&
        existing.ticketId === ticketId &&
        existing.custodyRecordId === custodyRecordId;
      if (!same) {
        throw conflict('IDEMPOTENCY_CONFLICT');
      }
      return toView(await this.load(existing.id));
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId },
      select: { id: true, externalSubject: true, status: true },
    });
    if (!target) {
      throw notFound('TARGET_NOT_FOUND');
    }
    if (target.status !== 'ACTIVE') {
      throw conflict('TARGET_NOT_ACTIVE');
    }
    if (rule.tenantScoped && tenantId) {
      const membership = await this.prisma.tenantMembership.findFirst({
        where: { tenantId, userId: target.id, status: 'ACTIVE' },
      });
      if (!membership) {
        throw notFound('TARGET_NOT_FOUND');
      }
    }
    if (rule.requiresCustodyRecord && !custodyRecordId) {
      throw conflict('CUSTODY_EVIDENCE_REQUIRED');
    }

    const created = (await this.prisma.recoveryApprovalRequest.create({
      data: {
        requestId,
        recoveryPath,
        tenantId,
        targetUserId,
        targetSubject: target.externalSubject,
        requestedBy: identity.subject,
        reason,
        ticketId,
        custodyRecordId,
        state: RECOVERY_APPROVAL_STATES.PENDING,
        requiredApprovals: rule.requiredApprovals,
        approvalExpiresAt: new Date(Date.now() + RECOVERY_APPROVAL_TTL_MS),
        version: 0,
      },
    })) as unknown as RequestRow;

    await this.audit.record({
      action: 'auth.mfa_reset_requested',
      resourceType: 'recovery_approval',
      resourceId: created.id,
      tenantId: tenantId ?? undefined,
      actorId: identity.subject,
      metadata: {
        requestId,
        recoveryPath,
        targetUserId,
        requiredApprovals: rule.requiredApprovals,
        expiresAt: created.approvalExpiresAt.toISOString(),
      },
    });
    return toView(await this.load(created.id));
  }

  async decide(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance | undefined,
    approvalId: string,
    input: DecideRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView> {
    this.requireMfa(assurance);
    const decision = readDecision(input?.decision);
    const reason = readOptionalText(input?.reason, 'reason', 500);
    if (decision === DECISIONS.DENY && !reason) {
      throw badRequest('A denial needs a reason');
    }

    const request = await this.load(approvalId);
    await this.requireOpen(request);
    if (request.state !== RECOVERY_APPROVAL_STATES.PENDING) {
      throw conflict('APPROVAL_TERMINAL');
    }
    const rule = RECOVERY_POLICY[request.recoveryPath as RecoveryPath];

    const recorded = await this.prisma.recoveryApprovalDecision.findUnique({
      where: {
        requestId_actorSubject: {
          requestId: request.id,
          actorSubject: identity.subject,
        },
      },
    });
    if (recorded) {
      if ((recorded as unknown as DecisionRow).decision === decision) {
        return toView(request);
      }
      throw conflict('DECISION_ALREADY_RECORDED');
    }

    const approvals = toApprovals(request.decisions);
    const policyRole = await this.eligibleRole(
      identity,
      request,
      rule,
      approvals,
    );

    try {
      await this.prisma.recoveryApprovalDecision.create({
        data: {
          requestId: request.id,
          actorSubject: identity.subject,
          policyRole,
          decision,
          reason: reason ?? null,
        },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw conflict('DECISION_ALREADY_RECORDED');
      }
      throw error;
    }

    const after: RecoveryApproval[] = [
      ...approvals,
      {
        actorSubject: identity.subject,
        policyRole,
        approvedAt: new Date(),
      },
    ];
    const state: RecoveryApprovalState =
      decision === DECISIONS.DENY
        ? RECOVERY_APPROVAL_STATES.DENIED
        : decisionState({ rule, approvals: after, denied: false });

    await this.transition(request, state, {
      stateReason:
        state === RECOVERY_APPROVAL_STATES.DENIED ? 'APPROVER_DENIED' : null,
    });

    await this.audit.record({
      action:
        state === RECOVERY_APPROVAL_STATES.DENIED
          ? 'auth.mfa_reset_denied'
          : 'auth.mfa_reset_approval_recorded',
      resourceType: 'recovery_approval',
      resourceId: request.id,
      tenantId: request.tenantId ?? undefined,
      actorId: identity.subject,
      metadata: {
        policyRole,
        decision,
        approvals: after.length,
        requiredApprovals: rule.requiredApprovals,
      },
    });
    if (state === RECOVERY_APPROVAL_STATES.APPROVED) {
      await this.audit.record({
        action: 'auth.mfa_reset_approved',
        resourceType: 'recovery_approval',
        resourceId: request.id,
        tenantId: request.tenantId ?? undefined,
        actorId: identity.subject,
        metadata: {
          targetUserId: request.targetUserId,
          expiresAt: request.approvalExpiresAt.toISOString(),
        },
      });
    }
    return toView(await this.load(request.id));
  }

  async consume(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance | undefined,
    approvalId: string,
    input: ConsumeRecoveryApprovalInput,
  ): Promise<ConsumeRecoveryApprovalResult> {
    this.requireMfa(assurance);
    const request = await this.load(approvalId);
    await this.requireOpen(request);
    const tenantId = readOptionalUuid(input?.tenantId, 'tenantId');
    if (tenantId !== request.tenantId) {
      throw notFound('TENANT_SCOPE_MISMATCH');
    }
    if (!(await this.dutyOf(identity, request.tenantId))) {
      throw forbidden('EXECUTOR_NOT_PERMITTED');
    }

    const now = new Date();
    if (request.state === RECOVERY_APPROVAL_STATES.CONSUMED) {
      const open = isExecutionOpen(
        {
          state: request.state as RecoveryApprovalState,
          executionExpiresAt: request.executionExpiresAt ?? now,
          completedAt: request.completedAt,
        },
        now,
      );
      if (request.executedBy === identity.subject && open) {
        return {
          approval: toView(request),
          executionId: request.executionId as string,
          executionExpiresAt: request.executionExpiresAt as Date,
          result: readRecordedResult(request),
          failureCode: request.failureCode,
        };
      }
      throw conflict('APPROVAL_ALREADY_CONSUMED');
    }
    if (request.state !== RECOVERY_APPROVAL_STATES.APPROVED) {
      throw conflict(
        request.state === RECOVERY_APPROVAL_STATES.PENDING
          ? 'APPROVAL_NOT_APPROVED'
          : 'APPROVAL_TERMINAL',
      );
    }

    const executionId = randomUUID();
    const executionExpiresAt = new Date(
      now.getTime() + RECOVERY_EXECUTION_TTL_MS,
    );
    await this.transition(request, RECOVERY_APPROVAL_STATES.CONSUMED, {
      executionId,
      executionExpiresAt,
      consumedAt: now,
      executedBy: identity.subject,
    });
    await this.audit.record({
      action: 'auth.mfa_reset_execution_started',
      resourceType: 'recovery_approval',
      resourceId: request.id,
      tenantId: request.tenantId ?? undefined,
      actorId: identity.subject,
      metadata: {
        executionId,
        targetUserId: request.targetUserId,
        expiresAt: executionExpiresAt.toISOString(),
      },
    });
    const outcome = await this.resets.perform(
      request.targetUserId,
      request.targetSubject,
    );
    await this.recordOutcome(request, outcome.result, outcome.failureCode);
    if (outcome.result === RESULTS.FAILED) {
      await this.audit.record({
        action: 'auth.mfa_reset_failed',
        resourceType: 'recovery_approval',
        resourceId: request.id,
        tenantId: request.tenantId ?? undefined,
        actorId: identity.subject,
        metadata: {
          executionId,
          targetUserId: request.targetUserId,
          failureCode: outcome.failureCode,
        },
      });
    }

    return {
      approval: toView(await this.load(request.id)),
      executionId,
      executionExpiresAt,
      result: outcome.result,
      failureCode: outcome.failureCode,
    };
  }

  async complete(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance | undefined,
    approvalId: string,
    input: CompleteRecoveryApprovalInput,
  ): Promise<RecoveryApprovalView> {
    this.requireMfa(assurance);
    const executionId = readUuid(input?.executionId, 'executionId');
    const claim = readOptionalResult(input?.result);

    const request = await this.load(approvalId);
    if (isTerminal(request)) {
      if (this.isSameResult(request, executionId, claim)) {
        return toView(request);
      }
      throw conflict('EXECUTION_ALREADY_COMPLETED');
    }
    if (request.state !== RECOVERY_APPROVAL_STATES.CONSUMED) {
      throw conflict('APPROVAL_TERMINAL');
    }
    if (request.executedBy !== identity.subject) {
      throw forbidden('EXECUTION_ACTOR_MISMATCH');
    }
    if (request.executionId !== executionId) {
      throw notFound('EXECUTION_NOT_FOUND');
    }
    const now = new Date();
    const timedOut = isExecutionTimedOut(request, now);
    if (timedOut && !request.resetOutcome) {
      await this.expireExecution(request, now);
    }

    const result = readRecordedResult(request);
    if (claim !== null && claim !== result) {
      throw conflict('EXECUTION_RESULT_MISMATCH');
    }
    if (timedOut && result === RESULTS.SUCCEEDED) {
      await this.expireExecution(request, now);
    }

    const state =
      result === RESULTS.SUCCEEDED
        ? RECOVERY_APPROVAL_STATES.COMPLETED
        : RECOVERY_APPROVAL_STATES.FAILED;
    await this.transition(request, state, {
      completedAt: now,
      failureCode: result === RESULTS.FAILED ? request.failureCode : null,
    });
    if (state === RECOVERY_APPROVAL_STATES.COMPLETED) {
      await this.audit.record({
        action: 'auth.mfa_reset_completed',
        resourceType: 'recovery_approval',
        resourceId: request.id,
        tenantId: request.tenantId ?? undefined,
        actorId: identity.subject,
        metadata: {
          executionId,
          targetUserId: request.targetUserId,
          failureCode: null,
        },
      });
    }
    return toView(await this.load(request.id));
  }

  async cancel(
    identity: AuthenticatedIdentity,
    assurance: AuthAssurance | undefined,
    approvalId: string,
  ): Promise<RecoveryApprovalView> {
    this.requireMfa(assurance);
    const request = await this.load(approvalId);
    if (request.requestedBy !== identity.subject) {
      throw forbidden('CANCEL_NOT_PERMITTED');
    }
    await this.requireOpen(request);
    if (
      request.state !== RECOVERY_APPROVAL_STATES.PENDING &&
      request.state !== RECOVERY_APPROVAL_STATES.APPROVED
    ) {
      throw conflict('CANCEL_NOT_ALLOWED');
    }
    await this.transition(request, RECOVERY_APPROVAL_STATES.CANCELLED, {
      stateReason: 'REQUESTER_CANCELLED',
    });
    await this.audit.record({
      action: 'auth.mfa_reset_denied',
      resourceType: 'recovery_approval',
      resourceId: request.id,
      tenantId: request.tenantId ?? undefined,
      actorId: identity.subject,
      metadata: { stateReason: 'REQUESTER_CANCELLED' },
    });
    return toView(await this.load(request.id));
  }

  async get(
    identity: AuthenticatedIdentity,
    approvalId: string,
  ): Promise<RecoveryApprovalView> {
    const request = await this.load(approvalId);
    if (isApprovalExpiredRow(request)) {
      await this.markExpired(request);
      return toView(await this.load(approvalId));
    }
    const allowed =
      request.requestedBy === identity.subject ||
      request.targetSubject === identity.subject ||
      (await this.dutyOf(identity, request.tenantId)) !== null;
    if (!allowed) {
      throw forbidden('READ_NOT_PERMITTED');
    }
    return toView(request);
  }

  async listMine(
    identity: AuthenticatedIdentity,
    query: ListRecoveryApprovalQuery,
  ): Promise<{ items: RecoveryApprovalSummary[] }> {
    const tenantId = readOptionalUuid(query?.tenantId, 'tenantId');
    const state = readOptionalState(query?.state);
    const limit = readLimit(query?.limit);
    const rows = (await this.prisma.recoveryApprovalRequest.findMany({
      where: {
        requestedBy: identity.subject,
        ...(tenantId === null ? {} : { tenantId }),
        ...(state ? { state } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })) as unknown as (RequestRow & { decisions?: DecisionRow[] })[];

    return {
      items: rows.map((row) =>
        toSummary({ ...row, decisions: row.decisions ?? [] }),
      ),
    };
  }

  private async load(approvalId: string): Promise<RequestWithDecisions> {
    const row = (await this.prisma.recoveryApprovalRequest.findUnique({
      where: { id: approvalId },
      include: { decisions: { orderBy: { createdAt: 'asc' } } },
    })) as unknown as RequestWithDecisions | null;
    if (!row) {
      throw notFound('APPROVAL_NOT_FOUND');
    }
    return row;
  }

  private requireMfa(assurance: AuthAssurance | undefined): void {
    if (assurance?.aal !== 'aal2') {
      throw mfaRequired();
    }
  }

  /** Mark an expired request and refuse the action (D-62 section 7). */
  private async requireOpen(request: RequestRow): Promise<void> {
    if (!isApprovalExpiredRow(request)) {
      return;
    }
    await this.markExpired(request);
    throw conflict('APPROVAL_EXPIRED');
  }

  private async markExpired(request: RequestRow): Promise<void> {
    await this.prisma.recoveryApprovalRequest.updateMany({
      where: {
        id: request.id,
        state: request.state,
        version: request.version,
      },
      data: {
        state: RECOVERY_APPROVAL_STATES.EXPIRED,
        stateReason: 'APPROVAL_EXPIRED',
        version: request.version + 1,
      },
    });
  }

  private async transition(
    request: RequestRow,
    state: RecoveryApprovalState,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const updated = await this.prisma.recoveryApprovalRequest.updateMany({
      where: {
        id: request.id,
        state: request.state,
        version: request.version,
      },
      data: { ...extra, state, version: request.version + 1 },
    });
    if (updated.count !== 1) {
      throw conflict('APPROVAL_VERSION_CONFLICT');
    }
  }

  /**
   * End a consumed execution whose window closed before it recorded a result.
   * Without this, a crash between the consume and the reset would leave the
   * request CONSUMED forever, because `complete` cannot finalize an absent
   * outcome. The transition happens before the error, so the request ends.
   */
  private async expireExecution(
    request: RequestRow,
    now: Date,
  ): Promise<never> {
    await this.transition(request, RECOVERY_APPROVAL_STATES.FAILED, {
      completedAt: now,
      failureCode: 'EXECUTION_TIMEOUT',
      stateReason: 'EXECUTION_TIMEOUT',
    });
    throw conflict('EXECUTION_EXPIRED');
  }

  /** A caller reports the same result twice without a second state change. */
  private isSameResult(
    request: RequestRow,
    executionId: string,
    claim: ExecutionResult | null,
  ): boolean {
    if (request.executionId !== executionId) return false;
    const stored =
      request.state === RECOVERY_APPROVAL_STATES.COMPLETED
        ? RESULTS.SUCCEEDED
        : request.state === RECOVERY_APPROVAL_STATES.FAILED
          ? RESULTS.FAILED
          : null;
    return stored !== null && (claim === null || claim === stored);
  }

  /** Store the observed reset outcome before `complete` can finalize it. */
  private async recordOutcome(
    request: RequestRow,
    result: ResetResult,
    failureCode: string | null,
  ): Promise<void> {
    const consumedVersion = request.version + 1;
    const updated = await this.prisma.recoveryApprovalRequest.updateMany({
      where: {
        id: request.id,
        state: RECOVERY_APPROVAL_STATES.CONSUMED,
        version: consumedVersion,
      },
      data: {
        resetOutcome: result,
        failureCode,
        version: consumedVersion + 1,
      },
    });
    if (updated.count !== 1) {
      throw conflict('APPROVAL_VERSION_CONFLICT');
    }
  }

  private async eligibleRole(
    identity: AuthenticatedIdentity,
    request: RequestRow,
    rule: RecoveryPolicyRule,
    approvals: readonly RecoveryApproval[],
  ): Promise<RecoveryPolicyRole> {
    const policyRole = await this.dutyOf(identity, request.tenantId);
    if (!policyRole) {
      throw forbidden('APPROVER_NOT_ELIGIBLE');
    }
    const denial = approvalDenial({
      rule,
      approvals,
      actorSubject: identity.subject,
      requestedBy: request.requestedBy,
      targetUserId: request.targetSubject,
      policyRole,
    });
    if (denial === null) {
      return policyRole;
    }
    throw denial === 'ROLE_QUOTA_FILLED'
      ? conflict('DUPLICATE_APPROVAL')
      : forbidden(denial);
  }

  private async dutyOf(
    identity: AuthenticatedIdentity,
    tenantId: string | null,
  ): Promise<RecoveryPolicyRole | null> {
    const canonical = await this.roles.resolveRole({
      identity,
      tenantId: tenantId ?? undefined,
    });
    return canonical ? (RECOVERY_ROLE_MAP[canonical] ?? null) : null;
  }
}

function isTerminal(request: RequestRow): boolean {
  return (
    request.state === RECOVERY_APPROVAL_STATES.COMPLETED ||
    request.state === RECOVERY_APPROVAL_STATES.FAILED
  );
}

function isApprovalExpiredRow(request: RequestRow): boolean {
  return (
    (request.state === RECOVERY_APPROVAL_STATES.PENDING ||
      request.state === RECOVERY_APPROVAL_STATES.APPROVED) &&
    isApprovalExpired(request.approvalExpiresAt, new Date())
  );
}

function isExecutionTimedOut(request: RequestRow, now: Date): boolean {
  return (
    request.executionExpiresAt === null ||
    request.executionExpiresAt.getTime() <= now.getTime()
  );
}

function toApprovals(decisions: readonly DecisionRow[]): RecoveryApproval[] {
  return decisions
    .filter((row) => row.decision === DECISIONS.APPROVE)
    .map((row) => ({
      actorSubject: row.actorSubject,
      policyRole: row.policyRole as RecoveryPolicyRole,
      approvedAt: row.createdAt,
    }));
}

function toView(request: RequestWithDecisions): RecoveryApprovalView {
  const rule = RECOVERY_POLICY[request.recoveryPath as RecoveryPath];
  return {
    approvalId: request.id,
    state: request.state as RecoveryApprovalState,
    recoveryPath: request.recoveryPath,
    tenantId: request.tenantId,
    targetUserId: request.targetUserId,
    requestedBy: request.requestedBy,
    requiredApprovals: request.requiredApprovals,
    requiredApproverRoles: rule ? rule.approverRoles : [],
    approvals: toApprovals(request.decisions).map((entry) => ({
      actorId: entry.actorSubject,
      policyRole: entry.policyRole,
      approvedAt: entry.approvedAt,
    })),
    requestedAt: request.createdAt,
    expiresAt: request.approvalExpiresAt,
    consumedAt: request.consumedAt,
    completedAt: request.completedAt,
    stateReason: request.stateReason,
    failureCode: request.failureCode,
    version: request.version,
  };
}

function toSummary(request: RequestWithDecisions): RecoveryApprovalSummary {
  return {
    approvalId: request.id,
    state: request.state as RecoveryApprovalState,
    recoveryPath: request.recoveryPath,
    tenantId: request.tenantId,
    targetUserId: request.targetUserId,
    requestedAt: request.createdAt,
    expiresAt: request.approvalExpiresAt,
    requiredApprovals: request.requiredApprovals,
    approvalCount: toApprovals(request.decisions).length,
    stateReason: request.stateReason,
    failureCode: request.failureCode,
  };
}

function readUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw badRequest(`${field} must be a UUID`);
  }
  return value;
}

function readOptionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return readUuid(value, field);
}

function readPath(value: unknown): RecoveryPath {
  if (
    typeof value !== 'string' ||
    !Object.prototype.hasOwnProperty.call(RECOVERY_POLICY, value)
  ) {
    throw badRequest('recoveryPath is not a supported recovery path');
  }
  return value as RecoveryPath;
}

function readTenant(rule: RecoveryPolicyRule, value: unknown): string | null {
  if (!rule.tenantScoped) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    throw badRequest('tenantId is not allowed for this recovery path');
  }
  if (value === undefined || value === null || value === '') {
    throw badRequest('tenantId is required for this recovery path');
  }
  return readUuid(value, 'tenantId');
}

function readText(
  value: unknown,
  field: string,
  min: number,
  max: number,
): string {
  if (typeof value !== 'string') {
    throw badRequest(`${field} is required`);
  }
  const text = value.trim();
  if (text.length < min || text.length > max) {
    throw badRequest(`${field} must be ${min} to ${max} characters`);
  }
  return text;
}

function readOptionalText(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string' || value.length > max) {
    throw badRequest(`${field} must be at most ${max} characters`);
  }
  return value.trim() || null;
}

function readDecision(value: unknown): DecisionKind {
  if (value === DECISIONS.APPROVE || value === DECISIONS.DENY) {
    return value;
  }
  throw badRequest('decision must be APPROVE or DENY');
}

function readOptionalResult(value: unknown): ExecutionResult | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === RESULTS.SUCCEEDED || value === RESULTS.FAILED) {
    return value;
  }
  throw badRequest('result must be SUCCEEDED or FAILED');
}

/**
 * Read the outcome the provider reset recorded. A missing value fails closed:
 * an interrupted execution must never report FAILED when it did not run.
 */
function readRecordedResult(request: RequestRow): ExecutionResult {
  if (request.resetOutcome === RESULTS.SUCCEEDED) return RESULTS.SUCCEEDED;
  if (request.resetOutcome === RESULTS.FAILED) return RESULTS.FAILED;
  throw conflict('EXECUTION_RESULT_MISSING');
}

function readOptionalState(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (
    typeof value !== 'string' ||
    !Object.prototype.hasOwnProperty.call(RECOVERY_APPROVAL_STATES, value)
  ) {
    throw badRequest('state is not a known approval state');
  }
  return value;
}

function readLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') {
    return 20;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw badRequest('limit must be a whole number from 1 to 50');
  }
  return parsed;
}

function badRequest(message: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_INPUT', message });
}

function forbidden(code: string): ForbiddenException {
  return new ForbiddenException({ code, message: 'The action is not allowed' });
}

function conflict(code: string): ConflictException {
  return new ConflictException({
    code,
    message: 'The approval state does not allow this action',
  });
}

function notFound(code: string): NotFoundException {
  return new NotFoundException({ code, message: 'The resource was not found' });
}
