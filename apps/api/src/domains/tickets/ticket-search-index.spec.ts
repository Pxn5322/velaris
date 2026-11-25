/**
 * Inbox search index contract (D-80; D-77, D-78 follow-up).
 *
 * The inbox queue search runs a case-insensitive `contains` (Prisma `ILIKE
 * '%phrase%'`) over customer-visible CUSTOMER message bodies, customer names
 * and emails, and ticket titles. A b-tree cannot serve a leading wildcard, so
 * migration 0019 adds one pg_trgm GIN index per searched column. These tests
 * read the committed migration file, so a later edit that drops the extension
 * or an index fails here instead of silently returning to a full scan. No
 * database is needed, so they run in the normal `npm run test` job.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0019_inbox_search_index/migration.sql',
    import.meta.url,
  ),
);

function migrationSql(): string {
  expect(existsSync(MIGRATION_PATH)).toBe(true);
  return readFileSync(MIGRATION_PATH, 'utf8');
}

describe('D-80 inbox search indexes', () => {
  it('enables the pg_trgm extension the GIN indexes need', () => {
    expect(migrationSql()).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm;/);
  });

  it('indexes customer-visible CUSTOMER message bodies with trigrams', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "messages_customer_body_trgm_idx"\s+ON "messages" USING GIN \("body" gin_trgm_ops\)/,
    );
  });

  it('keeps internal notes and agent replies out of the message index', () => {
    // The partial predicate must be exactly the visibility rule the service
    // filters on (TH-05), so an unreadable message is never searched.
    expect(migrationSql()).toMatch(
      /WHERE "author_type" = 'CUSTOMER' AND "visibility" = 'CUSTOMER_VISIBLE'/,
    );
  });

  it('indexes the customer name and email the queue search reads', () => {
    const sql = migrationSql();
    expect(sql).toMatch(
      /CREATE INDEX "customers_display_name_trgm_idx"\s+ON "customers" USING GIN \("display_name" gin_trgm_ops\)/,
    );
    expect(sql).toMatch(
      /CREATE INDEX "customers_email_trgm_idx"\s+ON "customers" USING GIN \("email" gin_trgm_ops\)/,
    );
  });

  it('indexes the ticket title the queue search reads', () => {
    expect(migrationSql()).toMatch(
      /CREATE INDEX "tickets_title_trgm_idx"\s+ON "tickets" USING GIN \("title" gin_trgm_ops\)/,
    );
  });
});
