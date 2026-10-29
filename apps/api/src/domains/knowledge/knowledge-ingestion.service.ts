/**
 * Async ingestion pipeline (T3.03, AC-F07-1, AC-F07-2, TH-11).
 *
 * The worker-side engine behind the IngestionQueue port. One execution:
 *
 * 1. Resolve the source through the job's tenant scope. A job that names
 *    another tenant's (or a deleted) source touches no row (TH-01).
 * 2. Recheck tenant status at execution time: a disabled tenant fails the
 *    job with TENANT_DISABLED instead of continuing (TH-11).
 * 3. Record PROCESSING (durable job state on the source row).
 * 4. Load, parse and chunk the content, embed every chunk through the
 *    provider port, and write chunks plus pgvector rows for the job's
 *    tenant; previous chunks of the source are replaced, not duplicated
 *    (unique source_id/chunk_index).
 * 5. Record READY, or FAILED with an error code: permanent problems
 *    (crawler/object storage not configured, empty content) fail once;
 *    transient failures retry up to maxAttempts with linear backoff and
 *    then land RETRY_EXHAUSTED (AC-F07-2 retry/re-index).
 *
 * D-07 (embedding provider) and the queue service are undecided, so the
 * pipeline runs through ports with the local deterministic provider and
 * the in-process queue; swapping either implementation changes no caller
 * (Proposed D-xx, run log). Job metadata contract: ingestion-types.ts.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import {
  EMBEDDING_PROVIDER,
  LocalDeterministicEmbeddingProvider,
  type EmbeddingProvider,
} from './embedding.provider.js';
import type {
  IngestionJob,
  IngestionJobOutcome,
  IngestionRunner,
} from './ingestion-types.js';
import { PermanentIngestionError } from './ingestion-types.js';
import {
  SourceContentLoader,
  SourceNotConfiguredError,
} from './source-content.loader.js';

/** Re-exported so callers can classify the configured-loader failure. */
export { PermanentIngestionError, SourceNotConfiguredError };

/** Words per chunk window before overlap (documented pipeline constant). */
const CHUNK_WORDS = 120;
/** Words shared between consecutive chunks for context continuity. */
const CHUNK_OVERLAP_WORDS = 20;

/** Processed result of one attempt. */
interface Piece {
  text: string;
  words: number;
}

@Injectable()
export class KnowledgeIngestionService implements IngestionRunner {
  /** Delay base between retries; tests set 0 for deterministic runs. */
  backoffMs = 250;
  /** Bounded retry budget for transient failures (AC-F07-2, TH-09). */
  maxAttempts = 3;

  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly loader: SourceContentLoader = new SourceContentLoader(),
    @Inject(EMBEDDING_PROVIDER)
    readonly embeddingProvider: EmbeddingProvider = new LocalDeterministicEmbeddingProvider(),
  ) {}

  /** Execute one job to a durable outcome. Never throws on job failure. */
  async run(job: IngestionJob): Promise<IngestionJobOutcome> {
    // Tenant scope first: a foreign or deleted id resolves to no row.
    const source = await this.prisma.knowledgeSource.findFirst({
      where: { id: job.sourceId, tenantId: job.tenantId, deletedAt: null },
    });
    if (!source) {
      return skip(job.sourceId);
    }

    // TH-11: tenant status is rechecked at job execution, not enqueue.
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: job.tenantId },
    });
    if (!tenant || tenant.status !== 'ACTIVE') {
      await this.prisma.knowledgeSource.update({
        where: { id: source.id },
        data: { status: 'FAILED', errorCode: 'TENANT_DISABLED' },
      });
      return {
        sourceId: source.id,
        status: 'FAILED',
        attempts: 0,
        errorCode: 'TENANT_DISABLED',
      };
    }

    await this.prisma.knowledgeSource.update({
      where: { id: source.id },
      data: { status: 'PROCESSING' },
    });

    for (let attempt = 1; ; attempt++) {
      try {
        await this.ingestOnce(job, source);
        await this.prisma.knowledgeSource.update({
          where: { id: source.id },
          data: { status: 'READY', errorCode: null },
        });
        return {
          sourceId: source.id,
          status: 'READY',
          attempts: attempt,
          errorCode: null,
        };
      } catch (error) {
        if (error instanceof PermanentIngestionError) {
          await this.prisma.knowledgeSource.update({
            where: { id: source.id },
            data: { status: 'FAILED', errorCode: error.errorCode },
          });
          return {
            sourceId: source.id,
            status: 'FAILED',
            attempts: attempt,
            errorCode: error.errorCode,
          };
        }
        if (attempt >= this.maxAttempts) {
          await this.prisma.knowledgeSource.update({
            where: { id: source.id },
            data: { status: 'FAILED', errorCode: 'RETRY_EXHAUSTED' },
          });
          return {
            sourceId: source.id,
            status: 'FAILED',
            attempts: attempt,
            errorCode: 'RETRY_EXHAUSTED',
          };
        }
        await this.delay(this.backoffMs * attempt);
      }
    }
  }

  /** One load/parse/chunk/embed/write pass; throws to trigger retry. */
  private async ingestOnce(
    job: IngestionJob,
    source: {
      id: string;
      sourceType: string;
      provenanceJson: unknown;
    },
  ): Promise<void> {
    const raw = this.loader.load(source);
    const text = raw.trim().replace(/\n{3,}/g, '\n\n');
    if (!text) {
      throw new PermanentIngestionError(
        'PARSE_FAILED',
        'source content is empty after parsing',
      );
    }

    const pieces = this.chunk(text);
    // Re-index semantics: replace previous chunks instead of duplicating.
    await this.prisma.knowledgeChunk.deleteMany({
      where: { sourceId: source.id },
    });
    for (const [index, piece] of pieces.entries()) {
      const vector = await this.embeddingProvider.embed(piece.text);
      const row = await this.prisma.knowledgeChunk.create({
        data: {
          tenantId: job.tenantId,
          sourceId: source.id,
          chunkIndex: index,
          content: piece.text,
          tokenCount: piece.words,
          metadataJson: { sourceType: source.sourceType },
        },
      });
      await this.insertEmbedding(job.tenantId, row.id, vector);
    }
  }

  /** Split text into overlapping word windows (pipeline constant above). */
  private chunk(text: string): Piece[] {
    const words = text.split(/\s+/);
    const pieces: Piece[] = [];
    for (
      let start = 0;
      start < words.length;
      start += CHUNK_WORDS - CHUNK_OVERLAP_WORDS
    ) {
      const window = words.slice(start, start + CHUNK_WORDS);
      pieces.push({ text: window.join(' '), words: window.length });
      if (start + CHUNK_WORDS >= words.length) {
        break;
      }
    }
    return pieces;
  }

  /**
   * Write the vector through SQL: Prisma types the column as
   * Unsupported("vector(1536)"), so the generated client cannot bind it.
   * The literal contains numbers only, and the upsert keeps re-indexing
   * idempotent per (chunk, model).
   */
  private async insertEmbedding(
    tenantId: string,
    chunkId: string,
    vector: number[],
  ): Promise<void> {
    const literal = `[${vector.join(',')}]`;
    await this.prisma.$executeRaw`
      INSERT INTO knowledge_embeddings (id, tenant_id, chunk_id, embedding, model, dimensions)
      VALUES (gen_random_uuid(), ${tenantId}, ${chunkId}, ${literal}::vector,
              ${this.embeddingProvider.model}, ${vector.length})
      ON CONFLICT (chunk_id, model)
      DO UPDATE SET embedding = EXCLUDED.embedding, dimensions = EXCLUDED.dimensions`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function skip(sourceId: string): IngestionJobOutcome {
  return { sourceId, status: 'SKIPPED', attempts: 0, errorCode: null };
}
