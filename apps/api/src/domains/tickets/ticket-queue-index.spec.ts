/**
 * Queue filter index contract (D-85).
 *
 * The inbox queue filters by status and by assignee, then takes one window of
 * `order by updated_at desc`. Indexes that stop at `status` find the rows but
 * leave the sort, so migration 0021 extends both filter indexes with the sort
 * column. These tests read the committed migration and the Prisma schema, so a
 * later edit that shortens an index or leaves the schema behind fails here
 * instead of quietly bringing the sort back. No database is needed, so they run
 * in the normal `npm run test` job.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0021_queue_filter_indexes/migration.sql',
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

function ticketModel(): string {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const start = schema.indexOf('model Ticket {');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = schema.indexOf('}', start);
  return schema.slice(start, end);
}

describe('D-85 queue filter indexes', () => {
  it('orders the status page by the sort column inside the index', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "tickets_tenant_id_status_updated_at_idx"\s+ON "tickets"\("tenant_id", "status", "updated_at" DESC\)/,
    );
  });

  it('orders the assigned page by the sort column inside the index', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "tickets_tenant_id_assignee_membership_id_status_updated_at_idx"\s+ON "tickets"\("tenant_id", "assignee_membership_id", "status", "updated_at" DESC\)/,
    );
  });

  it('drops the shorter filter indexes the new ones replace', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/DROP INDEX "tickets_tenant_id_status_idx";/);
    expect(sql).toMatch(
      /DROP INDEX "tickets_tenant_id_assignee_membership_id_status_idx";/,
    );
  });

  it('declares the extended indexes in the Prisma schema', () => {
    const model = ticketModel();
    expect(model).toContain(
      '@@index([tenantId, status, updatedAt(sort: Desc)])',
    );
    expect(model).toContain(
      '@@index([tenantId, assigneeMembershipId, status, updatedAt(sort: Desc)])',
    );
    // The shortened forms must not stay, or migrate would re-create them.
    expect(model).not.toContain('@@index([tenantId, status])');
    expect(model).not.toContain(
      '@@index([tenantId, assigneeMembershipId, status])',
    );
  });
});
