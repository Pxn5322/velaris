/**
 * Ticket domain service (T2.02, F-05).
 *
 * Replaces the prototype in-memory service: rows now live in the tickets
 * table from migration 0003_support_schema (D-02, Prisma). Domain rules:
 * - every read and write is tenant-scoped; a cross-tenant id reads as
 *   not found, never as data (AC-F04-3, TH-01)
 * - status changes must follow ticket-transitions.ts; anything else is
 *   409 (AC-F05-2)
 * - updates are optimistic-concurrent: the caller may send
 *   `expectedVersion`, and every write pins the version it read inside
 *   the UPDATE ... WHERE, so a lost update is 409, never silent
 *   (AC-F05-2)
 * - an assignee must be an ACTIVE membership of the same tenant
 *   (AC-F05-1)
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';
import {
  assertTransition,
  isTicketStatus,
  lifecycleTimestamps,
  type TicketStatus,
} from './ticket-transitions.js';

/** TicketPriority values from prisma/schema.prisma. */
const TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
type TicketPriority = (typeof TICKET_PRIORITIES)[number];

@Injectable()
export class TicketsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async create(createTicketDto: CreateTenantScopedCreate) {
    requireText(createTicketDto.title, 'title');
    requireText(createTicketDto.customerId, 'customerId');
    requireText(createTicketDto.tenantId, 'tenantId');
    const priority = createTicketDto.priority ?? 'MEDIUM';
    requireOneOf(priority, TICKET_PRIORITIES, 'priority');

    return this.prisma.ticket.create({
      data: {
        tenantId: createTicketDto.tenantId,
        customerId: createTicketDto.customerId,
        title: createTicketDto.title,
        priority,
      },
    });
  }

  /** Tenant-scoped list, newest change first. */
  findAll(tenantId: string) {
    return this.prisma.ticket.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    return this.requireTicket(id, tenantId);
  }

  async update(id: string, updateTicketDto: UpdateTicketDto, tenantId: string) {
    const current = await this.requireTicket(id, tenantId);

    if (updateTicketDto.status !== undefined) {
      if (!isTicketStatus(updateTicketDto.status)) {
        throw new BadRequestException(
          'status must be one of ' +
            [
              'OPEN',
              'IN_PROGRESS',
              'PENDING_CUSTOMER',
              'RESOLVED',
              'CLOSED',
            ].join(', '),
        );
      }
      if (updateTicketDto.status !== current.status) {
        assertTransition(
          current.status,
          updateTicketDto.status as TicketStatus,
        );
      }
    }
    if (updateTicketDto.priority !== undefined) {
      requireOneOf(updateTicketDto.priority, TICKET_PRIORITIES, 'priority');
    }
    if (
      updateTicketDto.expectedVersion !== undefined &&
      updateTicketDto.expectedVersion !== current.version
    ) {
      throw new ConflictException(
        'Stale ticket version: expected ' +
          updateTicketDto.expectedVersion +
          ' but the current version is ' +
          current.version,
      );
    }
    if (updateTicketDto.assigneeMembershipId !== undefined) {
      await this.assertAssignableMembership(
        updateTicketDto.assigneeMembershipId,
        tenantId,
      );
    }

    const data: Record<string, unknown> = { version: current.version + 1 };
    if (updateTicketDto.title !== undefined) {
      data.title = updateTicketDto.title;
    }
    if (updateTicketDto.priority !== undefined) {
      data.priority = updateTicketDto.priority;
    }
    if (updateTicketDto.assigneeMembershipId !== undefined) {
      data.assigneeMembershipId = updateTicketDto.assigneeMembershipId;
    }
    if (updateTicketDto.status !== undefined) {
      data.status = updateTicketDto.status;
      if (updateTicketDto.status !== current.status) {
        Object.assign(
          data,
          lifecycleTimestamps(
            current.status as TicketStatus,
            updateTicketDto.status as TicketStatus,
            current,
          ),
        );
      }
    }

    // The WHERE pins id, tenant and the version that was just read, so a
    // concurrent writer makes count 0 instead of a silent lost update.
    const result = await this.prisma.ticket.updateMany({
      where: { id, tenantId, version: current.version },
      data,
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Ticket was modified concurrently; re-read it and retry',
      );
    }
    // The guarded write above proved the row exists in this tenant.
    const written = await this.prisma.ticket.findUnique({ where: { id } });
    if (!written) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    return written;
  }

  async remove(id: string, tenantId: string): Promise<{ success: boolean }> {
    await this.requireTicket(id, tenantId);
    await this.prisma.ticket.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Tenant scope is not a filter, it is existence: a ticket of another
   * tenant reads as not found (AC-F04-3, TH-01).
   */
  private async requireTicket(id: string, tenantId: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket || ticket.tenantId !== tenantId) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    return ticket;
  }

  /** The assignee must be an ACTIVE membership of this same tenant. */
  private async assertAssignableMembership(
    assigneeMembershipId: string,
    tenantId: string,
  ) {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { id: assigneeMembershipId },
      select: { tenantId: true, status: true },
    });
    if (
      !membership ||
      membership.tenantId !== tenantId ||
      membership.status !== 'ACTIVE'
    ) {
      throw new BadRequestException(
        'assigneeMembershipId must be an ACTIVE membership in this tenant',
      );
    }
  }
}

/** Create input: the DTO, narrowed so TS sees the required fields. */
type CreateTenantScopedCreate = CreateTicketDto & {
  title: string;
  customerId: string;
  tenantId: string;
  priority?: TicketPriority;
};

function requireText(value: string | undefined, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(field + ' is required');
  }
}

function requireOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
  field: string,
): asserts value is T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new BadRequestException(
      field + ' must be one of ' + allowed.join(', '),
    );
  }
}
