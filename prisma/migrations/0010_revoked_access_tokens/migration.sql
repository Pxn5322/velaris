-- Sign-out revocation (D-51).
--
-- A signed-out access token is refused by the API guard before the in-process
-- verifier cache can accept it. Only a SHA-256 digest of the bearer token is
-- stored. `session_id` lets the guard reject any access token from the same
-- Supabase session, and `expires_at` bounds retention to the token lifetime.

CREATE TABLE "revoked_access_tokens" (
    "token_hash" CHAR(64) NOT NULL,
    "session_id" VARCHAR(64),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_access_tokens_pkey" PRIMARY KEY ("token_hash")
);

CREATE INDEX "revoked_access_tokens_session_id_idx" ON "revoked_access_tokens"("session_id");

CREATE INDEX "revoked_access_tokens_expires_at_idx" ON "revoked_access_tokens"("expires_at");