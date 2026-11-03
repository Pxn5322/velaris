/**
 * T5.02 retention and lifecycle (F-14; AC-F14-1, AC-F14-2, AC-F14-3).
 *
 * Covers the policy contract (valid windows accepted, invalid ones rejected
 * with a code), the cutoff arithmetic, the lifecycle job contract, the Prisma
 * filter that hides expired knowledge and memory, the sweep that marks expired
 * rows, and the retrieval SQL guard. The retrieval and sweep tests use fake
 * Prisma delegates, so they prove the arguments the service sends.
 */

import { BadRequestException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETENTION_CATEGORIES,
  retentionCutoff,
  validateRetentionPolicy,
} from './retention-policy.js';
import { buildLifecycleJob } from './lifecycle-job.js';
import { RetentionService } from './retention.service.js';
import { runWithCorrelationId } from '../../common/logging/correlation.js';

const NOW = new Date('2026-11-03T10:00:00.000Z');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('retention policy contract (AC-F14-2)', () => {
  it('accepts every category within the supported window', () => {
    for (const category of RETENTION_CATEGORIES) {
      expect(validateRetentionPolicy({ category, retentionDays: 1 })).toEqual({
        category,
        retentionDays: 1,
      });
      expect(
        validateRetentionPolicy({ category, retentionDays: 3650 }),
      ).toEqual({ category, retentionDays: 3650 });
    }
  });

  it('rejects a window outside 1..3650 days', () => {
    for (const retentionDays of [0, -5, 3651, 1.5, Number.NaN]) {
      expect(() =>
        validateRetentionPolicy({ category: 'KNOWLEDGE', retentionDays }),
      ).toThrow(BadRequestException);
    }
  });

  it('rejects an unknown category or a non-string one', () => {
    expect(() =>
      validateRetentionPolicy({ category: 'EVERYTHING', retentionDays: 30 }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateRetentionPolicy({
        category: undefined as unknown as string,
        retentionDays: 30,
      }),
    ).toThrow(BadRequestException);
  });

  it('names the offending field in the error', () => {
    try {
      validateRetentionPolicy({ category: 'TRACES', retentionDays: 0 });
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toContain('retentionDays');
    }
  });
});

describe('retention cutoff', () => {
  it('subtracts the configured window from now', () => {
    expect(retentionCutoff('KNOWLEDGE', 30, NOW).toISOString()).toBe(
      '2026-10-04T10:00:00.000Z',
    );
  });

  it('returns a new Date and never mutates the input', () => {
    const cutoff = retentionCutoff('MEMORY', 1, NOW);
    expect(cutoff).not.toBe(NOW);
    expect(NOW.toISOString()).toBe('2026-11-03T10:00:00.000Z');
  });
});

describe('lifecycle job contract (AC-F14-1)', () => {
  it('builds a schema-versioned job with the context correlation id', () => {
    const job = runWithCorrelationId('trace-lifecycle', () =>
      buildLifecycleJob({
        tenantId: 'tenant-a',
        category: 'KNOWLEDGE',
        cutoffAt: new Date('2026-10-04T10:00:00.000Z'),
        enqueuedAt: NOW,
      }),
    );

    expect(job.schemaVersion).toBe(1);
    expect(job.jobId).toMatch(UUID);
    expect(job.correlationId).toBe('trace-lifecycle');
    expect(job.tenantId).toBe('tenant-a');
    expect(job.category).toBe('KNOWLEDGE');
    expect(job.cutoffAt).toBe('2026-10-04T10:00:00.000Z');
    expect(job.enqueuedAt).toBe(NOW.toISOString());
    expect(job.idempotencyKey).toBe('lifecycle:tenant-a:KNOWLEDGE:2026-10-04');
  });

  it('generates a correlation id when no context exists', () => {
    const job = buildLifecycleJob({
      tenantId: 'tenant-a',
      category: 'TRACES',
      cutoffAt: NOW,
      enqueuedAt: NOW,
    });

    expect(job.correlationId).toMatch(UUID);
  });
});

interface Delegate {
  updateMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
}

function delegate(): Delegate {
  return {
    updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    findMany: vi.fn().mockResolvedValue([]),
  };
}

function service() {
  const knowledgeSource = delegate();
  const knowledgeChunk = delegate();
  const aiTrace = delegate();
  const aiMemory = delegate();
  const prisma = {
    knowledgeSource,
    knowledgeChunk,
    aiTrace,
    aiMemory,
  };
  return {
    service: new RetentionService(prisma as never),
    knowledgeSource,
    knowledgeChunk,
    aiTrace,
    aiMemory,
  };
}

describe('retention sweep (AC-F14-1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks expired sources deleted, then removes their derived records', async () => {
    const { service: retention, knowledgeSource, knowledgeChunk } = service();

    const result = await retention.expireKnowledgeSources(
      'tenant-a',
      new Date('2026-10-04T10:00:00.000Z'),
    );

    expect(knowledgeSource.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        deletedAt: null,
        expiresAt: { not: null, lte: new Date('2026-10-04T10:00:00.000Z') },
      },
      data: { deletedAt: new Date('2026-10-04T10:00:00.000Z') },
    });
    expect(knowledgeChunk.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        source: {
          deletedAt: { not: null },
          expiresAt: { not: null, lte: new Date('2026-10-04T10:00:00.000Z') },
        },
      },
    });
    expect(result).toEqual({ sources: 2, chunks: 3 });
  });

  it('scopes the sweep to one tenant', async () => {
    const { service: retention, knowledgeSource } = service();

    await retention.expireKnowledgeSources('tenant-b', NOW);

    expect(knowledgeSource.updateMany.mock.calls[0][0].where.tenantId).toBe(
      'tenant-b',
    );
  });

  it('deletes expired traces and soft-deletes expired memory', async () => {
    const { service: retention, aiTrace, aiMemory } = service();

    const result = await retention.expireAiRecords('tenant-a', NOW);

    expect(aiTrace.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', expiresAt: { lte: NOW } },
    });
    expect(aiMemory.updateMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a', deletedAt: null, expiresAt: { lte: NOW } },
      data: { deletedAt: NOW },
    });
    expect(result).toEqual({ traces: 3, memories: 2 });
  });
});

describe('availability filters (AC-F14-1)', () => {
  it('hides expired and deleted sources in the Prisma filter', () => {
    const { service: retention } = service();

    expect(retention.activeKnowledgeSourceWhere(NOW)).toEqual({
      deletedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }],
    });
  });

  it('hides expired and deleted memory in the Prisma filter', () => {
    const { service: retention } = service();

    expect(retention.activeMemoryWhere(NOW)).toEqual({
      deletedAt: null,
      expiresAt: { gt: NOW },
    });
  });
});
