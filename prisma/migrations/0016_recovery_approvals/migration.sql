-- Privileged recovery approvals (T6.09; D-62 contract, D-59 matrix, D-66).
--
-- One request authorizes one execution. The required approval count comes from
-- the code policy table, never from the caller. The target user id and tenant
-- id carry no foreign key, so a later account or tenant change cannot rewrite
-- the approval history.
--
-- No row is created by this migration. A recovery request is created only by
-- an authenticated enterprise administrator with an aal2 session and a
-- one-time recovery.request step-up grant.

CREATE TABLE "recovery_approval_requests" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "recovery_path" VARCHAR(48) NOT NULL,
    "tenant_id" UUID,
    "target_user_id" UUID NOT NULL,
    "target_subject" VARCHAR(128) NOT NULL,
    "requested_by" VARCHAR(128) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "ticket_id" VARCHAR(100) NOT NULL,
    "custody_record_id" VARCHAR(128),
    "state" VARCHAR(16) NOT NULL,
    "required_approvals" INTEGER NOT NULL,
    "approval_expires_at" TIMESTAMP(3) NOT NULL,
    "execution_id" UUID,
    "execution_expires_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "executed_by" VARCHAR(128),
    "completed_at" TIMESTAMP(3),
    "state_reason" VARCHAR(32),
    "failure_code" VARCHAR(64),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recovery_approval_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "recovery_approval_decisions" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_subject" VARCHAR(128) NOT NULL,
    "policy_role" VARCHAR(32) NOT NULL,
    "decision" VARCHAR(8) NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_approval_decisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recovery_approval_requests_requested_by_request_id_key"
    ON "recovery_approval_requests"("requested_by", "request_id");

CREATE INDEX "recovery_approval_requests_state_approval_expires_at_idx"
    ON "recovery_approval_requests"("state", "approval_expires_at");

CREATE INDEX "recovery_approval_requests_tenant_id_state_created_at_idx"
    ON "recovery_approval_requests"("tenant_id", "state", "created_at" DESC);

CREATE UNIQUE INDEX "recovery_approval_decisions_request_id_actor_subject_key"
    ON "recovery_approval_decisions"("request_id", "actor_subject");

ALTER TABLE "recovery_approval_decisions"
    ADD CONSTRAINT "recovery_approval_decisions_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "recovery_approval_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
