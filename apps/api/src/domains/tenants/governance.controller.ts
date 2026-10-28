/**
 * Platform governance routes (T1.01 follow-up, AC-F03-1).
 *
 * Guard chain: SupabaseAuthGuard, then PermissionsGuard. Every route
 * declares its permission, so a route that forgets @RequirePermission
 * grants nothing. Creating or disabling a tenant is platform-wide
 * governance and needs TENANT_MANAGE_PLATFORM, which only
 * R-enterprise-admin holds (AC-F03-3). Changing a membership role needs
 * ROLE_MANAGE and stays scoped to the tenant in the path.
 *
 * Each successful change appends one audit event before it answers
 * (AC-F03-1, AC-F11-1). Platform-scope routes carry no tenantId, so the
 * guard resolves the role across the caller's memberships.
 */

import {
  Body,
  Controller,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedIdentity } from '../auth/auth.interface.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { PERMISSIONS } from '../permissions/permission.codes.js';
import {
  CreateTenantDto,
  SetMembershipRoleDto,
  SetTenantStatusDto,
} from './dto/governance.dto.js';
import { GovernanceService } from './governance.service.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('tenants')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class GovernanceController {
  constructor(
    private readonly governance: GovernanceService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  async createTenant(
    @Req() request: AuthedRequest,
    @Body() createTenantDto: CreateTenantDto,
  ) {
    const tenant = await this.governance.createTenant(createTenantDto);
    await this.audit.record({
      action: 'tenant.created',
      resourceType: 'tenant',
      resourceId: tenant.id,
      tenantId: tenant.id,
      actorId: request.user?.subject,
      metadata: { slug: tenant.slug, name: tenant.name },
    });
    return tenant;
  }

  @Patch(':tenantId')
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  async setTenantStatus(
    @Param('tenantId') tenantId: string,
    @Req() request: AuthedRequest,
    @Body() setStatusDto: SetTenantStatusDto,
  ) {
    const tenant = await this.governance.setTenantStatus(
      tenantId,
      setStatusDto,
    );
    await this.audit.record({
      action: 'tenant.status_changed',
      resourceType: 'tenant',
      resourceId: tenantId,
      tenantId,
      actorId: request.user?.subject,
      metadata: { status: tenant.status },
    });
    return tenant;
  }

  @Put(':tenantId/memberships/:membershipId/roles')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async setMembershipRole(
    @Param('tenantId') tenantId: string,
    @Param('membershipId') membershipId: string,
    @Req() request: AuthedRequest,
    @Body() setRoleDto: SetMembershipRoleDto,
  ) {
    const result = await this.governance.setMembershipRole(
      tenantId,
      membershipId,
      setRoleDto,
    );
    await this.audit.record({
      action: 'role.changed',
      resourceType: 'membership',
      resourceId: membershipId,
      tenantId,
      actorId: request.user?.subject,
      metadata: { roleCode: result.roleCode },
    });
    return result;
  }
}
