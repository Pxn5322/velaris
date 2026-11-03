-- T5.02 retention and lifecycle (F-14; AC-F14-1, AC-F14-2).
--
-- Three additions:
--   1. knowledge_sources gains retention_days and expires_at, so a source can
--      expire without waiting for a cleanup sweep. Retrieval excludes expired
--      and soft-deleted sources, and the index serves the sweep query.
--   2. ai_traces and ai_memories as DATABASE.md section 3 defines them.
--   3. retention_policies holds one row per tenant and category. The CHECK
--      bounds the window the API also validates, so an invalid policy cannot
--      enter through a direct SQL path either (AC-F14-2).
--
-- Written in the style of the earlier migrations; Prisma emits the same DDL.

-- CreateEnum
CREATE TYPE "RetentionCategory" AS ENUM ('KNOWLEDGE', 'TRACES', 'MEMORY');

-- AlterTable
ALTER TABLE "knowledge_sources"
    ADD COLUMN "retention_days" INTEGER,
    ADD COLUMN "expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "knowledge_sources_tenant_id_expires_at_idx" ON "knowledge_sources"("tenant_id", "expires_at");

-- CreateTable
CREATE TABLE "ai_traces" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "correlation_id" VARCHAR(128) NOT NULL,
    "agent_id" UUID,
    "agent_version_id" UUID,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64),
    "outcome" VARCHAR(32) NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "usage_json" JSONB NOT NULL DEFAULT '{}',
    "spans_metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_memories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID,
    "scope" VARCHAR(64) NOT NULL,
    "content" TEXT NOT NULL,
    "provenance_json" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION NOT NULL,
    "permission_scope_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "ai_memories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category" "RetentionCategory" NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_traces_correlation_id_idx" ON "ai_traces"("correlation_id");

-- CreateIndex
CREATE INDEX "ai_traces_tenant_id_created_at_idx" ON "ai_traces"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_traces_expires_at_idx" ON "ai_traces"("expires_at");

-- CreateIndex
CREATE INDEX "ai_memories_tenant_id_expires_at_idx" ON "ai_memories"("tenant_id", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_tenant_id_category_key" ON "retention_policies"("tenant_id", "category");

-- Bounds the window at the storage layer: one day to ten years. The API
-- contract rejects the same values with a readable error (AC-F14-2).
ALTER TABLE "retention_policies"
    ADD CONSTRAINT "retention_policies_retention_days_check"
    CHECK ("retention_days" BETWEEN 1 AND 3650);
