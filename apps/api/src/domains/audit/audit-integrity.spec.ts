/**
 * Audit chain verification (T6.10; D-60).
 *
 * D-60 verifies integrity on a schedule, or by a manual or CI job until a
 * scheduler exists. `AuditIntegrityService.verify` walks one scope in chain
 * order and compares the last sealed row with the recorded chain head, so a
 * changed row, a dropped row or a lost tail is reported instead of trusted.
 * Rows written before migration 0025 carry no seal; they are counted, never
 * presented as verified.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { auditEventHash, type SealedAuditRow } from './audit-chain.js';
import { AuditIntegrityService } from './audit-integrity.service.js';

const BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-a',
  actorId: null,
  actorSnapshot: null,
  snapshotVersion: 1,
  action: 'ticket.updated',
  resourceType: 'ticket',
  resourceId: 'ticket-1',
  metadataJson: { status: 'OPEN' },
  requestId: 'req-1',
  createdAt: new Date('2026-11-28T10:00:00.000Z'),
};

function sealed(seq: bigint, prevHash: string | null, id: string) {
  const row = { ...BASE, id, metadata: BASE.metadataJson };
  return {
    ...row,
    chainSeq: seq,
    prevHash,
    eventHash: auditEventHash(row, seq, prevHash),
  } satisfies SealedAuditRow;
}

function buildService(rows: unknown[], head: unknown, unsealed = 0) {
  const findMany = vi.fn().mockResolvedValue(rows);
  const count = vi.fn().mockResolvedValue(unsealed);
  const findUnique = vi.fn().mockResolvedValue(head);
  const prisma = {
    auditEvent: { findMany, count },
    auditChain: { findUnique },
  } as unknown as PrismaService;
  return {
    service: new AuditIntegrityService(prisma),
    findMany,
    count,
    findUnique,
  };
}

describe('AuditIntegrityService', () => {
  it('accepts a sealed chain whose head matches its last row', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const { service } = buildService([one, two], {
      scopeKey: 'tenant:tenant-a',
      lastSeq: 2n,
      lastHash: two.eventHash,
    });

    const check = await service.verify('tenant:tenant-a');

    expect(check).toMatchObject({
      scopeKey: 'tenant:tenant-a',
      ok: true,
      sealed: 2,
      unsealed: 0,
      problem: null,
    });
  });

  it('reports the first row whose content no longer matches its hash', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const { service } = buildService(
      [one, { ...two, action: 'ticket.deleted' }],
      { scopeKey: 'tenant:tenant-a', lastSeq: 2n, lastHash: two.eventHash },
    );

    const check = await service.verify('tenant:tenant-a');

    expect(check.ok).toBe(false);
    expect(check.firstMismatchSeq).toBe(2n);
    expect(check.problem).toBe('hash');
  });

  it('reports a head that no longer matches the last sealed row', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const { service } = buildService([one], {
      scopeKey: 'tenant:tenant-a',
      lastSeq: 2n,
      lastHash: two.eventHash,
    });

    const check = await service.verify('tenant:tenant-a');

    expect(check.ok).toBe(false);
    expect(check.problem).toBe('head');
    expect(check.firstMismatchSeq).toBe(2n);
  });

  it('counts rows written before the seal without claiming them verified', async () => {
    const one = sealed(1n, null, 'row-1');
    const { service } = buildService(
      [one],
      { scopeKey: 'tenant:tenant-a', lastSeq: 1n, lastHash: one.eventHash },
      3,
    );

    const check = await service.verify('tenant:tenant-a');

    expect(check).toMatchObject({ ok: true, sealed: 1, unsealed: 3 });
  });

  it('reads one scope in chain order and pages with the sequence cursor', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const three = sealed(3n, two.eventHash, 'row-3');
    const { service, findMany, findUnique } = buildService([one, two], {
      scopeKey: 'tenant:tenant-a',
      lastSeq: 3n,
      lastHash: three.eventHash,
    });
    findMany.mockResolvedValueOnce([one, two]).mockResolvedValueOnce([three]);

    const check = await service.verify('tenant:tenant-a', { batchSize: 2 });

    expect(check).toMatchObject({ ok: true, sealed: 3 });
    expect(findUnique).toHaveBeenCalledWith({
      where: { scopeKey: 'tenant:tenant-a' },
    });
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { scopeKey: 'tenant:tenant-a', chainSeq: { not: null } },
        orderBy: { chainSeq: 'asc' },
        take: 2,
      }),
    );
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          scopeKey: 'tenant:tenant-a',
          chainSeq: { not: null, gt: 2n },
        },
      }),
    );
  });

  it('reports a scope with no chain head as a head mismatch when rows exist', async () => {
    const one = sealed(1n, null, 'row-1');
    const { service } = buildService([one], null);

    const check = await service.verify('tenant:tenant-a');

    expect(check.ok).toBe(false);
    expect(check.problem).toBe('head');
  });
});
