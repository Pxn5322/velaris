/**
 * Deterministic tool authorization and execution (T4.04; F-10; AC-F10-1,
 * AC-F10-2, AC-F10-3; TH-03).
 *
 * The model proposes; this service decides. Checks run in a fixed order and
 * every one reads server state, never the proposal:
 *
 *   1. envelope     - tenantId and userId come from server context
 *   2. definition   - the tool must be registered (tenant first, then platform)
 *   3. enabled      - a disabled tool is denied
 *   4. grant        - the agent version must hold an explicit grant (allow-list)
 *   5. permission   - the caller's server-resolved role must hold the tool's
 *                     required permission (AC-F10-3)
 *   6. guardrails   - policy (no model-chosen scope, size bound) and JSON
 *                     Schema validation of the arguments
 *   7. approval     - HIGH/CRITICAL risk or `approval_required` needs an
 *                     approved, unexpired decision, claimed exactly once
 *   8. execution    - the handler runs under the registered timeout
 *   9. audit        - executed and denied attempts both leave an audit row
 *
 * Any failure before step 8 means the handler is never called, so a denied
 * proposal cannot produce a side effect (AC-F10-2). A handler failure or
 * timeout is reported without its message, because a downstream error text
 * can contain sensitive detail (SECURITY.md section 7).
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuthorizationService } from '../../permissions/authorization.service.js';
import type { PermissionCode } from '../../permissions/permission.codes.js';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../../infrastructure/prisma/prisma.service.js';
import { ToolProposalGuard } from '../guardrails/tool-proposal.guard.js';
import { ToolRegistry } from './tool-registry.js';
import {
  TOOL_APPROVAL_GATE,
  type ToolActor,
  type ToolApprovalGate,
  type ToolAuditSink,
  type ToolDenialReason,
  type ToolExecutionOutcome,
  type ToolHandler,
  type ToolProposal,
} from './tool.types.js';

/** Risks that always need a human decision, whatever the flag says. */
const APPROVAL_REQUIRED_RISKS = new Set(['HIGH', 'CRITICAL']);

/** Lifetime of an approval request opened by the gate. */
const APPROVAL_TTL_MS = 30 * 60 * 1000;

/** Marker for the timeout path; never leaves this module. */
class ToolTimeoutError extends Error {}

@Injectable()
export class ToolExecutionService {
  private readonly logger = new Logger(ToolExecutionService.name);

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    private readonly registry: ToolRegistry,
    private readonly guard: ToolProposalGuard,
    @Inject('TOOL_AUDIT_SINK') private readonly audit: ToolAuditSink,
    @Inject(TOOL_APPROVAL_GATE) private readonly approvals: ToolApprovalGate,
  ) {}

  /** Authorize and, when every check passes, execute one proposal. */
  async execute(
    proposal: ToolProposal,
    actor: ToolActor,
  ): Promise<ToolExecutionOutcome> {
    if (
      typeof proposal?.tenantId !== 'string' ||
      proposal.tenantId.trim() === ''
    ) {
      throw new BadRequestException('tenantId is required');
    }
    if (typeof actor?.userId !== 'string' || actor.userId.trim() === '') {
      throw new BadRequestException('userId is required');
    }

    const toolName = proposal.toolName?.trim() ?? '';
    const tenantId = proposal.tenantId;

    // 2-3. Registered and enabled.
    const definition = await this.findDefinition(tenantId, toolName);
    if (!definition) {
      return this.deny(proposal, actor, toolName, 'unknown_tool', null);
    }
    if (!definition.enabled) {
      return this.deny(proposal, actor, toolName, 'tool_disabled', null);
    }

    // 4. Explicit grant for this agent version, in this tenant.
    const grant = await this.prisma.agentToolGrant.findFirst({
      where: {
        tenantId,
        agentVersionId: proposal.agentVersionId,
        toolId: definition.id,
      },
      select: { id: true },
    });
    if (!grant) {
      return this.deny(proposal, actor, toolName, 'not_granted', null);
    }

    // 5. Application permission from the server-resolved role (AC-F10-3).
    try {
      this.authorization.assertPermission(
        actor.role,
        definition.requiredPermission as PermissionCode,
      );
    } catch {
      return this.deny(proposal, actor, toolName, 'missing_permission', null);
    }

    // 6. Guardrails: policy and argument schema.
    const validation = this.guard.validate(
      definition.inputSchemaJson,
      proposal.arguments,
    );
    if (!validation.ok) {
      return this.deny(
        proposal,
        actor,
        toolName,
        validation.reason,
        validation.detail,
      );
    }

    // 7. Approval floor: HIGH and CRITICAL risk always need a decision.
    const needsApproval =
      definition.approvalRequired ||
      APPROVAL_REQUIRED_RISKS.has(definition.riskLevel);
    if (needsApproval) {
      const proposalHash = this.hashProposal(proposal, definition.id);
      const usable = await this.approvals.findUsable({
        tenantId,
        toolDefinitionId: definition.id,
        agentVersionId: proposal.agentVersionId,
        proposalHash,
      });
      if (!usable) {
        const created = await this.approvals.request({
          tenantId,
          toolDefinitionId: definition.id,
          agentVersionId: proposal.agentVersionId,
          proposalHash,
          proposalJson: {
            toolName,
            arguments: proposal.arguments,
          },
          requestedBy: actor.userId,
          expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
        });
        await this.record(proposal, actor, 'tool.approval_requested', {
          tool: toolName,
          approvalId: created.id,
        });
        return { status: 'PENDING_APPROVAL', toolName, approvalId: created.id };
      }
      const claimed = await this.approvals.claim(usable.id);
      if (!claimed) {
        // Another run consumed the decision; a fresh one is needed.
        return { status: 'PENDING_APPROVAL', toolName, approvalId: usable.id };
      }
    }

    // 8. Execute under the registered deadline.
    const handler: ToolHandler | null = this.registry.get(definition.name);
    if (!handler) {
      return { status: 'FAILED', toolName, reason: 'handler_error' };
    }

    const startedAt = Date.now();
    try {
      const result = await this.withTimeout(
        handler(proposal.arguments, {
          tenantId,
          userId: actor.userId,
          toolName: definition.name,
        }),
        definition.timeoutMs,
      );
      const durationMs = Date.now() - startedAt;

      // 9. Audit the permitted action (AC-F10-1).
      await this.record(proposal, actor, 'tool.executed', {
        tool: toolName,
        definitionId: definition.id,
        durationMs,
      });

      return { status: 'EXECUTED', toolName, result, durationMs };
    } catch (error) {
      const reason =
        error instanceof ToolTimeoutError ? 'timeout' : 'handler_error';
      this.logger.warn(
        `Tool ${toolName} failed (${reason}) for tenant ${tenantId}`,
      );
      return { status: 'FAILED', toolName, reason };
    }
  }

  /** Tenant-owned definition wins over a platform definition of the same name. */
  private async findDefinition(tenantId: string, toolName: string) {
    if (!toolName) {
      return null;
    }
    const own = await this.prisma.aiToolDefinition.findFirst({
      where: { tenantId, name: toolName },
    });
    if (own) {
      return own;
    }
    return this.prisma.aiToolDefinition.findFirst({
      where: { tenantId: null, name: toolName },
    });
  }

  /** Deny without side effects, and leave an audit row. */
  private async deny(
    proposal: ToolProposal,
    actor: ToolActor,
    toolName: string,
    reason: ToolDenialReason,
    detail: string | null,
  ): Promise<ToolExecutionOutcome> {
    await this.record(proposal, actor, 'tool.denied', {
      tool: toolName,
      reason,
      detail,
    });
    return { status: 'DENIED', toolName, reason, detail };
  }

  private async record(
    proposal: ToolProposal,
    actor: ToolActor,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.record({
        action,
        resourceType: 'tool',
        tenantId: proposal.tenantId,
        actorId: actor.userId,
        metadata,
      });
    } catch (error) {
      // An audit failure must not hide the authorization decision, the same
      // rule the permission-denial path follows (T1.04).
      this.logger.error(
        `Audit write failed for ${action}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /** Stable hash of the reviewed proposal, bound to the definition. */
  private hashProposal(proposal: ToolProposal, definitionId: string): string {
    return createHash('sha256')
      .update(
        JSON.stringify([
          definitionId,
          proposal.tenantId,
          proposal.agentVersionId,
          proposal.toolName,
          proposal.arguments,
        ]),
      )
      .digest('hex');
  }

  /** Reject with ToolTimeoutError when the handler exceeds its deadline. */
  private withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new ToolTimeoutError()), timeoutMs);
      timer.unref?.();
      work.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
