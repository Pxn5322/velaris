/**
 * Audit scope guard contract for migration 0026 (T6.10; D-60, D-88).
 *
 * The event hash covers the scope key, never the live `tenant_id`. The
 * `tenant_id` column is a foreign key to `tenants`, so a tenant delete or an id
 * change would rewrite history that was already hashed. Migration 0026 makes
 * the relation `NO ACTION` on both delete and update, and a CHECK pairs a null
 * `tenant_id` with the `platform` scope, so the two columns cannot disagree.
 *
 * These tests read the committed migration and the Prisma schema. No database
 * is needed, so they run in the normal `npm run test` job.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MIGRATION_PATH = fileURLToPath(
  new URL(
    '../../../../../prisma/migrations/0026_audit_scope_guard/migration.sql',
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

describe('D-88 audit scope guard migration', () => {
  it('replaces the tenant foreign key with one that refuses a rewrite', () => {
    const sql = migrationSql();
    expect(sql).toMatch(/DROP CONSTRAINT "audit_events_tenant_id_fkey"/);
    expect(sql).toMatch(
      /FOREIGN KEY \("tenant_id"\) REFERENCES "tenants"\("id"\)[\s\S]*?ON DELETE NO ACTION ON UPDATE NO ACTION/,
    );
  });

  it('keeps no cascade or set-null rule on the audit history', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/ON DELETE SET NULL/);
    expect(sql).not.toMatch(/ON UPDATE CASCADE/);
    expect(sql).not.toMatch(/ON DELETE CASCADE/);
  });

  it('ties a null tenant id to the platform scope', () => {
    expect(migrationSql()).toMatch(
      /CHECK \(\("tenant_id" IS NULL\) = \("scope_key" = 'platform'\)\)/,
    );
  });

  it('declares the same relation behaviour in the Prisma schema', () => {
    expect(schemaText()).toMatch(
      /tenant\s+Tenant\?\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: NoAction, onUpdate: NoAction\)/,
    );
  });
});
