/**
 * T3.03 async ingestion pipeline (AC-F07-1, AC-F07-2, TH-11).
 *
 * The ingestion service is the worker-side engine: it claims a PENDING
 * knowledge source through a tenant-scoped job, parses and chunks the
 * content, writes chunks plus pgvector embeddings, and records READY or
 * FAILED status. What these tests pin:
 *
 * 1. Tenant context (job metadata): every read and write carries the
 *    job's tenantId; a job that names another tenant's source touches no
 *    row (TH-01).
 * 2. Tenant status recheck at job execution: a disabled tenant fails the
 *    job with TENANT_DISABLED instead of ingesting (TH-11).
 * 3. Retry: transient failures retry up to a bounded attempt count with
 *    backoff, then land FAILED with RETRY_EXHAUSTED (AC-F07-2).
 * 4. Permanent failures (source reference that needs the not-yet
 *    configured crawler/object storage, unparseable content) fail once
 *    with a specific error code and no retry.
 * 5. Happy path: PENDING -> PROCESSING -> READY with chunks and
 *    embeddings recorded for the source's tenant (AC-F07-1), replacing
 *    any previous chunks for that source instead of duplicating them.
 *
 * The embedding provider is the local deterministic port implementation:
 * D-07 (provider selection) is still Unknown, so no network call happens.
 * Synthetic tenant A/B data only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestionJob } from './ingestion-types.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { KnowledgeIngestionService } from './knowledge-ingestion.service.js';

type SourceRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  sourceType: string;
  status: string;
  errorCode: string | null;
  provenanceJson: Record<string, unknown>;
  deletedAt: Date | null;
};

function sourceRow(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'src-1',
    tenantId: 'tenant-a',
    sourceType: 'MARKDOWN',
    status: 'PENDING',
    errorCode: null,
    provenanceJson: { content: '# Runbook\n\nReset the password here.' },
    deletedAt: null,
    ...overrides,
  };
}

function job(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    idempotencyKey: 'ingest:src-1',
    correlationId: 'corr-1',
    tenantId: 'tenant-a',
    sourceId: 'src-1',
    actorId: 'user-1',
    enqueuedAt: new Date().toISOString(),
    ...overrides,
  };
}

function fakePrisma(sources: SourceRow[] = [], tenantStatus = 'ACTIVE') {
  const chunkStore: Record<string, unknown>[] = [];
  const embedInserts: unknown[][] = [];
  let chunkCounter = 0;
  return {
    knowledgeSource: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; tenantId: string; deletedAt: null };
        }) =>
          sources.find(
            (row) =>
              row.id === where.id &&
              row.tenantId === where.tenantId &&
              row.deletedAt === where.deletedAt,
          ) ?? null,
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = sources.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return row;
        },
      ),
    },
    knowledgeChunk: {
      deleteMany: vi.fn(async ({ where }: { where: { sourceId: string } }) => {
        const before = chunkStore.length;
        for (let i = chunkStore.length - 1; i >= 0; i--) {
          if (chunkStore[i].sourceId === where.sourceId) {
            chunkStore.splice(i, 1);
          }
        }
        return { count: before - chunkStore.length };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const duplicate = chunkStore.find(
          (row) =>
            row.sourceId === data.sourceId &&
            row.chunkIndex === data.chunkIndex,
        );
        if (duplicate) {
          throw new Error('unique violation on (source_id, chunk_index)');
        }
        const row = { id: 'chunk-' + ++chunkCounter, ...data };
        chunkStore.push(row);
        return row;
      }),
    },
    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'tenant-a' || where.id === 'tenant-b'
          ? { id: where.id, status: tenantStatus }
          : null,
      ),
    },
    // Vector writes go through SQL because Prisma types the column as
    // Unsupported("vector(1536)"); the fake captures the bound values.
    $executeRaw: vi.fn(
      async (_strings: TemplateStringsArray, ...values: unknown[]) => {
        embedInserts.push(values);
        return 1;
      },
    ),
    _sources: sources,
    _chunks: chunkStore,
    _embeddings: embedInserts,
  };
}

function makeService(
  prisma: ReturnType<typeof fakePrisma>,
  overrides: Partial<{ backoffMs: number; maxAttempts: number }> = {},
) {
  const service = new KnowledgeIngestionService(
    prisma as unknown as PrismaService,
  );
  service.backoffMs = overrides.backoffMs ?? 0;
  if (overrides.maxAttempts !== undefined) {
    service.maxAttempts = overrides.maxAttempts;
  }
  return service;
}

describe('KnowledgeIngestionService (T3.03)', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: KnowledgeIngestionService;

  beforeEach(() => {
    prisma = fakePrisma();
    service = makeService(prisma);
  });

  describe('happy path (AC-F07-1)', () => {
    it('moves a PENDING text source to READY with chunks and embeddings', async () => {
      const source = sourceRow();
      prisma._sources.push(source);

      const outcome = await service.run(job());

      expect(outcome.status).toBe('READY');
      expect(outcome.attempts).toBe(1);
      expect(source.status).toBe('READY');
      expect(source.errorCode).toBeNull();
      expect(prisma._chunks.length).toBeGreaterThan(0);
      expect(prisma._chunks[0]).toMatchObject({
        tenantId: 'tenant-a',
        sourceId: 'src-1',
        chunkIndex: 0,
      });
      expect(prisma._embeddings.length).toBe(prisma._chunks.length);
    });

    it('records PROCESSING before the work starts (durable job state)', async () => {
      const source = sourceRow();
      prisma._sources.push(source);
      const statuses: unknown[] = [];
      prisma.knowledgeSource.update.mockImplementation(
        async ({
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          statuses.push(data.status);
          Object.assign(source, data);
          return source;
        },
      );

      await service.run(job());

      expect(statuses).toEqual(['PROCESSING', 'READY']);
    });
  });

  describe('tenant context (job metadata, TH-01)', () => {
    it('touches no row when the job names a source of another tenant', async () => {
      const foreign = sourceRow({ id: 'src-b', tenantId: 'tenant-b' });
      prisma._sources.push(foreign);

      const outcome = await service.run(
        job({ sourceId: 'src-b', idempotencyKey: 'ingest:src-b' }),
      );

      expect(outcome.status).toBe('SKIPPED');
      expect(foreign.status).toBe('PENDING');
      expect(prisma.knowledgeSource.update).not.toHaveBeenCalled();
      expect(prisma.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('skips a source that no longer exists (deleted or unknown id)', async () => {
      const outcome = await service.run(job());

      expect(outcome.status).toBe('SKIPPED');
      expect(prisma.knowledgeSource.update).not.toHaveBeenCalled();
    });
  });

  describe('tenant status recheck at execution (TH-11)', () => {
    it('fails with TENANT_DISABLED when the tenant is not ACTIVE', async () => {
      const source = sourceRow();
      const p = fakePrisma([source], 'SUSPENDED');
      const s = makeService(p);

      const outcome = await s.run(job());

      expect(outcome.status).toBe('FAILED');
      expect(outcome.errorCode).toBe('TENANT_DISABLED');
      expect(source.status).toBe('FAILED');
      expect(p.knowledgeChunk.create).not.toHaveBeenCalled();
      expect(p.$executeRaw).not.toHaveBeenCalled();
    });

    it('fails with TENANT_DISABLED when the tenant row is gone', async () => {
      // Defensive path: the foreign key should guarantee the row, but a
      // job must never proceed on an unresolvable tenant (TH-11).
      const source = sourceRow({ id: 'src-x', tenantId: 'tenant-gone' });
      const p = fakePrisma([source]);
      const s = makeService(p);

      const outcome = await s.run(
        job({ sourceId: 'src-x', tenantId: 'tenant-gone' }),
      );

      expect(outcome.status).toBe('FAILED');
      expect(outcome.errorCode).toBe('TENANT_DISABLED');
      expect(source.status).toBe('FAILED');
      expect(p.knowledgeChunk.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('permanent failures (AC-F07-2, no retry)', () => {
    it('fails once with FETCH_NOT_CONFIGURED for a source that needs the crawler', async () => {
      const source = sourceRow({
        sourceType: 'WEBSITE',
        provenanceJson: { sourceUri: 'https://example.test/docs' },
      });
      const p = fakePrisma([source]);
      const s = makeService(p);

      const outcome = await s.run(job());

      expect(outcome.status).toBe('FAILED');
      expect(outcome.errorCode).toBe('FETCH_NOT_CONFIGURED');
      expect(outcome.attempts).toBe(1);
      expect(source.status).toBe('FAILED');
      expect(p.knowledgeSource.update).toHaveBeenCalledTimes(2); // PROCESSING, FAILED
    });

    it('fails with PARSE_FAILED when the stored content is empty', async () => {
      const source = sourceRow({ provenanceJson: { content: '   ' } });
      const p = fakePrisma([source]);
      const s = makeService(p);

      const outcome = await s.run(job());

      expect(outcome.status).toBe('FAILED');
      expect(outcome.errorCode).toBe('PARSE_FAILED');
      expect(p.knowledgeChunk.create).not.toHaveBeenCalled();
    });
  });

  describe('transient retry (AC-F07-2)', () => {
    it('retries a transient embedding failure and succeeds on the next attempt', async () => {
      const source = sourceRow();
      const p = fakePrisma([source]);
      const s = makeService(p);
      const original = s.embeddingProvider.embed.bind(s.embeddingProvider);
      let calls = 0;
      s.embeddingProvider.embed = vi.fn(async (text: string) => {
        calls += 1;
        if (calls === 1) {
          throw new Error('provider rate limit');
        }
        return original(text);
      });

      const outcome = await s.run(job());

      expect(outcome.status).toBe('READY');
      expect(outcome.attempts).toBe(2);
      expect(calls).toBe(2);
    });

    it('fails with RETRY_EXHAUSTED after the bounded attempt count', async () => {
      const source = sourceRow();
      const p = fakePrisma([source]);
      const s = makeService(p, { maxAttempts: 3 });
      s.embeddingProvider.embed = vi
        .fn()
        .mockRejectedValue(new Error('provider down'));

      const outcome = await s.run(job());

      expect(outcome.status).toBe('FAILED');
      expect(outcome.errorCode).toBe('RETRY_EXHAUSTED');
      expect(outcome.attempts).toBe(3);
      expect(s.embeddingProvider.embed).toHaveBeenCalledTimes(3);
      expect(source.status).toBe('FAILED');
      expect(p.knowledgeChunk.create).not.toHaveBeenCalled();
    });
  });

  describe('chunking long documents', () => {
    it('splits into overlapping windows with unique chunk indexes', async () => {
      const longContent = Array.from(
        { length: 300 },
        (_, i) => `word${i}`,
      ).join(' ');
      const source = sourceRow({ provenanceJson: { content: longContent } });
      const p = fakePrisma([source]);
      const s = makeService(p);

      const outcome = await s.run(job());

      expect(outcome.status).toBe('READY');
      expect(p._chunks).toHaveLength(3);
      const indexes = p._chunks.map((row) => row.chunkIndex);
      expect(new Set(indexes).size).toBe(indexes.length);
      expect(indexes).toEqual([0, 1, 2]);
      expect(p._embeddings).toHaveLength(3);
      // Overlap: consecutive windows share words.
      const first = String(p._chunks[0]!.content).split(' ');
      const second = String(p._chunks[1]!.content).split(' ');
      expect(second[0]).toBe(first[100]);
    });
  });

  describe('re-ingestion replaces instead of duplicating', () => {
    it('drops previous chunks of the source before writing new ones', async () => {
      const source = sourceRow({ status: 'READY' });
      const p = fakePrisma([source]);
      p._chunks.push({
        id: 'chunk-old',
        sourceId: 'src-1',
        chunkIndex: 0,
        content: 'stale',
      });
      const s = makeService(p);

      const outcome = await s.run(job());

      expect(outcome.status).toBe('READY');
      expect(p.knowledgeChunk.deleteMany).toHaveBeenCalledWith({
        where: { sourceId: 'src-1' },
      });
      expect(p._chunks.filter((row) => row.id === 'chunk-old')).toHaveLength(0);
      expect(p._chunks.filter((row) => row.chunkIndex === 0)).toHaveLength(1);
    });
  });
});
