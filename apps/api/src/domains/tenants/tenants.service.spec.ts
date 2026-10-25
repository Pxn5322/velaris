/**
 * Tenant context and membership resolution (T1.02).
 *
 * Covers the intent of AC-F02-1 (a valid identity resolves session and
 * tenant membership) and the membership-gating primitive for AC-F04-1
 * (tenant-scoped access is limited to in-scope records). Token/credential
 * validation (AC-F02-2, 401 behaviour) arrives with the Supabase Auth
 * guard and is out of scope for this spec.
 */

import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { TenantsService } from './tenants.service.js';

type MockPrisma = {
  user: { findUnique: ReturnType<typeof vi.fn> };
};

function membership(overrides: Record<string, unknown> = {}) {
  return {
    id: 'membership-1',
    tenantId: 'tenant-a',
    userId: 'user-1',
    status: 'ACTIVE',
    tenant: {
      id: 'tenant-a',
      slug: 'acme',
      name: 'Acme',
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

describe('TenantsService', () => {
  let prisma: MockPrisma;
  let service: TenantsService;

  beforeEach(() => {
    prisma = { user: { findUnique: vi.fn() } };
    service = new TenantsService(prisma as unknown as PrismaService);
  });

  describe('resolveContext', () => {
    it('resolves an active tenant context for a valid identity (AC-F02-1)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        provider: 'supabase',
        externalSubject: 'sub-123',
        status: 'ACTIVE',
        memberships: [
          membership(),
          membership({
            id: 'membership-2',
            tenantId: 'tenant-b',
            tenant: { id: 'tenant-b', slug: 'beta', name: 'Beta', status: 'ACTIVE' },
          }),
        ],
      });

      const context = await service.resolveContext('supabase', 'sub-123');

      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { provider_externalSubject: { provider: 'supabase', externalSubject: 'sub-123' } },
        include: { memberships: { include: { tenant: true } } },
      });
      expect(context).not.toBeNull();
      expect(context?.userId).toBe('user-1');
      expect(context?.tenants.map((t) => t.slug)).toEqual(['acme', 'beta']);
      expect(context?.tenants[0]).toEqual({
        tenantId: 'tenant-a',
        slug: 'acme',
        name: 'Acme',
        membershipId: 'membership-1',
      });
    });

    it('excludes tenants that are suspended even when the membership is active', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        memberships: [
          membership({
            id: 'membership-3',
            tenantId: 'tenant-suspended',
            tenant: {
              id: 'tenant-suspended',
              slug: 'susp',
              name: 'Suspended Co',
              status: 'SUSPENDED',
            },
          }),
        ],
      });

      const context = await service.resolveContext('supabase', 'sub-123');

      expect(context?.tenants).toEqual([]);
    });

    it('excludes non-active memberships', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        memberships: [
          membership({ status: 'REVOKED' }),
          membership({ status: 'INVITED', id: 'membership-4' }),
        ],
      });

      const context = await service.resolveContext('supabase', 'sub-123');

      expect(context?.tenants).toEqual([]);
    });

    it('returns null for an unknown identity', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.resolveContext('supabase', 'nope')).resolves.toBeNull();
    });

    it('returns an empty tenant list when the user has no memberships', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', memberships: [] });

      const context = await service.resolveContext('supabase', 'sub-123');

      expect(context).toEqual({ userId: 'user-1', tenants: [] });
    });
  });

  describe('requireTenantAccess', () => {
    it('returns the membership entry when the user has an active membership', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        memberships: [membership()],
      });

      const entry = await service.requireTenantAccess('user-1', 'tenant-a');

      expect(entry).toEqual({
        tenantId: 'tenant-a',
        slug: 'acme',
        name: 'Acme',
        membershipId: 'membership-1',
      });
    });

    it('throws Forbidden when the tenant is suspended', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        memberships: [
          membership({
            tenant: {
              id: 'tenant-a',
              slug: 'acme',
              name: 'Acme',
              status: 'SUSPENDED',
            },
          }),
        ],
      });

      await expect(service.requireTenantAccess('user-1', 'tenant-a')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws Forbidden when the membership is revoked (cross-tenant denial primitive)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        memberships: [membership({ status: 'REVOKED' })],
      });

      await expect(service.requireTenantAccess('user-1', 'tenant-a')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('throws Forbidden when the user has no membership in that tenant', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        memberships: [
          membership({
            id: 'membership-9',
            tenantId: 'tenant-other',
            tenant: { id: 'tenant-other', slug: 'other', name: 'Other', status: 'ACTIVE' },
          }),
        ],
      });

      await expect(service.requireTenantAccess('user-1', 'tenant-a')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});
