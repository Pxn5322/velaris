/**
 * Customer routes on the real T2.01 table (T2.03 scope: customers half).
 *
 * Replaces the prototype in-memory CustomersService, which exposed
 * unguarded routes. The new controller runs the same chain as tickets:
 * SupabaseAuthGuard -> PermissionsGuard -> tenant scope check, so no
 * caller can list or create customers outside an ACTIVE membership
 * (AC-F04-1/AC-F04-3) and no caller without ticket.read gets anything
 * (AC-F05-3).
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CustomersService } from './customers.service.js';

type CustomerRow = {
  id: string;
  tenantId: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function customerRow(id: string, overrides: Partial<CustomerRow> = {}) {
  return {
    id,
    tenantId: 'tenant-a',
    displayName: 'Fixture',
    email: null,
    phone: null,
    status: 'ACTIVE',
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as CustomerRow;
}

function fakePrisma(rows: CustomerRow[]) {
  const store = [...rows];
  let counter = 0;
  return {
    customer: {
      findMany: vi.fn(
        async ({
          where,
          skip,
          take,
        }: {
          where: { tenantId: string; id?: string };
          skip?: number;
          take?: number;
        }) => {
          const rows = store
            .filter(
              (c) =>
                c.tenantId === where.tenantId &&
                (!where.id || c.id === where.id),
            )
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          const from = skip ?? 0;
          return rows.slice(from, take === undefined ? undefined : from + take);
        },
      ),
      count: vi.fn(
        async ({ where }: { where: { tenantId: string; id?: string } }) =>
          store.filter(
            (c) =>
              c.tenantId === where.tenantId &&
              (!where.id || c.id === where.id),
          ).length,
      ),
      create: vi.fn(async ({ data }: { data: Partial<CustomerRow> }) => {
        const row = {
          id: 'cust-new-' + ++counter,
          status: 'ACTIVE',
          email: null,
          phone: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as object),
        } as CustomerRow;
        store.push(row);
        return row;
      }),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          store.find((c) => c.id === where.id) ?? null,
      ),
    },
    _store: store,
  };
}

describe('CustomersService (Prisma-backed, T2.03)', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: CustomersService;

  beforeEach(() => {
    prisma = fakePrisma([]);
    service = new CustomersService(prisma as unknown as PrismaService);
  });

  it('lists customers of the tenant only', async () => {
    prisma._store.push(
      customerRow('cust-a'),
      customerRow('cust-b', { tenantId: 'tenant-b' }),
    );
    const page = await service.findPage('tenant-a');
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe('cust-a');
    expect(page.total).toBe(1);
  });

  it('findPage returns one page, the total and the shared offset (D-86)', async () => {
    prisma._store.push(
      customerRow('cust-a', { createdAt: new Date('2026-11-01T08:00:00Z') }),
      customerRow('cust-b', { createdAt: new Date('2026-11-02T08:00:00Z') }),
      customerRow('cust-c', { createdAt: new Date('2026-11-03T08:00:00Z') }),
    );

    const first = await service.findPage('tenant-a', { page: 1, pageSize: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['cust-a', 'cust-b']);
    expect(first).toMatchObject({ total: 3, page: 1, pageSize: 2 });

    const second = await service.findPage('tenant-a', { page: 2, pageSize: 2 });
    expect(second.items.map((row) => row.id)).toEqual(['cust-c']);
    expect(second.total).toBe(3);
    expect(prisma.customer.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 2, take: 2 }),
    );

    // The same shared offset as the other list routes: page 3 of 5 skips 10.
    await service.findPage('tenant-a', { page: 3, pageSize: 5 });
    expect(prisma.customer.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  it('findPage refuses a page size above the cap and a non-positive page (D-86)', async () => {
    await expect(
      service.findPage('tenant-a', { pageSize: 101 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.findPage('tenant-a', { page: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customer.findMany).not.toHaveBeenCalled();
  });

  it('creates a customer without contact details as nulls', async () => {
    const created = await service.create({
      tenantId: 'tenant-a',
      displayName: 'No Contact',
    });
    expect(created.email).toBeNull();
    expect(created.phone).toBeNull();
  });

  it('rejects a list without a tenant scope (400)', async () => {
    await expect(service.findPage('')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.findPage(undefined as never)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('creates a customer with the tenant scope and default status', async () => {
    const created = await service.create({
      tenantId: 'tenant-a',
      displayName: 'New Person',
      email: 'new@example.test',
    });
    expect(created.tenantId).toBe('tenant-a');
    expect(created.status).toBe('ACTIVE');
    expect(created.displayName).toBe('New Person');
  });

  it('rejects a create without a tenant scope or display name (400)', async () => {
    await expect(
      service.create({ displayName: 'x' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.create({ tenantId: 'tenant-a', displayName: '  ' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports an unknown customer as not found (404)', async () => {
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findOne returns the row', async () => {
    prisma._store.push(customerRow('cust-a'));
    await expect(service.findOne('cust-a')).resolves.toMatchObject({
      id: 'cust-a',
    });
  });
});
