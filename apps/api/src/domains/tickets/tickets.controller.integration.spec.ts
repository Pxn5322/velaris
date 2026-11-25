/**
 * Guarded ticket routes (T1.03 route wiring, AC-F02-3/AC-F04-3, T2.02).
 *
 * Runs the real guard chain on the real controller:
 * SupabaseAuthGuard -> PermissionsGuard -> tenant scope check. Covers:
 * - 401 without a credential (authentication first)
 * - 403 for an authenticated principal without the permission (AC-F02-3)
 * - 403 when tenant A credentials request tenant B data by guessed ID
 *   (AC-F04-3)
 * - 403 when the submitted tenant identifier does not exist (AC-F03-2)
 * - 400 when the submitted body tenant identifier contradicts the query
 *   (AC-F03-2)
 * - 400 when no tenant scope is supplied (deny by default: no scope, no data)
 * - 409 when a PATCH makes an invalid status transition (AC-F05-2)
 * - 409 when a PATCH carries a stale expectedVersion (AC-F05-2)
 * - 200/201 when the resolved role holds the permission and the membership
 *   is in scope
 *
 * Synthetic tenant A/B data only; the Prisma layer is an in-memory fake,
 * no network and no database.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AUTH_ACCOUNT_TEST_PROVIDER } from '../../../test/auth-account.stub.js';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import { AuditService } from '../audit/audit.service.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { CustomerScopeService } from '../customers/customer-scope.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';

/** Caller with an ACTIVE membership in tenant A only. */
const USER_ROW = {
  id: 'user-1',
  provider: 'supabase',
  externalSubject: 'sub-123',
  status: 'ACTIVE',
  memberships: [
    {
      id: 'membership-1',
      tenantId: 'tenant-a',
      userId: 'user-1',
      status: 'ACTIVE',
      tenant: { id: 'tenant-a', slug: 'acme', name: 'Acme', status: 'ACTIVE' },
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** One in-memory tickets table shared by the fake Prisma client. */
type FakeTicket = Record<string, unknown>;

/** One in-memory customers table (T2.04 scope resolver). */
type FakeCustomer = {
  id: string;
  tenantId: string;
  email: string | null;
  displayName: string;
};

function fakeTicketPrisma(tickets: FakeTicket[]) {
  const store = [...tickets];
  const assignments: FakeTicket[] = [];
  const conversations: { id: string; tenantId: string; customerId: string }[] =
    [];
  const customers: FakeCustomer[] = [
    {
      id: 'customer-1',
      tenantId: 'tenant-a',
      email: 'user@example.test',
      displayName: 'User Example',
    },
  ];
  let counter = 0;
  const client = {
    ticket: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = store.find((r) => r.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        store.filter((r) => r.tenantId === where.tenantId),
      create: async ({ data }: { data: FakeTicket }) => {
        const row: FakeTicket = {
          id:
            'aaaaaaaa-0000-4000-8000-00000000' +
            String(++counter).padStart(4, '0'),
          status: 'OPEN',
          assigneeMembershipId: null,
          slaState: 'NOT_SET',
          tags: [],
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          resolvedAt: null,
          closedAt: null,
          ...data,
        };
        store.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; tenantId: string; version: number };
        data: FakeTicket;
      }) => {
        const hits = store.filter(
          (r) =>
            r.id === where.id &&
            r.tenantId === where.tenantId &&
            r.version === where.version,
        );
        hits.forEach((hit) => Object.assign(hit, data));
        return { count: hits.length };
      },
      delete: async () => ({}),
    },
    tenantMembership: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'membership-agent'
          ? {
              id: 'membership-agent',
              tenantId: 'tenant-a',
              status: 'ACTIVE',
              roles: [{ role: { code: 'R-agent', baseRoleCode: null } }],
            }
          : null,
      findMany: async () => [
        {
          id: 'membership-agent',
          userId: 'user-agent',
          user: {
            displayName: 'Avery Agent',
            emailNormalized: 'avery@example.test',
          },
          roles: [{ role: { code: 'R-agent' } }],
        },
      ],
    },
    ticketAssignment: {
      create: async ({ data }: { data: FakeTicket }) => {
        assignments.push(data);
        return data;
      },
    },
    customer: {
      // The identity email maps to a customer row inside its own tenant; a
      // missing row is what a first self-service ticket has to create.
      findFirst: async ({
        where,
      }: {
        where: { tenantId: string; email?: { equals: string } };
      }) => {
        const wanted = where.email?.equals.toLowerCase();
        const row = customers.find(
          (candidate) =>
            candidate.tenantId === where.tenantId &&
            candidate.email?.toLowerCase() === wanted,
        );
        return row ? { id: row.id } : null;
      },
      create: async ({ data }: { data: Omit<FakeCustomer, 'id'> }) => {
        const row: FakeCustomer = {
          id: 'customer-' + String(customers.length + 1),
          ...data,
        };
        customers.push(row);
        return row;
      },
    },
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        conversations.find((c) => c.id === where.id) ?? null,
    },
    _store: store,
    _assignments: assignments,
    _customers: customers,
    _conversations: conversations,
  };
  return Object.assign(client, {
    $transaction: async (callback: (tx: typeof client) => unknown) =>
      callback(client),
  });
}

function seededTicket(overrides: FakeTicket = {}): FakeTicket {
  return {
    id: 'ticket-seeded',
    tenantId: 'tenant-a',
    customerId: 'customer-1',
    title: 'Seeded',
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

describe('Tickets routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;
  let prismaFake: ReturnType<typeof fakeTicketPrisma>;

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          jsonResponse(200, { sub: 'sub-123', email: 'user@example.test' }),
        ),
    );

    role = null;
    auditRecord = vi.fn().mockResolvedValue(undefined);
    prismaFake = fakeTicketPrisma([]);
    const findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [
        TicketsService,
        AuthorizationService,
        SupabaseAuthGuard,

        AUTH_ACCOUNT_TEST_PROVIDER,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: PRISMA_SERVICE, useValue: prismaFake },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: resolver },
        {
          provide: CustomerScopeService,
          useValue: new CustomerScopeService(
            prismaFake as unknown as PrismaService,
          ),
        },
        {
          provide: TenantsService,
          useValue: new TenantsService({
            user: { findUnique },
          } as unknown as PrismaService),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns 401 without a credential', async () => {
    const res = await request(app.getHttpServer()).get(
      '/tickets?tenantId=tenant-a',
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for an authenticated principal without the permission (AC-F02-3)', async () => {
    const res = await request(app.getHttpServer())
      .get('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('returns 400 when no tenant scope is supplied', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('lists tickets for the caller tenant with ticket.read (AC-F04-1 scope)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('lists eligible assignees for an agent', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets/assignees?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        membershipId: 'membership-agent',
        userId: 'user-agent',
        displayName: 'Avery Agent',
        email: 'avery@example.test',
        roles: ['R-agent'],
      },
    ]);
  });

  it('denies the assignee list to a customer', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .get('/tickets/assignees?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('denies tenant A credentials on tenant B by guessed ID (AC-F04-3)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('rejects a submitted tenant identifier with no matching tenant (AC-F03-2)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets?tenantId=tenant-does-not-exist')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('rejects a body tenant identifier that contradicts the query (AC-F03-2)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .post('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({
        tenantId: 'tenant-b',
        title: 'Help',
        customerId: 'customer-1',
      });

    expect(res.status).toBe(400);
  });

  it('denies ticket writes to a role without ticket.write (AC-F02-3)', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ tenantId: 'tenant-a', title: 'Help', customerId: 'customer-1' });

    expect(res.status).toBe(403);
  });

  it('creates a ticket for an in-scope role with ticket.write', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .post('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ tenantId: 'tenant-a', title: 'Help', customerId: 'customer-1' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenantId: 'tenant-a',
      status: 'OPEN',
      version: 0,
    });
    // T1.04: the sensitive mutation is audited with its scope and actor.
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.created',
        resourceType: 'ticket',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
        resourceId: res.body.id,
      }),
    );
  });

  it('denies reading tenant B data through findOne by guessed ID (AC-F04-3)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets/aaaaaaaa-0000-4000-8000-000000000009?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('rejects a malformed ticket id with 400 (F-G3-2)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/tickets/not-a-uuid?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('R-customer list returns only tickets of their own customer row', async () => {
    role = 'R-customer';
    prismaFake._store.push(
      seededTicket({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        customerId: 'customer-1',
      }),
      seededTicket({
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        customerId: 'customer-2',
      }),
    );

    const res = await request(app.getHttpServer())
      .get('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
    });
  });

  it('R-customer reads their own ticket but gets 404 for another customer ticket', async () => {
    role = 'R-customer';
    prismaFake._store.push(
      seededTicket({
        id: 'aaaaaaaa-0000-4000-8000-000000000001',
        customerId: 'customer-1',
      }),
      seededTicket({
        id: 'aaaaaaaa-0000-4000-8000-000000000002',
        customerId: 'customer-2',
      }),
    );

    const mine = await request(app.getHttpServer())
      .get('/tickets/aaaaaaaa-0000-4000-8000-000000000001?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(mine.status).toBe(200);

    const theirs = await request(app.getHttpServer())
      .get('/tickets/aaaaaaaa-0000-4000-8000-000000000002?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(theirs.status).toBe(404);
  });

  it('applies a valid transition over HTTP and audits it (AC-F05-1)', async () => {
    role = 'R-agent';
    prismaFake._store.push(
      seededTicket({ id: 'aaaaaaaa-0000-4000-8000-000000000003' }),
    );

    const res = await request(app.getHttpServer())
      .patch('/tickets/aaaaaaaa-0000-4000-8000-000000000003?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'IN_PROGRESS', expectedVersion: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'IN_PROGRESS', version: 1 });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.updated',
        resourceId: 'aaaaaaaa-0000-4000-8000-000000000003',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
      }),
    );
  });

  it('assigns a ticket, records history and audits the assignment', async () => {
    role = 'R-agent';
    prismaFake._store.push(
      seededTicket({ id: 'aaaaaaaa-0000-4000-8000-000000000010' }),
    );

    const res = await request(app.getHttpServer())
      .patch('/tickets/aaaaaaaa-0000-4000-8000-000000000010?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ assigneeMembershipId: 'membership-agent', expectedVersion: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      assigneeMembershipId: 'membership-agent',
      version: 1,
    });
    expect(prismaFake._assignments).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-a',
        ticketId: 'aaaaaaaa-0000-4000-8000-000000000010',
        fromMembershipId: null,
        toMembershipId: 'membership-agent',
        actorId: 'sub-123',
      }),
    ]);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.assigned',
        resourceId: 'aaaaaaaa-0000-4000-8000-000000000010',
        metadata: { title: 'Seeded', assigneeMembershipId: 'membership-agent' },
      }),
    );
  });

  it('rejects an invalid transition over HTTP with 409 (AC-F05-2)', async () => {
    role = 'R-agent';
    prismaFake._store.push(
      seededTicket({
        id: 'aaaaaaaa-0000-4000-8000-000000000005',
        status: 'PENDING_CUSTOMER',
      }),
    );

    const res = await request(app.getHttpServer())
      .patch('/tickets/aaaaaaaa-0000-4000-8000-000000000005?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'OPEN' });

    expect(res.status).toBe(409);
  });

  it('refuses a direct close over HTTP with 409 (migration-0003 invariant)', async () => {
    role = 'R-agent';
    prismaFake._store.push(
      seededTicket({ id: 'aaaaaaaa-0000-4000-8000-000000000006' }),
    );

    const res = await request(app.getHttpServer())
      .patch('/tickets/aaaaaaaa-0000-4000-8000-000000000006?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'CLOSED' });

    expect(res.status).toBe(409);
  });

  it('rejects a stale expectedVersion over HTTP with 409 (AC-F05-2)', async () => {
    role = 'R-agent';
    prismaFake._store.push(
      seededTicket({ id: 'aaaaaaaa-0000-4000-8000-000000000004', version: 2 }),
    );

    const res = await request(app.getHttpServer())
      .patch('/tickets/aaaaaaaa-0000-4000-8000-000000000004?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ priority: 'URGENT', expectedVersion: 1 });

    expect(res.status).toBe(409);
  });

  it('does not audit a refused update (AC-F05-2 side effects)', async () => {
    role = 'R-agent';
    prismaFake._store.push(
      seededTicket({ id: 'aaaaaaaa-0000-4000-8000-000000000007' }),
    );

    const res = await request(app.getHttpServer())
      .patch('/tickets/aaaaaaaa-0000-4000-8000-000000000007?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'CLOSED', expectedVersion: 99 });

    expect(res.status).toBe(409);
    expect(auditRecord).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ticket.updated' }),
    );
  });

  it('lets a customer open a ticket for their own customer record (AC-F05-1)', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({
        title: 'Printer on floor 3 is offline',
        tags: ['Hardware'],
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenantId: 'tenant-a',
      customerId: 'customer-1',
      title: 'Printer on floor 3 is offline',
      status: 'OPEN',
      tags: ['Hardware'],
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ticket.created',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
      }),
    );

    // The same customer reads it back through the list route.
    const list = await request(app.getHttpServer())
      .get('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      title: 'Printer on floor 3 is offline',
      customerId: 'customer-1',
    });
  });

  it('refuses a body tenantId that contradicts the query scope', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'Wrong tenant', tenantId: 'tenant-b' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Body tenantId must match');
    expect(prismaFake._store).toHaveLength(0);
  });

  it('refuses a body customerId that is not the caller record', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'Wrong customer', customerId: 'customer-2' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Body customerId must match');
    expect(prismaFake._store).toHaveLength(0);
  });

  it('accepts a body customerId that matches the caller record', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'Own customer id', customerId: 'customer-1' });

    expect(res.status).toBe(201);
    expect(res.body.customerId).toBe('customer-1');
  });

  it('links a conversation the caller owns and refuses a foreign one', async () => {
    role = 'R-customer';
    prismaFake._conversations.push(
      { id: 'conv-own', tenantId: 'tenant-a', customerId: 'customer-1' },
      { id: 'conv-foreign', tenantId: 'tenant-a', customerId: 'customer-2' },
    );

    const mine = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'With description', conversationId: 'conv-own' });
    expect(mine.status).toBe(201);
    expect(mine.body.primaryConversationId).toBe('conv-own');

    const foreign = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({
        title: 'With foreign conversation',
        conversationId: 'conv-foreign',
      });
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toContain('conversationId must reference');
  });

  it('creates the customer row on the first self-service ticket', async () => {
    role = 'R-customer';
    prismaFake._customers.length = 0;

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'My first request' });

    expect(res.status).toBe(201);
    expect(prismaFake._customers).toEqual([
      expect.objectContaining({
        tenantId: 'tenant-a',
        email: 'user@example.test',
        displayName: 'user@example.test',
      }),
    ]);
    expect(res.body.customerId).toBe(prismaFake._customers[0].id);
  });

  it('refuses the self-service route to a non-customer role', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'Agent attempt' });

    expect(res.status).toBe(403);
  });

  it('refuses a self-service ticket without a title', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets/self?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: '   ' });

    expect(res.status).toBe(400);
  });

  it('returns 403 for a customer on the tenant-wide create route', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ title: 'Bypass attempt', customerId: 'customer-2' });

    expect(res.status).toBe(403);
  });
});
