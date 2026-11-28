/**
 * Audit scope keys and the event hash chain (T6.10; D-60).
 *
 * D-60 stores one chain per scope. A scope is a tenant, or the platform for a
 * row with no tenant. The hash covers the row's own content plus its position
 * and predecessor, so a changed row, a dropped row or a reordered row breaks
 * the chain. These cases use no database: they pin the format and the
 * verification rules, and the migration spec pins the storage.
 */

import { describe, expect, it } from 'vitest';
import {
  AUDIT_CHAIN_VERSION,
  ChainVerifier,
  auditEventHash,
  auditScopeKey,
  canonicalJson,
  type AuditChainRow,
  type SealedAuditRow,
} from './audit-chain.js';

const ROW: AuditChainRow = {
  id: '11111111-1111-4111-8111-111111111111',
  tenantId: 'tenant-a',
  scopeKey: 'tenant:tenant-a',
  actorId: 'sub-1',
  actorSnapshot: {
    version: 1,
    userId: 'user-1',
    displayName: 'Ada Lovelace',
    email: 'ada@acme.test',
    roles: ['Tenant Administrator'],
    membershipId: '22222222-2222-4222-8222-222222222222',
    tenantId: 'tenant-a',
  },
  snapshotVersion: 1,
  action: 'ticket.updated',
  resourceType: 'ticket',
  resourceId: 'ticket-1',
  metadata: { status: 'OPEN', nested: { b: 2, a: 1 } },
  requestId: 'req-1',
  createdAt: new Date('2026-11-28T10:00:00.000Z'),
};

function sealed(
  seq: bigint,
  prevHash: string | null,
  row: AuditChainRow = ROW,
): SealedAuditRow {
  return {
    ...row,
    chainSeq: seq,
    prevHash,
    eventHash: auditEventHash(row, seq, prevHash),
  };
}

describe('auditScopeKey', () => {
  it('names one platform scope for a row with no tenant', () => {
    expect(auditScopeKey(null)).toBe('platform');
    expect(auditScopeKey(undefined)).toBe('platform');
  });

  it('gives every tenant its own chain', () => {
    expect(auditScopeKey('tenant-a')).toBe('tenant:tenant-a');
    expect(auditScopeKey('tenant-a')).not.toBe(auditScopeKey('tenant-b'));
  });
});

describe('canonicalJson', () => {
  it('sorts object keys so insertion order cannot change the hash', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      '{"a":{"c":3,"d":2},"b":1}',
    );
  });

  it('keeps array order and drops undefined members', () => {
    expect(canonicalJson({ a: [2, 1], b: undefined })).toBe('{"a":[2,1]}');
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('auditEventHash', () => {
  it('returns a 64-character hex digest at the pinned chain version', () => {
    expect(AUDIT_CHAIN_VERSION).toBe(1);
    expect(auditEventHash(ROW, 1n, null)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for the same row, position and predecessor', () => {
    expect(auditEventHash(ROW, 4n, 'abc')).toBe(auditEventHash(ROW, 4n, 'abc'));
  });

  it('does not depend on the order of the metadata keys', () => {
    const reordered: AuditChainRow = {
      ...ROW,
      metadata: { nested: { a: 1, b: 2 }, status: 'OPEN' },
    };
    expect(auditEventHash(reordered, 1n, null)).toBe(
      auditEventHash(ROW, 1n, null),
    );
  });

  it('changes when the audited content changes', () => {
    const other: AuditChainRow = { ...ROW, action: 'ticket.deleted' };
    expect(auditEventHash(other, 1n, null)).not.toBe(
      auditEventHash(ROW, 1n, null),
    );
  });

  it('binds the row to its position and its predecessor', () => {
    const first = auditEventHash(ROW, 1n, null);
    expect(auditEventHash(ROW, 2n, null)).not.toBe(first);
    expect(auditEventHash(ROW, 1n, 'deadbeef')).not.toBe(first);
  });

  it('binds the row to its scope key, which is the immutable identity', () => {
    const other: AuditChainRow = { ...ROW, scopeKey: 'tenant:tenant-b' };
    expect(auditEventHash(other, 1n, null)).not.toBe(
      auditEventHash(ROW, 1n, null),
    );
  });

  // The tenant FK is a live relation. Deleting a tenant or changing its id
  // rewrites `tenant_id`, so a row must not hash it: the scope key already
  // names the tenant and it never changes (D-60, D-88).
  it('ignores the live tenant id, so a tenant deletion cannot read as tampering', () => {
    const afterTenantDelete: AuditChainRow = { ...ROW, tenantId: null };
    expect(auditEventHash(afterTenantDelete, 1n, null)).toBe(
      auditEventHash(ROW, 1n, null),
    );
  });
});

describe('ChainVerifier', () => {
  it('accepts a chain that links every row', () => {
    const verifier = new ChainVerifier('tenant:tenant-a');
    const one = sealed(1n, null);
    const two = sealed(2n, one.eventHash);
    verifier.push(one);
    verifier.push(two);

    expect(verifier.result()).toEqual({
      scopeKey: 'tenant:tenant-a',
      ok: true,
      sealed: 2,
      firstMismatchSeq: null,
      problem: null,
    });
  });

  it('reports the first row whose content no longer matches its hash', () => {
    const verifier = new ChainVerifier('tenant:tenant-a');
    const one = sealed(1n, null);
    const two = sealed(2n, one.eventHash);
    const three = sealed(3n, two.eventHash);
    verifier.push(one);
    verifier.push({ ...two, action: 'ticket.deleted' });
    verifier.push(three);

    const check = verifier.result();
    expect(check.ok).toBe(false);
    expect(check.firstMismatchSeq).toBe(2n);
    expect(check.problem).toBe('hash');
  });

  it('reports a missing sequence number', () => {
    const verifier = new ChainVerifier('tenant:tenant-a');
    const one = sealed(1n, null);
    const three = sealed(3n, one.eventHash);
    verifier.push(one);
    verifier.push(three);

    const check = verifier.result();
    expect(check.ok).toBe(false);
    expect(check.firstMismatchSeq).toBe(3n);
    expect(check.problem).toBe('sequence');
  });

  it('reports a broken predecessor link', () => {
    const verifier = new ChainVerifier('tenant:tenant-a');
    const one = sealed(1n, null);
    const two = sealed(2n, one.eventHash);
    verifier.push(one);
    verifier.push({ ...two, prevHash: 'a'.repeat(64) });

    const check = verifier.result();
    expect(check.ok).toBe(false);
    expect(check.firstMismatchSeq).toBe(2n);
    expect(check.problem).toBe('prev_hash');
  });

  it('expects the first sealed row to carry sequence one and no predecessor', () => {
    const verifier = new ChainVerifier('tenant:tenant-a');
    verifier.push(sealed(5n, null));

    const check = verifier.result();
    expect(check.ok).toBe(false);
    expect(check.problem).toBe('sequence');
  });

  it('reports an empty chain as an empty result, not a failure', () => {
    expect(new ChainVerifier('platform').result()).toMatchObject({
      ok: true,
      sealed: 0,
    });
  });
});
