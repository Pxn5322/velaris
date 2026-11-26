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
import type { TicketQueueOptions } from './tickets.service.js';

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
  primaryConversationId?: string | null;
  /** The nested read findAll asks Prisma for (D-75 queue preview). */
  primaryConversation?: { messages: { body: string }[] } | null;
  /** The customer label the queue row shows (D-79). */
  customer?: { displayName: string; email: string | null };
};

type MessageRow = { conversationId: string; body: string };

type MembershipRow = {
  id: string;
  tenantId: string;
  userId?: string;
  status: string;
  roles?: { role: { code: string; baseRoleCode: string | null } }[];
};

type AssignmentRow = {
  tenantId: string;
  ticketId: string;
  fromMembershipId: string | null;
  toMembershipId: string | null;
  actorId: string | null;
};

function fakePrisma(tickets: TicketRow[], memberships: MembershipRow[] = []) {
  const store = [...tickets];
  const assignments: AssignmentRow[] = [];
  const messages: MessageRow[] = [];
  let counter = 0;
  const client = {
    ticket: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = store.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      }),
      findMany: vi.fn(
        async ({
          where,
          skip,
          take,
        }: {
          where?: { tenantId: string };
          skip?: number;
          take?: number;
        } = {}) => {
          const rows = store.filter(
            (r) => !where?.tenantId || r.tenantId === where.tenantId,
          );
          const start = skip ?? 0;
          return rows
            .slice(start, take === undefined ? undefined : start + take)
            .map((r) => ({ ...r }));
        },
      ),
      count: vi.fn(
        async ({ where }: { where?: { tenantId: string } } = {}) =>
          store.filter((r) => !where?.tenantId || r.tenantId === where.tenantId)
            .length,
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
    message: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where?: { conversationId?: { in: string[] } };
        } = {}) =>
          messages
            .filter(
              (m) =>
                !where?.conversationId ||
                where.conversationId.in.includes(m.conversationId),
            )
            .map((m) => ({ ...m })),
      ),
    },
    tenantMembership: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const membership = memberships.find((m) => m.id === where.id);
        return membership
          ? {
              ...membership,
              roles: membership.roles ?? [
                { role: { code: 'R-agent', baseRoleCode: null } },
              ],
            }
          : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) =>
        memberships
          .filter(
            (m) =>
              m.tenantId === where.tenantId &&
              m.status === 'ACTIVE' &&
              (m.roles ?? [{ role: { code: 'R-agent' } }]).some(
                ({ role }) => role.code === 'R-agent',
              ),
          )
          .map((m) => ({
            id: m.id,
            userId: m.userId ?? 'user-' + m.id,
            user: {
              displayName: 'Agent ' + m.id,
              emailNormalized: m.id + '@acme.test',
            },
            roles: m.roles ?? [
              { role: { code: 'R-agent', baseRoleCode: null } },
            ],
          })),
      ),
    },
    ticketAssignment: {
      create: vi.fn(async ({ data }: { data: AssignmentRow }) => {
        assignments.push(data);
        return data;
      }),
    },
    $queryRaw: vi.fn(async () => [] as { id: string }[]),
    _store: store,
    _assignments: assignments,
    _messages: messages,
  };
  return Object.assign(client, {
    $transaction: vi.fn(async (callback: (tx: typeof client) => unknown) =>
      callback(client),
    ),
  });
}

function ticketRow(id: string, overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id,
    tenantId: tenantA.id,
    customerId: 'customer-1',
    primaryConversationId: null,
    customer: {
      displayName: 'Jordan Ellis',
      email: 'jordan.ellis@northstar.test',
    },
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

  const listPage = async (options: TicketQueueOptions = {}) =>
    (await service.findPage(tenantA.id, options)).items;

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
    const result = await listPage();
    expect(result).toHaveLength(1);
    expect(result[0]!.tenantId).toBe(tenantA.id);
  });

  it('findPage returns one page and the total that matched (D-81)', async () => {
    prisma._store.push(
      ticketRow('p-1'),
      ticketRow('p-2'),
      ticketRow('p-3'),
      ticketRow('p-4'),
    );

    const first = await service.findPage(tenantA.id, { page: 1, pageSize: 2 });
    expect(first.items.map((row) => row.id)).toEqual(['p-1', 'p-2']);
    expect(first).toMatchObject({ total: 4, page: 1, pageSize: 2 });

    const second = await service.findPage(tenantA.id, { page: 2, pageSize: 2 });
    expect(second.items.map((row) => row.id)).toEqual(['p-3', 'p-4']);
    expect(second.total).toBe(4);

    // The window is part of the read, so the database returns one page only.
    expect(prisma.ticket.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ skip: 2, take: 2 }),
    );
    expect(prisma.ticket.count).toHaveBeenCalledTimes(2);
  });

  it('findPage refuses a page size above the cap and a non-positive page (D-81)', async () => {
    await expect(
      service.findPage(tenantA.id, { pageSize: 101 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.findPage(tenantA.id, { page: 0 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findPage applies the queue filters inside the query (D-81)', async () => {
    await service.findPage(tenantA.id, {
      statuses: ['OPEN', 'IN_PROGRESS'],
      priority: 'HIGH',
      assigneeMembershipId: 'membership-1',
      customerId: 'customer-1',
    });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: tenantA.id,
          customerId: 'customer-1',
          status: { in: ['OPEN', 'IN_PROGRESS'] },
          priority: 'HIGH',
          assigneeMembershipId: 'membership-1',
        },
      }),
    );
  });

  it('findPage refuses an unknown status (D-81)', async () => {
    await expect(
      service.findPage(tenantA.id, { statuses: ['NONSENSE'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('findAll previews the linked conversation for the queue (D-75)', async () => {
    prisma._store.push(
      ticketRow('t-linked', {
        primaryConversation: {
          messages: [
            { body: 'Exporting  November\ninvoices returns a blank file.' },
          ],
        },
      }),
      ticketRow('t-unlinked'),
      ticketRow('t-agent-first', { primaryConversation: { messages: [] } }),
    );

    const result = await listPage();
    const byId = new Map(result.map((row) => [row.id, row]));

    expect(byId.get('t-linked')!.descriptionPreview).toBe(
      'Exporting November invoices returns a blank file.',
    );
    expect(byId.get('t-unlinked')!.descriptionPreview).toBeNull();
    expect(byId.get('t-agent-first')!.descriptionPreview).toBeNull();

    // TH-05: only customer-visible CUSTOMER text, and only the first message,
    // can become a preview; an internal note or a later reply never does.
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          primaryConversation: {
            select: {
              messages: {
                where: {
                  authorType: 'CUSTOMER',
                  visibility: 'CUSTOMER_VISIBLE',
                },
                orderBy: { createdAt: 'asc' },
                take: 1,
                select: { body: true },
              },
            },
          },
          customer: { select: { displayName: true, email: true } },
        },
      }),
    );
  });

  it('findAll gives the queue each row customer name and email (D-79)', async () => {
    prisma._store.push(
      ticketRow('t-person', {
        customer: {
          displayName: 'Priya Raman',
          email: 'priya@example.test',
        },
      }),
    );

    const [row] = await listPage();

    expect(row!.customerName).toBe('Priya Raman');
    expect(row!.customerEmail).toBe('priya@example.test');
    // The nested customer object never reaches the queue payload.
    expect(row).not.toHaveProperty('customer');
  });

  it('findAll cuts a long description preview to a triage-sized line', async () => {
    prisma._store.push(
      ticketRow('t-long', {
        primaryConversation: { messages: [{ body: 'x'.repeat(300) }] },
      }),
    );

    const [row] = await listPage();

    expect(row!.descriptionPreview).toHaveLength(140);
    expect(row!.descriptionPreview!.endsWith('…')).toBe(true);
  });

  it('findAll searches every customer-visible message of the linked thread (D-77)', async () => {
    prisma._store.push(
      ticketRow('t-linked', {
        primaryConversationId: 'conv-1',
        primaryConversation: {
          messages: [{ body: 'Exporting invoices returns a blank file.' }],
        },
      }),
    );
    // The phrase is in a later customer reply, not in the first message.
    prisma._messages.push({
      conversationId: 'conv-1',
      body: 'It still fails after the retry on 2 December.',
    });

    const [row] = await listPage({
      query: 'retry on 2 December',
    });

    // The preview still opens the thread, and the match shows why the row hit.
    expect(row!.descriptionPreview).toBe(
      'Exporting invoices returns a blank file.',
    );
    expect(row!.matchPreview).toBe(
      'It still fails after the retry on 2 December.',
    );
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: tenantA.id,
          OR: expect.arrayContaining([
            { title: { contains: 'retry on 2 December', mode: 'insensitive' } },
            {
              primaryConversation: {
                messages: {
                  some: {
                    authorType: 'CUSTOMER',
                    visibility: 'CUSTOMER_VISIBLE',
                    body: {
                      contains: 'retry on 2 December',
                      mode: 'insensitive',
                    },
                  },
                },
              },
            },
          ]),
        }),
      }),
    );
  });

  it('findAll search still finds a ticket by a fragment of its id (D-77)', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ id: 'ticket-1' }]);
    prisma._store.push(ticketRow('ticket-1'));

    await listPage({ query: 'ticket-1' });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([{ id: { in: ['ticket-1'] } }]),
        }),
      }),
    );
  });

  it('findAll search matches the customer name and email (D-78)', async () => {
    prisma._store.push(ticketRow('t-person'));

    await listPage({ query: 'priya' });

    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              customer: {
                OR: [
                  { displayName: { contains: 'priya', mode: 'insensitive' } },
                  { email: { contains: 'priya', mode: 'insensitive' } },
                ],
              },
            },
          ]),
        }),
      }),
    );
  });

  it('findAll keeps the description preview for a title-only match (D-77)', async () => {
    prisma._store.push(
      ticketRow('t-title', {
        title: 'Refund not received',
        primaryConversationId: 'conv-2',
        primaryConversation: {
          messages: [{ body: 'My refund has not arrived.' }],
        },
      }),
    );

    const [row] = await listPage({ query: 'refund' });

    expect(row!.descriptionPreview).toBe('My refund has not arrived.');
    expect(row!.matchPreview).toBeNull();
  });

  it('findAll reads no thread and sets no match without a query (D-77)', async () => {
    prisma._store.push(ticketRow('t-plain'));

    const [row] = await listPage();

    expect(row!.matchPreview).toBeNull();
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(prisma.ticket.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: tenantA.id } }),
    );
  });

  it('findAll search never reads internal notes or agent text (TH-05)', async () => {
    prisma._store.push(
      ticketRow('t-linked', {
        primaryConversationId: 'conv-1',
        primaryConversation: { messages: [{ body: 'Opening line.' }] },
      }),
    );

    await listPage({ query: 'churn risk' });

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: tenantA.id,
          authorType: 'CUSTOMER',
          visibility: 'CUSTOMER_VISIBLE',
          body: { contains: 'churn risk', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('findAll search reads only the linked threads of this tenant (TH-01)', async () => {
    prisma._store.push(
      ticketRow('a-1', {
        primaryConversationId: 'conv-a',
        primaryConversation: { messages: [{ body: 'Tenant A text.' }] },
      }),
      ticketRow('b-1', {
        tenantId: tenantB.id,
        primaryConversationId: 'conv-b',
        primaryConversation: { messages: [{ body: 'Tenant B text.' }] },
      }),
    );

    await listPage({ query: 'text' });

    expect(prisma.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId: { in: ['conv-a'] },
        }),
      }),
    );
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

  it('records assignment history, including unassignment', async () => {
    prisma = fakePrisma(
      [ticketRow('t-1')],
      [{ id: 'mem-a', tenantId: tenantA.id, status: 'ACTIVE' }],
    );
    service = new TicketsService(prisma as unknown as PrismaService);

    await service.update(
      't-1',
      { assigneeMembershipId: 'mem-a' },
      tenantA.id,
      'actor-1',
    );
    await service.update(
      't-1',
      { assigneeMembershipId: null },
      tenantA.id,
      'actor-1',
    );

    expect(prisma._assignments).toEqual([
      expect.objectContaining({
        tenantId: tenantA.id,
        ticketId: 't-1',
        fromMembershipId: null,
        toMembershipId: 'mem-a',
        actorId: 'actor-1',
      }),
      expect.objectContaining({
        tenantId: tenantA.id,
        ticketId: 't-1',
        fromMembershipId: 'mem-a',
        toMembershipId: null,
        actorId: 'actor-1',
      }),
    ]);
  });

  it('rejects assigning a customer membership', async () => {
    prisma = fakePrisma(
      [ticketRow('t-1')],
      [
        {
          id: 'mem-customer',
          tenantId: tenantA.id,
          status: 'ACTIVE',
          roles: [{ role: { code: 'R-customer', baseRoleCode: null } }],
        },
      ],
    );
    service = new TicketsService(prisma as unknown as PrismaService);

    await expect(
      service.update(
        't-1',
        { assigneeMembershipId: 'mem-customer' },
        tenantA.id,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists active agent memberships for assignment', async () => {
    prisma = fakePrisma(
      [],
      [
        {
          id: 'mem-a',
          tenantId: tenantA.id,
          userId: 'user-a',
          status: 'ACTIVE',
        },
        {
          id: 'mem-customer',
          tenantId: tenantA.id,
          status: 'ACTIVE',
          roles: [{ role: { code: 'R-customer', baseRoleCode: null } }],
        },
      ],
    );
    service = new TicketsService(prisma as unknown as PrismaService);

    const assignees = await service.listAssignees(tenantA.id);
    expect(assignees).toEqual([
      expect.objectContaining({
        membershipId: 'mem-a',
        userId: 'user-a',
        displayName: 'Agent mem-a',
      }),
    ]);
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
