/**
 * T2.01 schema contract (AC-F05-2).
 *
 * These tests pin the two pieces of the schema the ticket state machine
 * depends on, so a later schema edit that drops them fails here rather than
 * silently weakening the database:
 *
 * 1. The generated Prisma client exposes `version` on Ticket and
 *    Conversation, which is what optimistic concurrency reads and writes.
 * 2. The committed migration file defines the CHECK constraints that make
 *    `version` non-negative and tie RESOLVED/CLOSED to their timestamps.
 *
 * Reading the migration file keeps this a pure unit test: no database is
 * needed, so it runs in the normal `npm run test` job.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Ticket, Conversation } from '@prisma/client';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the migration directory lives at the repository root.
const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0003_support_schema/migration.sql',
    import.meta.url,
  ),
);

describe('T2.01 support schema', () => {
  it('exposes version on Ticket and Conversation for optimistic concurrency', () => {
    // Type-level assertion: these assignments fail to compile if the
    // generated client drops the version field.
    const ticket: Pick<Ticket, 'version' | 'status'> = {
      version: 1,
      status: 'OPEN',
    };
    const conversation: Pick<Conversation, 'version' | 'status'> = {
      version: 0,
      status: 'OPEN',
    };

    expect(ticket.version).toBe(1);
    expect(conversation.version).toBe(0);
  });

  it('defines the state/version CHECK constraints in migration 0003', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toContain('tickets_version_nonnegative');
    expect(sql).toContain('conversations_version_nonnegative');
    expect(sql).toContain('tickets_resolved_requires_timestamp');
    expect(sql).toContain('tickets_closed_requires_timestamp');
  });

  it('ties RESOLVED and CLOSED to their lifecycle timestamps', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');

    expect(sql).toMatch(
      /tickets_resolved_requires_timestamp" CHECK \(\s*"status" <> 'RESOLVED' OR "resolved_at" IS NOT NULL/,
    );
    expect(sql).toMatch(
      /tickets_closed_requires_timestamp" CHECK \(\s*"status" <> 'CLOSED' OR \("resolved_at" IS NOT NULL AND "closed_at" IS NOT NULL\)/,
    );
  });
});
