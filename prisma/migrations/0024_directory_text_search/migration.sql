-- Platform directory text search indexes (D-87, revised).
--
-- `GET /tenants/users?q=` matched a membership through its user's email, its
-- user's display name or its tenant's name. The Prisma filter sends
-- `ILIKE '%phrase%'` for each leg, and a b-tree cannot serve a leading
-- wildcard, so the join filter read every membership.
--
-- The route now resolves the matching accounts and tenants first and filters
-- memberships on `user_id` / `tenant_id`, which the membership indexes serve.
-- That move is only worth it if the two lookups are cheap, so each searched
-- column gets a pg_trgm GIN index, as migration 0019 does for the inbox
-- search. A phrase shorter than three characters produces no trigram and stays
-- a sequential scan over users or tenants; a phrase that matches more than the
-- route's identifier limit keeps the joined-text filter.

-- pg_trgm is a trusted extension on Supabase PostgreSQL, so the migration role
-- can enable it without superuser rights (0019 already installed it).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Account identity: the email and name legs of the search.
CREATE INDEX "users_email_normalized_trgm_idx"
  ON "users" USING GIN ("email_normalized" gin_trgm_ops);

CREATE INDEX "users_display_name_trgm_idx"
  ON "users" USING GIN ("display_name" gin_trgm_ops);

-- Workspace name: the tenant leg of the search.
CREATE INDEX "tenants_name_trgm_idx"
  ON "tenants" USING GIN ("name" gin_trgm_ops);
