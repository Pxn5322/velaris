-- Inbox queue search indexes (D-80; closes the index follow-up in D-77 and
-- D-78).
--
-- `GET /tickets?q=...` matches with a case-insensitive `contains`, which the
-- Prisma client sends as `ILIKE '%phrase%'`. A b-tree cannot serve a leading
-- wildcard, so every searched column gets a pg_trgm GIN index, which the
-- planner can use for `ILIKE` once the phrase is at least three characters
-- (a one- or two-character phrase stays a sequential scan: it produces no
-- trigram).
--
-- The message index is partial on the exact predicate the search filters:
-- only a CUSTOMER_VISIBLE message written by the customer is indexed, so an
-- internal note or an agent reply is neither indexed nor matchable (TH-05).
-- The indexes carry no tenant column, because the tenant scope is a filter
-- over the same rows and a trigram scan over one tenant's small result set
-- stays the cheaper plan than a composite index that triples its size.

-- pg_trgm is a trusted extension on Supabase PostgreSQL, so the migration
-- role can enable it without superuser rights, as migration 0004 does for
-- pgvector.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Customer text: the thread search and the `matchPreview` read.
CREATE INDEX "messages_customer_body_trgm_idx"
  ON "messages" USING GIN ("body" gin_trgm_ops)
  WHERE "author_type" = 'CUSTOMER' AND "visibility" = 'CUSTOMER_VISIBLE';

-- Customer identity: the name and email search (D-78).
CREATE INDEX "customers_display_name_trgm_idx"
  ON "customers" USING GIN ("display_name" gin_trgm_ops);

CREATE INDEX "customers_email_trgm_idx"
  ON "customers" USING GIN ("email" gin_trgm_ops);

-- Ticket subject: the title leg of the same search.
CREATE INDEX "tickets_title_trgm_idx"
  ON "tickets" USING GIN ("title" gin_trgm_ops);
