/**
 * Protected session endpoint (T1.02 integration spec).
 *
 * Runs the real HTTP path: SupabaseAuthGuard -> SupabaseTokenVerifier
 * (global fetch stubbed, no network) -> AuthController -> TenantsService
 * (Prisma stubbed, synthetic tenant A/B data only).
 *
 * Maps to TST-AC-F02-1 (valid identity resolves session and tenant
 * membership) and TST-AC-F02-2 (invalid/expired credential returns a
 * consistent 401) in docs/TESTING.md section 3.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ROLE_RESOLVER } from '../permissions/role-resolver.js';
import { AuthController } from './auth.controller.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';

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
    {
      id: 'membership-2',
      tenantId: 'tenant-b',
      userId: 'user-1',
      status: 'ACTIVE',
      tenant: {
        id: 'tenant-b',
        slug: 'beta',
        name: 'Beta',
        status: 'SUSPENDED',
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

describe('GET /auth/session (integration)', () => {
  let app: INestApplication<App>;
  let fetchMock: ReturnType<typeof vi.fn>;
  let findUnique: ReturnType<typeof vi.fn>;
  let resolveRole: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const prisma = { user: { findUnique } };
    resolveRole = vi.fn().mockResolvedValue('R-tenant-admin');

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        { provide: ROLE_RESOLVER, useValue: { resolveRole } },
        {
          provide: TenantsService,
          useValue: new TenantsService(prisma as unknown as PrismaService),
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

  it('returns 401 with a consistent body when no credential is sent', async () => {
    const res = await request(app.getHttpServer()).get('/auth/session');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the same 401 body for an invalid token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'invalid JWT' }));

    const res = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', 'Bearer expired-or-forged');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      statusCode: 401,
      message: 'Unauthorized',
    });
  });

  it('resolves session and tenant context for a valid identity (AC-F02-1)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { sub: 'sub-123', email: 'user@example.test' }),
    );

    const res = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.identity).toEqual({
      provider: 'supabase',
      subject: 'sub-123',
      email: 'user@example.test',
    });
    // Suspended tenant beta is excluded; only active membership acme remains.
    expect(res.body.tenantContext).toEqual({
      userId: 'user-1',
      tenants: [
        {
          tenantId: 'tenant-a',
          slug: 'acme',
          name: 'Acme',
          membershipId: 'membership-1',
        },
      ],
    });
    // Role-aware nav: the server resolves the role per active membership.
    expect(res.body.role).toBe('R-tenant-admin');
    expect(resolveRole).toHaveBeenCalledWith({
      identity: {
        provider: 'supabase',
        subject: 'sub-123',
        email: 'user@example.test',
      },
      tenantId: 'tenant-a',
    });
  });

  it('returns a null role when no membership resolves one (deny by default)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { sub: 'sub-123', email: 'user@example.test' }),
    );
    resolveRole.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.tenantContext).not.toBeNull();
    expect(res.body.role).toBeNull();
  });

  it('returns a null tenant context when no user row exists for the identity', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { sub: 'unknown-sub' }));
    findUnique.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/auth/session')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body.tenantContext).toBeNull();
    expect(res.body.role).toBeNull();
  });
});
