/**
 * Permission-aware retrieval (T3.04, AC-F07-3, AC-F09-1, TH-01, TH-12).
 *
 * The application service the AI orchestrator calls to ground an answer.
 * Order of checks:
 *
 * 1. Deny by default: the caller's resolved role must hold
 *    `knowledge.manage` before any query runs (AC-F07-3, TH-02). The
 *    SECURITY.md baseline maps knowledge access to an explicit grant and
 *    gives R-agent/R-customer no source access; until a distinct
 *    knowledge-read permission code is decided, retrieval reuses the
 *    manage code (Proposed D-xx, run log).
 * 2. Tenant scope: the vector query is parameterized with the caller's
 *    tenant and the SQL filters tenant_id, source status READY and
 *    deleted_at IS NULL, so chunks of other tenants or retired sources
 *    never reach a response (TH-01, TH-12).
 * 3. Citations: every hit carries provenance (source id, source type,
 *    origin metadata, chunk index, model, similarity score) so a grounded
 *    answer can cite it (AC-F09-1).
 *
 * pgvector similarity runs through raw SQL because Prisma types the
 * column as Unsupported("vector(1536)"). The query embeds the caller's
 * text through the same provider port ingestion used, so model versions
 * always match.
 */

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import {
  EMBEDDING_PROVIDER,
  LocalDeterministicEmbeddingProvider,
  type EmbeddingProvider,
} from './embedding.provider.js';

/** Retrieval inputs: caller scope plus the search text. */
export interface RetrievalQuery {
  /** Tenant scope required for every query (NFR-01). */
  tenantId: string;
  /** Server-resolved role; null means unresolved and must deny. */
  role: CanonicalRole | null;
  query: string;
  /** Page size; 1..50, default 8. */
  limit?: number;
}

/** One retrieved chunk with the provenance a citation needs. */
export interface RetrievalHit {
  chunkId: string;
  chunkIndex: number;
  content: string;
  /** Similarity in [-1, 1]; higher is closer to the query. */
  score: number;
  citation: {
    sourceId: string;
    sourceType: string;
    provenance: unknown;
    model: string;
  };
}

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 50;

@Injectable()
export class KnowledgeRetrievalService {
  constructor(
    @Inject(PRISMA_SERVICE) private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    @Inject(EMBEDDING_PROVIDER)
    readonly embeddingProvider: EmbeddingProvider = new LocalDeterministicEmbeddingProvider(),
  ) {}

  async search(params: RetrievalQuery): Promise<RetrievalHit[]> {
    // Authorization before any work: an ungranted principal learns nothing.
    this.authorization.assertPermission(
      params.role,
      PERMISSIONS.KNOWLEDGE_MANAGE,
    );
    if (typeof params.tenantId !== 'string' || params.tenantId.trim() === '') {
      throw new BadRequestException('tenantId is required');
    }
    if (typeof params.query !== 'string' || params.query.trim() === '') {
      throw new BadRequestException('query is required');
    }
    const limit = params.limit ?? DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new BadRequestException(`limit must be between 1 and ${MAX_LIMIT}`);
    }

    const vector = await this.embeddingProvider.embed(params.query.trim());
    const literal = `[${vector.join(',')}]`;
    const rows = await this.prisma.$queryRaw<RawHit[]>`
      SELECT c.id AS chunk_id,
             c.chunk_index AS chunk_index,
             c.content AS content,
             s.id AS source_id,
             s.source_type AS source_type,
             s.provenance_json AS provenance_json,
             e.model AS model,
             1 - (e.embedding <=> ${literal}::vector) AS score
      FROM knowledge_chunks c
      JOIN knowledge_sources s ON s.id = c.source_id
      JOIN knowledge_embeddings e ON e.chunk_id = c.id
      WHERE c.tenant_id = ${params.tenantId}
        AND s.status = 'READY'
        AND s.deleted_at IS NULL
        AND e.model = ${this.embeddingProvider.model}
      ORDER BY e.embedding <=> ${literal}::vector
      LIMIT ${limit}`;

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      score: Number(row.score),
      citation: {
        sourceId: row.source_id,
        sourceType: row.source_type,
        provenance: row.provenance_json,
        model: row.model,
      },
    }));
  }
}

/** Row shape the raw query returns (snake_case aliases above). */
interface RawHit {
  chunk_id: string;
  chunk_index: number;
  content: string;
  source_id: string;
  source_type: string;
  provenance_json: unknown;
  model: string;
  score: number;
}
