/**
 * Ticket domain rules (T2.02, AC-F05-1, AC-F05-2).
 *
 * The service is Prisma-backed (tickets table, T2.01). These tests use a
 * small in-memory fake of the Prisma client so they exercise the domain
 * logic without a database. Covered here:
 * - tenant isolation on every read and write (AC-F04-1/AC-F04-3, TH-01)
 * - invalid status transitions rejected with 409 (AC-F05-2)
 * - stale expectedVersion rejected with 409, version bumps on every update
 *   (AC-F05-2 optimistic concurrency)
 * - assignment only to an ACTIVE membership of the same tenant (AC-F05-1)
 * - lifecycle timestamps satisfy the migration-0003 CHECK constraints
 *
 * The TH-05 serialization boundary test stays with the test-utils fixture.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  tenantA,
  tenantB,
  customerVisibleMessages,
  tenantAFixture,
} from 'test-utils';
import { TicketsService } from './tickets.service.js';

type TicketRow = {
  id: string;
  tenantId: string;
  customerId: string;
  title: string;
  status: string;
  priority: string;
  slaState: string;
  assigneeMembershipId: string | null;
  tags: string[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
};

type MembershipRow = { id: string; tenantId: string; status: string };

function fakePrisma(tickets: TicketRow[], memberships: MembershipRow[] = []) {
  const store = [...tickets];
  let counter = 0;
  return {
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = store.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      }),
      findMany: vi.fn(
        async ({ where }: { where?: { tenantId: string } } = {}) =>
          store
            .filter((r) => !where?.tenantId || r.tenantId === where.tenantId)
            .map((r) => ({ ...r })),
      ),
      create: vi.fn(async ({ data }: { data: Partial<TicketRow> }) => {
        const row: TicketRow = {
          id: 'ticket-' + ++counter,
          tenantId: data.tenantId as string,
          customerId: data.customerId as string,
          title: data.title as string,
          status: 'OPEN',
          priority: (data.priority as string) ?? 'MEDIUM',
          slaState: 'NOT_SET',
          assigneeMembershipId: null,
          tags: [],
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
          closedAt: null,
        };
        store.push(row);
        return { ...row };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; tenantId: string; version: number };
          data: Partial<TicketRow>;
        }) => {
          const hits = store.filter(
            (r) =>
              r.id === where.id &&
              r.tenantId === where.tenantId &&
              r.version === where.version,
          );
          for (const hit of hits) {
            Object.assign(hit, data, { updatedAt: new Date() });
          }
          return { count: hits.length };
        },
      ),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => {
        const index = store.findIndex((r) => r.id === where.id);
        const [removed] = store.splice(index, 1);
        return { ...removed };
      }),
    },
    tenantMembership: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          memberships.find((m) => m.id === where.id) ?? null,
      ),
    },
    _store: store,
  };
}

function ticketRow(id: string, overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id,
    tenantId: tenantA.id,
    customerId: 'customer-1',
    title: 'Fixture ticket',
    status: 'OPEN',
    priority: 'MEDIUM',
    slaState: 'NOT_SET',
    assigneeMembershipId: null,
    tags: [],
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

describe('TicketsService (Prisma-backed domain, T2.02)', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: TicketsService;

  const createIn = (tenantId: string) =>
    service.create({
      title: 'Fixture ticket',
      customerId: 'customer-1',
      tenantId,
    });

  beforeEach(() => {
    prisma = fakePrisma([]);
    service = new TicketsService(prisma as unknown as PrismaService);
  });

  it('creates a ticket with OPEN status, version 0 and default priority', async () => {
    const ticket = await createIn(tenantA.id);
    expect(ticket.status).toBe('OPEN');
    expect(ticket.version).toBe(0);
    expect(ticket.priority).toBe('MEDIUM');
    expect(ticket.tenantId).toBe(tenantA.id);
  });

  it('create honours an explicit priority', async () => {
    const ticket = await service.create({
      title: 'Urgent',
      customerId: 'customer-1',
      tenantId: tenantA.id,
      priority: 'URGENT',
    });
    expect(ticket.priority).toBe('URGENT');
  });

  it('rejects a create without a customerId (schema requires the FK)', async () => {
    await expect(
      service.create({ title: 'x', tenantId: tenantA.id } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findAll returns only tickets of the given tenant (AC-F04-1)', async () => {
    prisma._store.push(
      ticketRow('a-1'),
      ticketRow('b-1', { tenantId: tenantB.id }),
    );
    const result = await service.findAll(tenantA.id);
    expect(result).toHaveLength(1);
    expect(result[0]!.tenantId).toBe(tenantA.id);
  });

  it('findOne hides a tenant B ticket from a tenant A scope (TH-01)', async () => {
    prisma._store.push(ticketRow('b-1', { tenantId: tenantB.id }));
    await expect(service.findOne('b-1', tenantA.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('update bumps the version on every change (AC-F05-2)', async () => {
    prisma._store.push(ticketRow('t-1'));
    const updated = await service.update(
      't-1',
      { priority: 'URGENT' },
      tenantA.id,
    );
    expect(updated.version).toBe(1);
    expect(updated.priority).toBe('URGENT');
  });

  it('rejects a stale expectedVersion with 409 (AC-F05-2)', async () => {
    prisma._store.push(ticketRow('t-1', { version: 3 }));
    await expect(
      service.update(
        't-1',
        { priority: 'URGENT', expectedVersion: 2 },
        tenantA.id,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts a matching expectedVersion', async () => {
    prisma._store.push(ticketRow('t-1', { version: 3 }));
    const updated = await service.update(
      't-1',
      { priority: 'URGENT', expectedVersion: 3 },
      tenantA.id,
    );
    expect(updated.version).toBe(4);
  });

  it('rejects a concurrent write when the version moved under the read', async () => {
    prisma._store.push(ticketRow('t-1', { version: 5 }));
    // The fake keeps the row at version 5, but simulate the raced write by
    // making the guarded updateMany match nothing.
    prisma.ticket.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.update('t-1', { priority: 'HIGH' }, tenantA.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports not found if the row vanishes between write and read', async () => {
    prisma._store.push(ticketRow('t-1'));
    prisma.ticket.findUnique
      .mockResolvedValueOnce(ticketRow('t-1')) // the pre-write read
      .mockResolvedValueOnce(null); // the post-write re-read
    await expect(
      service.update('t-1', { priority: 'HIGH' }, tenantA.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an invalid transition with 409 (AC-F05-2)', async () => {
    prisma._store.push(ticketRow('t-1', { status: 'PENDING_CUSTOMER' }));
    await expect(
      service.update('t-1', { status: 'OPEN' }, tenantA.id),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unknown status value with 400', async () => {
    prisma._store.push(ticketRow('t-1'));
    await expect(
      service.update('t-1', { status: 'NONSENSE' } as never, tenantA.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a same-status update is legal and only bumps the version', async () => {
    prisma._store.push(ticketRow('t-1', { status: 'OPEN' }));
    const updated = await service.update('t-1', { status: 'OPEN' }, tenantA.id);
    expect(updated.status).toBe('OPEN');
    expect(updated.version).toBe(1);
    expect(updated.resolvedAt).toBeNull();
  });

  it('sets resolvedAt on RESOLVED and clears it on reopen', async () => {
    prisma._store.push(ticketRow('t-1', { status: 'IN_PROGRESS' }));
    const resolved = await service.update(
      't-1',
      { status: 'RESOLVED' },
      tenantA.id,
    );
    expect(resolved.resolvedAt).toBeInstanceOf(Date);
    const reopened = await service.update(
      't-1',
      { status: 'IN_PROGRESS' },
      tenantA.id,
    );
    expect(reopened.resolvedAt).toBeNull();
  });

  it('sets closedAt when the ticket closes', async () => {
    prisma._store.push(ticketRow('t-1', { status: 'RESOLVED' }));
    const closed = await service.update(
      't-1',
      { status: 'CLOSED' },
      tenantA.id,
    );
    expect(closed.closedAt).toBeInstanceOf(Date);
  });

  it('assigns only to an ACTIVE membership of the same tenant (AC-F05-1)', async () => {
    prisma = fakePrisma(
      [ticketRow('t-1')],
      [
        { id: 'mem-a', tenantId: tenantA.id, status: 'ACTIVE' },
        { id: 'mem-b', tenantId: tenantB.id, status: 'ACTIVE' },
        { id: 'mem-off', tenantId: tenantA.id, status: 'SUSPENDED' },
      ],
    );
    service = new TicketsService(prisma as unknown as PrismaService);

    const assigned = await service.update(
      't-1',
      { assigneeMembershipId: 'mem-a' },
      tenantA.id,
    );
    expect(assigned.assigneeMembershipId).toBe('mem-a');

    await expect(
      service.update('t-1', { assigneeMembershipId: 'mem-b' }, tenantA.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update('t-1', { assigneeMembershipId: 'mem-off' }, tenantA.id),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.update(
        't-1',
        { assigneeMembershipId: 'mem-missing' },
        tenantA.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update changes the title (AC-F05-1 field write)', async () => {
    prisma._store.push(ticketRow('t-1'));
    const updated = await service.update(
      't-1',
      { title: 'Renamed' },
      tenantA.id,
    );
    expect(updated.title).toBe('Renamed');
  });

  it('rejects an unknown priority value with 400', async () => {
    prisma._store.push(ticketRow('t-1'));
    await expect(
      service.update('t-1', { priority: 'WHENEVER' } as never, tenantA.id),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('update throws for an unknown ticket id', async () => {
    await expect(
      service.update('missing', { title: 'x' }, tenantA.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('remove deletes a ticket inside the tenant scope', async () => {
    prisma._store.push(ticketRow('t-1'));
    await expect(service.remove('t-1', tenantA.id)).resolves.toEqual({
      success: true,
    });
    await expect(service.findOne('t-1', tenantA.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('remove refuses a tenant B ticket from tenant A scope', async () => {
    prisma._store.push(ticketRow('b-1', { tenantId: tenantB.id }));
    await expect(service.remove('b-1', tenantA.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('internal note stays out of customer-visible messages (TH-05)', () => {
    const visible = customerVisibleMessages(tenantAFixture.messages);
    expect(visible).toHaveLength(1);
    expect(visible.some((m) => m.id === tenantAFixture.messages[1]!.id)).toBe(
      false,
    );
  });
});
