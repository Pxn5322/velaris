-- Queue filter indexes in read order (D-85; closes the sort item in D-84).
--
-- `GET /tickets` filters by tenant and, when the agent narrows the queue, by
-- status list or by assignee, then takes one window of
-- `order by updated_at desc`.
--
-- Before this migration the two filter indexes stopped at the filter:
--   tickets_tenant_id_status_idx                       (tenant_id, status)
--   tickets_tenant_id_assignee_membership_id_status_idx (tenant_id, assignee_membership_id, status)
-- They find the matching rows, but the planner still sorts them to answer the
-- order, so a page costs a sort over every matching ticket.
--
-- Adding `updated_at DESC` to each index makes the filtered rows come back in
-- the order the route asks for. A single status is an index range; a status
-- list is one range per value, and the planner merges the already ordered
-- ranges instead of sorting. The section below ends with a sequential scan of
-- the tenant's tickets, which the existing tenant and updated time index serves.
CREATE INDEX "tickets_tenant_id_status_updated_at_idx"
  ON "tickets"("tenant_id", "status", "updated_at" DESC);

CREATE INDEX "tickets_tenant_id_assignee_membership_id_status_updated_at_idx"
  ON "tickets"("tenant_id", "assignee_membership_id", "status", "updated_at" DESC);

-- Each replaced index is a strict prefix of its successor, so the successor
-- serves every query the old index could. Keeping both would cost a second
-- index write on every ticket insert and update.
DROP INDEX "tickets_tenant_id_status_idx";
DROP INDEX "tickets_tenant_id_assignee_membership_id_status_idx";
