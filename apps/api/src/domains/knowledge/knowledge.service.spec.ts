/**
 * T3.02 knowledge source validation and ingestion status (AC-F07-1,
 * AC-F07-2).
 *
 * The service owns two things the acceptance criteria name:
 * 1. Source reference validation: a malformed or unsupported reference is
 *    refused before any row is written (400), and oversized inline content
 *    is refused with 413, which is what API-08 documents.
 * 2. Ingestion status: a created source starts PENDING with provenance,
 *    a failed source reports its error code through findOne, and
 *    resubmitting identical content resets a FAILED source to PENDING so
 *    retry is possible (AC-F07-2). Identical content that already ingested
 *    is idempotent: the unique (tenant, type, hash) identity returns the
 *    existing row instead of creating a duplicate.
 *
 * Synthetic tenant A data only; the Prisma layer is an in-memory fake.
 */

import {
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { KnowledgeService } from './knowledge.service.js';

type SourceRow = Record<string, unknown> & {
  id: string;
  tenantId: string;
  sourceType: string;
  contentHash: string;
  status: string;
  errorCode: string | null;
  deletedAt: Date | null;
};

function sourceRow(overrides: Partial<SourceRow> = {}): SourceRow {
  return {
    id: 'src-1',
    tenantId: 'tenant-a',
    sourceType: 'WEBSITE',
    sourceUri: 'https://example.test/docs',
    objectKey: null,
    status: 'PENDING',
    contentHash: 'sha256:abc',
    provenanceJson: {},
    errorCode: null,
    createdBy: 'user-1',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function fakePrisma(rows: SourceRow[] = []) {
  const store = [...rows];
  let counter = 0;
  let failNextCreate: string | null = null;
  return {
    knowledgeSource: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            tenantId?: string;
            sourceType?: string;
            contentHash?: string;
            deletedAt: null;
          };
        }) =>
          store.find(
            (row) =>
              (where.id === undefined || row.id === where.id) &&
              (where.tenantId === undefined ||
                row.tenantId === where.tenantId) &&
              (where.sourceType === undefined ||
                row.sourceType === where.sourceType) &&
              (where.contentHash === undefined ||
                row.contentHash === where.contentHash) &&
              (where.deletedAt === undefined ||
                row.deletedAt === where.deletedAt),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (failNextCreate) {
          const code = failNextCreate;
          failNextCreate = null;
          throw Object.assign(new Error('Unique constraint failed'), {
            code,
          });
        }
        const row = {
          id: 'src-new-' + ++counter,
          status: 'PENDING',
          errorCode: null,
          provenanceJson: {},
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        } as unknown as SourceRow;
        store.push(row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = store.find((r) => r.id === where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        },
      ),
    },
    /** Make the next create() throw a Prisma error with this code. */
    _failNextCreate(code: string) {
      failNextCreate = code;
    },
    _store: store,
  };
}

describe('KnowledgeService (T3.02)', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: KnowledgeService;

  beforeEach(() => {
    prisma = fakePrisma();
    service = new KnowledgeService(prisma as unknown as PrismaService);
  });

  describe('source reference validation (AC-F07-2 invalid path)', () => {
    it('rejects a missing or unsupported source type (400)', async () => {
      await expect(
        service.create('tenant-a', { sourceType: 'VIDEO' } as never, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create('tenant-a', {} as never, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.knowledgeSource.create).not.toHaveBeenCalled();
    });

    it('rejects a create without a tenant scope (400)', async () => {
      await expect(
        service.create('', { sourceType: 'WEBSITE' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a WEBSITE source without an http(s) URL (400)', async () => {
      await expect(
        service.create('tenant-a', { sourceType: 'WEBSITE' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(
          'tenant-a',
          { sourceType: 'WEBSITE', sourceUri: 'ftp://example.test/x' },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create(
          'tenant-a',
          { sourceType: 'WEBSITE', sourceUri: 'not a url' },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.knowledgeSource.create).not.toHaveBeenCalled();
    });

    it('rejects a PDF source without an uploaded object reference (400)', async () => {
      await expect(
        service.create('tenant-a', { sourceType: 'PDF' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      const created = await service.create(
        'tenant-a',
        { sourceType: 'PDF', objectKey: 'uploads/manual.pdf' },
        'user-1',
      );
      expect(created.source.status).toBe('PENDING');
    });

    it('rejects an inline-text source without content (400)', async () => {
      for (const sourceType of ['MARKDOWN', 'FAQ', 'MANUAL'] as const) {
        await expect(
          service.create('tenant-a', { sourceType }, 'user-1'),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          service.create('tenant-a', { sourceType, content: '   ' }, 'user-1'),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it('rejects a HISTORY source with no reference at all (400)', async () => {
      await expect(
        service.create('tenant-a', { sourceType: 'HISTORY' }, 'user-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a HISTORY source referenced by URL or object key', async () => {
      const byUri = await service.create(
        'tenant-a',
        { sourceType: 'HISTORY', sourceUri: 'https://archive.test/tickets' },
        'user-1',
      );
      expect(byUri.source.status).toBe('PENDING');

      const byObject = await service.create(
        'tenant-a',
        { sourceType: 'HISTORY', objectKey: 'archive/2025-export.json' },
        'user-1',
      );
      expect(byObject.source.status).toBe('PENDING');
      expect(byObject.source.provenanceJson).toMatchObject({
        objectKey: 'archive/2025-export.json',
      });
    });

    it('rejects oversized inline content with 413', async () => {
      const oversized = 'x'.repeat(64 * 1024 + 1);
      await expect(
        service.create(
          'tenant-a',
          { sourceType: 'MARKDOWN', content: oversized },
          'user-1',
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException);
      expect(prisma.knowledgeSource.create).not.toHaveBeenCalled();
    });
  });

  describe('ingestion status (AC-F07-1 happy path)', () => {
    it('creates a PENDING source with provenance and a content hash', async () => {
      const { source, retried } = await service.create(
        'tenant-a',
        { sourceType: 'WEBSITE', sourceUri: 'https://example.test/docs' },
        'user-1',
      );

      expect(source.status).toBe('PENDING');
      expect(retried).toBe(false);
      expect(String(source.contentHash)).toMatch(/^sha256:/);
      expect(source.provenanceJson).toMatchObject({
        sourceUri: 'https://example.test/docs',
      });
      expect(source.tenantId).toBe('tenant-a');
    });

    it('uses a caller-supplied content hash when provided (idempotency key)', async () => {
      const { source } = await service.create(
        'tenant-a',
        {
          sourceType: 'PDF',
          objectKey: 'uploads/manual.pdf',
          contentHash: 'sha256:deadbeef',
        },
        'user-1',
      );
      expect(source.contentHash).toBe('sha256:deadbeef');
    });
  });

  describe('idempotent resubmission and retry (AC-F07-2)', () => {
    it('returns the existing source instead of creating a duplicate', async () => {
      const body = {
        sourceType: 'WEBSITE',
        sourceUri: 'https://example.test/docs',
      } as const;
      const first = await service.create('tenant-a', body, 'user-1');
      const second = await service.create('tenant-a', body, 'user-1');

      expect(second.source.id).toBe(first.source.id);
      expect(second.retried).toBe(false);
      expect(prisma.knowledgeSource.create).toHaveBeenCalledTimes(1);
    });

    it('resets a FAILED source to PENDING on resubmission (retry possible)', async () => {
      const body = {
        sourceType: 'MARKDOWN',
        content: '# Runbook',
      } as const;
      const first = await service.create('tenant-a', body, 'user-1');
      prisma._store[0]!.status = 'FAILED';
      prisma._store[0]!.errorCode = 'FETCH_FAILED';

      const retry = await service.create('tenant-a', body, 'user-1');

      expect(retry.retried).toBe(true);
      expect(retry.source.id).toBe(first.source.id);
      expect(retry.source.status).toBe('PENDING');
      expect(retry.source.errorCode).toBeNull();
      expect(prisma.knowledgeSource.create).toHaveBeenCalledTimes(1);
    });

    it('reports a lost create race through the existing row, not a 500', async () => {
      prisma._store.push(
        sourceRow({ id: 'src-existing', contentHash: 'sha256:raced' }),
      );
      // The duplicate check runs before the concurrent row is visible, so
      // the create hits the unique constraint and the re-fetch finds it.
      prisma.knowledgeSource.findFirst.mockImplementationOnce(async () => null);
      prisma._failNextCreate('P2002');

      const result = await service.create(
        'tenant-a',
        {
          sourceType: 'WEBSITE',
          sourceUri: 'https://example.test/docs',
          contentHash: 'sha256:raced',
        },
        'user-1',
      );

      expect(result.source.id).toBe('src-existing');
      expect(result.retried).toBe(false);
    });

    it('rethrows a database failure that is not a duplicate conflict', async () => {
      prisma._failNextCreate('P1008');
      await expect(
        service.create(
          'tenant-a',
          { sourceType: 'WEBSITE', sourceUri: 'https://example.test/x' },
          'user-1',
        ),
      ).rejects.toThrow('Unique constraint failed');
    });

    it('rethrows a duplicate conflict whose winner row has vanished', async () => {
      // Unique violation raised, but the re-fetch finds no row (the
      // concurrent source was deleted): the failure must surface.
      prisma._failNextCreate('P2002');
      await expect(
        service.create(
          'tenant-a',
          { sourceType: 'WEBSITE', sourceUri: 'https://example.test/gone' },
          'user-1',
        ),
      ).rejects.toThrow('Unique constraint failed');
    });
  });

  describe('status reporting (API-09)', () => {
    it('returns the source with status, error code and provenance', async () => {
      prisma._store.push(
        sourceRow({
          id: 'src-failed',
          status: 'FAILED',
          errorCode: 'UNSUPPORTED_MEDIA',
        }),
      );

      const found = await service.findOne('src-failed', 'tenant-a');
      expect(found.status).toBe('FAILED');
      expect(found.errorCode).toBe('UNSUPPORTED_MEDIA');
      expect(found.provenanceJson).toBeDefined();
    });

    it('reports an unknown or foreign source as not found (404)', async () => {
      prisma._store.push(sourceRow({ id: 'src-a', tenantId: 'tenant-a' }));

      await expect(
        service.findOne('missing', 'tenant-a'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findOne('src-a', 'tenant-b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('hides soft-deleted sources (404)', async () => {
      prisma._store.push(sourceRow({ id: 'src-gone', deletedAt: new Date() }));
      await expect(
        service.findOne('src-gone', 'tenant-a'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
