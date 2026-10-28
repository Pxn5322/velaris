/**
 * Ticket transition rules (T2.02, AC-F05-2).
 *
 * Pure domain module: no Prisma, no HTTP. The map is the single source of
 * truth for which status changes a ticket may make. CLOSED is terminal.
 * An invalid transition raises ConflictException, which the service maps
 * to HTTP 409. Lifecycle timestamps must satisfy the schema CHECK
 * constraints from migration 0003_support_schema: RESOLVED and CLOSED
 * rows carry resolved_at / closed_at.
 */

import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  TICKET_STATUSES,
  assertTransition,
  canTransition,
  lifecycleTimestamps,
  type TicketStatus,
} from './ticket-transitions.js';

describe('ticket transition rules', () => {
  it('defines an entry for every schema status', () => {
    for (const status of TICKET_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });

  it('allows the main support path OPEN -> IN_PROGRESS -> RESOLVED -> CLOSED', () => {
    expect(canTransition('OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'RESOLVED')).toBe(true);
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
  });

  it('allows waiting on the customer and resuming afterwards', () => {
    expect(canTransition('IN_PROGRESS', 'PENDING_CUSTOMER')).toBe(true);
    expect(canTransition('PENDING_CUSTOMER', 'IN_PROGRESS')).toBe(true);
  });

  it('allows reopening a resolved ticket', () => {
    expect(canTransition('RESOLVED', 'IN_PROGRESS')).toBe(true);
  });

  it('treats CLOSED as terminal', () => {
    for (const status of TICKET_STATUSES) {
      expect(canTransition('CLOSED', status)).toBe(false);
    }
  });

  it('rejects an invalid transition with 409 (AC-F05-2)', () => {
    expect(() => assertTransition('PENDING_CUSTOMER', 'OPEN')).toThrow(
      ConflictException,
    );
    expect(() => assertTransition('CLOSED', 'IN_PROGRESS')).toThrow(
      ConflictException,
    );
  });

  it('accepts a valid transition without throwing', () => {
    expect(() => assertTransition('OPEN', 'RESOLVED')).not.toThrow();
  });

  it('sets resolvedAt when entering RESOLVED', () => {
    const data = lifecycleTimestamps('IN_PROGRESS', 'RESOLVED', {
      resolvedAt: null,
      closedAt: null,
    });
    expect(data.resolvedAt).toBeInstanceOf(Date);
  });

  it('clears resolvedAt when a resolved ticket reopens', () => {
    const data = lifecycleTimestamps('RESOLVED', 'IN_PROGRESS', {
      resolvedAt: new Date(),
      closedAt: null,
    });
    expect(data.resolvedAt).toBeNull();
  });

  it('sets closedAt when a ticket closes and never leaves CLOSED', () => {
    const data = lifecycleTimestamps('RESOLVED', 'CLOSED', {
      resolvedAt: new Date(),
      closedAt: null,
    });
    expect(data.closedAt).toBeInstanceOf(Date);
    const exits = ALLOWED_TRANSITIONS['CLOSED'] as readonly TicketStatus[];
    expect(exits).toHaveLength(0);
  });

  it('keeps resolvedAt when a resolved ticket closes', () => {
    // Migration 0003 CHECK tickets_closed_requires_timestamp demands BOTH
    // timestamps on a CLOSED row, so closing must not clear resolvedAt.
    const resolvedAt = new Date();
    const data = lifecycleTimestamps('RESOLVED', 'CLOSED', {
      resolvedAt,
      closedAt: null,
    });
    expect(data.resolvedAt).toBeUndefined();
    expect(data.closedAt).toBeInstanceOf(Date);
  });

  it('refuses a direct close without resolving first (migration-0003 invariant)', () => {
    // The live CHECK constraint requires resolved_at on a CLOSED ticket:
    // a close from any pre-resolve status would violate it (found by the
    // 2026-10-28 live check, which saw 500 instead of a clean refusal).
    expect(canTransition('OPEN', 'CLOSED')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CLOSED')).toBe(false);
    expect(canTransition('PENDING_CUSTOMER', 'CLOSED')).toBe(false);
    expect(() => assertTransition('IN_PROGRESS', 'CLOSED')).toThrow(
      ConflictException,
    );
  });
});
