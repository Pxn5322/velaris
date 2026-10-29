/**
 * T3.04 permission-aware retrieval (AC-F07-3, AC-F09-1, TH-01, TH-05).
 *
 * The retrieval service is what the AI orchestrator will call to ground
 * an answer. These tests pin the boundary the acceptance criteria name:
 *
 * 1. Deny by default: a principal without the knowledge permission is
 *    refused before any database query runs (AC-F07-3, TH-02).
 * 2. Tenant scope: the query is parameterized with the caller's tenant
 *    and chunks of other tenants never come back (TH-01).
 * 3. Source eligibility: only READY, non-deleted sources contribute
 *    chunks, so failed or deleted knowledge stops being retrievable
 *    (TH-12).
 * 4. Citations: every hit carries provenance (source id/type/origin,
 *    chunk index, model, score) so a grounded answer can cite it
 *    (AC-F09-1).
 *
 * The pgvector similarity query runs through raw SQL because Prisma types
 * the vector column as Unsupported; the fake below behaves like a
 * compliant database (it honours the same WHERE filters the SQL states)
 * and the spec also asserts those filters are present in the SQL text.
 */

import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { KnowledgeRetrievalService } from './knowledge-retrieval.service.js';

type SourceRow = {
  id: string;
  tenantId: string;
  sourceType: string;
  status: string;
  deletedAt: Date | null;
  provenanceJson: Record<string, unknown>;
};

type ChunkRow = {
  id: string;
  tenantId: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
};

type EmbeddingRow = {
  chunkId: string;
  tenantId: string;
  model: string;
  vector: number[];
};

function sourceRow(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'src-a',
    tenantId: 'tenant-a',
    sourceType: 'MARKDOWN',
    status: 'READY',
    deletedAt: null,
    provenanceJson: { sourceUri: 'https://example.test/docs' },
    ...overrides,
  };
}

function chunkRow(overrides: Partial<ChunkRow> = {}): ChunkRow {
  return {
    id: 'chunk-a',
    tenantId: 'tenant-a',
    sourceId: 'src-a',
    chunkIndex: 0,
    content: 'Reset the password in the admin panel.',
    ...overrides,
  };
}

/** Cosine similarity, matching the ORDER BY the real SQL performs. */
function cosine(a: number[], b: number[]): number {
  const dot = a.reduce((sum, value, i) => sum + value * b[i]!, 0);
  const normA = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const normB = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  return normA === 0 || normB === 0 ? 0 : dot / (normA * normB);
}

function fakePrisma(
  sources: SourceRow[],
  chunks: ChunkRow[],
  embeddings: EmbeddingRow[],
) {
  const sqlCalls: { text: string; values: unknown[] }[] = [];
  return {
    $queryRaw: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      // Bound-parameter order of the real SQL: score vector, tenant,
      // model, order-by vector, limit.
      const vectorLiteral = values[0] as string;
      const tenantId = values[1] as string;
      const model = values[2] as string;
      const limit = values[4] as number;
      sqlCalls.push({ text: strings.join('?'), values });
      const queryVector = JSON.parse(vectorLiteral) as number[];
      const rows = chunks
        .filter((chunk) => chunk.tenantId === tenantId)
        .map((chunk) => {
          const source = sources.find((s) => s.id === chunk.sourceId);
          const embedding = embeddings.find(
            (e) => e.chunkId === chunk.id && e.model === model,
          );
          return { chunk, source, embedding };
        })
        .filter(
          ({ source, embedding }) =>
            source !== undefined &&
            source.tenantId === tenantId &&
            source.status === 'READY' &&
            source.deletedAt === null &&
            embedding !== undefined,
        )
        .map(({ chunk, source, embedding }) => ({
          chunk_id: chunk.id,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          source_id: source!.id,
          source_type: source!.sourceType,
          provenance_json: source!.provenanceJson,
          model: embedding!.model,
          score: cosine(embedding!.vector, queryVector),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return Promise.resolve(rows);
    }),
    _sql: sqlCalls,
  };
}

function makeService(prisma: ReturnType<typeof fakePrisma>) {
  const embeddings = {
    model: 'local-hash-v1',
    dimensions: 1536,
    embed: vi.fn(async (text: string) => {
      // Deterministic pseudo-vector derived from the text length keeps
      // assertions simple while still going through the port.
      const base = (text.length % 7) + 1;
      return Array.from({ length: 8 }, (_, i) => base * (i + 1));
    }),
  };
  const service = new KnowledgeRetrievalService(
    prisma as unknown as PrismaService,
    new AuthorizationService(),
    embeddings as never,
  );
  return { service, embeddings };
}

describe('KnowledgeRetrievalService (T3.04)', () => {
  let prisma: ReturnType<typeof fakePrisma>;

  beforeEach(() => {
    prisma = fakePrisma(
      [sourceRow()],
      [chunkRow()],
      [
        {
          chunkId: 'chunk-a',
          tenantId: 'tenant-a',
          model: 'local-hash-v1',
          vector: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      ],
    );
  });

  it('refuses a principal without the knowledge permission before querying (AC-F07-3)', async () => {
    const { service, embeddings } = makeService(prisma);

    for (const role of [
      null,
      'R-agent',
      'R-customer',
    ] as (CanonicalRole | null)[]) {
      await expect(
        service.search({ tenantId: 'tenant-a', role, query: 'password' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(embeddings.embed).not.toHaveBeenCalled();
  });

  it('returns authorized chunks with citation provenance (AC-F09-1)', async () => {
    const { service } = makeService(prisma);

    const hits = await service.search({
      tenantId: 'tenant-a',
      role: 'R-tenant-admin',
      query: 'how do I reset the password',
    });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      chunkId: 'chunk-a',
      chunkIndex: 0,
      content: 'Reset the password in the admin panel.',
      citation: {
        sourceId: 'src-a',
        sourceType: 'MARKDOWN',
        model: 'local-hash-v1',
      },
    });
    expect(hits[0]!.citation.provenance).toMatchObject({
      sourceUri: 'https://example.test/docs',
    });
    expect(hits[0]!.score).toBeTypeOf('number');
  });

  it('parameterizes the query with the caller tenant and states the filters in SQL (TH-01)', async () => {
    const { service } = makeService(prisma);

    await service.search({
      tenantId: 'tenant-a',
      role: 'R-tenant-admin',
      query: 'password',
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    const call = prisma._sql[0]!;
    expect(call.values).toContain('tenant-a');
    expect(call.text).toContain('c.tenant_id =');
    expect(call.text).toContain("s.status = 'READY'");
    expect(call.text).toContain('s.deleted_at IS NULL');
  });

  it('excludes chunks whose source is not READY or is soft-deleted (TH-12)', async () => {
    const p = fakePrisma(
      [
        sourceRow({ id: 'src-failed', status: 'FAILED' }),
        sourceRow({ id: 'src-gone', deletedAt: new Date() }),
      ],
      [
        chunkRow({ id: 'chunk-failed', sourceId: 'src-failed' }),
        chunkRow({ id: 'chunk-gone', sourceId: 'src-gone' }),
      ],
      [
        {
          chunkId: 'chunk-failed',
          tenantId: 'tenant-a',
          model: 'local-hash-v1',
          vector: [1, 2, 3, 4, 5, 6, 7, 8],
        },
        {
          chunkId: 'chunk-gone',
          tenantId: 'tenant-a',
          model: 'local-hash-v1',
          vector: [1, 2, 3, 4, 5, 6, 7, 8],
        },
      ],
    );
    const { service } = makeService(p);

    const hits = await service.search({
      tenantId: 'tenant-a',
      role: 'R-tenant-admin',
      query: 'password',
    });

    expect(hits).toHaveLength(0);
  });

  it('never returns another tenant chunks for a tenant-a caller (TH-01)', async () => {
    const p = fakePrisma(
      [sourceRow(), sourceRow({ id: 'src-b', tenantId: 'tenant-b' })],
      [
        chunkRow(),
        chunkRow({
          id: 'chunk-b',
          tenantId: 'tenant-b',
          sourceId: 'src-b',
          content: 'tenant B secret',
        }),
      ],
      [
        {
          chunkId: 'chunk-a',
          tenantId: 'tenant-a',
          model: 'local-hash-v1',
          vector: [1, 2, 3, 4, 5, 6, 7, 8],
        },
        {
          chunkId: 'chunk-b',
          tenantId: 'tenant-b',
          model: 'local-hash-v1',
          vector: [9, 9, 9, 9, 9, 9, 9, 9],
        },
      ],
    );
    const { service } = makeService(p);

    const hits = await service.search({
      tenantId: 'tenant-a',
      role: 'R-tenant-admin',
      query: 'password',
    });

    expect(hits.map((hit) => hit.chunkId)).toEqual(['chunk-a']);
    expect(hits.some((hit) => hit.content.includes('tenant B secret'))).toBe(
      false,
    );
  });

  it('rejects a missing tenant scope or empty query (400)', async () => {
    const { service } = makeService(prisma);

    await expect(
      service.search({ tenantId: '', role: 'R-tenant-admin', query: 'x' }),
    ).rejects.toThrow('tenantId is required');
    await expect(
      service.search({
        tenantId: 'tenant-a',
        role: 'R-tenant-admin',
        query: ' ',
      }),
    ).rejects.toThrow('query is required');
  });

  it('rejects a limit outside the allowed page size (400)', async () => {
    const { service } = makeService(prisma);

    await expect(
      service.search({
        tenantId: 'tenant-a',
        role: 'R-tenant-admin',
        query: 'password',
        limit: 0,
      }),
    ).rejects.toThrow('limit must be between');
    await expect(
      service.search({
        tenantId: 'tenant-a',
        role: 'R-tenant-admin',
        query: 'password',
        limit: 51,
      }),
    ).rejects.toThrow('limit must be between');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('applies the requested page size and the embedding model filter', async () => {
    const { service } = makeService(prisma);

    await service.search({
      tenantId: 'tenant-a',
      role: 'R-tenant-admin',
      query: 'password',
      limit: 5,
    });

    const call = prisma._sql[0]!;
    expect(call.values).toContain(5);
    expect(call.values).toContain('local-hash-v1');
  });
});
