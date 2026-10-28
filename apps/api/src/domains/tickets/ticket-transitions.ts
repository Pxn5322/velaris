/**
 * Ticket transition rules (T2.02, AC-F05-2).
 *
 * Pure domain module: no Prisma, no HTTP. ALLOWED_TRANSITIONS is the
 * single source of truth for legal status changes. CLOSED is terminal,
 * RESOLVED can reopen into IN_PROGRESS, and every other move must go
 * through the map or it is refused with 409 (ConflictException).
 *
 * Lifecycle timestamps keep the migration 0003_support_schema CHECK
 * constraints satisfied: a RESOLVED row carries resolved_at, a CLOSED
 * row carries closed_at, and reopening clears resolved_at again.
 */

import { ConflictException } from '@nestjs/common';

/** The five TicketStatus values from prisma/schema.prisma. */
export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'PENDING_CUSTOMER',
  'RESOLVED',
  'CLOSED',
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Legal successor statuses per status. CLOSED has no successors: it is
 * terminal, and it is reachable only from RESOLVED. Migration 0003's
 * CHECK tickets_closed_requires_timestamp demands both resolved_at and
 * closed_at on a CLOSED row, so a close before resolution would violate
 * the live invariant (Proposed D-16, found by the 2026-10-28 live check).
 */
export const ALLOWED_TRANSITIONS: Record<
  TicketStatus,
  readonly TicketStatus[]
> = {
  OPEN: ['IN_PROGRESS', 'PENDING_CUSTOMER', 'RESOLVED'],
  IN_PROGRESS: ['OPEN', 'PENDING_CUSTOMER', 'RESOLVED'],
  PENDING_CUSTOMER: ['IN_PROGRESS', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: [],
};

/** Narrow an unknown string to a schema status, or null. */
export function isTicketStatus(value: unknown): value is TicketStatus {
  return (
    typeof value === 'string' &&
    (TICKET_STATUSES as readonly string[]).includes(value)
  );
}

/** True when the transition is allowed by the map. */
export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Refuse an illegal transition with 409 (AC-F05-2). */
export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictException(
      'Invalid ticket status transition ' + from + ' -> ' + to,
    );
  }
}

/** Timestamp fields the lifecycle rules change on a status transition. */
export interface LifecycleTimestamps {
  resolvedAt?: Date | null;
  closedAt?: Date | null;
}

/**
 * Lifecycle timestamps for a status change. The clock value is one
 * `now` so both fields agree inside one write.
 */
export function lifecycleTimestamps(
  _from: TicketStatus,
  to: TicketStatus,
  current: { resolvedAt: Date | null; closedAt: Date | null },
): LifecycleTimestamps {
  const data: LifecycleTimestamps = {};
  // The service only calls this for a changed status, so `to === RESOLVED`
  // implies `from !== RESOLVED` (same-status updates skip the transition).
  if (to === 'RESOLVED') {
    data.resolvedAt = new Date();
  }
  // Reopening clears resolved_at; closing keeps it (migration 0003 CHECK
  // tickets_closed_requires_timestamp requires both timestamps).
  if (to !== 'RESOLVED' && to !== 'CLOSED' && current.resolvedAt) {
    data.resolvedAt = null;
  }
  if (to === 'CLOSED') {
    data.closedAt = new Date();
  }
  return data;
}
