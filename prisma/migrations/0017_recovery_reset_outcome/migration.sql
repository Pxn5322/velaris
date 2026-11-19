-- Privileged recovery reset outcome (T6.09; D-62 section 12).
--
-- The API performs the provider reset inside the execution window and stores
-- the observed outcome here, so `complete` finalizes a recorded fact instead of
-- trusting a caller claim. A null value means the reset has not run yet.

ALTER TABLE "recovery_approval_requests"
    ADD COLUMN "reset_outcome" VARCHAR(16);
