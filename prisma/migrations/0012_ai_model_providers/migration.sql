-- Platform AI model gateway configuration (AI Governance).
--
-- Only the environment-variable name of a provider credential is stored;
-- the secret itself stays in the deployment environment. is_default marks
-- the model used for new runs, and the service clears the previous default
-- in the same transaction so at most one row is active as default.
CREATE TYPE "AiProviderStatus" AS ENUM ('ACTIVE', 'PAUSED');

CREATE TABLE "ai_model_providers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(128) NOT NULL,
    "base_url" TEXT,
    "api_key_ref" VARCHAR(64) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "status" "AiProviderStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_model_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_model_providers_name_key" ON "ai_model_providers"("name");
CREATE INDEX "ai_model_providers_is_default_idx" ON "ai_model_providers"("is_default");