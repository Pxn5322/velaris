/**
 * Database-backed role resolution (roles storage, DATABASE.md section 5).
 *
 * Replaces the deny-all default resolver: the role now comes from
 * membership_roles joined to roles, never from client input
 * (docs/SECURITY.md section 4). A role is in scope when it is a system
 * role (tenant_id NULL) or belongs to the membership's tenant, and the
 * membership must be ACTIVE. When several roles apply, the highest
 * privilege wins. No row, no tenantId or an unknown identity all resolve
 * to null, which PermissionsGuard turns into a denial.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { DatabaseRoleResolver } from './database-role-resolver.js';

type MockPrisma = {
  user: { findUnique: ReturnType<typeof vi.fn> };
  membershipRole: { findMany: ReturnType<typeof vi.fn> };
};

const IDENTITY = { provider: 'supabase', subject: 'sub-123' };

function assignment(code: string, roleTenantId: string | null = null) {
  return {
    membershipId: 'membership-1',
    roleId: `role-${code}`,
    role: {
      id: `role-${code}`,
      tenantId: roleTenantId,
      code,
      name: code,
      systemManaged: true,
    },
  };
}

describe('DatabaseRoleResolver', () => {
  let prisma: MockPrisma;
  let resolver: DatabaseRoleResolver;

  beforeEach(() => {
    prisma = {
      user: { findUnique: vi.fn() },
      membershipRole: { findMany: vi.fn() },
    };
    resolver = new DatabaseRoleResolver(prisma as unknown as PrismaService);
  });

  it('returns null without a tenant scope and reads no data', async () => {
    const role = await resolver.resolveRole({ identity: IDENTITY });

    expect(role).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.membershipRole.findMany).not.toHaveBeenCalled();
  });

  it('returns null for an identity with no local user row', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const role = await resolver.resolveRole({
      identity: IDENTITY,
      tenantId: 'tenant-a',
    });

    expect(role).toBeNull();
    expect(prisma.membershipRole.findMany).not.toHaveBeenCalled();
  });

  it('returns null when no active membership role exists', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.membershipRole.findMany.mockResolvedValue([]);

    const role = await resolver.resolveRole({
      identity: IDENTITY,
      tenantId: 'tenant-a',
    });

    expect(role).toBeNull();
  });

  it('queries by user, tenant and ACTIVE membership status', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.membershipRole.findMany.mockResolvedValue([]);

    await resolver.resolveRole({ identity: IDENTITY, tenantId: 'tenant-a' });

    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: {
        provider_externalSubject: {
          provider: 'supabase',
          externalSubject: 'sub-123',
        },
      },
      select: { id: true },
    });
    expect(prisma.membershipRole.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          membership: {
            userId: 'user-1',
            tenantId: 'tenant-a',
            status: 'ACTIVE',
          },
          role: { OR: [{ tenantId: null }, { tenantId: 'tenant-a' }] },
        },
      }),
    );
  });

  it('resolves the assigned role code', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.membershipRole.findMany.mockResolvedValue([assignment('R-agent')]);

    const role = await resolver.resolveRole({
      identity: IDENTITY,
      tenantId: 'tenant-a',
    });

    expect(role).toBe('R-agent');
  });

  it('picks the highest privilege when several roles apply', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.membershipRole.findMany.mockResolvedValue([
      assignment('R-customer'),
      assignment('R-tenant-admin'),
      assignment('R-agent'),
    ]);

    const role = await resolver.resolveRole({
      identity: IDENTITY,
      tenantId: 'tenant-a',
    });

    expect(role).toBe('R-tenant-admin');
  });

  it('ignores unknown role codes and resolves null when only those apply', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.membershipRole.findMany.mockResolvedValue([
      assignment('R-made-up'),
      assignment('also-not-a-role'),
    ]);

    const role = await resolver.resolveRole({
      identity: IDENTITY,
      tenantId: 'tenant-a',
    });

    expect(role).toBeNull();
  });

  it('still resolves a real role when an unknown code is mixed in', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1' });
    prisma.membershipRole.findMany.mockResolvedValue([
      assignment('R-made-up'),
      assignment('R-agent'),
    ]);

    const role = await resolver.resolveRole({
      identity: IDENTITY,
      tenantId: 'tenant-a',
    });

    expect(role).toBe('R-agent');
  });
});
