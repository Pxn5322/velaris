-- Audit integrity (T6.10, D-60).
--
-- D-60 keeps one immutable, hash-chained audit history per scope. This
-- migration adds the actor snapshot, the stable scope key and the sealed chain
-- position, and rebuilds `audit_events` as monthly partitions so retention
-- drops a partition instead of deleting rows.
--
-- Fail-closed defaults, per the owner decision on 2026-11-19:
-- - The proposed retention period is seven years and it is NOT approved. The
--   purge function refuses to run until `audit_retention_policy.approved_at`
--   is set by an owner and legal review.
-- - A legal hold blocks every purge while any hold row has a null
--   `released_at`.
-- - The application is append-only: a trigger refuses UPDATE and DELETE, and
--   a second trigger refuses TRUNCATE. Retention is a partition drop by the
--   maintenance role, not a row delete.
--
-- Rows written before this migration carry no seal. They keep their content
-- and receive a scope key, so verification counts them as unsealed instead of
-- claiming integrity for them. A chain therefore starts at sequence one with
-- the first row written after this migration.

-- One chain head per scope. A writer reserves the next sequence on this row;
-- the row lock is held until the writer stores the new hash.
CREATE TABLE "audit_chains" (
  "scope_key" VARCHAR(80) PRIMARY KEY,
  "last_seq" BIGINT NOT NULL,
  "last_hash" CHAR(64),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Legal holds block every purge until released. A null scope covers all scopes.
CREATE TABLE "audit_legal_holds" (
  "id" UUID PRIMARY KEY,
  "scope_key" VARCHAR(80),
  "reason" TEXT NOT NULL,
  "placed_by" VARCHAR(128) NOT NULL,
  "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "released_at" TIMESTAMP(3)
);

CREATE INDEX "audit_legal_holds_scope_key_released_at_idx"
  ON "audit_legal_holds" ("scope_key", "released_at");

-- Proposed retention period. `approved_at` stays null until the owner and
-- legal review approve the period (D-60, PRD D-08).
CREATE TABLE "audit_retention_policy" (
  "id" VARCHAR(16) PRIMARY KEY,
  "period_years" INTEGER NOT NULL,
  "approved_by" VARCHAR(128),
  "approved_at" TIMESTAMP(3),
  CONSTRAINT "audit_retention_policy_single_row" CHECK ("id" = 'platform')
);

INSERT INTO "audit_retention_policy" ("id", "period_years") VALUES ('platform', 7);

-- Rebuild `audit_events` as a partitioned table. The old table keeps its name
-- while the rows are copied, so a failure here leaves the data in place.
ALTER TABLE "audit_events" RENAME TO "audit_events_unpartitioned";

-- A rename keeps constraint names, so move the old key aside before the new
-- partitioned table declares its own primary key.
ALTER TABLE "audit_events_unpartitioned"
  RENAME CONSTRAINT "audit_events_pkey" TO "audit_events_unpartitioned_pkey";

CREATE TABLE "audit_events" (
  "id" UUID NOT NULL,
  "tenant_id" UUID,
  "scope_key" VARCHAR(80),
  "actor_id" UUID,
  "actor_snapshot" JSONB,
  "snapshot_version" INTEGER NOT NULL DEFAULT 1,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata_json" JSONB,
  "request_id" TEXT,
  "chain_seq" BIGINT,
  "prev_hash" CHAR(64),
  "event_hash" CHAR(64),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id", "created_at"),
  CONSTRAINT "audit_events_chain_pair"
    CHECK (("chain_seq" IS NULL) = ("event_hash" IS NULL)),
  CONSTRAINT "audit_events_chain_link"
    CHECK (("chain_seq" IS NULL) OR (("chain_seq" = 1) = ("prev_hash" IS NULL)))
) PARTITION BY RANGE ("created_at");

-- Monthly partitions for the current horizon, plus an overflow partition so a
-- row outside the horizon is stored rather than refused. Add months ahead of
-- time with `audit_ensure_month_partition`.
CREATE TABLE "audit_events_2026_01" PARTITION OF "audit_events" FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');
CREATE TABLE "audit_events_2026_02" PARTITION OF "audit_events" FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');
CREATE TABLE "audit_events_2026_03" PARTITION OF "audit_events" FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
CREATE TABLE "audit_events_2026_04" PARTITION OF "audit_events" FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE "audit_events_2026_05" PARTITION OF "audit_events" FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE "audit_events_2026_06" PARTITION OF "audit_events" FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE "audit_events_2026_07" PARTITION OF "audit_events" FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE "audit_events_2026_08" PARTITION OF "audit_events" FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE "audit_events_2026_09" PARTITION OF "audit_events" FOR VALUES FROM ('2026-09-01') TO ('2026-10-01');
CREATE TABLE "audit_events_2026_10" PARTITION OF "audit_events" FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
CREATE TABLE "audit_events_2026_11" PARTITION OF "audit_events" FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE "audit_events_2026_12" PARTITION OF "audit_events" FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE "audit_events_2027_01" PARTITION OF "audit_events" FOR VALUES FROM ('2027-01-01') TO ('2027-02-01');
CREATE TABLE "audit_events_2027_02" PARTITION OF "audit_events" FOR VALUES FROM ('2027-02-01') TO ('2027-03-01');
CREATE TABLE "audit_events_2027_03" PARTITION OF "audit_events" FOR VALUES FROM ('2027-03-01') TO ('2027-04-01');
CREATE TABLE "audit_events_2027_04" PARTITION OF "audit_events" FOR VALUES FROM ('2027-04-01') TO ('2027-05-01');
CREATE TABLE "audit_events_2027_05" PARTITION OF "audit_events" FOR VALUES FROM ('2027-05-01') TO ('2027-06-01');
CREATE TABLE "audit_events_2027_06" PARTITION OF "audit_events" FOR VALUES FROM ('2027-06-01') TO ('2027-07-01');
CREATE TABLE "audit_events_2027_07" PARTITION OF "audit_events" FOR VALUES FROM ('2027-07-01') TO ('2027-08-01');
CREATE TABLE "audit_events_2027_08" PARTITION OF "audit_events" FOR VALUES FROM ('2027-08-01') TO ('2027-09-01');
CREATE TABLE "audit_events_2027_09" PARTITION OF "audit_events" FOR VALUES FROM ('2027-09-01') TO ('2027-10-01');
CREATE TABLE "audit_events_2027_10" PARTITION OF "audit_events" FOR VALUES FROM ('2027-10-01') TO ('2027-11-01');
CREATE TABLE "audit_events_2027_11" PARTITION OF "audit_events" FOR VALUES FROM ('2027-11-01') TO ('2027-12-01');
CREATE TABLE "audit_events_2027_12" PARTITION OF "audit_events" FOR VALUES FROM ('2027-12-01') TO ('2028-01-01');
CREATE TABLE "audit_events_default" PARTITION OF "audit_events" DEFAULT;

-- Copy the history. The scope key is derived from the tenant and is stored as
-- text, so it is not a live foreign key (D-60). The seal columns stay null for
-- these rows: verification counts them as unsealed.
INSERT INTO "audit_events" (
  "id", "tenant_id", "scope_key", "actor_id", "action", "resource_type",
  "resource_id", "metadata_json", "request_id", "created_at"
)
SELECT
  "id",
  "tenant_id",
  CASE WHEN "tenant_id" IS NULL THEN 'platform' ELSE 'tenant:' || "tenant_id"::text END,
  "actor_id",
  "action",
  "resource_type",
  "resource_id",
  "metadata_json",
  "request_id",
  "created_at"
FROM "audit_events_unpartitioned";

DROP TABLE "audit_events_unpartitioned";

ALTER TABLE "audit_events" ALTER COLUMN "scope_key" SET NOT NULL;

-- The indexes the audit page and the chain verification read (D-86, D-60).
CREATE INDEX "audit_events_tenant_id_created_at_idx"
  ON "audit_events" ("tenant_id", "created_at" DESC);
CREATE INDEX "audit_events_tenant_id_action_created_at_idx"
  ON "audit_events" ("tenant_id", "action", "created_at" DESC);
CREATE INDEX "audit_events_resource_type_resource_id_created_at_idx"
  ON "audit_events" ("resource_type", "resource_id", "created_at" DESC);
CREATE INDEX "audit_events_scope_key_chain_seq_idx"
  ON "audit_events" ("scope_key", "chain_seq");

ALTER TABLE "audit_events"
  ADD CONSTRAINT "audit_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only: the history cannot be edited or deleted through the table.
-- Retention drops a whole partition, which no row trigger sees.
CREATE OR REPLACE FUNCTION "audit_events_reject_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_reject_mutation"();

CREATE TRIGGER "audit_events_no_truncate"
  BEFORE TRUNCATE ON "audit_events"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_events_reject_mutation"();

-- Add the partition for one month when the horizon moves forward.
CREATE OR REPLACE FUNCTION "audit_ensure_month_partition"(p_month DATE)
RETURNS TEXT AS $$
DECLARE
  v_name TEXT := 'audit_events_' || to_char(p_month, 'YYYY_MM');
BEGIN
  IF to_regclass(v_name) IS NOT NULL THEN
    RETURN v_name;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF "audit_events" FOR VALUES FROM (%L) TO (%L)',
    v_name,
    date_trunc('month', p_month),
    date_trunc('month', p_month) + interval '1 month'
  );
  RETURN v_name;
END;
$$ LANGUAGE plpgsql;

-- Drop whole partitions older than the approved period. This fails closed:
-- it raises while a legal hold is active, and while the retention period has
-- no owner approval. No application path calls it; the maintenance role runs
-- it after the owner records D-60.
CREATE OR REPLACE FUNCTION "audit_purge_expired_partitions"(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE ("dropped_partition" TEXT) AS $$
DECLARE
  v_policy RECORD;
  v_partition RECORD;
  v_cutoff TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  IF EXISTS (SELECT 1 FROM "audit_legal_holds" WHERE "released_at" IS NULL) THEN
    RAISE EXCEPTION 'audit purge blocked: legal hold active';
  END IF;

  SELECT "period_years", "approved_at" INTO v_policy
  FROM "audit_retention_policy"
  WHERE "id" = 'platform';

  IF NOT FOUND OR v_policy."approved_at" IS NULL THEN
    RAISE EXCEPTION 'audit purge blocked: retention period not approved';
  END IF;

  v_cutoff := p_now - make_interval(years => v_policy."period_years");

  FOR v_partition IN
    SELECT c.relname AS name
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = 'audit_events'
      AND c.relname ~ '^audit_events_[0-9]{4}_[0-9]{2}$'
  LOOP
    v_end := make_date(
      substring(v_partition.name from 14 for 4)::INT,
      substring(v_partition.name from 19 for 2)::INT,
      1
    ) + interval '1 month';
    IF v_end <= v_cutoff THEN
      EXECUTE format('DROP TABLE %I', v_partition.name);
      "dropped_partition" := v_partition.name;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
