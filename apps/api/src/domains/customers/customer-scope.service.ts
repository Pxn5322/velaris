/**
 * Per-customer data scope for a verified caller (T2.04 / GATE-2 hardening,
 * AC-F05-3, TH-01).
 *
 * The guard chain proves identity, permission and tenant membership, but an
 * R-customer must also see only their own rows: tickets, conversations and
 * customer records belong to one customer inside the tenant. This resolver
 * maps the caller's verified email (from the token verifier, never from the
 * request) onto the customer row in the target tenant:
 *
 * - non-customer roles (agents, admins) resolve to the whole tenant scope
 * - R-customer with no email, no matching row, or a soft-deleted row
 *   resolves to NONE: deny by default, no data (TH-01)
 * - R-customer with a match resolves to that customer id, so controllers
 *   filter list results and refuse foreign rows next to their own checks
 *
 * The lookup is case-insensitive on email because identity providers and
 * input forms disagree on case.
 */

import { Inject, Injectable } from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';

export type CustomerScope =
  /** Staff role: the whole tenant scope is in reach. */
  | { kind: 'tenant' }
  /** Customer identity with no own row: deny everything. */
  | { kind: 'none' }
  /** Customer identity bound to one customer row. */
  | { kind: 'customer'; customerId: string };

@Injectable()
export class CustomerScopeService {
  // Explicit token: resolves without emitDecoratorMetadata (see PRISMA_SERVICE).
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /**
   * Resolve the data scope for a caller in `tenantId`.
   * `role` is the guard-resolved role, `email` the verified identity email.
   */
  async resolve(
    tenantId: string,
    role: CanonicalRole | null | undefined,
    email?: string,
  ): Promise<CustomerScope> {
    if (role !== 'R-customer') {
      return { kind: 'tenant' };
    }
    if (!email) {
      return { kind: 'none' };
    }
    const row = await this.prisma.customer.findFirst({
      where: {
        tenantId,
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
    return row ? { kind: 'customer', customerId: row.id } : { kind: 'none' };
  }
}
