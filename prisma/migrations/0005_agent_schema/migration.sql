-- T4.02 agent schema (F-08, F-10, F-11; AC-F08-1, AC-F08-2).
--
-- Generated with `prisma migrate diff --from-schema <before> --to-schema
-- prisma/schema.prisma --script` and extended by hand with the published-
-- version immutability trigger: the schema engine cannot emit triggers,
-- and AC-F08-1 requires the published configuration snapshot to be
-- immutable in the database itself, not only in application code
-- (SECURITY.md section 7: server-side enforcement is mandatory).
--
-- The DRAFT -> PUBLISHED transition stays possible because the trigger
-- guards on OLD.status: once a row is PUBLISHED, no UPDATE can change it.

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AgentVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'PASSED', 'FAILED');

-- CreateTable
CREATE TABLE "ai_agents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "owner_membership_id" UUID NOT NULL,
    "active_version_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_agent_versions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config_json" JSONB NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "status" "AgentVersionStatus" NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "ai_agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tool_grants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_version_id" UUID NOT NULL,
    "tool_id" UUID NOT NULL,
    "granted_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tool_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "agent_version_id" UUID NOT NULL,
    "dataset_version" TEXT NOT NULL,
    "provider" VARCHAR(64) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "aggregate_json" JSONB NOT NULL DEFAULT '{}',
    "failure_reasons_json" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_agents_tenant_id_name_idx" ON "ai_agents"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "ai_agent_versions_tenant_id_agent_id_idx" ON "ai_agent_versions"("tenant_id", "agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_agent_versions_agent_id_version_key" ON "ai_agent_versions"("agent_id", "version");

-- CreateIndex
CREATE INDEX "agent_tool_grants_tenant_id_idx" ON "agent_tool_grants"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_tool_grants_agent_version_id_tool_id_key" ON "agent_tool_grants"("agent_version_id", "tool_id");

-- CreateIndex
CREATE INDEX "evaluation_runs_tenant_id_agent_version_id_idx" ON "evaluation_runs"("tenant_id", "agent_version_id");

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_owner_membership_id_fkey" FOREIGN KEY ("owner_membership_id") REFERENCES "tenant_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agents" ADD CONSTRAINT "ai_agents_active_version_id_fkey" FOREIGN KEY ("active_version_id") REFERENCES "ai_agent_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_agent_versions" ADD CONSTRAINT "ai_agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "ai_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "ai_agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_runs" ADD CONSTRAINT "evaluation_runs_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "ai_agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AC-F08-1: a PUBLISHED agent version is the immutable configuration
-- snapshot behind publish/rollback and the audit trail. The trigger
-- rejects any UPDATE of a row that is already published; the
-- DRAFT -> PUBLISHED transition itself is still an UPDATE of a DRAFT row,
-- so publishing keeps working. Deletion cascades remain allowed: tenant
-- cleanup (F-14 pattern) removes the whole agent tree.
CREATE OR REPLACE FUNCTION reject_published_agent_version_update() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'PUBLISHED' THEN
    RAISE EXCEPTION 'ai_agent_versions: published versions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ai_agent_versions_published_immutable"
  BEFORE UPDATE ON "ai_agent_versions"
  FOR EACH ROW
  WHEN (OLD."status" = 'PUBLISHED')
  EXECUTE FUNCTION reject_published_agent_version_update();
