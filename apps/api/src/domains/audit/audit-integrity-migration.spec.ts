/**
 * Audit storage contract for migration 0025 (T6.10; D-60).
 *
 * D-60 keeps one append-only, hash-chained audit table per scope. The rows are
 * monthly partitions so retention drops a partition instead of deleting rows,
 * and no purge happens until the owner approves the period and no legal hold
 * is active. These tests read the committed migration and the Prisma schema,
 * so a later edit that removes the sealed columns, the append-only trigger or
 * the purge guard fails here. No database is needed, so they run in the normal
 * `npm run test` job.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0025_audit_integrity/migration.sql',
    import.meta.url,
  ),
);
const SCHEMA_PATH = fileURLToPath(
  new URL('../../../../../prisma/schema.prisma', import.meta.url),
);

function migrationSql(): string {
  expect(existsSync(MIGRATION_PATH)).toBe(true);
  return readFileSync(MIGRATION_PATH, 'utf8');
}

function schemaText(): string {
  expect(existsSync(SCHEMA_PATH)).toBe(true);
  return readFileSync(SCHEMA_PATH, 'utf8');
}

describe('D-60 audit integrity migration', () => {
  it('stores the sealed columns, the actor snapshot and the scope key', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/"scope_key" VARCHAR\(80\)/);
    expect(sql).toMatch(/"actor_snapshot" JSONB/);
    expect(sql).toMatch(/"snapshot_version" INTEGER NOT NULL DEFAULT 1/);
    expect(sql).toMatch(/"chain_seq" BIGINT/);
    expect(sql).toMatch(/"prev_hash" CHAR\(64\)/);
    expect(sql).toMatch(/"event_hash" CHAR\(64\)/);
  });

  it('requires a chain position and a hash together, and a predecessor past the first row', () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /CHECK \(\("chain_seq" IS NULL\) = \("event_hash" IS NULL\)\)/,
    );
    expect(sql).toMatch(
      /CHECK \(\("chain_seq" IS NULL\) OR \(\("chain_seq" = 1\) = \("prev_hash" IS NULL\)\)\)/,
    );
  });

  it('partitions audit rows by month with an overflow partition', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/PARTITION BY RANGE \("created_at"\)/);
    expect(sql).toMatch(
      /CREATE TABLE "audit_events_2026_01" PARTITION OF "audit_events" FOR VALUES FROM \('2026-01-01'\) TO \('2026-02-01'\)/,
    );
    expect(sql).toMatch(
      /CREATE TABLE "audit_events_2027_01" PARTITION OF "audit_events" FOR VALUES FROM \('2027-01-01'\) TO \('2027-02-01'\)/,
    );
    expect(sql).toMatch(
      /CREATE TABLE "audit_events_default" PARTITION OF "audit_events" DEFAULT/,
    );
  });

  it('copies the existing rows into the partitioned table before dropping it', () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /ALTER TABLE "audit_events" RENAME TO "audit_events_unpartitioned"/,
    );
    expect(sql).toMatch(/INSERT INTO "audit_events"/);
    expect(sql).toMatch(/FROM "audit_events_unpartitioned"/);
    expect(sql).toMatch(/DROP TABLE "audit_events_unpartitioned"/);
  });

  it('gives every legacy row a scope key, named platform when it has no tenant', () => {
    expect(migrationSql()).toMatch(
      /CASE WHEN "tenant_id" IS NULL THEN 'platform' ELSE 'tenant:' \|\| "tenant_id"::text END/,
    );
  });

  it('refuses an update, a delete and a truncate on the audit table', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/RAISE EXCEPTION 'audit_events is append-only'/);
    expect(sql).toMatch(/BEFORE UPDATE OR DELETE ON "audit_events"/);
    expect(sql).toMatch(/BEFORE TRUNCATE ON "audit_events"/);
  });

  it('keeps one chain head per scope', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CREATE TABLE "audit_chains"/);
    expect(sql).toMatch(/"scope_key" VARCHAR\(80\) PRIMARY KEY/);
    expect(sql).toMatch(/"last_seq" BIGINT NOT NULL/);
    expect(sql).toMatch(/"last_hash" CHAR\(64\)/);
  });

  it('records legal holds and a proposed retention period that is not approved', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/CREATE TABLE "audit_legal_holds"/);
    expect(sql).toMatch(/"released_at" TIMESTAMP\(3\)/);
    expect(sql).toMatch(/CREATE TABLE "audit_retention_policy"/);
    expect(sql).toMatch(/"approved_at" TIMESTAMP\(3\)/);
    expect(sql).toMatch(
      /INSERT INTO "audit_retention_policy" \("id", "period_years"\) VALUES \('platform', 7\)/,
    );
  });

  it('blocks a purge while a hold is active or the period is not approved', () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /RAISE EXCEPTION 'audit purge blocked: legal hold active'/,
    );
    expect(sql).toMatch(
      /RAISE EXCEPTION 'audit purge blocked: retention period not approved'/,
    );
    expect(sql).toMatch(/DROP TABLE %I/);
  });

  it('declares the same columns and chain tables in the Prisma schema', () => {
    const schema = schemaText();
    expect(schema).toMatch(
      /scopeKey\s+String\s+@map\("scope_key"\) @db.VarChar\(80\)/,
    );
    expect(schema).toMatch(/actorSnapshot\s+Json\?\s+@map\("actor_snapshot"\)/);
    expect(schema).toMatch(
      /snapshotVersion\s+Int\s+@default\(1\) @map\("snapshot_version"\)/,
    );
    expect(schema).toMatch(/chainSeq\s+BigInt\?\s+@map\("chain_seq"\)/);
    expect(schema).toMatch(
      /prevHash\s+String\?\s+@map\("prev_hash"\) @db.Char\(64\)/,
    );
    expect(schema).toMatch(
      /eventHash\s+String\?\s+@map\("event_hash"\) @db.Char\(64\)/,
    );
    expect(schema).toMatch(/@@id\(\[id, createdAt\]\)/);
    expect(schema).toMatch(/model AuditChain \{/);
    expect(schema).toMatch(/model AuditLegalHold \{/);
  });
});
