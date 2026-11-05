/**
 * Provisioning seeds the TRACES retention row (T6.06; F-14; D-38).
 *
 * The route spec proves registration end to end; this focused service test
 * proves the seeded window. A new tenant gets exactly one row, and its value
 * is the same default the trace writer applies when no row exists. No
 * KNOWLEDGE or MEMORY window is invented, because those numbers are a
 * commercial decision that is not approved yet.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { DEFAULT_TRACE_RETENTION_DAYS } from '../retention/retention-policy.js';
import type { SupabaseAdminService } from './supabase-admin.service.js';
import { SignupService } from './signup.service.js';

function prismaFake() {
  const store = {
    enterpriseOrganization: {
      create: vi.fn(async () => ({ id: 'org-1' })),
    },
    tenant: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({
        id: 'tenant-1',
        slug: 'acme',
        name: 'Acme',
      })),
    },
    user: { create: vi.fn(async () => ({ id: 'user-1' })) },
    tenantMembership: {
      create: vi.fn(async () => ({ id: 'membership-1' })),
    },
    role: { findFirst: vi.fn(async () => ({ id: 'role-1' })) },
    membershipRole: { create: vi.fn(async () => ({ id: 'mr-1' })) },
    retentionPolicy: {
      create: vi.fn(async ({ data }: { data: object }) => ({
        id: 'policy-1',
        ...data,
      })),
    },
  };
  return {
    ...store,
    $transaction: vi.fn(async (fn: (tx: typeof store) => Promise<unknown>) =>
      fn(store),
    ),
  };
}

function adminFake() {
  return {
    requireConfigured: vi.fn(),
    createUser: vi.fn(async () => ({ id: 'sub-1' })),
    removeUser: vi.fn(async () => undefined),
  };
}

describe('signup provisioning seeds the retention default (D-38)', () => {
  it('stores exactly one TRACES row with the documented window', async () => {
    const prisma = prismaFake();
    const admin = adminFake();
    const service = new SignupService(
      prisma as unknown as PrismaService,
      admin as unknown as SupabaseAdminService,
    );

    await service.signup({
      email: 'owner@newco.test',
      password: 'correct-horse-battery',
      tenantName: 'New Co',
    });

    expect(prisma.retentionPolicy.create).toHaveBeenCalledTimes(1);
    expect(prisma.retentionPolicy.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'tenant-1',
        category: 'TRACES',
        retentionDays: DEFAULT_TRACE_RETENTION_DAYS,
        updatedBy: 'user-1',
      },
    });
  });
});
