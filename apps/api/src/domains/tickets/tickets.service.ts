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
 *   with an agent or tenant-administrator role (AC-F05-1)
 * - every assignee change appends a ticket_assignments row in the same
 *   transaction as the ticket update
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

/** Roles that can receive support tickets. Custom roles inherit one of these. */
const ASSIGNABLE_ROLE_CODES = ['R-agent', 'R-tenant-admin'] as const;

export interface TicketAssignee {
  membershipId: string;
  userId: string;
  displayName: string;
  email: string;
  roles: string[];
}

@Injectable()
export class TicketsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async create(createTicketDto: CreateTenantScopedCreate) {
    requireText(createTicketDto.title, 'title');
    requireText(createTicketDto.customerId, 'customerId');
    requireText(createTicketDto.tenantId, 'tenantId');
    const priority = createTicketDto.priority ?? 'MEDIUM';
    requireOneOf(priority, TICKET_PRIORITIES, 'priority');
    const tags = normalizeTags(createTicketDto.tags);

    // A linked conversation carries the customer's description, so it must be
    // a conversation of the same customer in the same tenant; anything else
    // is a client contradiction, not a lookup that may silently pass.
    if (createTicketDto.primaryConversationId !== undefined) {
      requireText(createTicketDto.primaryConversationId, 'conversationId');
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: createTicketDto.primaryConversationId },
        select: { tenantId: true, customerId: true },
      });
      if (
        !conversation ||
        conversation.tenantId !== createTicketDto.tenantId ||
        conversation.customerId !== createTicketDto.customerId
      ) {
        throw new BadRequestException(
          'conversationId must reference your own conversation in this tenant',
        );
      }
    }

    return this.prisma.ticket.create({
      data: {
        tenantId: createTicketDto.tenantId,
        customerId: createTicketDto.customerId,
        title: createTicketDto.title.trim(),
        priority,
        tags,
        ...(createTicketDto.primaryConversationId
          ? { primaryConversationId: createTicketDto.primaryConversationId }
          : {}),
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

  /** Active agents and tenant administrators who can receive tickets. */
  async listAssignees(tenantId: string): Promise<TicketAssignee[]> {
    const rows = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        roles: {
          some: {
            role: {
              OR: [
                { code: { in: [...ASSIGNABLE_ROLE_CODES] } },
                { baseRoleCode: { in: [...ASSIGNABLE_ROLE_CODES] } },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        userId: true,
        user: { select: { displayName: true, emailNormalized: true } },
        roles: { select: { role: { select: { code: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((row) => ({
      membershipId: row.id,
      userId: row.userId,
      displayName: row.user.displayName,
      email: row.user.emailNormalized,
      roles: row.roles.map((membershipRole) => membershipRole.role.code),
    }));
  }

  async update(
    id: string,
    updateTicketDto: UpdateTicketDto,
    tenantId: string,
    actorId: string | null = null,
  ) {
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
    const requestedAssignee = updateTicketDto.assigneeMembershipId;
    const assignmentChanged =
      requestedAssignee !== undefined &&
      requestedAssignee !== current.assigneeMembershipId;
    if (assignmentChanged && requestedAssignee !== null) {
      await this.assertAssignableMembership(requestedAssignee, tenantId);
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

    return this.prisma.$transaction(async (tx) => {
      // The WHERE pins id, tenant and the version that was just read, so a
      // concurrent writer makes count 0 instead of a silent lost update.
      const result = await tx.ticket.updateMany({
        where: { id, tenantId, version: current.version },
        data,
      });
      if (result.count === 0) {
        throw new ConflictException(
          'Ticket was modified concurrently; re-read it and retry',
        );
      }
      if (assignmentChanged) {
        await tx.ticketAssignment.create({
          data: {
            tenantId,
            ticketId: id,
            fromMembershipId: current.assigneeMembershipId,
            toMembershipId: updateTicketDto.assigneeMembershipId ?? null,
            actorId,
          },
        });
      }
      // The guarded write above proved the row exists in this tenant.
      const written = await tx.ticket.findUnique({ where: { id } });
      if (!written) {
        throw new NotFoundException('Ticket with ID ' + id + ' not found');
      }
      return written;
    });
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

  /** The assignee must be an ACTIVE agent/admin membership of this tenant. */
  private async assertAssignableMembership(
    assigneeMembershipId: string,
    tenantId: string,
  ) {
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { id: assigneeMembershipId },
      select: {
        tenantId: true,
        status: true,
        roles: {
          select: { role: { select: { code: true, baseRoleCode: true } } },
        },
      },
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
    const canReceiveTickets = membership.roles.some((membershipRole) => {
      const role = membershipRole.role;
      return (
        (ASSIGNABLE_ROLE_CODES as readonly string[]).includes(role.code) ||
        (role.baseRoleCode !== null &&
          (ASSIGNABLE_ROLE_CODES as readonly string[]).includes(
            role.baseRoleCode,
          ))
      );
    });
    if (!canReceiveTickets) {
      throw new BadRequestException(
        'assigneeMembershipId must hold an agent or tenant administrator role',
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
  tags?: string[];
  primaryConversationId?: string;
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

/** Ticket labels: at most five short, trimmed, non-empty strings. */
const MAX_TAGS = 5;
const MAX_TAG_LENGTH = 40;

function normalizeTags(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException('tags must be an array of strings');
  }
  if (value.length > MAX_TAGS) {
    throw new BadRequestException(
      'tags must hold at most ' + MAX_TAGS + ' values',
    );
  }
  return value.map((tag) => {
    if (typeof tag !== 'string' || tag.trim().length === 0) {
      throw new BadRequestException('tags must hold non-empty strings');
    }
    const trimmed = tag.trim();
    if (trimmed.length > MAX_TAG_LENGTH) {
      throw new BadRequestException(
        'each tag must be at most ' + MAX_TAG_LENGTH + ' characters',
      );
    }
    return trimmed;
  });
}
