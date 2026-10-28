/**
 * Guarded customer routes (T2.03, AC-F05-3 on this surface).
 *
 * The prototype exposed unguarded create/list routes over an in-memory
 * store. The replacement runs SupabaseAuthGuard, then PermissionsGuard,
 * then the same tenant scope check as tickets: no scope means no data,
 * a guessed foreign tenant id is 403, and a caller without ticket.read
 * or ticket.write is refused (AC-F05-3).
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
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
import { PERMISSIONS } from '../permissions/permission.codes.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CustomerScopeService } from './customer-scope.service.js';
import { CustomersService } from './customers.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';

/** Express request carrying the identity and the guard-resolved role. */
type AuthedRequest = Request & {
  user?: AuthenticatedIdentity;
  role?: CanonicalRole | null;
};

@Controller('customers')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly tenants: TenantsService,
    private readonly scope: CustomerScopeService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  async create(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() createCustomerDto: CreateCustomerDto,
  ) {
    await this.requireTenantScope(request, tenantId);
    // The query parameter is the tenant scope; it wins over any body value.
    return this.customersService.create(
      Object.assign(createCustomerDto, { tenantId }),
    );
  }

  @Get()
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findAll(
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    // Per-customer scope (T2.04): an R-customer sees only their own row.
    const scope = await this.resolveScope(request, tenantId);
    if (scope.kind === 'none') {
      return [];
    }
    const rows = await this.customersService.findAll(tenantId);
    return scope.kind === 'customer'
      ? rows.filter((row) => row.id === scope.customerId)
      : rows;
  }

  @Get(':customerId')
  @RequirePermission(PERMISSIONS.TICKET_READ)
  async findOne(
    @Param('customerId') customerId: string,
    @Query('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    // Scope first: a foreign row must not even be looked up (T2.04).
    const scope = await this.resolveScope(request, tenantId);
    if (scope.kind === 'none') {
      throw new ForbiddenException('Customer is outside your scope');
    }
    if (scope.kind === 'customer' && scope.customerId !== customerId) {
      throw new ForbiddenException('Customer is outside your scope');
    }
    const customer = await this.customersService.findOne(customerId);
    if (customer.tenantId !== tenantId) {
      throw new ForbiddenException('Customer belongs to another tenant');
    }
    return customer;
  }

  /** Per-customer data scope from the guard-resolved role and identity. */
  private resolveScope(request: AuthedRequest, tenantId: string) {
    return this.scope.resolve(
      tenantId,
      request.role ?? null,
      request.user?.email,
    );
  }

  /**
   * Deny by default: no tenant scope means no data. The scope must be a
   * tenant the caller holds an ACTIVE membership in (AC-F04-3).
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
