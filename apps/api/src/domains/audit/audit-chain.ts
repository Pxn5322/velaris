/**
 * Audit scope keys, canonical hashing and chain verification (T6.10; D-60).
 *
 * D-60 keeps one chain per scope: a tenant, or the platform for a row with no
 * tenant. A chain row's hash covers its own content, its position and its
 * predecessor, so a changed row, a dropped row or a reordered row breaks the
 * chain. The hash input is a canonical form: object keys are sorted and
 * numbers keep their JSON form, so two writes of the same event agree.
 *
 * The verifier walks rows in chain order. It counts sealed rows and reports
 * the first row that fails on sequence, predecessor or hash. Rows written
 * before migration 0025 carry no seal; the service counts them separately and
 * never presents them as verified.
 */

import { createHash } from 'node:crypto';

/** Bump only with a documented decision: it changes every later hash. */
export const AUDIT_CHAIN_VERSION = 1;

/** Immutable actor labels stored on the row (D-60). */
export interface AuditActorSnapshot {
  version: number;
  userId: string;
  displayName: string;
  email: string;
  membershipId: string | null;
  tenantId: string | null;
  roles: string[];
}

/** The content of one audit row, without its chain position. */
export interface AuditChainRow {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  actorSnapshot: AuditActorSnapshot | null;
  snapshotVersion: number;
  action: string;
  resourceType: string;
  resourceId: string | null;
  metadata: unknown;
  requestId: string | null;
  createdAt: Date;
}

/** An audit row with its chain position, predecessor and stored hash. */
export interface SealedAuditRow extends AuditChainRow {
  chainSeq: bigint;
  prevHash: string | null;
  eventHash: string;
}

export type ChainProblem = 'sequence' | 'prev_hash' | 'hash' | 'head';

export interface ChainCheck {
  scopeKey: string;
  ok: boolean;
  sealed: number;
  firstMismatchSeq: bigint | null;
  problem: ChainProblem | null;
}

/** `tenant:<id>`, or `platform` for a row with no tenant. */
export function auditScopeKey(tenantId?: string | null): string {
  return tenantId ? `tenant:${tenantId}` : 'platform';
}

/**
 * Deterministic JSON: sorted keys, array order kept, `undefined` members
 * dropped. Two objects with the same content always produce the same text,
 * so the hash does not depend on the order of the caller's keys.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => (item === undefined ? 'null' : canonicalJson(item)))
      .join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, member]) => `${JSON.stringify(key)}:${canonicalJson(member)}`)
    .join(',')}}`;
}

/**
 * The SHA-256 of one sealed row. `seq` and `prevHash` are part of the input,
 * so a moved row or a changed predecessor can never reproduce the hash.
 */
export function auditEventHash(
  row: AuditChainRow,
  seq: bigint,
  prevHash: string | null,
): string {
  const payload = [
    `v${AUDIT_CHAIN_VERSION}`,
    row.id,
    auditScopeKey(row.tenantId),
    String(seq),
    prevHash ?? '',
    row.tenantId ?? '',
    row.actorId ?? '',
    String(row.snapshotVersion),
    row.actorSnapshot ? canonicalJson(row.actorSnapshot) : '',
    row.action,
    row.resourceType,
    row.resourceId ?? '',
    row.metadata === undefined ? '' : canonicalJson(row.metadata),
    row.requestId ?? '',
    row.createdAt.toISOString(),
  ].join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Checks one scope in chain order. Push sealed rows in ascending sequence;
 * `result()` reports the first mismatch and stops changing afterwards.
 */
export class ChainVerifier {
  private readonly scopeKey: string;
  private expectedSeq = 1n;
  private lastSealed: SealedAuditRow | null = null;
  private sealedCount = 0;
  private failure: { seq: bigint; problem: ChainProblem } | null = null;

  constructor(scopeKey: string) {
    this.scopeKey = scopeKey;
  }

  push(row: SealedAuditRow): void {
    this.sealedCount += 1;
    if (this.failure) return;
    if (row.chainSeq !== this.expectedSeq) {
      this.failure = { seq: row.chainSeq, problem: 'sequence' };
      return;
    }
    if (row.prevHash !== (this.lastSealed?.eventHash ?? null)) {
      this.failure = { seq: row.chainSeq, problem: 'prev_hash' };
      return;
    }
    if (auditEventHash(row, row.chainSeq, row.prevHash) !== row.eventHash) {
      this.failure = { seq: row.chainSeq, problem: 'hash' };
      return;
    }
    this.expectedSeq = row.chainSeq + 1n;
    this.lastSealed = row;
  }

  /** Sequence of the last row accepted by the chain, null for an empty chain. */
  get lastConsistentSeq(): bigint | null {
    return this.lastSealed?.chainSeq ?? null;
  }

  get lastConsistentHash(): string | null {
    return this.lastSealed?.eventHash ?? null;
  }

  result(): ChainCheck {
    return {
      scopeKey: this.scopeKey,
      ok: this.failure === null,
      sealed: this.sealedCount,
      firstMismatchSeq: this.failure?.seq ?? null,
      problem: this.failure?.problem ?? null,
    };
  }
}
