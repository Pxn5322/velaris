-- Auth assurance (T6.08, D-58).
--
-- A flagged account may read its session, change its password and sign out.
-- Every other protected route is refused until the flag clears.
--
-- token_invalid_before refuses access tokens issued at or before a password
-- change or a global session revocation. The verifier cache cannot bypass it,
-- because the guard reads this row after it verifies the token.
--
-- step_up_grants stores only a SHA-256 digest of the one-time bearer value. The
-- row is bound to the subject, Supabase session, tenant and action, and the
-- first successful verification sets used_at.
--
-- No existing account is flagged by this migration. Flagging live accounts is
-- an owner-authorized data action under D-58, not a schema migration.

ALTER TABLE "users"
    ADD COLUMN "password_reset_required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "users"
    ADD COLUMN "token_invalid_before" TIMESTAMP(3);

CREATE TABLE "step_up_grants" (
    "id" UUID NOT NULL,
    "subject" VARCHAR(128) NOT NULL,
    "session_id" VARCHAR(64) NOT NULL,
    "tenant_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "step_up_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "step_up_grants_token_hash_key" ON "step_up_grants"("token_hash");

CREATE INDEX "step_up_grants_subject_action_expires_at_idx" ON "step_up_grants"("subject", "action", "expires_at");

CREATE INDEX "step_up_grants_session_id_idx" ON "step_up_grants"("session_id");

CREATE INDEX "step_up_grants_expires_at_idx" ON "step_up_grants"("expires_at");
