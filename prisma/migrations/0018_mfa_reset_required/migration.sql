-- T6.09: a privileged reset removes every MFA factor, so the account must
-- enroll a new one before normal routes are allowed again.
ALTER TABLE "users" ADD COLUMN "mfa_reset_required" BOOLEAN NOT NULL DEFAULT false;
