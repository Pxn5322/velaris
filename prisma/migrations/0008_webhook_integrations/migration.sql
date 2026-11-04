-- T5.05 webhook integrations (F-13; AC-F13-2, AC-F13-3; TH-08).
--
-- Two tables:
--   1. integration_endpoints registers one inbound webhook per tenant. It
--      stores the NAME of the environment variable that holds the signing
--      secret, never the secret itself (D-30), so a database dump carries no
--      secret material.
--   2. webhook_deliveries records one row per (endpoint, delivery id). The
--      unique pair makes a retried provider delivery one side effect, and
--      payload_hash lets the API answer 409 when the same id carries a
--      different body instead of overwriting history.
--
-- Written in the style of the earlier migrations; Prisma emits the same DDL.

-- CreateEnum
CREATE TYPE "IntegrationEndpointStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "integration_endpoints" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "display_name" TEXT NOT NULL,
    "secret_ref" VARCHAR(64) NOT NULL,
    "status" "IntegrationEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "endpoint_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "delivery_id" VARCHAR(128) NOT NULL,
    "payload_hash" VARCHAR(64) NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PROCESSED',
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_endpoints_tenant_id_created_at_idx" ON "integration_endpoints"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_endpoints_tenant_id_provider_display_name_key" ON "integration_endpoints"("tenant_id", "provider", "display_name");

-- CreateIndex
CREATE INDEX "webhook_deliveries_tenant_id_received_at_idx" ON "webhook_deliveries"("tenant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_endpoint_id_delivery_id_key" ON "webhook_deliveries"("endpoint_id", "delivery_id");
