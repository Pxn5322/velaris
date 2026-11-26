-- Platform directory page indexes (D-87; follows D-86).
--
-- `GET /tenants/users` read every membership on the platform and sorted the
-- result by tenant name in the database. The directory then paged in the
-- browser, so one request carried the whole table.
--
-- The route now reads one page:
--   where <optional status, role or text filter>
--   order by created_at asc, id asc
--   skip $1 take $2
--
-- The sort key is `(created_at, id)`, so a page needs an index in that order.
-- The id breaks a tie on equal creation time, which keeps offset pages stable.
CREATE INDEX "tenant_memberships_created_at_id_idx"
  ON "tenant_memberships"("created_at", "id");

-- The status filter is the most common narrowing on the directory. This index
-- puts the filter column first and keeps the sort columns behind it, so a
-- status page reads its rows in order instead of sorting them.
CREATE INDEX "tenant_memberships_status_created_at_id_idx"
  ON "tenant_memberships"("status", "created_at", "id");

-- A role filter reads membership_roles, which no single-table index can serve;
-- a text filter matches joined user and tenant columns for the same reason.
-- Both still read one bounded page, and the unfiltered page and the status
-- page read their order from the indexes above.
