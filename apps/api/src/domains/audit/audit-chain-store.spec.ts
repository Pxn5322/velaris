/**
 * Prisma reader for audit chain verification (T6.10; D-60).
 *
 * The runnable verification job and `AuditIntegrityService` read the chain
 * through one adapter, so the page query, the head lookup and the unsealed
 * count cannot drift between a scheduled check and a manual run. The adapter
 * has no Nest imports: the script loads it with Node's type stripping.
 */

import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { auditChainStore } from './audit-chain-store.js';

type Client = Pick<PrismaClient, 'auditEvent' | 'auditChain'>;

function buildStore() {
  const findSealed = vi.fn().mockResolvedValue([]);
  const findScopes = vi.fn().mockResolvedValue([]);
  const count = vi.fn().mockResolvedValue(0);
  const findHead = vi.fn().mockResolvedValue(null);
  const findHeads = vi.fn().mockResolvedValue([]);
  const prisma = {
    auditEvent: { findMany: findSealed, count },
    auditChain: { findMany: findHeads, findUnique: findHead },
  } as unknown as Client;
  const store = auditChainStore(prisma);
  return { store, findSealed, findScopes, count, findHead, findHeads, prisma };
}

describe('auditChainStore', () => {
  it('reads the first page of a scope with no cursor', async () => {
    const { store, findSealed } = buildStore();

    await store.sealedRows('tenant:tenant-a', null, 500);

    expect(findSealed).toHaveBeenCalledWith({
      where: { scopeKey: 'tenant:tenant-a', chainSeq: { not: null } },
      orderBy: { chainSeq: 'asc' },
      take: 500,
    });
  });

  it('reads the next page past the last accepted sequence', async () => {
    const { store, findSealed } = buildStore();

    await store.sealedRows('tenant:tenant-a', 42n, 100);

    expect(findSealed).toHaveBeenCalledWith({
      where: {
        scopeKey: 'tenant:tenant-a',
        chainSeq: { not: null, gt: 42n },
      },
      orderBy: { chainSeq: 'asc' },
      take: 100,
    });
  });

  it('maps a stored row to the sealed shape the verifier hashes', async () => {
    const { store, findSealed } = buildStore();
    findSealed.mockResolvedValue([
      {
        id: 'row-1',
        tenantId: 'tenant-a',
        scopeKey: 'tenant:tenant-a',
        actorId: 'sub-1',
        actorSnapshot: { userId: 'user-1', roles: ['R-agent'] },
        snapshotVersion: 1,
        action: 'ticket.updated',
        resourceType: 'ticket',
        resourceId: 'ticket-1',
        metadataJson: { status: 'OPEN' },
        requestId: 'req-1',
        createdAt: new Date('2026-11-28T10:00:00.000Z'),
        chainSeq: 2n,
        prevHash: 'a'.repeat(64),
        eventHash: 'b'.repeat(64),
      },
    ]);

    const [row] = await store.sealedRows('tenant:tenant-a', null, 10);

    expect(row).toEqual({
      id: 'row-1',
      tenantId: 'tenant-a',
      scopeKey: 'tenant:tenant-a',
      actorId: 'sub-1',
      actorSnapshot: { userId: 'user-1', roles: ['R-agent'] },
      snapshotVersion: 1,
      action: 'ticket.updated',
      resourceType: 'ticket',
      resourceId: 'ticket-1',
      metadata: { status: 'OPEN' },
      requestId: 'req-1',
      createdAt: new Date('2026-11-28T10:00:00.000Z'),
      chainSeq: 2n,
      prevHash: 'a'.repeat(64),
      eventHash: 'b'.repeat(64),
    });
  });

  it('reads the chain head, or null when a scope has none', async () => {
    const { store, findHead } = buildStore();
    findHead.mockResolvedValue({
      scopeKey: 'platform',
      lastSeq: 7n,
      lastHash: 'c'.repeat(64),
    });

    await expect(store.chainHead('platform')).resolves.toEqual({
      lastSeq: 7n,
      lastHash: 'c'.repeat(64),
    });
    findHead.mockResolvedValueOnce(null);
    await expect(store.chainHead('tenant:none')).resolves.toBeNull();
    expect(findHead).toHaveBeenCalledWith({ where: { scopeKey: 'platform' } });
  });

  it('counts the rows written before the seal', async () => {
    const { store, count } = buildStore();

    await store.unsealedCount('platform', null);

    expect(count).toHaveBeenCalledTimes(1);
    expect(count).toHaveBeenCalledWith({
      where: { scopeKey: 'platform', chainSeq: null },
    });
  });

  it('splits the unsealed rows at the first sealed row of the scope', async () => {
    const { store, count } = buildStore();
    const sealStartedAt = new Date('2026-11-28T10:00:00.000Z');
    count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);

    await expect(
      store.unsealedCount('tenant:tenant-a', sealStartedAt),
    ).resolves.toEqual({ legacy: 2, afterSeal: 1 });
    expect(count).toHaveBeenNthCalledWith(1, {
      where: {
        scopeKey: 'tenant:tenant-a',
        chainSeq: null,
        createdAt: { lt: sealStartedAt },
      },
    });
    expect(count).toHaveBeenNthCalledWith(2, {
      where: {
        scopeKey: 'tenant:tenant-a',
        chainSeq: null,
        createdAt: { gte: sealStartedAt },
      },
    });
  });

  it('lists a scope once when it has both a head and legacy rows', async () => {
    const { store, findSealed, findHeads } = buildStore();
    findSealed.mockResolvedValue([
      { scopeKey: 'tenant:tenant-b' },
      { scopeKey: 'platform' },
    ]);
    findHeads.mockResolvedValue([
      { scopeKey: 'tenant:tenant-a' },
      { scopeKey: 'platform' },
    ]);

    await expect(store.scopes()).resolves.toEqual([
      'platform',
      'tenant:tenant-a',
      'tenant:tenant-b',
    ]);
    expect(findSealed).toHaveBeenCalledWith({
      distinct: ['scopeKey'],
      select: { scopeKey: true },
    });
    expect(findHeads).toHaveBeenCalledWith({ select: { scopeKey: true } });
  });
});
