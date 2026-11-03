/**
 * Retention sweep (T5.02; F-14; AC-F14-1).
 *
 * Two layers keep an expired record unavailable:
 * 1. Availability filters on read, so an expiry takes effect at the stated
 *    instant and not only when a sweep happens to run.
 * 2. This sweep, which marks expired sources deleted, removes their chunks
 *    (embeddings cascade with the chunk), deletes expired traces and
 *    soft-deletes expired memory.
 *
 * A source is soft-deleted first: the chunk delete then scopes to sources
 * that are both deleted and expired, so an unrelated soft delete keeps its
 * chunks for review. Every query is tenant-scoped.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import {
  activeKnowledgeSourceWhere,
  activeMemoryWhere,
} from './retention-policy.js';

export interface KnowledgeExpiryResult {
  sources: number;
  chunks: number;
}

export interface AiRecordExpiryResult {
  traces: number;
  memories: number;
}

@Injectable()
export class RetentionService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Sources that are still available to retrieval and listing. */
  activeKnowledgeSourceWhere(now: Date = new Date()) {
    return activeKnowledgeSourceWhere(now);
  }

  /** Memory rows that are still available. */
  activeMemoryWhere(now: Date = new Date()) {
    return activeMemoryWhere(now);
  }

  /** Expire knowledge sources and delete their derived chunks. */
  async expireKnowledgeSources(
    tenantId: string,
    cutoff: Date,
  ): Promise<KnowledgeExpiryResult> {
    const expiry = { not: null, lte: cutoff };
    const sources = await this.prisma.knowledgeSource.updateMany({
      where: { tenantId, deletedAt: null, expiresAt: expiry },
      data: { deletedAt: cutoff },
    });
    const chunks = await this.prisma.knowledgeChunk.deleteMany({
      where: {
        tenantId,
        source: { deletedAt: { not: null }, expiresAt: expiry },
      },
    });
    return { sources: sources.count, chunks: chunks.count };
  }

  /** Delete expired AI traces and soft-delete expired memory. */
  async expireAiRecords(
    tenantId: string,
    now: Date,
  ): Promise<AiRecordExpiryResult> {
    const traces = await this.prisma.aiTrace.deleteMany({
      where: { tenantId, expiresAt: { lte: now } },
    });
    const memories = await this.prisma.aiMemory.updateMany({
      where: { tenantId, deletedAt: null, expiresAt: { lte: now } },
      data: { deletedAt: now },
    });
    return { traces: traces.count, memories: memories.count };
  }
}
