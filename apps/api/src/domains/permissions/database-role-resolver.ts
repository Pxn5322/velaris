/**
 * Database-backed role resolution (roles storage, DATABASE.md section 5).
 *
 * Reads membership_roles joined to roles for the verified identity in the
 * tenant the request targets. The tenantId argument only selects which
 * membership to read: a forged value yields no rows and no role, so it can
 * never grant anything (docs/SECURITY.md section 4). A role is in scope
 * when it is a system role (tenant_id NULL) or belongs to that tenant, and
 * the membership must be ACTIVE. Several roles resolve to the highest
 * privilege (role-permissions.ts ROLE_PRECEDENCE). Missing user, missing
 * membership or no in-scope role all return null, which PermissionsGuard
 * turns into a 403: the policy still denies by default.
 *
 * Platform scope (AC-F03-1): a route that targets no single tenant, such
 * as creating a tenant, supplies no tenantId. The resolver then reads every
 * ACTIVE membership and returns the highest privilege among them. Only
 * R-enterprise-admin holds a platform permission (TENANT_MANAGE_PLATFORM),
 * so no other role becomes reachable, and an identity with no membership
 * still resolves to null. Routes that do name a tenant keep the tenant-
 * scoped query, so a tenant admin can never govern another tenant.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CanonicalRole } from './permission.codes.js';
import { highestPrivilegeRole } from './role-permissions.js';
import type { RoleLookup, RoleResolver } from './role-resolver.js';

/** Canonical UUID text form; ids in every table use this shape. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class DatabaseRoleResolver implements RoleResolver {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async resolveRole(lookup: RoleLookup): Promise<CanonicalRole | null> {
    const { identity, tenantId } = lookup;

    // Live check 2026-10-29: a malformed tenantId reached Postgres and
    // failed with 22P02 (invalid input syntax for type uuid), which the
    // API reported as a 500. A value that cannot name a tenant can never
    // grant one, so the policy denies before any query (deny by default,
    // docs/SECURITY.md section 4).
    if (tenantId && !UUID_PATTERN.test(tenantId)) {
      return null;
    }

    const user = await this.prisma.user.findUnique({
      where: {
        provider_externalSubject: {
          provider: identity.provider,
          externalSubject: identity.subject,
        },
      },
      select: { id: true },
    });
    if (!user) {
      return null;
    }

    const assigned = await this.prisma.membershipRole.findMany({
      where: {
        membership: tenantId
          ? { userId: user.id, tenantId, status: 'ACTIVE' }
          : { userId: user.id, status: 'ACTIVE' },
        ...(tenantId
          ? { role: { OR: [{ tenantId: null }, { tenantId }] } }
          : {}),
      },
      select: { role: { select: { code: true } } },
    });

    return highestPrivilegeRole(assigned.map((row) => row.role.code));
  }
}
