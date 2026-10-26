/**
 * Audit event persistence (T1.04, AC-F03-1/AC-F11-1 intent).
 *
 * The service only appends: one create path, no update or delete
 * (docs/DATABASE.md section 5: append-oriented, restricted). A failed
 * audit write propagates instead of passing silently, so a caller cannot
 * complete a sensitive action while believing it was recorded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from './audit.service.js';

type MockPrisma = {
  auditEvent: { create: ReturnType<typeof vi.fn> };
};

describe('AuditService', () => {
  let prisma: MockPrisma;
  let service: AuditService;

  beforeEach(() => {
    prisma = { auditEvent: { create: vi.fn().mockResolvedValue({}) } };
    service = new AuditService(prisma as unknown as PrismaService);
  });

  it('appends an audit row with the mapped fields', async () => {
    await service.record({
      action: 'permission.denied',
      resourceType: 'permission',
      resourceId: 'ticket.read',
      tenantId: 'tenant-a',
      actorId: 'sub-123',
      metadata: { role: 'R-agent' },
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: 'permission.denied',
        resourceType: 'permission',
        resourceId: 'ticket.read',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
        metadataJson: { role: 'R-agent' },
      },
    });
  });

  it('omits optional fields that were not supplied', async () => {
    await service.record({ action: 'ticket.created', resourceType: 'ticket' });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        action: 'ticket.created',
        resourceType: 'ticket',
        resourceId: undefined,
        tenantId: undefined,
        actorId: undefined,
        metadataJson: undefined,
      },
    });
  });

  it('propagates a persistence failure instead of passing silently', async () => {
    prisma.auditEvent.create.mockRejectedValue(new Error('write denied'));

    await expect(
      service.record({ action: 'ticket.deleted', resourceType: 'ticket' }),
    ).rejects.toThrow('write denied');
  });
});
