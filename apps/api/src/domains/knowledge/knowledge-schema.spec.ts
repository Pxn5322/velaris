/**
 * T3.01 knowledge schema contract (AC-F07-1, F-14).
 *
 * These tests pin the schema the ingestion and retrieval pipeline depends
 * on, so a later schema edit that drops them fails here rather than
 * silently weakening the database:
 *
 * 1. pgvector is enabled by the migration, because knowledge_embeddings
 *    stores a vector column (DATABASE.md section 5A requires confirming
 *    pgvector support in the real project).
 * 2. knowledge_sources carries the unique (tenant, type, content hash)
 *    identity that makes re-ingestion idempotent, plus the status index
 *    that drives AC-F07-2 retry reporting.
 * 3. knowledge_chunks is unique per (source_id, chunk_index), so
 *    re-indexing replaces chunks instead of duplicating them.
 * 4. knowledge_embeddings is unique per (chunk_id, model), carries a
 *    positive-dimension vector, and cascades deletion from its chunk,
 *    which is what F-14 knowledge deletion cleanup requires.
 *
 * Reading the migration file keeps this a pure unit test: no database is
 * needed, so it runs in the normal `npm run test` job.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { KnowledgeSource, KnowledgeChunk } from '@prisma/client';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0004_knowledge_schema/migration.sql',
    import.meta.url,
  ),
);

function migrationSql(): string {
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('T3.01 knowledge schema', () => {
  it('exposes status and provenance fields on the generated client', () => {
    // Type-level assertion: these assignments fail to compile if the
    // generated client drops the fields ingestion and retrieval read.
    const source: Pick<
      KnowledgeSource,
      'status' | 'contentHash' | 'provenanceJson' | 'errorCode'
    > = {
      status: 'READY',
      contentHash: 'sha256:abc',
      provenanceJson: { uri: 'https://example.test/docs' },
      errorCode: null,
    };
    const chunk: Pick<KnowledgeChunk, 'chunkIndex' | 'tokenCount'> = {
      chunkIndex: 0,
      tokenCount: 42,
    };

    expect(source.status).toBe('READY');
    expect(chunk.tokenCount).toBe(42);
  });

  it('enables pgvector before creating the embedding table', () => {
    const sql = migrationSql();

    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector/i);
    expect(sql).toMatch(/"embedding"\s+vector\(1536\)/);
  });

  it('gives knowledge_sources a unique tenant/type/hash identity and status index', () => {
    const sql = migrationSql();

    expect(sql).toContain(
      'knowledge_sources_tenant_id_source_type_content_hash_key',
    );
    expect(sql).toContain('knowledge_sources_tenant_id_status_idx');
  });

  it('makes chunks unique per source and index, and tenant-scoped by time', () => {
    const sql = migrationSql();

    expect(sql).toContain('knowledge_chunks_source_id_chunk_index_key');
    expect(sql).toContain(
      'knowledge_chunks_tenant_id_source_id_created_at_idx',
    );
  });

  it('makes embeddings unique per chunk/model with positive dimensions', () => {
    const sql = migrationSql();

    expect(sql).toContain('knowledge_embeddings_chunk_id_model_key');
    expect(sql).toMatch(/knowledge_embeddings_dimensions_check" CHECK \(/);
    expect(sql).toMatch(/"dimensions" > 0/);
  });

  it('cascades deletion from source to chunks and from chunk to embeddings', () => {
    const sql = migrationSql();

    expect(sql).toMatch(
      /FOREIGN KEY \("source_id"\) REFERENCES "knowledge_sources"\("id"\) ON DELETE CASCADE/,
    );
    expect(sql).toMatch(
      /FOREIGN KEY \("chunk_id"\) REFERENCES "knowledge_chunks"\("id"\) ON DELETE CASCADE/,
    );
  });
});
