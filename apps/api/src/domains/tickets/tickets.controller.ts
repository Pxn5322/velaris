/**
 * Guarded ticket routes (T1.03 route wiring).
 *
 * Every route runs SupabaseAuthGuard first (401 without a credential),
 * then PermissionsGuard (403 without the declared permission), then a
 * tenant scope check against the caller's own memberships: tenantId is a
 * required query parameter, and TenantsService.requireTenantAccess
 * refuses any tenant the caller has no ACTIVE membership in (AC-F04-3).
 * No tenant scope means no data (deny by default).
 */

import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { AuditService } from '../audit/audit.service.js';
import { CustomerScopeService } from '../customers/customer-scope.service.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TicketsService } from './tickets.service.js';
import { CreateOwnTicketDto } from './dto/create-own-ticket.dto.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';

/** Express request carrying the identity and the guard-resolved role. */
type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  role?: CanonicalRole | null;
};

@Controller('tickets')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly scope: CustomerScopeService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async create(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() createTicketDto: CreateTicketDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    if (createTicketDto.tenantId && createTicketDto.tenantId !== tenantId) {
      throw new BadRequestException(
        'Body tenantId must match the tenantId query parameter',
      );
    }
    // The query parameter is the tenant scope; it wins over any body value.
    const created = await this.ticketsService.create(
      Object.assign(createTicketDto, { tenantId }),
    );
    // T1.04: a successful mutation of a core record is security-sensitive.
    await this.audit.record({
      action: 'ticket.created',
      resourceType: 'ticket',
      resourceId: created.id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { title: created.title },
    });
    return created;
  }

  /**
   * Self-service ticket (T2.04 follow-up): an R-customer opens a ticket for
   * its own customer record. The tenant comes from the query scope, which
   * already passed the membership check, and the customer row comes from the
   * verified email; the client chooses neither, so this route cannot write
   * for another customer or tenant.
   */
  @Post('self')
  @RequirePermission(PERMISSIONS.TICKET_REQUEST)
  async createOwn(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() body: CreateOwnTicketDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    if (request.role !== 'R-customer') {
      throw new ForbiddenException(
        'Only a customer can open a self-service ticket',
      );
    }
    // Same contract as POST /tickets: a body tenantId may confirm the query
    // scope but never contradict it. Refused before any lookup or write.
    if (body.tenantId !== undefined && body.tenantId !== tenantId) {
      throw new BadRequestException(
        'Body tenantId must match the tenantId query parameter',
      );
    }
    const email = request.user?.email;
    if (!email) {
      // Deny by default: no verified address means no customer row to own it.
      throw new ForbiddenException(
        'A verified email is required to open a ticket',
      );
    }
    const customerId = await this.scope.resolveOrCreateCustomer(
      tenantId,
      email,
      email,
    );
    if (body.customerId !== undefined && body.customerId !== customerId) {
      throw new BadRequestException(
        "Body customerId must match the caller's customer record",
      );
    }
    const created = await this.ticketsService.create({
      title: body.title,
      priority: body.priority,
      tags: body.tags,
      customerId,
      tenantId,
      primaryConversationId: body.conversationId,
    });
    await this.audit.record({
      action: 'ticket.created',
      resourceType: 'ticket',
      resourceId: created.id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { title: created.title, channel: 'customer_portal' },
    });
    return created;
  }

  @Get()
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findAll(
    @Query('tenantId') tenantId: string,
    @Query('q') q: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    // Per-customer scope (T2.04): an R-customer sees only their own tickets.
    const scope = await this.resolveScope(request, tenantId);
    if (scope.kind === 'none') {
      return [];
    }
    // An optional phrase filters in the database, across the whole linked
    // thread (D-77); tenant scope and per-customer scope still apply.
    const rows = await this.ticketsService.findAll(tenantId, { query: q });
    return scope.kind === 'customer'
      ? rows.filter((row) => row.customerId === scope.customerId)
      : rows;
  }

  /** Eligible assignees are visible to agents and tenant administrators. */
  @Get('assignees')
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async listAssignees(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    if (request.role === 'R-customer') {
      throw new ForbiddenException('Customers cannot list ticket assignees');
    }
    return this.ticketsService.listAssignees(tenantId);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    // Scope first: a foreign ticket must not be looked up (T2.04).
    const scope = await this.resolveScope(request, tenantId);
    if (scope.kind === 'none') {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    const ticket = await this.ticketsService.findOne(id, tenantId);
    if (scope.kind === 'customer' && ticket.customerId !== scope.customerId) {
      throw new NotFoundException('Ticket with ID ' + id + ' not found');
    }
    return ticket;
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() updateTicketDto: UpdateTicketDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    const updated = await this.ticketsService.update(
      id,
      updateTicketDto,
      tenantId,
      request.user?.subject ?? null,
    );
    await this.audit.record({
      action:
        updateTicketDto.assigneeMembershipId !== undefined
          ? 'ticket.assigned'
          : 'ticket.updated',
      resourceType: 'ticket',
      resourceId: id,
      tenantId,
      actorId: request.user?.subject,
      metadata: {
        title: updated.title,
        ...(updateTicketDto.assigneeMembershipId !== undefined
          ? { assigneeMembershipId: updated.assigneeMembershipId }
          : {}),
      },
    });
    return updated;
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    const result = await this.ticketsService.remove(id, tenantId);
    await this.audit.record({
      action: 'ticket.deleted',
      resourceType: 'ticket',
      resourceId: id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { success: result.success },
    });
    return result;
  }

  /**
   * Deny by default: no tenant scope means no data. The scope must be a
   * tenant the caller holds an ACTIVE membership in; a guessed ID from
   * another tenant raises 403 through requireTenantAccess.
   */
  private async requireTenantScope(
    request: AuthedRequest,
    tenantId: string,
  ): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('tenantId query parameter is required');
    }
    const identity = request.user as AuthenticatedIdentity;
    const context = await this.tenants.resolveContext(
      identity.provider,
      identity.subject,
    );
    if (!context) {
      throw new ForbiddenException('No tenant context for this identity');
    }
    await this.tenants.requireTenantAccess(context.userId, tenantId);
  }

  /** Per-customer data scope from the guard-resolved role and identity. */
  private resolveScope(request: AuthedRequest, tenantId: string) {
    return this.scope.resolve(
      tenantId,
      request.role ?? null,
      request.user?.email,
    );
  }
}
