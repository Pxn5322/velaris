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
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import type {
  AuthenticatedIdentity,
} from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { AuditService } from '../audit/audit.service.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { TicketsService } from './tickets.service.js';
import { CreateTicketDto } from './dto/create-ticket.dto.js';
import { UpdateTicketDto } from './dto/update-ticket.dto.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('tickets')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class TicketsController {
  constructor(
    private readonly ticketsService: TicketsService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
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
    const created = this.ticketsService.create(
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

  @Get()
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findAll(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.ticketsService.findAll(tenantId);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findOne(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.ticketsService.findOne(id, tenantId);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async update(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() updateTicketDto: UpdateTicketDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    const updated = this.ticketsService.update(id, updateTicketDto, tenantId);
    await this.audit.record({
      action: 'ticket.updated',
      resourceType: 'ticket',
      resourceId: id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { title: updated.title },
    });
    return updated;
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async remove(
    @Param('id') id: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    const result = this.ticketsService.remove(id, tenantId);
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
}
