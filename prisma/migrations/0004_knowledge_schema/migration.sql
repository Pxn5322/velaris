-- T3.01 knowledge schema (F-07, F-14; AC-F07-1).
--
-- Generated with `prisma migrate diff --from-empty --to-schema` and cut
-- down to the knowledge delta on top of 0001-0003, matching the hand-
-- curated style of 0003. pgvector is a Supabase-provided extension
-- (available 0.8.2, confirmed in the development project); the schema
-- engine cannot emit CREATE EXTENSION, so it is enabled here first.

-- Enable pgvector before the vector column below needs it.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('WEBSITE', 'PDF', 'MARKDOWN', 'FAQ', 'MANUAL', 'HISTORY');

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_type" "KnowledgeSourceType" NOT NULL,
    "source_uri" TEXT,
    "object_key" TEXT,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'PENDING',
    "content_hash" TEXT NOT NULL,
    "provenance_json" JSONB NOT NULL DEFAULT '{}',
    "error_code" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "token_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_embeddings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "chunk_id" UUID NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_sources_tenant_id_status_idx" ON "knowledge_sources"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_sources_tenant_id_source_type_content_hash_key" ON "knowledge_sources"("tenant_id", "source_type", "content_hash");

-- CreateIndex
CREATE INDEX "knowledge_chunks_tenant_id_source_id_created_at_idx" ON "knowledge_chunks"("tenant_id", "source_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_source_id_chunk_index_key" ON "knowledge_chunks"("source_id", "chunk_index");

-- CreateIndex
CREATE INDEX "knowledge_embeddings_tenant_id_idx" ON "knowledge_embeddings"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_embeddings_chunk_id_model_key" ON "knowledge_embeddings"("chunk_id", "model");

-- Data-integrity constraint for embeddings (T3.01, AC-F07-1). Prisma
-- cannot express CHECK constraints, so - like the 0003 version/timestamp
-- CHECKs - this is written by hand: a stored embedding must declare a
-- positive dimension count that matches its vector width.
ALTER TABLE "knowledge_embeddings"
  ADD CONSTRAINT "knowledge_embeddings_dimensions_check" CHECK ("dimensions" > 0);

-- AddForeignKey
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_chunk_id_fkey" FOREIGN KEY ("chunk_id") REFERENCES "knowledge_chunks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_embeddings" ADD CONSTRAINT "knowledge_embeddings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
