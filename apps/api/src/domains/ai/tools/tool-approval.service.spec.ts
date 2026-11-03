/**
 * Approval gate contract (T4.04; F-10, AC-F10-2).
 *
 * A decision is bound to one proposal hash, expires, and is consumed once.
 * Deciding needs `ai.tool.approve`, so the model and ordinary agents cannot
 * approve their own consequential action (AC-F10-3).
 */

import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../../permissions/authorization.service.js';
import { ToolApprovalService } from './tool-approval.service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';
const TOOL = '66666666-6666-4666-8666-666666666666';
const VERSION = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const APPROVAL = '55555555-5555-4555-8555-555555555555';

function harness() {
  const findFirst = vi.fn().mockResolvedValue(null);
  const create = vi.fn().mockResolvedValue({ id: APPROVAL });
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    toolApprovalRequest: { findFirst, create, updateMany },
  };
  const service = new ToolApprovalService(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma as any,
    new AuthorizationService(),
  );
  return { service, findFirst, create, updateMany };
}

describe('ToolApprovalService', () => {
  describe('findUsable', () => {
    it('looks only for an approved, unexpired, unconsumed decision', async () => {
      const { service, findFirst } = harness();

      await service.findUsable({
        tenantId: TENANT,
        toolDefinitionId: TOOL,
        agentVersionId: VERSION,
        proposalHash: HASH,
      });

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: TENANT,
            toolDefinitionId: TOOL,
            agentVersionId: VERSION,
            proposalHash: HASH,
            status: 'APPROVED',
            consumedAt: null,
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });
  });

  describe('request', () => {
    it('reuses an open request for the same proposal', async () => {
      const { service, findFirst, create } = harness();
      findFirst.mockResolvedValueOnce({ id: 'existing' });

      const result = await service.request({
        tenantId: TENANT,
        toolDefinitionId: TOOL,
        agentVersionId: VERSION,
        proposalHash: HASH,
        proposalJson: { toolName: 'ticket.close' },
        requestedBy: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(result.id).toBe('existing');
      expect(create).not.toHaveBeenCalled();
    });

    it('opens a new request when none is open', async () => {
      const { service, create } = harness();

      const result = await service.request({
        tenantId: TENANT,
        toolDefinitionId: TOOL,
        agentVersionId: VERSION,
        proposalHash: HASH,
        proposalJson: { toolName: 'ticket.close' },
        requestedBy: 'user',
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(result.id).toBe(APPROVAL);
      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  describe('claim', () => {
    it('succeeds only when the conditional update changed one row', async () => {
      const { service, updateMany } = harness();

      await expect(service.claim(APPROVAL)).resolves.toBe(true);
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: APPROVAL,
            status: 'APPROVED',
            consumedAt: null,
          }),
        }),
      );
    });

    it('reports a lost race when no row is updated', async () => {
      const { service, updateMany } = harness();
      updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(service.claim(APPROVAL)).resolves.toBe(false);
    });
  });

  describe('decide', () => {
    const input = {
      tenantId: TENANT,
      approvalId: APPROVAL,
      approve: true,
      decidedBy: 'admin',
      actorRole: 'R-tenant-admin',
    };

    it('records an approval for an authorized administrator', async () => {
      const { service, findFirst, updateMany } = harness();
      findFirst.mockResolvedValueOnce({
        id: APPROVAL,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.decide(input);

      expect(result).toEqual({ id: APPROVAL, status: 'APPROVED' });
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'APPROVED',
            decidedBy: 'admin',
          }),
        }),
      );
    });

    it('records a rejection', async () => {
      const { service, findFirst, updateMany } = harness();
      findFirst.mockResolvedValueOnce({
        id: APPROVAL,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const result = await service.decide({ ...input, approve: false });

      expect(result.status).toBe('REJECTED');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );
    });

    it('refuses a role without ai.tool.approve and writes nothing (AC-F10-3)', async () => {
      const { service, findFirst, updateMany } = harness();

      await expect(
        service.decide({ ...input, actorRole: 'R-agent' }),
      ).rejects.toThrow('ai.tool.approve');
      expect(findFirst).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('refuses a null role', async () => {
      const { service } = harness();

      await expect(
        service.decide({ ...input, actorRole: null }),
      ).rejects.toThrow('ai.tool.approve');
    });

    it('does not decide a request from another tenant', async () => {
      const { service } = harness();

      await expect(
        service.decide({ ...input, tenantId: OTHER_TENANT }),
      ).rejects.toThrow('not found');
    });

    it('marks a past-expiry request expired instead of approved', async () => {
      const { service, findFirst, updateMany } = harness();
      findFirst.mockResolvedValueOnce({
        id: APPROVAL,
        status: 'PENDING',
        expiresAt: new Date(Date.now() - 1_000),
      });

      const result = await service.decide(input);

      expect(result.status).toBe('REJECTED');
      expect(updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );
    });
  });
});
