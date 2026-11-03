/**
 * T4.04 deterministic tool authorization contract (F-10; AC-F10-1, AC-F10-2,
 * AC-F10-3; TH-03).
 *
 * The model proposes; this service decides. Every check reads server state
 * (tool definition row, agent grant, role permission map, input schema,
 * approval row) and never the proposal itself, so a prompt injection cannot
 * promote a tool, widen its scope or skip an approval.
 *
 * AC-F10-1: a permitted action that passes permission, policy, schema and
 * approval executes once and is audited.
 * AC-F10-2: a disallowed action, missing approval, timeout or invalid
 * arguments fails safely — the handler is never called, so there is no
 * unauthorized side effect.
 * AC-F10-3: an LLM proposal without application permission is denied by
 * deterministic server authorization.
 *
 * SECURITY.md section 3 (TH-03) and section 7: server-side authorization is
 * mandatory, and tool arguments are untrusted input.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AuthorizationService } from '../../permissions/authorization.service.js';
import { PERMISSIONS } from '../../permissions/permission.codes.js';
import { ToolExecutionService } from './tool-execution.service.js';
import { ToolRegistry } from './tool-registry.js';
import { ToolProposalGuard } from '../guardrails/tool-proposal.guard.js';
import type { ToolActor, ToolProposal } from './tool.types.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const AGENT_VERSION = '33333333-3333-4333-8333-333333333333';
const ACTOR = '44444444-4444-4444-8444-444444444444';
const APPROVAL = '55555555-5555-4555-8555-555555555555';

const schema = {
  type: 'object',
  properties: { ticketId: { type: 'string', format: 'uuid' } },
  required: ['ticketId'],
  additionalProperties: false,
};

interface DefinitionOverrides {
  riskLevel?: string;
  approvalRequired?: boolean;
  enabled?: boolean;
  timeoutMs?: number;
  requiredPermission?: string;
  inputSchemaJson?: unknown;
}

function definition(overrides: DefinitionOverrides = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    tenantId: TENANT,
    name: 'ticket.close',
    inputSchemaJson: schema,
    requiredPermission: PERMISSIONS.TICKET_WRITE,
    riskLevel: 'LOW',
    approvalRequired: false,
    enabled: true,
    timeoutMs: 50,
    ...overrides,
  };
}

function harness(options: {
  def?: ReturnType<typeof definition> | null;
  platformDef?: ReturnType<typeof definition> | null;
  grant?: { id: string } | null;
  usableApproval?: { id: string } | null;
  claim?: boolean;
  /** Simulate a definition whose handler is not deployed. */
  handlerless?: boolean;
  /** Make the audit sink fail; 'string' throws a non-Error value. */
  auditFails?: boolean | 'string';
}) {
  const tenantFindFirst = vi.fn().mockResolvedValue(options.def ?? null);
  const platformFindFirst = vi
    .fn()
    .mockResolvedValue(options.platformDef ?? null);
  const grantFindFirst = vi
    .fn()
    .mockResolvedValue(
      options.grant === undefined ? { id: 'grant' } : options.grant,
    );
  const auditCreate = vi.fn().mockResolvedValue({});
  const approvalCreate = vi.fn().mockResolvedValue({ id: APPROVAL });
  const approvalUpdateMany = vi
    .fn()
    .mockResolvedValue({ count: options.claim === false ? 0 : 1 });

  const prisma = {
    aiToolDefinition: { findFirst: tenantFindFirst },
    agentToolGrant: { findFirst: grantFindFirst },
    toolApprovalRequest: {
      findFirst: vi.fn().mockResolvedValue(options.usableApproval ?? null),
      create: approvalCreate,
      updateMany: approvalUpdateMany,
    },
    auditEvent: { create: auditCreate },
  };

  // A single stub answers both the tenant-scoped and the platform-scoped
  // lookup: the service asks tenant scope first, then platform scope.
  tenantFindFirst.mockImplementation(
    async (args: { where: { tenantId?: string | null } }) =>
      args.where.tenantId === null || args.where.tenantId === undefined
        ? (options.platformDef ?? null)
        : (options.def ?? null),
  );

  // claim() must answer a boolean; the row update is observed separately.
  const claim = vi.fn().mockImplementation(async () => {
    await approvalUpdateMany();
    return options.claim !== false;
  });

  if (options.auditFails === 'string') {
    auditCreate.mockRejectedValue('audit store down');
  } else if (options.auditFails) {
    auditCreate.mockRejectedValue(new Error('audit store down'));
  }

  const registry = new ToolRegistry();
  const handler = vi.fn().mockResolvedValue({ closed: true });
  if (!options.handlerless) {
    registry.register('ticket.close', handler);
  }

  const service = new ToolExecutionService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma as any,
    new AuthorizationService(),
    registry,
    new ToolProposalGuard(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { record: auditCreate } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    {
      findUsable: vi.fn().mockResolvedValue(options.usableApproval ?? null),
      request: approvalCreate,
      claim,
    } as any,
  );

  return {
    service,
    handler,
    auditCreate,
    approvalCreate,
    approvalUpdateMany,
    grantFindFirst,
    tenantFindFirst,
  };
}

const proposal: ToolProposal = {
  tenantId: TENANT,
  agentVersionId: AGENT_VERSION,
  toolName: 'ticket.close',
  arguments: { ticketId: '77777777-7777-4777-8777-777777777777' },
};

const actor: ToolActor = { userId: ACTOR, role: 'R-agent' };

describe('ToolExecutionService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('AC-F10-1: a permitted action executes once and is audited', () => {
    it('executes the granted tool and records tool.executed', async () => {
      const { service, handler, auditCreate } = harness({ def: definition() });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('EXECUTED');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'tool.executed',
          tenantId: TENANT,
          actorId: ACTOR,
          resourceType: 'tool',
        }),
      );
    });

    it('passes the server tenant and user to the handler, never the proposal', async () => {
      const { service, handler } = harness({ def: definition() });

      await service.execute(proposal, actor);

      const context = handler.mock.calls[0][1] as {
        tenantId: string;
        userId: string;
      };
      expect(context.tenantId).toBe(TENANT);
      expect(context.userId).toBe(ACTOR);
    });

    it('resolves a platform tool when the tenant owns no definition', async () => {
      const { service } = harness({
        def: null,
        platformDef: definition({ tenantId: null } as never),
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('EXECUTED');
    });
  });

  describe('AC-F10-2: a disallowed proposal has zero side effects', () => {
    it('denies an unknown tool', async () => {
      const { service, handler, auditCreate } = harness({
        def: null,
        platformDef: null,
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'unknown_tool',
      });
      expect(handler).not.toHaveBeenCalled();
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tool.denied' }),
      );
    });

    it('denies a disabled tool', async () => {
      const { service, handler } = harness({
        def: definition({ enabled: false }),
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'tool_disabled',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('denies a tool the agent version was never granted', async () => {
      const { service, handler } = harness({
        def: definition(),
        grant: null,
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'not_granted',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('denies arguments that violate the registered input schema', async () => {
      const { service, handler } = harness({ def: definition() });

      const outcome = await service.execute(
        { ...proposal, arguments: { ticketId: 42, extra: true } },
        actor,
      );

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'invalid_arguments',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('denies arguments that try to choose the tenant scope', async () => {
      const { service, handler } = harness({
        def: definition({
          inputSchemaJson: { type: 'object', additionalProperties: true },
        }),
      });

      const outcome = await service.execute(
        {
          ...proposal,
          arguments: { ticketId: 'x', tenantId: OTHER_TENANT },
        },
        actor,
      );

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'policy_violation',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('holds a consequential tool for approval instead of executing it', async () => {
      const { service, handler, approvalCreate } = harness({
        def: definition({ approvalRequired: true }),
        usableApproval: null,
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('PENDING_APPROVAL');
      expect(handler).not.toHaveBeenCalled();
      expect(approvalCreate).toHaveBeenCalledTimes(1);
    });

    it('treats a HIGH risk tool as approval-required even when the flag is off', async () => {
      const { service, handler } = harness({
        def: definition({ riskLevel: 'HIGH', approvalRequired: false }),
        usableApproval: null,
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('PENDING_APPROVAL');
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not execute when an approval exists but the claim loses a race', async () => {
      const { service, handler, approvalUpdateMany } = harness({
        def: definition({ approvalRequired: true }),
        usableApproval: { id: APPROVAL },
        claim: false,
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('PENDING_APPROVAL');
      expect(approvalUpdateMany).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
    });

    it('executes once an approval is available and claims it', async () => {
      const { service, handler, approvalUpdateMany } = harness({
        def: definition({ approvalRequired: true }),
        usableApproval: { id: APPROVAL },
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('EXECUTED');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(approvalUpdateMany).toHaveBeenCalledTimes(1);
    });

    it('reports a handler failure without leaking the error', async () => {
      const { service, handler } = harness({ def: definition() });
      handler.mockRejectedValueOnce(new Error('downstream secret detail'));

      const outcome = await service.execute(proposal, actor);

      expect(outcome).toMatchObject({
        status: 'FAILED',
        reason: 'handler_error',
      });
      expect(JSON.stringify(outcome)).not.toContain('downstream secret detail');
    });

    it('fails safely when a definition has no deployed handler', async () => {
      const { service } = harness({ def: definition(), handlerless: true });

      const outcome = await service.execute(proposal, actor);

      expect(outcome).toMatchObject({
        status: 'FAILED',
        reason: 'handler_error',
      });
    });

    it('keeps the execution decision when the audit sink fails', async () => {
      const { service, handler } = harness({
        def: definition(),
        auditFails: true,
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('EXECUTED');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('stops a handler that exceeds the registered timeout', async () => {
      const { service, handler } = harness({
        def: definition({ timeoutMs: 20 }),
      });
      handler.mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
      );

      const outcome = await service.execute(proposal, actor);

      expect(outcome).toMatchObject({ status: 'FAILED', reason: 'timeout' });
    });
  });

  describe('AC-F10-3: the model cannot authorize itself', () => {
    it('denies a proposal whose actor role lacks the required permission', async () => {
      const { service, handler, auditCreate } = harness({ def: definition() });

      const outcome = await service.execute(proposal, {
        userId: ACTOR,
        role: 'R-customer',
      });

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'missing_permission',
      });
      expect(handler).not.toHaveBeenCalled();
      expect(auditCreate).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'tool.denied' }),
      );
    });

    it('ignores fields the model invents on the proposal', async () => {
      const { service, handler } = harness({ def: definition() });

      const forged = {
        ...proposal,
        requiredPermission: PERMISSIONS.TICKET_WRITE,
        approvalRequired: false,
        granted: true,
      } as ToolProposal;

      const outcome = await service.execute(forged, {
        userId: ACTOR,
        role: 'R-customer',
      });

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'missing_permission',
      });
      expect(handler).not.toHaveBeenCalled();
    });

    it('scopes the grant lookup to the caller tenant', async () => {
      const { service, grantFindFirst } = harness({ def: definition() });

      await service.execute(proposal, actor);

      expect(grantFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT,
            agentVersionId: AGENT_VERSION,
            toolId: '66666666-6666-4666-8666-666666666666',
          }),
        }),
      );
    });

    it('rejects a proposal with no user id before any lookup', async () => {
      const { service, tenantFindFirst } = harness({ def: definition() });

      await expect(
        service.execute(proposal, { userId: '', role: 'R-agent' }),
      ).rejects.toThrow('userId');
      expect(tenantFindFirst).not.toHaveBeenCalled();
    });

    it('treats a missing tool name as an unknown tool', async () => {
      const { service, tenantFindFirst, handler } = harness({
        def: definition(),
      });

      const outcome = await service.execute(
        { ...proposal, toolName: undefined as never },
        actor,
      );

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'unknown_tool',
      });
      expect(tenantFindFirst).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it('still decides when the audit sink throws a non-Error value', async () => {
      const { service } = harness({
        def: definition(),
        auditFails: 'string',
      });

      const outcome = await service.execute(proposal, actor);

      expect(outcome.status).toBe('EXECUTED');
    });

    it('treats an empty tool name as an unknown tool', async () => {
      const { service, tenantFindFirst, handler } = harness({
        def: definition(),
      });

      const outcome = await service.execute(
        { ...proposal, toolName: '' },
        actor,
      );

      expect(outcome).toMatchObject({
        status: 'DENIED',
        reason: 'unknown_tool',
      });
      expect(tenantFindFirst).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects a proposal with no tenant before any lookup', async () => {
      const { service, tenantFindFirst } = harness({ def: definition() });

      await expect(
        service.execute({ ...proposal, tenantId: '' }, actor),
      ).rejects.toThrow('tenantId');
      expect(tenantFindFirst).not.toHaveBeenCalled();
    });
  });
});
