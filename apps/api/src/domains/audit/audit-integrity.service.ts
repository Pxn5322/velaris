/**
 * Audit chain verification (T6.10; D-60).
 *
 * D-60 runs integrity verification on a schedule, or by a manual or CI job
 * until a scheduler exists. `verify` walks one scope in chain order, then
 * compares the last accepted row with the recorded chain head. A head that
 * runs past the rows means the tail was lost; a head that lags the rows means
 * a row was appended without sealing the chain. Rows written before migration
 * 0025 carry no seal and are reported as `unsealed`, never as verified.
 *
 * This service only reads. It has no route: D-60 keeps verification out of
 * the tenant-facing API until the owner approves an operator surface.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import {
  ChainVerifier,
  type AuditActorSnapshot,
  type ChainCheck,
  type SealedAuditRow,
} from './audit-chain.js';

export const DEFAULT_CHAIN_BATCH = 500;

/** One scope's verification result, with the unsealed legacy rows counted. */
export interface AuditChainReport extends ChainCheck {
  unsealed: number;
}

type AuditEventRow = Prisma.AuditEventGetPayload<Record<string, never>>;

@Injectable()
export class AuditIntegrityService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async verify(
    scopeKey: string,
    options: { batchSize?: number } = {},
  ): Promise<AuditChainReport> {
    const batchSize = options.batchSize ?? DEFAULT_CHAIN_BATCH;
    const verifier = new ChainVerifier(scopeKey);
    let cursor: bigint | null = null;

    for (;;) {
      const rows = await this.prisma.auditEvent.findMany({
        where: {
          scopeKey,
          chainSeq: cursor === null ? { not: null } : { not: null, gt: cursor },
        },
        orderBy: { chainSeq: 'asc' },
        take: batchSize,
      });
      for (const row of rows) verifier.push(toSealedRow(row));
      if (rows.length < batchSize) break;
      cursor = rows[rows.length - 1].chainSeq as bigint;
    }

    const [head, unsealed] = await Promise.all([
      this.prisma.auditChain.findUnique({ where: { scopeKey } }),
      this.prisma.auditEvent.count({ where: { scopeKey, chainSeq: null } }),
    ]);

    const check = verifier.result();
    const headSeq = verifier.lastConsistentSeq;
    const headMatches =
      head === null
        ? headSeq === null
        : head.lastSeq === headSeq &&
          head.lastHash === verifier.lastConsistentHash;

    if (check.ok && headMatches) return { ...check, unsealed };
    if (!check.ok) return { ...check, unsealed };
    return {
      ...check,
      ok: false,
      unsealed,
      problem: 'head',
      firstMismatchSeq: (headSeq ?? 0n) + 1n,
    };
  }
}

function toSealedRow(row: AuditEventRow): SealedAuditRow {
  return {
    id: row.id,
    tenantId: row.tenantId,
    actorId: row.actorId,
    actorSnapshot: (row.actorSnapshot ?? null) as AuditActorSnapshot | null,
    snapshotVersion: row.snapshotVersion,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    metadata: row.metadataJson,
    requestId: row.requestId,
    createdAt: row.createdAt,
    chainSeq: row.chainSeq as bigint,
    prevHash: row.prevHash,
    eventHash: row.eventHash as string,
  };
}
