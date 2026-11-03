-- T4.04 deterministic tool authorization (F-10; AC-F10-1, AC-F10-2, AC-F10-3).
--
-- Generated with `prisma migrate diff --from-schema <master schema> --to-schema
-- prisma/schema.prisma --script` and extended by hand with three guards the
-- schema engine cannot emit:
--
-- 1. A partial unique index for platform tools. Prisma compiles
--    @@unique([tenantId, name]) to a plain unique index, and PostgreSQL treats
--    NULL values as distinct, so two platform tools could share one name. The
--    partial index closes that hole (DATABASE.md 6: "unique name in scope").
-- 2. A CHECK on timeout_ms. Every execution runs under a deadline, so a row
--    cannot ask for a zero, negative or unbounded timeout (SECURITY.md 6).
-- 3. A default of 10000 ms is already in the column; the CHECK bounds it.
--
-- agent_tool_grants.tool_id gains its foreign key here: the T4.02 migration
-- left it a plain UUID because no tool registry existed yet.

-- CreateEnum
CREATE TYPE "ToolRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ToolApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ai_tool_definitions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "input_schema_json" JSONB NOT NULL,
    "output_schema_json" JSONB,
    "required_permission" VARCHAR(64) NOT NULL,
    "risk_level" "ToolRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "approval_required" BOOLEAN NOT NULL DEFAULT false,
    "timeout_ms" INTEGER NOT NULL DEFAULT 10000,
    "retry_policy_json" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tool_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_approval_requests" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tool_definition_id" UUID NOT NULL,
    "agent_version_id" UUID NOT NULL,
    "proposal_hash" VARCHAR(64) NOT NULL,
    "proposal_json" JSONB NOT NULL,
    "requested_by" UUID NOT NULL,
    "status" "ToolApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tool_approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_tool_definitions_name_idx" ON "ai_tool_definitions"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tool_definitions_tenant_id_name_key" ON "ai_tool_definitions"("tenant_id", "name");

-- CreateIndex (hand-written: one name per platform scope, where tenant_id is NULL)
CREATE UNIQUE INDEX "ai_tool_definitions_platform_name_key" ON "ai_tool_definitions"("name") WHERE "tenant_id" IS NULL;

-- CreateIndex
CREATE INDEX "tool_approval_requests_tenant_id_status_idx" ON "tool_approval_requests"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tool_approval_requests_tenant_id_tool_definition_id_proposa_idx" ON "tool_approval_requests"("tenant_id", "tool_definition_id", "proposal_hash", "status");

-- CreateIndex
CREATE INDEX "agent_tool_grants_tool_id_idx" ON "agent_tool_grants"("tool_id");

-- AddConstraint (hand-written: every execution runs under a bounded deadline)
ALTER TABLE "ai_tool_definitions"
    ADD CONSTRAINT "ai_tool_definitions_timeout_ms_check"
    CHECK ("timeout_ms" BETWEEN 100 AND 300000);

-- AddForeignKey
ALTER TABLE "ai_tool_definitions" ADD CONSTRAINT "ai_tool_definitions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_approval_requests" ADD CONSTRAINT "tool_approval_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_approval_requests" ADD CONSTRAINT "tool_approval_requests_tool_definition_id_fkey" FOREIGN KEY ("tool_definition_id") REFERENCES "ai_tool_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tool_approval_requests" ADD CONSTRAINT "tool_approval_requests_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "ai_agent_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tool_grants" ADD CONSTRAINT "agent_tool_grants_tool_id_fkey" FOREIGN KEY ("tool_id") REFERENCES "ai_tool_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
