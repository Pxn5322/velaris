/**
 * Audit event persistence (T1.04, T6.10; AC-F03-1/AC-F11-1; D-60).
 *
 * The service only appends: one create path, no update or delete
 * (docs/DATABASE.md section 5: append-oriented, restricted). Each write
 * resolves the actor snapshot once, then seals the row into its scope chain
 * inside one transaction: the chain head row reserves the sequence and holds
 * its lock until the new hash is stored, so two writers cannot take the same
 * position. A failed audit write propagates instead of passing silently, so a
 * caller cannot complete a sensitive action while believing it was recorded.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from './audit.service.js';

type Head = { lastSeq: bigint; lastHash: string | null };

type MockPrisma = {
  auditEvent: { create: ReturnType<typeof vi.fn> };
  user: { findFirst: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
  $executeRaw: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
};

function buildPrisma(): { prisma: MockPrisma; heads: Map<string, Head> } {
  const heads = new Map<string, Head>();
  const create = vi.fn().mockResolvedValue({});
  const prisma: MockPrisma = {
    auditEvent: { create },
    user: { findFirst: vi.fn().mockResolvedValue(null) },
    $queryRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (/INSERT INTO "audit_chains"/.test(sql)) {
          const scope = String(values[0]);
          const current = heads.get(scope);
          const head: Head = current
            ? { lastSeq: current.lastSeq + 1n, lastHash: current.lastHash }
            : { lastSeq: 1n, lastHash: null };
          heads.set(scope, head);
          return [{ last_seq: head.lastSeq, last_hash: head.lastHash }];
        }
        return [];
      },
    ),
    $executeRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = strings.join('?');
        if (/UPDATE "audit_chains"/.test(sql)) {
          const [eventHash, scope, seq] = values as [string, string, bigint];
          const head = heads.get(scope);
          if (!head || head.lastSeq !== BigInt(seq)) return 0;
          heads.set(scope, { lastSeq: head.lastSeq, lastHash: eventHash });
        }
        return 1;
      },
    ),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (work: (tx: MockPrisma) => Promise<unknown>) => work(prisma),
  );
  return { prisma, heads };
}

describe('AuditService', () => {
  let prisma: MockPrisma;
  let heads: Map<string, Head>;
  let service: AuditService;

  beforeEach(() => {
    ({ prisma, heads } = buildPrisma());
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
      data: expect.objectContaining({
        action: 'permission.denied',
        resourceType: 'permission',
        resourceId: 'ticket.read',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
        metadataJson: { role: 'R-agent' },
      }),
    });
  });

  it('omits optional fields that were not supplied and scopes a platform row', async () => {
    await service.record({ action: 'ticket.created', resourceType: 'ticket' });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'ticket.created',
        resourceType: 'ticket',
        resourceId: undefined,
        tenantId: undefined,
        actorId: undefined,
        metadataJson: undefined,
        scopeKey: 'platform',
        actorSnapshot: undefined,
      }),
    });
  });

  it('seals the first row of a scope at sequence one with no predecessor', async () => {
    await service.record({
      action: 'ticket.created',
      resourceType: 'ticket',
      tenantId: 'tenant-a',
    });

    const data = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(data.scopeKey).toBe('tenant:tenant-a');
    expect(data.chainSeq).toBe(1n);
    expect(data.prevHash).toBeNull();
    expect(data.eventHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.createdAt).toBeInstanceOf(Date);
  });

  it('links the second row of a scope to the first row hash', async () => {
    await service.record({
      action: 'ticket.created',
      resourceType: 'ticket',
      tenantId: 'tenant-a',
    });
    await service.record({
      action: 'ticket.updated',
      resourceType: 'ticket',
      tenantId: 'tenant-a',
    });

    const first = prisma.auditEvent.create.mock.calls[0][0].data;
    const second = prisma.auditEvent.create.mock.calls[1][0].data;
    expect(second.chainSeq).toBe(2n);
    expect(second.prevHash).toBe(first.eventHash);
    expect(second.eventHash).not.toBe(first.eventHash);
  });

  it('keeps a separate chain for every scope', async () => {
    await service.record({
      action: 'ticket.created',
      resourceType: 'ticket',
      tenantId: 'tenant-a',
    });
    await service.record({
      action: 'tenant.updated',
      resourceType: 'tenant',
      tenantId: 'tenant-b',
    });

    const second = prisma.auditEvent.create.mock.calls[1][0].data;
    expect(second.chainSeq).toBe(1n);
    expect(second.prevHash).toBeNull();
    expect([...heads.keys()]).toEqual(['tenant:tenant-a', 'tenant:tenant-b']);
  });

  it('stores the actor snapshot for the row tenant, so a later rename keeps the label', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'user-1',
      displayName: 'Ada Lovelace',
      emailNormalized: 'ada@acme.test',
      memberships: [
        {
          id: 'membership-a',
          tenantId: 'tenant-a',
          roles: [
            { role: { name: 'Tenant Administrator' } },
            { role: { name: 'Support Agent' } },
          ],
        },
        {
          id: 'membership-b',
          tenantId: 'tenant-b',
          roles: [{ role: { name: 'Other Tenant Role' } }],
        },
      ],
    });

    await service.record({
      action: 'ticket.updated',
      resourceType: 'ticket',
      tenantId: 'tenant-a',
      actorId: 'sub-123',
    });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { externalSubject: 'sub-123' } }),
    );
    const data = prisma.auditEvent.create.mock.calls[0][0].data;
    expect(data.actorId).toBe('sub-123');
    expect(data.snapshotVersion).toBe(1);
    expect(data.actorSnapshot).toEqual({
      version: 1,
      userId: 'user-1',
      displayName: 'Ada Lovelace',
      email: 'ada@acme.test',
      membershipId: 'membership-a',
      tenantId: 'tenant-a',
      roles: ['Support Agent', 'Tenant Administrator'],
    });
  });

  it('reads no user when the row has no actor', async () => {
    await service.record({
      action: 'ticket.created',
      resourceType: 'ticket',
      tenantId: 'tenant-a',
    });

    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.auditEvent.create.mock.calls[0][0].data.actorSnapshot,
    ).toBeUndefined();
  });

  it('refuses the write when the chain head moved under it', async () => {
    prisma.$executeRaw.mockImplementation(
      async (strings: TemplateStringsArray) =>
        /UPDATE "audit_chains"/.test(strings.join('?')) ? 0 : 1,
    );

    await expect(
      service.record({ action: 'ticket.created', resourceType: 'ticket' }),
    ).rejects.toThrow(/audit chain head moved/);
  });

  it('propagates a persistence failure instead of passing silently', async () => {
    prisma.auditEvent.create.mockRejectedValue(new Error('write denied'));

    await expect(
      service.record({ action: 'ticket.deleted', resourceType: 'ticket' }),
    ).rejects.toThrow('write denied');
  });
});
