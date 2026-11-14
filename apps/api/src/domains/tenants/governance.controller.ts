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
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
  AddMemberDto,
  CreateRoleDto,
  CreateTenantDto,
  SetMembershipRoleDto,
  SetMembershipStatusDto,
  SetTenantStatusDto,
  UpdateRoleDto,
} from './dto/governance.dto.js';
import { GovernanceService } from './governance.service.js';
import { TenantRolesService } from './tenant-roles.service.js';
import {
  TenantUsersService,
  type TenantMemberView,
} from './tenant-users.service.js';

/** Express request carrying the identity SupabaseAuthGuard attached. */
type AuthedRequest = Request & { user?: AuthenticatedIdentity };

@Controller('tenants')
@UseGuards(SupabaseAuthGuard, PermissionsGuard)
export class GovernanceController {
  constructor(
    private readonly governance: GovernanceService,
    private readonly users: TenantUsersService,
    private readonly roles: TenantRolesService,
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
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
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

  /** System and custom roles available to one tenant. */
  @Get(':tenantId/roles')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async listRoles(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.roles.list(tenantId);
  }

  @Post(':tenantId/roles')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async createRole(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() request: AuthedRequest,
    @Body() createRoleDto: CreateRoleDto,
  ) {
    const role = await this.roles.create(tenantId, createRoleDto);
    await this.audit.record({
      action: 'role.created',
      resourceType: 'role',
      resourceId: role.id,
      tenantId,
      actorId: request.user?.subject,
      metadata: {
        code: role.code,
        baseRoleCode: role.baseRoleCode,
      },
    });
    return role;
  }

  @Patch(':tenantId/roles/:roleId')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async updateRole(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Req() request: AuthedRequest,
    @Body() updateRoleDto: UpdateRoleDto,
  ) {
    const role = await this.roles.update(tenantId, roleId, updateRoleDto);
    await this.audit.record({
      action: 'role.updated',
      resourceType: 'role',
      resourceId: role.id,
      tenantId,
      actorId: request.user?.subject,
      metadata: { code: role.code, baseRoleCode: role.baseRoleCode },
    });
    return role;
  }

  @Delete(':tenantId/roles/:roleId')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async deleteRole(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Req() request: AuthedRequest,
  ) {
    const result = await this.roles.remove(tenantId, roleId);
    await this.audit.record({
      action: 'role.deleted',
      resourceType: 'role',
      resourceId: roleId,
      tenantId,
      actorId: request.user?.subject,
    });
    return result;
  }

  @Put(':tenantId/memberships/:membershipId/roles')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async setMembershipRole(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
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

  /**
   * Tenant user management (F-03, AC-F03-1). Each route declares its own
   * permission and is scoped to the tenant in the path: ROLE_MANAGE to
   * read the member list, USER_CREATE to add a member, USER_DISABLE to
   * suspend or reinstate one. The guard resolves the caller's role for
   * that tenant, so only a member of the tenant can reach these handlers.
   */
  @Get(':tenantId/users')
  @RequirePermission(PERMISSIONS.ROLE_MANAGE)
  async listUsers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<TenantMemberView[]> {
    return this.users.list(tenantId);
  }

  @Post(':tenantId/users')
  @RequirePermission(PERMISSIONS.USER_CREATE)
  async addUser(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() request: AuthedRequest,
    @Body() addMemberDto: AddMemberDto,
  ) {
    const member = await this.users.add(tenantId, addMemberDto);
    await this.audit.record({
      action: 'user.added',
      resourceType: 'membership',
      resourceId: member.membershipId,
      tenantId,
      actorId: request.user?.subject,
      metadata: { email: member.email, roleCode: member.roles[0] },
    });
    return member;
  }

  @Delete(':tenantId/memberships/:membershipId')
  @RequirePermission(PERMISSIONS.USER_DISABLE)
  async removeUser(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Req() request: AuthedRequest,
  ) {
    const result = await this.users.remove(tenantId, membershipId);
    await this.audit.record({
      action: 'user.removed',
      resourceType: 'membership',
      resourceId: membershipId,
      tenantId,
      actorId: request.user?.subject,
      metadata: { email: result.email },
    });
    return result;
  }

  @Patch(':tenantId/memberships/:membershipId/status')
  @RequirePermission(PERMISSIONS.USER_DISABLE)
  async setMembershipStatus(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Req() request: AuthedRequest,
    @Body() setStatusDto: SetMembershipStatusDto,
  ) {
    const result = await this.users.setMembershipStatus(
      tenantId,
      membershipId,
      setStatusDto,
    );
    await this.audit.record({
      action: 'user.status_changed',
      resourceType: 'membership',
      resourceId: membershipId,
      tenantId,
      actorId: request.user?.subject,
      metadata: { status: result.status },
    });
    return result;
  }
}
