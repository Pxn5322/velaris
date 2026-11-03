/**
 * Guarded analytics summary (T5.03; API-15; F-12).
 *
 * The guard chain is the same as the knowledge routes: SupabaseAuthGuard
 * answers 401 without a credential, PermissionsGuard answers 403 without
 * `analytics.read`, and the tenant scope check refuses a tenant outside the
 * caller's memberships (AC-F12-3). A missing tenant scope is a 400, because
 * deny-by-default means no widening to every tenant.
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
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { parseAnalyticsRange } from './analytics-range.js';
import { AnalyticsService } from './analytics.service.js';

type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('analytics')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('summary')
  @RequirePermission(PERMISSIONS.ANALYTICS_READ)
  async summary(
    @Query('tenantId') tenantId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() request: AuthedRequest,
  ) {
    await this.requireTenantScope(request, tenantId);
    const range = parseAnalyticsRange({ from, to });
    return this.analytics.summary(tenantId, range);
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
