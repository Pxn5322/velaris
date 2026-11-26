-- List read indexes (D-86; follows D-84 and D-85).
--
-- `GET /audit/events` is already bounded by `take: limit` (default 25, capped
-- at 100), but it optionally filters by action and always reads newest first:
--   where tenant_id = $1 and action = $2 order by created_at desc limit $3
-- The existing index `(tenant_id, created_at DESC)` serves the page without
-- the action filter. With the filter, the planner finds the action rows among
-- the tenant's events and then sorts them, so the page costs a sort over that
-- range and not over the page size.
CREATE INDEX "audit_events_tenant_id_action_created_at_idx"
  ON "audit_events"("tenant_id", "action", "created_at" DESC);

-- `GET /customers` reads the tenant's customers oldest first:
--   where tenant_id = $1 order by created_at asc skip $2 take $3
-- The table had indexes on (tenant_id, email) and (tenant_id, external_ref)
-- only, so the read swept the tenant's rows and sorted them. The route is now
-- bounded by a page window as well (D-86), and this index supplies that order.
CREATE INDEX "customers_tenant_id_created_at_idx"
  ON "customers"("tenant_id", "created_at");
