/**
 * T5.04 audit and trace routes (F-11; AC-F11-3).
 *
 * Runs the real guard chain: SupabaseAuthGuard -> PermissionsGuard -> tenant
 * scope check. Covers 401, 403 without `audit.read` (AC-F11-3), 400 without a
 * tenant scope, 403 for a guessed foreign tenant, 400 for a bad page size, and
 * 200 for both reads with the tenant filter applied.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { AuditQueryController } from './audit-query.controller.js';
import { AuditQueryService } from './audit-query.service.js';

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

const EVENT_ROW = {
  id: 'event-1',
  tenantId: 'tenant-a',
  actorId: 'user-1',
  action: 'ticket.updated',
  resourceType: 'ticket',
  resourceId: 'ticket-1',
  metadataJson: {},
  requestId: 'req-1',
  createdAt: new Date('2026-11-03T10:00:00.000Z'),
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function prismaFake() {
  return {
    auditEvent: { findMany: vi.fn().mockResolvedValue([EVENT_ROW]) },
    aiTrace: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findUnique: vi.fn().mockResolvedValue(USER_ROW) },
  };
}

describe('Audit and trace routes (integration)', () => {
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

    role = null;
    prisma = prismaFake();
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuditQueryController],
      providers: [
        AuditQueryService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: PRISMA_SERVICE, useValue: prisma },
        {
          provide: AuditService,
          useValue: { record: vi.fn().mockResolvedValue(undefined) },
        },
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
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('returns 401 without a credential', async () => {
    const res = await request(app.getHttpServer()).get(
      '/audit/events?tenantId=tenant-a',
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 without audit.read and reads no row (AC-F11-3)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/audit/events?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a customer reading traces (AC-F11-3)', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .get('/audit/traces?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(prisma.aiTrace.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 without a tenant scope', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/audit/events')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns 403 for a guessed tenant outside the memberships', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/audit/events?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 for a page size above the cap', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/audit/events?tenantId=tenant-a&limit=101')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns the tenant audit page', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/audit/events?tenantId=tenant-a&limit=10')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      action: 'ticket.updated',
      requestId: 'req-1',
    });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a' },
        take: 10,
      }),
    );
  });

  it('returns the tenant trace page', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .get('/audit/traces?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ items: [], limit: 25 });
    expect(prisma.aiTrace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });
});
