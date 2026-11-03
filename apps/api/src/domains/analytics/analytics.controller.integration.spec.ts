/**
 * T5.03 analytics summary route (API-15; F-12).
 *
 * Runs the real guard chain: SupabaseAuthGuard -> PermissionsGuard -> tenant
 * scope check. Covers 401, 403 without `analytics.read`, 400 without a
 * tenant scope (deny by default), 403 for a guessed foreign tenant
 * (AC-F12-3), 400 for an invalid range, and 200 with documented metric
 * definitions and the empty state (AC-F12-1, AC-F12-2).
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
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

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

function prismaFake() {
  return {
    conversation: { count: vi.fn().mockResolvedValue(0) },
    ticket: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    aiTrace: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { count: vi.fn().mockResolvedValue(0) },
    message: {
      aggregate: vi.fn().mockResolvedValue({ _max: { createdAt: null } }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(USER_ROW) },
  };
}

describe('Analytics summary route (integration)', () => {
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
      controllers: [AnalyticsController],
      providers: [
        AnalyticsService,
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
      '/analytics/summary?tenantId=tenant-a',
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 without analytics.read (AC-F02-3)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/analytics/summary?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(prisma.conversation.count).not.toHaveBeenCalled();
  });

  it('returns 400 without a tenant scope (deny by default)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/analytics/summary')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
    expect(prisma.conversation.count).not.toHaveBeenCalled();
  });

  it('returns 403 for a guessed tenant outside the memberships (AC-F12-3)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/analytics/summary?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(prisma.conversation.count).not.toHaveBeenCalled();
  });

  it('returns 400 for an inverted range', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get(
        '/analytics/summary?tenantId=tenant-a&from=2026-11-03T00:00:00.000Z&to=2026-11-01T00:00:00.000Z',
      )
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('from');
  });

  it('returns the tenant summary with documented definitions and EMPTY state', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get(
        '/analytics/summary?tenantId=tenant-a&from=2026-11-01T00:00:00.000Z&to=2026-11-02T00:00:00.000Z',
      )
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      tenantId: 'tenant-a',
      state: 'EMPTY',
      staleAfterMinutes: 60,
      lastEventAt: null,
    });
    expect(res.body.metrics).toHaveLength(6);
    for (const metric of res.body.metrics) {
      expect(metric.definitionVersion).toBe('1.0.0');
      expect(typeof metric.formula).toBe('string');
      expect(metric.value).toBeNull();
    }
    expect(prisma.conversation.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 'tenant-a' }),
      }),
    );
  });
});
