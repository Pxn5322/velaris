/**
 * Guarded ticket routes (T1.03 route wiring, AC-F02-3/AC-F04-3).
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
 * - 200/201 when the resolved role holds the permission and the membership
 *   is in scope
 *
 * Synthetic tenant A/B data only; fetch is stubbed, no network.
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
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
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

describe('Tickets routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;

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
    const findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [TicketsController],
      providers: [
        TicketsService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: resolver },
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
        description: 'Broken',
      });

    expect(res.status).toBe(400);
  });

  it('denies ticket writes to a role without ticket.write (AC-F02-3)', async () => {
    role = 'R-customer';

    const res = await request(app.getHttpServer())
      .post('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ tenantId: 'tenant-a', title: 'Help', description: 'Broken' });

    expect(res.status).toBe(403);
  });

  it('creates a ticket for an in-scope role with ticket.write', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .post('/tickets?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ tenantId: 'tenant-a', title: 'Help', description: 'Broken' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantId: 'tenant-a', status: 'OPEN' });
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
      .get('/tickets/any-id?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });
});
