/**
 * Customer scope resolver (T2.04, AC-F05-3, TH-01).
 *
 * Every branch is pinned: staff roles take the tenant scope, an R-customer
 * resolves through the verified email onto their own row, and every missing
 * signal (no email, no row, soft-deleted row) falls back to deny-by-default
 * NONE instead of widening access.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CustomerScopeService } from './customer-scope.service.js';

function fakePrisma(row: { id: string } | null) {
  return {
    customer: {
      findFirst: vi.fn(async () => row),
    },
  };
}

describe('CustomerScopeService.resolve', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: CustomerScopeService;

  beforeEach(() => {
    prisma = fakePrisma(null);
    service = new CustomerScopeService(prisma as unknown as PrismaService);
  });

  it('gives staff roles the whole tenant scope without a lookup', async () => {
    const scope = await service.resolve('tenant-a', 'R-agent');
    expect(scope).toEqual({ kind: 'tenant' });
    expect(await service.resolve('tenant-a', 'R-tenant-admin')).toEqual({
      kind: 'tenant',
    });
    expect(await service.resolve('tenant-a', 'R-enterprise-admin')).toEqual({
      kind: 'tenant',
    });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('treats an absent or null role as the tenant scope, not as a customer', async () => {
    expect(await service.resolve('tenant-a', null)).toEqual({
      kind: 'tenant',
    });
    expect(await service.resolve('tenant-a', undefined)).toEqual({
      kind: 'tenant',
    });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('denies an R-customer with no verified email (deny by default)', async () => {
    expect(await service.resolve('tenant-a', 'R-customer')).toEqual({
      kind: 'none',
    });
    expect(await service.resolve('tenant-a', 'R-customer', '')).toEqual({
      kind: 'none',
    });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
  });

  it('binds an R-customer to their own row through a case-insensitive email match', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 'customer-9' });
    const scope = await service.resolve(
      'tenant-a',
      'R-customer',
      'Buyer@Example.Test',
    );
    expect(scope).toEqual({ kind: 'customer', customerId: 'customer-9' });
    expect(prisma.customer.findFirst).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        email: { equals: 'Buyer@Example.Test', mode: 'insensitive' },
        deletedAt: null,
      },
      select: { id: true },
    });
  });

  it('denies an R-customer with no matching row in the tenant', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);
    expect(
      await service.resolve('tenant-a', 'R-customer', 'nobody@example.test'),
    ).toEqual({ kind: 'none' });
  });
});
