/**
 * Tenant context and membership resolution (task T1.02, F-02/F-04).
 *
 * A TenantContext is the resolved set of tenants a user may act in:
 * the user must exist (identity resolved by the auth layer, D-03) and
 * hold an ACTIVE TenantMembership in an ACTIVE Tenant. Controllers and
 * guards use requireTenantAccess before reading or writing tenant-owned
 * records (AC-F04-1 primitive; full per-query scoping lands with the
 * repository layer in T1.03).
 */

import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface TenantContextEntry {
  tenantId: string;
  slug: string;
  name: string;
  membershipId: string;
}

export interface TenantContext {
  userId: string;
  tenants: TenantContextEntry[];
}

const ACTIVE = 'ACTIVE';

@Injectable()
export class TenantsService {
  // Explicit token: resolves without emitDecoratorMetadata (see PRISMA_SERVICE).
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /**
   * Resolve the tenant context for a verified identity (AC-F02-1).
   * Returns null when no user row exists for (provider, externalSubject).
   */
  async resolveContext(
    provider: string,
    externalSubject: string,
  ): Promise<TenantContext | null> {
    const user = await this.prisma.user.findUnique({
      where: { provider_externalSubject: { provider, externalSubject } },
      include: { memberships: { include: { tenant: true } } },
    });
    if (!user) {
      return null;
    }
    const tenants = user.memberships
      .filter(
        (membership) =>
          membership.status === ACTIVE && membership.tenant.status === ACTIVE,
      )
      .map((membership) => ({
        tenantId: membership.tenant.id,
        slug: membership.tenant.slug,
        name: membership.tenant.name,
        membershipId: membership.id,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug));
    return { userId: user.id, tenants };
  }

  /**
   * Assert that the user holds an active membership in the tenant
   * (AC-F04-1 gate). Throws ForbiddenException otherwise, which the API
   * layer maps to 403.
   */
  async requireTenantAccess(
    userId: string,
    tenantId: string,
  ): Promise<TenantContextEntry> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { memberships: { include: { tenant: true } } },
    });
    const match = user?.memberships.find(
      (membership) =>
        membership.tenantId === tenantId &&
        membership.status === ACTIVE &&
        membership.tenant.status === ACTIVE,
    );
    if (!match) {
      throw new ForbiddenException('No active membership for this tenant');
    }
    return {
      tenantId: match.tenant.id,
      slug: match.tenant.slug,
      name: match.tenant.name,
      membershipId: match.id,
    };
  }
}
