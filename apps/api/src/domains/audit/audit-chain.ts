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
  /** Live relation to `tenants`; never hashed, because the relation rewrites it. */
  tenantId: string | null;
  /** Immutable chain identity: `tenant:<id>`, or `platform`. Always hashed. */
  scopeKey: string;
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

export type ChainProblem =
  'sequence' | 'prev_hash' | 'hash' | 'head' | 'unsealed';

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
 *
 * The input covers `scopeKey` and never `tenantId` (D-88). `tenantId` is a
 * foreign key to `tenants`, so a tenant delete or an id change rewrites it,
 * and a hashed column that the database can rewrite would turn an ordinary
 * tenant deletion into a reported tamper. `scopeKey` names the same tenant and
 * nothing updates it.
 */
export function auditEventHash(
  row: AuditChainRow,
  seq: bigint,
  prevHash: string | null,
): string {
  const payload = [
    `v${AUDIT_CHAIN_VERSION}`,
    row.id,
    row.scopeKey,
    String(seq),
    prevHash ?? '',
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
  private firstSealed: Date | null = null;

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
    if (this.firstSealed === null && row.chainSeq === 1n) {
      this.firstSealed = row.createdAt;
    }
    this.expectedSeq = row.chainSeq + 1n;
    this.lastSealed = row;
  }

  /**
   * When the seal began for this scope: the time of its first sealed row. An
   * unsealed row at or after this instant did not come through the write path.
   */
  get sealStartedAt(): Date | null {
    return this.firstSealed;
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

/** The stored head of one scope's chain. */
export interface AuditChainHead {
  lastSeq: bigint;
  lastHash: string | null;
}

/**
 * The read side a verification run needs. `auditChainStore` implements it for
 * the database, and a test can supply it in memory, so the walk is one
 * implementation for the API service and the scheduled or manual job.
 */
export interface AuditChainStore {
  /** Every scope to check: each tenant chain and the platform chain. */
  scopes(): Promise<string[]>;
  /** Sealed rows in chain order, starting after `afterSeq` when it is given. */
  sealedRows(
    scopeKey: string,
    afterSeq: bigint | null,
    take: number,
  ): Promise<SealedAuditRow[]>;
  chainHead(scopeKey: string): Promise<AuditChainHead | null>;
  /**
   * Unsealed rows, split at the scope's first sealed row. `legacy` rows predate
   * the seal and can never be sealed; `afterSeal` rows are a broken chain.
   * `sealStartedAt` is null while the scope has no sealed row.
   */
  unsealedCount(
    scopeKey: string,
    sealStartedAt: Date | null,
  ): Promise<UnsealedRows>;
}

export interface UnsealedRows {
  legacy: number;
  afterSeal: number;
}

/** One scope's verification result, with both unsealed counts. */
export interface AuditChainReport extends ChainCheck {
  unsealed: number;
  unsealedAfterSeal: number;
}

/** Rows read per page while a scope is walked. */
export const DEFAULT_CHAIN_BATCH = 500;

/**
 * Walks one scope in pages, then compares the last accepted row with the chain
 * head. Rows written before the seal are counted, never claimed as verified.
 */
export async function verifyScope(
  store: AuditChainStore,
  scopeKey: string,
  batchSize: number = DEFAULT_CHAIN_BATCH,
): Promise<AuditChainReport> {
  const verifier = new ChainVerifier(scopeKey);
  let cursor: bigint | null = null;

  for (;;) {
    const rows = await store.sealedRows(scopeKey, cursor, batchSize);
    for (const row of rows) verifier.push(row);
    if (rows.length < batchSize) break;
    cursor = rows[rows.length - 1].chainSeq;
  }

  const [head, unsealed] = await Promise.all([
    store.chainHead(scopeKey),
    store.unsealedCount(scopeKey, verifier.sealStartedAt),
  ]);

  const check = verifier.result();
  const report: AuditChainReport = {
    ...check,
    unsealed: unsealed.legacy,
    unsealedAfterSeal: unsealed.afterSeal,
  };
  if (!check.ok) return report;

  const headSeq = verifier.lastConsistentSeq;
  const headMatches =
    head === null
      ? headSeq === null
      : head.lastSeq === headSeq &&
        head.lastHash === verifier.lastConsistentHash;
  if (!headMatches) {
    return {
      ...report,
      ok: false,
      problem: 'head',
      firstMismatchSeq: (headSeq ?? 0n) + 1n,
    };
  }

  // A row with no seal that was written after the seal began skipped the only
  // write path, so the scope's history has a gap. Counting it as legacy would
  // let the gap grow while every run still passed (D-88).
  if (unsealed.afterSeal > 0) {
    return { ...report, ok: false, problem: 'unsealed' };
  }
  return report;
}

/**
 * Verifies every scope the store reports, in order. One failed scope does not
 * stop the run: the job reports all of them and fails afterwards.
 */
export async function verifyAllScopes(
  store: AuditChainStore,
  batchSize: number = DEFAULT_CHAIN_BATCH,
): Promise<AuditChainReport[]> {
  const scopes = await store.scopes();
  const reports: AuditChainReport[] = [];
  for (const scopeKey of scopes) {
    reports.push(await verifyScope(store, scopeKey, batchSize));
  }
  return reports;
}
