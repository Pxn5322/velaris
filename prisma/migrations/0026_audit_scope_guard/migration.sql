-- Audit scope guard (T6.10; D-60, D-88).
--
-- The sealed hash covers `scope_key`, never `tenant_id`. `tenant_id` is a live
-- foreign key to `tenants`, so the old set-null and cascade rules rewrote a
-- column that was already hashed: deleting a tenant turned its whole chain into
-- a reported tamper. This migration makes the relation refuse a delete and an
-- update, and pairs a null `tenant_id` with the `platform` scope so the two
-- columns cannot disagree.
--
-- No row changes. Every existing row is unsealed and already carries a scope
-- key that matches its tenant, so the CHECK validates without a repair. The
-- hash format changed before any row was sealed (0 sealed rows in every
-- environment), so no chain needs a re-seal and no version bump is needed.

ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_tenant_id_fkey";

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A platform row has no tenant, and a tenant row names one. Nothing else is
-- consistent, and the scope key is part of the hash, so this pairing is what
-- makes the scope key the single identity of the row.
ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_scope_tenant_pair"
  CHECK (("tenant_id" IS NULL) = ("scope_key" = 'platform'));
