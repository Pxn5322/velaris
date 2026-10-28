/**
 * Guarded customer routes (T2.03, AC-F05-3 on the customers surface).
 *
 * The prototype CustomersController had no guards at all: any caller
 * could list or create customers. The replacement runs the real chain,
 * SupabaseAuthGuard -> PermissionsGuard -> tenant scope check, over the
 * T2.01 `customers` table. Synthetic tenant A/B data only.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
import { CustomerScopeService } from './customer-scope.service.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

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

function fakePrisma(rows: Record<string, unknown>[]) {
  const store = [...rows];
  let counter = 0;
  return {
    customer: {
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        store.filter((c) => c.tenantId === where.tenantId),
      findUnique: async ({ where }: { where: { id: string } }) =>
        store.find((c) => c.id === where.id) ?? null,
      findFirst: async ({
        where,
      }: {
        where: {
          tenantId: string;
          email?: { equals: string };
          deletedAt: null;
        };
      }) => {
        if (!where.email) {
          return null;
        }
        const needle = where.email.equals.toLowerCase();
        return (
          store.find(
            (c) =>
              c.tenantId === where.tenantId &&
              c.deletedAt === null &&
              String(c.email ?? '').toLowerCase() === needle,
          ) ?? null
        );
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: 'cust-http-' + ++counter,
          status: 'ACTIVE',
          email: null,
          phone: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.push(row);
        return row;
      },
    },
    _store: store,
  };
}

describe('Customers routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let prismaFake: ReturnType<typeof fakePrisma>;

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
    prismaFake = fakePrisma([
      {
        id: 'cust-a',
        tenantId: 'tenant-a',
        displayName: 'Alice',
        status: 'ACTIVE',
        email: 'user@example.test',
        phone: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'cust-a2',
        tenantId: 'tenant-a',
        displayName: 'Alice2',
        status: 'ACTIVE',
        email: 'other@example.test',
        phone: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 'cust-b',
        tenantId: 'tenant-b',
        displayName: 'Bob',
        status: 'ACTIVE',
        email: null,
        phone: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        CustomersService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: PRISMA_SERVICE, useValue: prismaFake },
        { provide: AuditService, useValue: { record: vi.fn() } },
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
      '/customers?tenantId=tenant-a',
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 without ticket.read (AC-F05-3)', async () => {
    const res = await request(app.getHttpServer())
      .get('/customers?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('returns 400 without a tenant scope', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/customers')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(400);
  });

  it('lists only the scoped tenant customers', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/customers?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(['cust-a', 'cust-a2']),
    );
  });

  it('R-customer list returns only their own row', async () => {
    role = 'R-customer';
    const res = await request(app.getHttpServer())
      .get('/customers?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'cust-a' });
  });

  it('R-customer is refused another customer row in the same tenant', async () => {
    role = 'R-customer';
    const res = await request(app.getHttpServer())
      .get('/customers/cust-a2?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('R-customer with no matching customer row sees nothing (deny by default)', async () => {
    role = 'R-customer';
    const store = prismaFake._store;
    const row = store.find((c) => c.id === 'cust-a');
    if (row) {
      row.email = 'someone-else@example.test';
    }
    const list = await request(app.getHttpServer())
      .get('/customers?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);
    const one = await request(app.getHttpServer())
      .get('/customers/cust-a?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(one.status).toBe(403);
  });

  it('denies a guessed tenant-B scope (AC-F04-3)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/customers?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('fetches one customer inside the scope', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/customers/cust-a?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 'cust-a' });
  });

  it('refuses a customer row from another tenant (AC-F04-3)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/customers/cust-b?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('denies customer creation without ticket.write', async () => {
    role = 'R-customer';
    const res = await request(app.getHttpServer())
      .post('/customers?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ displayName: 'New', email: 'new@example.test' });
    expect(res.status).toBe(403);
  });

  it('creates a customer in the scoped tenant with ticket.write', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .post('/customers?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ displayName: 'New Person', email: 'new@example.test' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenantId: 'tenant-a',
      displayName: 'New Person',
      status: 'ACTIVE',
    });
  });
});
