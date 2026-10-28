/**
 * Update-ticket input (T2.02, AC-F05-2).
 *
 * `expectedVersion` is the optimistic-concurrency guard: send the
 * version the client last read and a stale value is refused with 409.
 * Status values match the TicketStatus enum in prisma/schema.prisma.
 */
export class UpdateTicketDto {
  title?: string;
  status?: 'OPEN' | 'IN_PROGRESS' | 'PENDING_CUSTOMER' | 'RESOLVED' | 'CLOSED';
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assigneeMembershipId?: string;
  expectedVersion?: number;
}
