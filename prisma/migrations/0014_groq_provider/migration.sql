-- Current Groq gateway used by the runtime (LLM_PROVIDER resolves to Groq
-- when GROQ_API_KEY is configured). The credential stays in the environment;
-- only its variable name is stored. Groq becomes the single default provider.
UPDATE "ai_model_providers"
SET "is_default" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE "is_default" = true;

INSERT INTO "ai_model_providers" (
    "name",
    "provider",
    "model",
    "base_url",
    "api_key_ref",
    "is_default",
    "status",
    "created_at",
    "updated_at"
)
VALUES (
    'Groq',
    'groq',
    'openai/gpt-oss-120b',
    'https://api.groq.com/openai/v1',
    'GROQ_API_KEY',
    true,
    'ACTIVE',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO UPDATE SET
    "provider" = EXCLUDED."provider",
    "model" = EXCLUDED."model",
    "base_url" = EXCLUDED."base_url",
    "api_key_ref" = EXCLUDED."api_key_ref",
    "is_default" = true,
    "status" = 'ACTIVE',
    "updated_at" = CURRENT_TIMESTAMP;
