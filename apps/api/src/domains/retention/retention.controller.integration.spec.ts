/**
 * Tenant retention settings routes (T6.06; F-14; AC-F14-2, AC-F14-3).
 *
 * The route answers 401 without a credential, 403 for a role without
 * `retention.manage`, 400 without a tenant scope, 403 for a tenant the caller
 * does not belong to, and 200 only for R-tenant-admin with an active
 * membership. Every write pins the caller's tenant and records one audit row.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureApp } from '../../app.setup.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { RetentionController } from './retention.controller.js';
import { RetentionService } from './retention.service.js';

const TRACES_ROW = {
  id: 'policy-1',
  tenantId: 'tenant-a',
  category: 'TRACES',
  retentionDays: 14,
  updatedBy: null,
};

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
      tenant: {
        id: 'tenant-a',
        slug: 'acme',
        name: 'Acme',
        status: 'ACTIVE',
      },
    },
  ],
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function prismaFake() {
  return {
    retentionPolicy: {
      findMany: vi.fn().mockResolvedValue([TRACES_ROW]),
      upsert: vi.fn().mockImplementation(
        async ({
          create,
          update,
        }: {
          create: {
            tenantId: string;
            category: string;
            retentionDays: number;
          };
          update: { retentionDays: number; updatedBy: string };
        }) => ({
          id: 'policy-1',
          tenantId: create.tenantId,
          category: create.category,
          retentionDays: update.retentionDays,
          updatedBy: update.updatedBy,
        }),
      ),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(USER_ROW) },
  };
}

describe('Retention settings routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let prisma: ReturnType<typeof prismaFake>;

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

    role = 'R-tenant-admin';
    prisma = prismaFake();
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [RetentionController],
      providers: [
        RetentionService,
        AuditService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: ROLE_RESOLVER, useValue: resolver },
        {
          provide: TenantsService,
          useValue: new TenantsService({
            user: { findUnique: prisma.user.findUnique },
          } as unknown as PrismaService),
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('answers 401 without a credential', async () => {
    const res = await request(app.getHttpServer()).get(
      '/settings/retention?tenantId=tenant-a',
    );
    expect(res.status).toBe(401);
    expect(prisma.retentionPolicy.findMany).not.toHaveBeenCalled();
  });

  it('denies a role without retention.manage (AC-F14-2)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/settings/retention?tenantId=tenant-a')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(403);
    expect(prisma.retentionPolicy.findMany).not.toHaveBeenCalled();
  });

  it('requires a tenant scope even from a tenant administrator', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings/retention')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(400);
    expect(prisma.retentionPolicy.findMany).not.toHaveBeenCalled();
  });

  it('denies a tenant the caller does not belong to (AC-F04-1)', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings/retention?tenantId=tenant-b')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(403);
    expect(prisma.retentionPolicy.findMany).not.toHaveBeenCalled();
  });

  it('lists every category with the stored TRACES window', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings/retention?tenantId=tenant-a')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tenantId: 'tenant-a',
      policies: [
        { category: 'KNOWLEDGE', retentionDays: null, configured: false },
        { category: 'TRACES', retentionDays: 14, configured: true },
        { category: 'MEMORY', retentionDays: null, configured: false },
      ],
    });
  });

  it('rejects a window outside 1..3650 with 400 and no write', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/retention')
      .set('Authorization', 'Bearer test-token')
      .send({ tenantId: 'tenant-a', category: 'TRACES', retentionDays: 0 });

    expect(res.status).toBe(400);
    expect(prisma.retentionPolicy.upsert).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown category with 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/retention')
      .set('Authorization', 'Bearer test-token')
      .send({ tenantId: 'tenant-a', category: 'EVERYTHING', retentionDays: 7 });

    expect(res.status).toBe(400);
    expect(prisma.retentionPolicy.upsert).not.toHaveBeenCalled();
  });

  it('stores a window inside the tenant and records one audit row', async () => {
    const res = await request(app.getHttpServer())
      .put('/settings/retention')
      .set('Authorization', 'Bearer test-token')
      .send({ tenantId: 'tenant-a', category: 'MEMORY', retentionDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      category: 'MEMORY',
      retentionDays: 7,
      configured: true,
    });
    expect(prisma.retentionPolicy.upsert).toHaveBeenCalledWith({
      where: {
        tenantId_category: { tenantId: 'tenant-a', category: 'MEMORY' },
      },
      create: {
        tenantId: 'tenant-a',
        category: 'MEMORY',
        retentionDays: 7,
        updatedBy: 'sub-123',
      },
      update: { retentionDays: 7, updatedBy: 'sub-123' },
    });
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'retention.policy_changed',
        resourceType: 'retention_policy',
        resourceId: 'MEMORY',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
      }),
    });
  });

  it('denies a role without retention.manage on the write path', async () => {
    role = 'R-customer';
    const res = await request(app.getHttpServer())
      .put('/settings/retention')
      .set('Authorization', 'Bearer test-token')
      .send({ tenantId: 'tenant-a', category: 'TRACES', retentionDays: 7 });

    expect(res.status).toBe(403);
    expect(prisma.retentionPolicy.upsert).not.toHaveBeenCalled();
  });
});
