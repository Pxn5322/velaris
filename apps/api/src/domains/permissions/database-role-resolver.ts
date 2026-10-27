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
 */

import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CanonicalRole } from './permission.codes.js';
import { highestPrivilegeRole } from './role-permissions.js';
import type { RoleLookup, RoleResolver } from './role-resolver.js';

@Injectable()
export class DatabaseRoleResolver implements RoleResolver {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async resolveRole(lookup: RoleLookup): Promise<CanonicalRole | null> {
    const { identity, tenantId } = lookup;
    if (!tenantId) {
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
        membership: {
          userId: user.id,
          tenantId,
          status: 'ACTIVE',
        },
        role: { OR: [{ tenantId: null }, { tenantId }] },
      },
      select: { role: { select: { code: true } } },
    });

    return highestPrivilegeRole(assigned.map((row) => row.role.code));
  }
}
