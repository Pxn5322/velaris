/**
 * Human approval gate for consequential tool actions (T4.04; F-10,
 * AC-F10-2).
 *
 * Persisted in `tool_approval_requests` so a decision survives a restart and
 * applies to exactly one proposal:
 * - `proposal_hash` binds the decision to the arguments the human reviewed.
 * - `expires_at` bounds how long a decision stays usable.
 * - `claim()` is a conditional update, so two concurrent runs cannot both
 *   consume one approval (each side effect needs its own decision).
 *
 * Deciding a request needs the `ai.tool.approve` permission, checked here
 * rather than at the controller, so every caller gets the same rule.
 */

import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { AuthorizationService } from '../../permissions/authorization.service.js';
import { PERMISSIONS } from '../../permissions/permission.codes.js';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../../infrastructure/prisma/prisma.service.js';
import type { ToolApprovalGate } from './tool.types.js';

/** Default lifetime of one approval decision. */
export const APPROVAL_TTL_MS = 30 * 60 * 1000;

export interface ApprovalDecisionResult {
  id: string;
  status: 'APPROVED' | 'REJECTED';
}

@Injectable()
export class ToolApprovalService implements ToolApprovalGate {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
  ) {}

  async findUsable(input: {
    tenantId: string;
    toolDefinitionId: string;
    agentVersionId: string;
    proposalHash: string;
  }): Promise<{ id: string } | null> {
    return this.prisma.toolApprovalRequest.findFirst({
      where: {
        tenantId: input.tenantId,
        toolDefinitionId: input.toolDefinitionId,
        agentVersionId: input.agentVersionId,
        proposalHash: input.proposalHash,
        status: 'APPROVED',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
  }

  async request(input: {
    tenantId: string;
    toolDefinitionId: string;
    agentVersionId: string;
    proposalHash: string;
    proposalJson: Record<string, unknown>;
    requestedBy: string;
    expiresAt: Date;
  }): Promise<{ id: string }> {
    // Reuse an open request for the same proposal instead of opening a
    // second identical one; a human should see one row per proposal.
    const pending = await this.prisma.toolApprovalRequest.findFirst({
      where: {
        tenantId: input.tenantId,
        toolDefinitionId: input.toolDefinitionId,
        proposalHash: input.proposalHash,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (pending) {
      return pending;
    }
    return this.prisma.toolApprovalRequest.create({
      data: {
        tenantId: input.tenantId,
        toolDefinitionId: input.toolDefinitionId,
        agentVersionId: input.agentVersionId,
        proposalHash: input.proposalHash,
        proposalJson: input.proposalJson as never,
        requestedBy: input.requestedBy,
        expiresAt: input.expiresAt,
      },
      select: { id: true },
    });
  }

  async claim(approvalId: string): Promise<boolean> {
    const result = await this.prisma.toolApprovalRequest.updateMany({
      where: {
        id: approvalId,
        status: 'APPROVED',
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    return result.count === 1;
  }

  /** Record a human decision; requires `ai.tool.approve`. */
  async decide(input: {
    tenantId: string;
    approvalId: string;
    approve: boolean;
    decidedBy: string;
    actorRole: string | null;
  }): Promise<ApprovalDecisionResult> {
    this.authorization.assertPermission(
      input.actorRole,
      PERMISSIONS.AI_TOOL_APPROVE,
    );

    const approval = await this.prisma.toolApprovalRequest.findFirst({
      where: { id: input.approvalId, tenantId: input.tenantId },
      select: { id: true, status: true, expiresAt: true },
    });
    if (!approval) {
      throw new NotFoundException('Approval request not found');
    }

    const status = input.approve ? 'APPROVED' : 'REJECTED';
    const expired = approval.expiresAt.getTime() <= Date.now();
    const finalStatus = expired ? 'EXPIRED' : status;

    await this.prisma.toolApprovalRequest.updateMany({
      where: { id: approval.id, tenantId: input.tenantId, status: 'PENDING' },
      data: {
        status: finalStatus,
        decidedBy: input.decidedBy,
        decidedAt: new Date(),
      },
    });

    return {
      id: approval.id,
      status: finalStatus === 'APPROVED' ? 'APPROVED' : 'REJECTED',
    };
  }
}
