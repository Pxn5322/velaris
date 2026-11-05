/**
 * Tenant retention settings (T6.06; F-14; AC-F14-2, AC-F14-3).
 *
 * A tenant administrator lists the three categories and sets a window. The
 * route runs the usual chain: SupabaseAuthGuard (401), PermissionsGuard with
 * `retention.manage` (403, R-tenant-admin only), then the tenant scope check.
 * The path carries no tenantId, so the caller names it in the query or body
 * and the scope check resolves the caller's active membership before any row
 * is read or written. Every accepted change writes one audit row, because a
 * retention window decides how long tenant data stays available.
 */

import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import { TenantsService } from '../tenants/tenants.service.js';
import {
  RetentionService,
  type RetentionPolicyView,
} from './retention.service.js';

type AuthedRequest = Request & { user?: AuthenticatedIdentity };

/** Body of PUT /settings/retention. */
export interface UpdateRetentionPolicyBody {
  tenantId?: string;
  category?: unknown;
  retentionDays?: unknown;
}

@Controller('settings/retention')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
  ) {}

  /** Every category with its effective window (AC-F14-2). */
  @Get()
  @RequirePermission(PERMISSIONS.RETENTION_MANAGE)
  async list(
    @Req() request: AuthedRequest,
    @Query('tenantId') tenantId: string | undefined,
  ): Promise<{ tenantId: string; policies: RetentionPolicyView[] }> {
    await this.requireTenantScope(request, tenantId);
    return {
      tenantId: tenantId as string,
      policies: await this.retention.listPolicies(tenantId as string),
    };
  }

  /** Store one window and record who changed it (AC-F14-2, AC-F14-3). */
  @Put()
  @RequirePermission(PERMISSIONS.RETENTION_MANAGE)
  async update(
    @Req() request: AuthedRequest,
    @Body() body: UpdateRetentionPolicyBody,
  ): Promise<RetentionPolicyView> {
    await this.requireTenantScope(request, body?.tenantId);
    const tenantId = body.tenantId as string;
    const actor = (request.user as AuthenticatedIdentity).subject;
    const policy = await this.retention.setPolicy({
      tenantId,
      category: body?.category,
      retentionDays: body?.retentionDays,
      updatedBy: actor,
    });
    await this.audit.record({
      action: 'retention.policy_changed',
      resourceType: 'retention_policy',
      resourceId: policy.category,
      tenantId,
      actorId: actor,
      metadata: {
        category: policy.category,
        retentionDays: policy.retentionDays,
      },
    });
    return policy;
  }

  private async requireTenantScope(
    request: AuthedRequest,
    tenantId: string | undefined,
  ): Promise<void> {
    if (!tenantId) {
      throw new BadRequestException('tenantId is required');
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
