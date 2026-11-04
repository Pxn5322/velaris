/**
 * Guarded audit and trace reads (T5.04; F-11; AC-F11-3).
 *
 * The guard chain matches the other governance routes: SupabaseAuthGuard
 * answers 401 without a credential, PermissionsGuard answers 403 without
 * `audit.read`, and the tenant scope check refuses a tenant outside the
 * caller's memberships. R-agent and R-customer hold no `audit.read`, so an
 * unprivileged caller is denied before any row is read (AC-F11-3).
 */

import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import {
  AuditQueryService,
  MAX_AUDIT_LIMIT,
  parseAuditLimit,
} from './audit-query.service.js';

type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('audit')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class AuditQueryController {
  constructor(
    private readonly audit: AuditQueryService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('events')
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  async events(
    @Query('tenantId') tenantId: string,
    @Query('limit') limit: string | undefined,
    @Query('action') action: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.audit.listEvents(tenantId, {
      limit: this.requireLimit(limit),
      action: action || undefined,
    });
  }

  @Get('traces')
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  async traces(
    @Query('tenantId') tenantId: string,
    @Query('limit') limit: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    return this.audit.listTraces(tenantId, {
      limit: this.requireLimit(limit),
    });
  }

  private requireLimit(raw: string | undefined): number {
    const limit = parseAuditLimit(raw);
    if (limit === null) {
      throw new BadRequestException(
        `limit must be a whole number from 1 to ${MAX_AUDIT_LIMIT}`,
      );
    }
    return limit;
  }

  private async requireTenantScope(
    request: AuthedRequest,
    tenantId: string | undefined,
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
