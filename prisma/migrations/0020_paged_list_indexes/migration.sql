-- Paged-list indexes (D-84; closes the index follow-up in D-81 and D-82).
--
-- Both bounded list routes read `where tenant_id = $1` — and, for an
-- R-customer page, `and customer_id = $2` — then take one window of
-- `order by updated_at desc`.
--
-- The existing indexes cover the tenant-wide page only:
--   tickets_tenant_id_updated_at_idx       (tenant_id, updated_at DESC)
--   conversations_tenant_id_updated_at_idx (tenant_id, updated_at DESC)
--   conversations_tenant_id_customer_id_idx (tenant_id, customer_id)
-- A customer-filtered page therefore filters on customer_id and then sorts
-- the matching rows, so its cost grows with the customer's own history and
-- not with the page size.
--
-- One composite index per table in the exact read order removes the sort and
-- serves the count filter from the same entry.
CREATE INDEX "tickets_tenant_id_customer_id_updated_at_idx"
  ON "tickets"("tenant_id", "customer_id", "updated_at" DESC);

CREATE INDEX "conversations_tenant_id_customer_id_updated_at_idx"
  ON "conversations"("tenant_id", "customer_id", "updated_at" DESC);

-- The older two-column index is a strict prefix of the new one, so every
-- query it could serve is served by the new index. Keeping both would cost a
-- second index write on every conversation insert and update.
DROP INDEX "conversations_tenant_id_customer_id_idx";
