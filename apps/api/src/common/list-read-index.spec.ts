/**
 * List read index contract for the audit and customer routes (D-86).
 *
 * `GET /audit/events` filters by action and reads newest first, and
 * `GET /customers` reads one tenant page oldest first. Neither read had an
 * index in that order, so the planner found the rows and then sorted them.
 * These tests read the committed migration and the Prisma schema, so a later
 * edit that drops an index or leaves the schema behind fails here instead of
 * quietly bringing the sort back. No database is needed, so they run in the
 * normal `npm run test` job.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../prisma/migrations/0022_list_read_indexes/migration.sql',
    import.meta.url,
  ),
);
const PLATFORM_MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../prisma/migrations/0023_platform_directory_page/migration.sql',
    import.meta.url,
  ),
);
const TEXT_SEARCH_MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../prisma/migrations/0024_directory_text_search/migration.sql',
    import.meta.url,
  ),
);
const SCHEMA_PATH = fileURLToPath(
  new URL('../../../../prisma/schema.prisma', import.meta.url),
);

function migrationSql(): string {
  expect(existsSync(MIGRATION_PATH)).toBe(true);
  return readFileSync(MIGRATION_PATH, 'utf8');
}

function platformMigrationSql(): string {
  expect(existsSync(PLATFORM_MIGRATION_PATH)).toBe(true);
  return readFileSync(PLATFORM_MIGRATION_PATH, 'utf8');
}

function textSearchMigrationSql(): string {
  expect(existsSync(TEXT_SEARCH_MIGRATION_PATH)).toBe(true);
  return readFileSync(TEXT_SEARCH_MIGRATION_PATH, 'utf8');
}

function modelBlock(name: string): string {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const start = schema.indexOf('model ' + name + ' {');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = schema.indexOf('}', start);
  return schema.slice(start, end);
}

describe('D-86 list read indexes', () => {
  it('orders the filtered audit page by the sort column', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "audit_events_tenant_id_action_created_at_idx"\s+ON "audit_events"\("tenant_id", "action", "created_at" DESC\)/,
    );
  });

  it('orders the customer page by the sort column', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "customers_tenant_id_created_at_idx"\s+ON "customers"\("tenant_id", "created_at"\)/,
    );
  });

  it('declares both indexes in the Prisma schema', () => {
    expect(modelBlock('AuditEvent')).toContain(
      '@@index([tenantId, action, createdAt(sort: Desc)])',
    );
    expect(modelBlock('Customer')).toContain('@@index([tenantId, createdAt])');
  });
});

describe('D-87 platform directory page indexes', () => {
  it('orders the membership page by the sort columns', () => {
    expect(platformMigrationSql()).toMatch(
      /CREATE INDEX "tenant_memberships_created_at_id_idx"\s+ON "tenant_memberships"\("created_at", "id"\)/,
    );
  });

  it('keeps the status-filtered page in the same order', () => {
    expect(platformMigrationSql()).toMatch(
      /CREATE INDEX "tenant_memberships_status_created_at_id_idx"\s+ON "tenant_memberships"\("status", "created_at", "id"\)/,
    );
  });

  it('declares both membership indexes in the Prisma schema', () => {
    const membership = modelBlock('TenantMembership');
    expect(membership).toContain('@@index([createdAt, id])');
    expect(membership).toContain('@@index([status, createdAt, id])');
  });
});

describe('D-87 platform directory text search indexes', () => {
  it('indexes the account email and name for a leading-wildcard match', () => {
    const sql = textSearchMigrationSql();
    expect(sql).toMatch(
      /CREATE INDEX "users_email_normalized_trgm_idx"\s+ON "users" USING GIN \("email_normalized" gin_trgm_ops\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX "users_display_name_trgm_idx"\s+ON "users" USING GIN \("display_name" gin_trgm_ops\)/,
    );
  });

  it('indexes the tenant name for the same match', () => {
    expect(textSearchMigrationSql()).toMatch(
      /CREATE INDEX "tenants_name_trgm_idx"\s+ON "tenants" USING GIN \("name" gin_trgm_ops\)/,
    );
  });

  it('enables pg_trgm and names the migration in the schema', () => {
    expect(textSearchMigrationSql()).toMatch(
      /CREATE EXTENSION IF NOT EXISTS pg_trgm/,
    );
    // Prisma cannot model GIN or trigram indexes, so the models carry a note.
    expect(modelBlock('User')).toContain('0024_directory_text_search');
    expect(modelBlock('Tenant')).toContain('0024_directory_text_search');
  });
});
