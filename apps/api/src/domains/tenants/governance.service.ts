/**
 * Platform tenant governance (T1.01 follow-up, AC-F03-1).
 *
 * Implements the three actions AC-F03-1 names: create a tenant, disable a
 * tenant and change a user role. Every action writes through Prisma, so
 * the change is persisted, and the controller emits one audit event per
 * successful change (AC-F11-1). Authorization is not decided here: the
 * route declares its permission and PermissionsGuard resolves the role.
 *
 * Identifier validation follows the AC-F03-2 rule: a missing field, an
 * unknown role code or a status outside the allowed set is rejected with
 * 400, and an identifier with no row is rejected with 404 before any
 * write happens.
 */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type {
  CreateTenantDto,
  SetMembershipRoleDto,
  SetTenantStatusDto,
} from './dto/governance.dto.js';

/** Status values an administrator may set. DELETED has no API path. */
const SETTABLE_TENANT_STATUS = ['ACTIVE', 'SUSPENDED'] as const;

@Injectable()
export class GovernanceService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Create a tenant inside an enterprise organization (AC-F03-1). */
  async createTenant(input: CreateTenantDto) {
    requireText(input.enterpriseOrganizationId, 'enterpriseOrganizationId');
    requireText(input.name, 'name');
    requireText(input.slug, 'slug');

    return this.prisma.tenant.create({
      data: {
        enterpriseOrganizationId: input.enterpriseOrganizationId,
        name: input.name,
        slug: input.slug,
      },
    });
  }

  /** Set a tenant status. Used to disable a tenant (AC-F03-1, AC-F04-2). */
  async setTenantStatus(tenantId: string, input: SetTenantStatusDto) {
    if (
      !SETTABLE_TENANT_STATUS.includes(
        input.status as (typeof SETTABLE_TENANT_STATUS)[number],
      )
    ) {
      throw new BadRequestException(
        `status must be one of ${SETTABLE_TENANT_STATUS.join(', ')}`,
      );
    }

    const existing = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException(`Tenant with ID ${tenantId} not found`);
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: { status: input.status },
    });
  }

  /**
   * Replace the roles held by one membership (AC-F03-1). The role must
   * exist and must be in scope for the tenant: a system role (tenant
   * NULL) or a role that belongs to that tenant.
   */
  async setMembershipRole(
    tenantId: string,
    membershipId: string,
    input: SetMembershipRoleDto,
  ) {
    requireText(input.roleCode, 'roleCode');

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { id: membershipId },
    });
    // A membership in another tenant is reported as missing, so an
    // attacker learns nothing about other tenants' identifiers.
    if (!membership || membership.tenantId !== tenantId) {
      throw new NotFoundException(
        `Membership with ID ${membershipId} not found`,
      );
    }

    const role = await this.prisma.role.findFirst({
      where: { code: input.roleCode, OR: [{ tenantId: null }, { tenantId }] },
    });
    if (!role) {
      throw new BadRequestException(`Unknown role code: ${input.roleCode}`);
    }

    await this.prisma.membershipRole.deleteMany({ where: { membershipId } });
    await this.prisma.membershipRole.create({
      data: { membershipId, roleId: role.id },
    });

    return { membershipId, tenantId, roleCode: input.roleCode };
  }
}

/** Reject a missing or empty required field before any write (AC-F03-2). */
function requireText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
}
