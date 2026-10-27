/**
 * RBAC checks over real HTTP (T1.03 integration spec).
 *
 * Runs the full guard chain: SupabaseAuthGuard -> PermissionsGuard ->
 * controller, plus the tenant-membership gate. Maps to:
 * - TST-AC-F02-3: authenticated principal without the permission gets 403
 * - TST-AC-F03-3: R-tenant-admin is refused platform-wide governance
 * - TST-AC-F04-2: a disabled tenant rejects new business operations
 * - TST-AC-F04-3: tenant A cannot reach tenant B resources by guessed ID
 *
 * The harness controller lives in this spec on purpose: T1.03 ships the
 * policy and guard primitives, and applying them route by route follows
 * each feature task. Role data does not exist yet, so the spec injects a
 * RoleResolver; production uses the deny-all default until the roles
 * tables land. Data is synthetic tenant A/B only, fetch is stubbed.
 */

import {
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from './authorization.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PERMISSIONS } from './permission.codes.js';
import type { CanonicalRole } from './permission.codes.js';
import { ROLE_RESOLVER, type RoleResolver } from './role-resolver.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { RequirePermission } from '../../common/security/require-permission.decorator.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { TenantsService } from '../tenants/tenants.service.js';

/** Synthetic tenant A membership only: the caller has no access to B. */
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

/** Tenant rows for the disabled-tenant operation check. */
const TENANT_ROWS: Record<string, { id: string; status: string }> = {
  'tenant-a': { id: 'tenant-a', status: 'ACTIVE' },
  'tenant-suspended': { id: 'tenant-suspended', status: 'SUSPENDED' },
};

type AuthedRequest = Request & {
  user?: { provider: string; subject: string };
  params: Record<string, string>;
};

@Controller('harness')
class HarnessController {
  constructor(
    private readonly authz: AuthorizationService,
    private readonly tenants: TenantsService,
  ) {}

  @Get('tickets')
  @UseGuards(SupabaseAuthGuard, PermissionsGuard)
  @RequirePermission(PERMISSIONS.TICKET_READ)
  tickets(): { ok: boolean } {
    return { ok: true };
  }

  @Get('platform-tenants')
  @UseGuards(SupabaseAuthGuard, PermissionsGuard)
  @RequirePermission(PERMISSIONS.TENANT_MANAGE_PLATFORM)
  platform(): { ok: boolean } {
    return { ok: true };
  }

  @Post('tenants/:tenantId/operations')
  @UseGuards(SupabaseAuthGuard, PermissionsGuard)
  @RequirePermission(PERMISSIONS.TICKET_WRITE)
  operation(@Param('tenantId') tenantId: string): { ok: boolean } {
    const tenant = TENANT_ROWS[tenantId];
    if (!tenant) {
      throw new ForbiddenException('Unknown tenant');
    }
    this.authz.requireActiveTenant(tenant);
    return { ok: true };
  }

  @Get('members/:tenantId')
  @UseGuards(SupabaseAuthGuard)
  async member(@Req() request: AuthedRequest): Promise<{ tenantId: string }> {
    const identity = request.user as NonNullable<AuthedRequest['user']>;
    const context = await this.tenants.resolveContext(
      identity.provider,
      identity.subject,
    );
    if (!context) {
      throw new ForbiddenException('No tenant context');
    }
    const entry = await this.tenants.requireTenantAccess(
      context.userId,
      request.params.tenantId,
    );
    return { tenantId: entry.tenantId };
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('RBAC checks (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let findUnique: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    // A fresh Response per call: a shared body can only be read once.
    fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        jsonResponse(200, { sub: 'sub-123', email: 'user@example.test' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    role = null;
    findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const prisma = { user: { findUnique } };
    const resolver: RoleResolver = {
      resolveRole: async () => role,
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [HarnessController],
      providers: [
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        {
          provide: AuditService,
          useValue: { record: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: ROLE_RESOLVER, useValue: resolver },
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

  it('returns 401 before any permission check when no credential is sent', async () => {
    const res = await request(app.getHttpServer()).get('/harness/tickets');

    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 403 for an authenticated principal without the permission (AC-F02-3)', async () => {
    // Role resolver returns null: no role data exists yet, so deny applies.
    const res = await request(app.getHttpServer())
      .get('/harness/tickets')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(res.body.statusCode).toBe(403);
  });

  it('allows the route when the resolved role holds the permission', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get('/harness/tickets')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('refuses platform-wide tenant governance to R-tenant-admin (AC-F03-3)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/harness/platform-tenants')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('allows platform-wide tenant governance for R-enterprise-admin', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .get('/harness/platform-tenants')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
  });

  it('rejects a new business operation on a disabled tenant (AC-F04-2)', async () => {
    role = 'R-tenant-admin';

    const rejected = await request(app.getHttpServer())
      .post('/harness/tenants/tenant-suspended/operations')
      .set('Authorization', 'Bearer valid-token');
    const allowed = await request(app.getHttpServer())
      .post('/harness/tenants/tenant-a/operations')
      .set('Authorization', 'Bearer valid-token');

    expect(rejected.status).toBe(403);
    // Nest answers POST with 201 by default.
    expect(allowed.status).toBe(201);
  });

  it('denies tenant A credentials on tenant B resources by guessed ID (AC-F04-3)', async () => {
    const denied = await request(app.getHttpServer())
      .get('/harness/members/tenant-b')
      .set('Authorization', 'Bearer valid-token');
    const allowed = await request(app.getHttpServer())
      .get('/harness/members/tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(denied.status).toBe(403);
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({ tenantId: 'tenant-a' });
  });
});
