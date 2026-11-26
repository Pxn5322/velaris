/**
 * Paged-list index contract (D-84).
 *
 * Both bounded list routes read `where tenantId`, sometimes `where customerId`,
 * and `order by updatedAt desc`. A composite index in that same order lets the
 * database return the page without a sort step. These tests read the committed
 * migration and the Prisma schema, so a later edit that drops an index or leaves
 * the schema out of step fails here instead of quietly returning to a sort or a
 * full scan. No database is needed, so they run in the normal `npm run test`
 * job.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../prisma/migrations/0020_paged_list_indexes/migration.sql',
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

function modelBlock(name: string): string {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  const start = schema.indexOf('model ' + name + ' {');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = schema.indexOf('}', start);
  return schema.slice(start, end);
}

describe('D-84 paged-list indexes', () => {
  it('indexes the customer page of the ticket queue in read order', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "tickets_tenant_id_customer_id_updated_at_idx"\s+ON "tickets"\("tenant_id", "customer_id", "updated_at" DESC\)/,
    );
  });

  it('indexes the customer page of the conversation list in read order', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "conversations_tenant_id_customer_id_updated_at_idx"\s+ON "conversations"\("tenant_id", "customer_id", "updated_at" DESC\)/,
    );
  });

  it('drops the narrower conversation index that the new one prefixes', () => {
    expect(migrationSql()).toMatch(
      /DROP INDEX "conversations_tenant_id_customer_id_idx";/,
    );
  });

  it('declares the same indexes in the Prisma schema', () => {
    expect(modelBlock('Ticket')).toContain(
      '@@index([tenantId, customerId, updatedAt(sort: Desc)])',
    );
    expect(modelBlock('Conversation')).toContain(
      '@@index([tenantId, customerId, updatedAt(sort: Desc)])',
    );
    // The dropped index must not stay in the schema, or migrate would re-create
    // it and the two sources would disagree.
    expect(modelBlock('Conversation')).not.toContain(
      '@@index([tenantId, customerId])',
    );
  });
});
