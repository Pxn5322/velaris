/**
 * Whole-scope audit chain verification (T6.10; D-60).
 *
 * D-60 verifies integrity on a schedule, or by a manual or CI job until a
 * scheduler exists. The job must check every scope, so the walk lives in the
 * chain module as a function over a small reader interface: the API service
 * and the runnable script share it instead of each re-implementing the page
 * loop, the hash check or the head comparison.
 */

import { describe, expect, it } from 'vitest';
import {
  auditEventHash,
  verifyAllScopes,
  verifyScope,
  type AuditChainHead,
  type AuditChainStore,
  type SealedAuditRow,
} from './audit-chain.js';
import type { AuditChainReport } from './audit-chain.js';

const BASE = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-a',
  actorId: null,
  actorSnapshot: null,
  snapshotVersion: 1,
  action: 'ticket.updated',
  resourceType: 'ticket',
  resourceId: 'ticket-1',
  metadata: { status: 'OPEN' },
  requestId: 'req-1',
  createdAt: new Date('2026-11-28T10:00:00.000Z'),
};

function sealed(seq: bigint, prevHash: string | null, id: string) {
  const row = { ...BASE, id };
  return {
    ...row,
    chainSeq: seq,
    prevHash,
    eventHash: auditEventHash(row, seq, prevHash),
  } satisfies SealedAuditRow;
}

/** In-memory reader that pages rows the way the database does. */
class MemoryStore implements AuditChainStore {
  readonly reads: Array<{
    scopeKey: string;
    afterSeq: bigint | null;
    take: number;
  }> = [];

  constructor(
    private readonly rows: Record<string, SealedAuditRow[]>,
    private readonly heads: Record<string, AuditChainHead>,
    private readonly unsealed: Record<string, number> = {},
  ) {}

  async scopes(): Promise<string[]> {
    return Object.keys(this.rows).sort();
  }

  async sealedRows(
    scopeKey: string,
    afterSeq: bigint | null,
    take: number,
  ): Promise<SealedAuditRow[]> {
    this.reads.push({ scopeKey, afterSeq, take });
    return (this.rows[scopeKey] ?? [])
      .filter((row) => afterSeq === null || row.chainSeq > afterSeq)
      .slice(0, take);
  }

  async chainHead(scopeKey: string): Promise<AuditChainHead | null> {
    return this.heads[scopeKey] ?? null;
  }

  async unsealedCount(scopeKey: string): Promise<number> {
    return this.unsealed[scopeKey] ?? 0;
  }
}

function headOf(rows: SealedAuditRow[]): AuditChainHead {
  const last = rows[rows.length - 1];
  return { lastSeq: last.chainSeq, lastHash: last.eventHash };
}

describe('verifyScope', () => {
  it('accepts a sealed chain whose head matches its last row', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const store = new MemoryStore(
      { 'tenant:tenant-a': [one, two] },
      { 'tenant:tenant-a': headOf([one, two]) },
    );

    const report: AuditChainReport = await verifyScope(
      store,
      'tenant:tenant-a',
    );

    expect(report).toMatchObject({
      scopeKey: 'tenant:tenant-a',
      ok: true,
      sealed: 2,
      unsealed: 0,
      problem: null,
    });
  });

  it('books every page of a long chain', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const three = sealed(3n, two.eventHash, 'row-3');
    const store = new MemoryStore(
      { 'tenant:tenant-a': [one, two, three] },
      { 'tenant:tenant-a': headOf([one, two, three]) },
    );

    const report = await verifyScope(store, 'tenant:tenant-a', 2);

    expect(report).toMatchObject({ ok: true, sealed: 3 });
    expect(store.reads.map((read) => read.afterSeq)).toEqual([null, 2n]);
    expect(store.reads.map((read) => read.take)).toEqual([2, 2]);
  });

  it('reports a head that runs past the sealed rows', async () => {
    const one = sealed(1n, null, 'row-1');
    const store = new MemoryStore(
      { 'tenant:tenant-a': [one] },
      { 'tenant:tenant-a': { lastSeq: 2n, lastHash: 'a'.repeat(64) } },
    );

    const report = await verifyScope(store, 'tenant:tenant-a');

    expect(report).toMatchObject({
      ok: false,
      problem: 'head',
      firstMismatchSeq: 2n,
    });
  });

  it('keeps unsealed legacy rows out of the verified count', async () => {
    const one = sealed(1n, null, 'row-1');
    const store = new MemoryStore(
      { platform: [one] },
      { platform: headOf([one]) },
      { platform: 195 },
    );

    const report = await verifyScope(store, 'platform');

    expect(report).toMatchObject({ ok: true, sealed: 1, unsealed: 195 });
  });

  it('accepts a scope whose only rows predate the seal', async () => {
    const store = new MemoryStore({ platform: [] }, {}, { platform: 3 });

    const report = await verifyScope(store, 'platform');

    expect(report).toMatchObject({
      ok: true,
      sealed: 0,
      unsealed: 3,
      problem: null,
    });
  });

  it('reports a stored row whose content no longer matches its hash', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const store = new MemoryStore(
      { 'tenant:tenant-a': [one, { ...two, action: 'ticket.deleted' }] },
      { 'tenant:tenant-a': headOf([one, two]) },
    );

    const report = await verifyScope(store, 'tenant:tenant-a');

    expect(report).toMatchObject({
      ok: false,
      problem: 'hash',
      firstMismatchSeq: 2n,
    });
  });
});

describe('verifyAllScopes', () => {
  it('checks every scope the store reports, in order', async () => {
    const one = sealed(1n, null, 'row-1');
    const store = new MemoryStore(
      {
        platform: [one],
        'tenant:tenant-a': [one],
      },
      {
        platform: headOf([one]),
        'tenant:tenant-a': headOf([one]),
      },
      { platform: 195 },
    );

    const reports = await verifyAllScopes(store);

    expect(reports.map((report) => report.scopeKey)).toEqual([
      'platform',
      'tenant:tenant-a',
    ]);
    expect(reports.every((report) => report.ok)).toBe(true);
    expect(reports[0].unsealed).toBe(195);
  });

  it('keeps checking after one scope fails', async () => {
    const one = sealed(1n, null, 'row-1');
    const two = sealed(2n, one.eventHash, 'row-2');
    const store = new MemoryStore(
      {
        'tenant:a': [one, { ...two, prevHash: 'b'.repeat(64) }],
        'tenant:b': [one],
      },
      {
        'tenant:a': headOf([one, two]),
        'tenant:b': headOf([one]),
      },
    );

    const reports = await verifyAllScopes(store);

    expect(reports.map((report) => report.ok)).toEqual([false, true]);
    expect(reports[0].problem).toBe('prev_hash');
  });

  it('reports no scope as a passing, empty run', async () => {
    expect(await verifyAllScopes(new MemoryStore({}, {}))).toEqual([]);
  });
});
