/**
 * Prisma reader for audit chain verification (T6.10; D-60).
 *
 * One adapter serves the API service and the runnable verification job, so a
 * scheduled check and a manual run page the chain, read the head and count the
 * unsealed rows the same way. The module imports types only, so the job loads
 * it with Node's type stripping and no Nest dependency.
 */

import type { PrismaClient } from '@prisma/client';
import type {
  AuditActorSnapshot,
  AuditChainHead,
  AuditChainStore,
  SealedAuditRow,
} from './audit-chain.js';

type ChainClient = Pick<PrismaClient, 'auditEvent' | 'auditChain'>;

export function auditChainStore(prisma: ChainClient): AuditChainStore {
  return {
    async sealedRows(
      scopeKey: string,
      afterSeq: bigint | null,
      take: number,
    ): Promise<SealedAuditRow[]> {
      const rows = await prisma.auditEvent.findMany({
        where: {
          scopeKey,
          chainSeq:
            afterSeq === null ? { not: null } : { not: null, gt: afterSeq },
        },
        orderBy: { chainSeq: 'asc' },
        take,
      });
      return rows.map((row) => ({
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
      }));
    },

    async chainHead(scopeKey: string): Promise<AuditChainHead | null> {
      const head = await prisma.auditChain.findUnique({ where: { scopeKey } });
      return head
        ? { lastSeq: head.lastSeq, lastHash: head.lastHash ?? null }
        : null;
    },

    async unsealedCount(scopeKey: string): Promise<number> {
      return prisma.auditEvent.count({ where: { scopeKey, chainSeq: null } });
    },

    async scopes(): Promise<string[]> {
      // A scope with only pre-migration rows has no head, and a scope whose
      // rows were dropped still has one. Both are checked.
      const [rows, heads] = await Promise.all([
        prisma.auditEvent.findMany({
          distinct: ['scopeKey'],
          select: { scopeKey: true },
        }),
        prisma.auditChain.findMany({ select: { scopeKey: true } }),
      ]);
      return [
        ...new Set([...rows, ...heads].map((row) => row.scopeKey)),
      ].sort();
    },
  };
}
