/**
 * Tenant-scoping helpers for isolation tests (TH-01, AC-F04-3).
 *
 * These helpers model a repository that filters by tenant. Tests assert that
 * a tenant A query never returns a tenant B row, and that an internal note
 * never leaks into a customer-facing result (TH-05).
 */

import type { MessageFixture, TicketFixture } from './fixtures/tenants.js';

/**
 * Return only the rows owned by `tenantId`.
 *
 * Use this to model the expected result of a tenant-scoped read. A real
 * repository query must return the same set. Any row whose `tenantId` differs
 * is a tenant escape and a test failure.
 */
export function scopeByTenant<T extends { tenantId: string }>(
  rows: readonly T[],
  tenantId: string,
): T[] {
  return rows.filter((row) => row.tenantId === tenantId);
}

/**
 * Return only the messages a customer is allowed to see.
 *
 * An `internalNote` must never appear in a customer-facing response (TH-05).
 * Use this to model the expected serialization of a ticket timeline.
 */
export function customerVisibleMessages(
  messages: readonly MessageFixture[],
): MessageFixture[] {
  return messages.filter((message) => message.visibility === 'customerVisible');
}

/**
 * Return only the tickets owned by `tenantId`.
 *
 * Convenience wrapper over `scopeByTenant` for ticket lists.
 */
export function ticketsForTenant(
  tickets: readonly TicketFixture[],
  tenantId: string,
): TicketFixture[] {
  return scopeByTenant(tickets, tenantId);
}

/**
 * Report a tenant escape: any row that does not belong to `tenantId`.
 *
 * Assert this returns an empty array after every tenant-scoped read. A non-
 * empty result is the exact cross-tenant leak that the isolation suites block.
 */
export function findTenantEscapes<T extends { tenantId: string; id: string }>(
  rows: readonly T[],
  tenantId: string,
): T[] {
  return rows.filter((row) => row.tenantId !== tenantId);
}
