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
  defaultRetentionDays,
  RETENTION_CATEGORIES,
  type RetentionCategory,
  validateRetentionPolicy,
} from './retention-policy.js';

export interface KnowledgeExpiryResult {
  sources: number;
  chunks: number;
}

export interface AiRecordExpiryResult {
  traces: number;
  memories: number;
}

/** One category as an administrator sees it (T6.06, AC-F14-2). */
export interface RetentionPolicyView {
  category: RetentionCategory;
  /** Effective window, or null when the category has no stored policy. */
  retentionDays: number | null;
  /** True when the window comes from a stored row, not a default. */
  configured: boolean;
}

export interface SetRetentionPolicyInput {
  tenantId: string;
  category: unknown;
  retentionDays: unknown;
  /** Identity-provider subject of the acting administrator. */
  updatedBy: string;
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

  /**
   * Every category with its effective window. A category without a row
   * reports `configured: false`, and only TRACES then has a number, so a
   * client can never mistake an unset KNOWLEDGE or MEMORY window for a value
   * the product chose.
   */
  async listPolicies(tenantId: string): Promise<RetentionPolicyView[]> {
    const rows = await this.prisma.retentionPolicy.findMany({
      where: { tenantId },
    });
    const stored = new Map(
      rows.map((row) => [row.category, row.retentionDays] as const),
    );
    return RETENTION_CATEGORIES.map((category) => {
      const retentionDays = stored.get(category);
      return {
        category,
        retentionDays: retentionDays ?? defaultRetentionDays(category),
        configured: retentionDays !== undefined,
      };
    });
  }

  /** Validate and store one window, replacing the row when it exists. */
  async setPolicy(
    input: SetRetentionPolicyInput,
  ): Promise<RetentionPolicyView> {
    const policy = validateRetentionPolicy({
      category: input.category,
      retentionDays: input.retentionDays,
    });
    const row = await this.prisma.retentionPolicy.upsert({
      where: {
        tenantId_category: {
          tenantId: input.tenantId,
          category: policy.category,
        },
      },
      create: {
        tenantId: input.tenantId,
        category: policy.category,
        retentionDays: policy.retentionDays,
        updatedBy: input.updatedBy,
      },
      update: {
        retentionDays: policy.retentionDays,
        updatedBy: input.updatedBy,
      },
    });
    return {
      category: row.category,
      retentionDays: row.retentionDays,
      configured: true,
    };
  }
}
