/**
 * Ticket row as Prisma returns it (T2.02).
 *
 * Mirrors model Ticket in prisma/schema.prisma. Status and lifecycle
 * fields come straight from the database; the status union matches the
 * TicketStatus enum, including PENDING_CUSTOMER (the prototype's
 * PENDING value no longer exists).
 */

import type { TicketStatus } from './ticket-transitions.js';

export type { TicketStatus };

export interface Ticket {
  id: string;
  tenantId: string;
  customerId: string;
  title: string;
  status: TicketStatus;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  slaState: string;
  assigneeMembershipId: string | null;
  tags: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
}
