/**
 * Tenant user-management routes (F-03, AC-F03-1, AC-F03-2).
 *
 * Runs the real guard chain on the real controller and the real
 * TenantUsersService against a fake Prisma client and a stubbed identity
 * admin. Covered:
 * - 401 without a credential and 403 without the declared permission
 * - 200 member list with resolved role codes
 * - 201 adding a member from an existing VELARIS user (no provider call)
 * - 201 adding a member by creating the auth account with a password
 * - 400 for an unknown role code and for a malformed status
 * - 409 for an existing member and for an email with no account
 * - 404 for a membership that belongs to another tenant
 * - one audit event per successful change (AC-F11-1 intent)
 *
 * Synthetic tenant data only; no network and no database.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { AuditService } from '../audit/audit.service.js';
import { SupabaseAdminService } from '../auth/supabase-admin.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { GovernanceController } from './governance.controller.js';
import { GovernanceService } from './governance.service.js';
import { TenantUsersService } from './tenant-users.service.js';

const TENANT_ID = '12121212-1212-4212-8212-121212121212';
const FOREIGN_MEMBERSHIP_ID = '56565656-5656-4656-8656-565656565656';
const MEMBER_MEMBERSHIP_ID = '34343434-3434-4434-8434-343434343434';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakePrisma() {
  const store = {
    tenantMembership: {
      findMany: vi.fn(async () => [
        {
          id: MEMBER_MEMBERSHIP_ID,
          userId: 'user-1',
          tenantId: TENANT_ID,
          status: 'ACTIVE',
          user: {
            id: 'user-1',
            emailNormalized: 'agent@acme.test',
            displayName: 'agent@acme.test',
          },
          roles: [{ role: { code: 'R-agent' } }],
        },
      ]),
      findUnique: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) => {
          const compound = where.tenantId_userId as
            { tenantId: string; userId: string } | undefined;
          if (compound) {
            return store.hasExistingMembership &&
              compound.userId === 'user-1' &&
              compound.tenantId === TENANT_ID
              ? {
                  id: MEMBER_MEMBERSHIP_ID,
                  tenantId: compound.tenantId,
                  userId: compound.userId,
                  status: 'ACTIVE',
                }
              : null;
          }
          return where.id === FOREIGN_MEMBERSHIP_ID
            ? {
                id: FOREIGN_MEMBERSHIP_ID,
                tenantId: '99999999-9999-4999-8999-999999999999',
                userId: 'user-9',
                status: 'ACTIVE',
              }
            : {
                id: String(where.id),
                tenantId: TENANT_ID,
                userId: 'user-1',
                status: 'ACTIVE',
              };
        },
      ),
      create: vi.fn(
        async ({ data }: { data: { tenantId: string; userId: string } }) => ({
          id: MEMBER_MEMBERSHIP_ID,
          ...data,
          status: 'ACTIVE',
        }),
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { status: string };
        }) => ({ id: where.id, tenantId: TENANT_ID, status: data.status }),
      ),
    },
    user: {
      findFirst: vi.fn(
        async () =>
          store.localUser as unknown as {
            id: string;
            externalSubject: string;
          } | null,
      ),
      create: vi.fn(
        async ({ data }: { data: { externalSubject: string } }) => ({
          id: 'user-new',
          ...data,
        }),
      ),
    },
    role: {
      findFirst: vi.fn(async ({ where }: { where: { code: string } }) =>
        where.code === 'R-made-up'
          ? null
          : { id: 'role-' + where.code, tenantId: null, code: where.code },
      ),
    },
    membershipRole: {
      create: vi.fn(async () => ({ id: 'mr-1' })),
    },
    $transaction: vi.fn(async (fn: (tx: typeof store) => Promise<unknown>) =>
      fn(store),
    ),
    /** Set by a test to simulate an existing VELARIS user row. */
    localUser: null as { id: string } | null,
    /** Set by a test to simulate an existing membership for user-1. */
    hasExistingMembership: false,
  };
  return store;
}

describe('Tenant user management routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;
  let prisma: ReturnType<typeof fakePrisma>;
  let admin: {
    requireConfigured: ReturnType<typeof vi.fn>;
    findUserByEmail: ReturnType<typeof vi.fn>;
    createUser: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(async () =>
          jsonResponse(200, { sub: 'sub-123', email: 'admin@example.test' }),
        ),
    );

    role = null;
    auditRecord = vi.fn().mockResolvedValue(undefined);
    prisma = fakePrisma();
    admin = {
      requireConfigured: vi.fn(),
      findUserByEmail: vi.fn().mockResolvedValue(null),
      createUser: vi
        .fn()
        .mockResolvedValue({ id: 'auth-uid-new', email: 'new@acme.test' }),
    };

    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [GovernanceController],
      providers: [
        { provide: GovernanceService, useValue: {} },
        TenantUsersService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: SupabaseAdminService, useValue: admin },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: resolver },
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
      `/tenants/${TENANT_ID}/users`,
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for a role without ROLE_MANAGE (AC-F02-3)', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .get(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(prisma.tenantMembership.findMany).not.toHaveBeenCalled();
  });

  it('lists the tenant members with their resolved role codes', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        membershipId: MEMBER_MEMBERSHIP_ID,
        userId: 'user-1',
        email: 'agent@acme.test',
        displayName: 'agent@acme.test',
        status: 'ACTIVE',
        roles: ['R-agent'],
      },
    ]);
  });

  it('adds a member from an existing VELARIS user without a provider call', async () => {
    role = 'R-tenant-admin';
    prisma.localUser = { id: 'user-1' };

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'agent@acme.test', roleCode: 'R-agent' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      membershipId: MEMBER_MEMBERSHIP_ID,
      email: 'agent@acme.test',
      roles: ['R-agent'],
    });
    expect(admin.createUser).not.toHaveBeenCalled();
    expect(prisma.membershipRole.create).toHaveBeenCalledWith({
      data: { membershipId: MEMBER_MEMBERSHIP_ID, roleId: 'role-R-agent' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.added',
        resourceType: 'membership',
        tenantId: TENANT_ID,
        metadata: expect.objectContaining({ roleCode: 'R-agent' }),
      }),
    );
  });

  it('creates the auth account when the caller supplies a password', async () => {
    role = 'R-tenant-admin';
    prisma.localUser = null;

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({
        email: 'new@acme.test',
        roleCode: 'R-agent',
        password: 'a-strong-password',
      });

    expect(res.status).toBe(201);
    expect(admin.createUser).toHaveBeenCalledWith(
      'new@acme.test',
      'a-strong-password',
    );
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'supabase',
        externalSubject: 'auth-uid-new',
        emailNormalized: 'new@acme.test',
      }),
    });
  });

  it('links an existing auth account found by email without creating one', async () => {
    role = 'R-tenant-admin';
    prisma.localUser = null;
    admin.findUserByEmail.mockResolvedValue({
      id: 'auth-uid-known',
      email: 'known@acme.test',
    });

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'known@acme.test', roleCode: 'R-agent' });

    expect(res.status).toBe(201);
    // The local user row attaches to the found auth subject; no new account.
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'supabase',
        externalSubject: 'auth-uid-known',
        emailNormalized: 'known@acme.test',
      }),
    });
    expect(admin.createUser).not.toHaveBeenCalled();
  });

  it('rejects a malformed email with 400 before any lookup (AC-F03-2)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'not-an-email', roleCode: 'R-agent' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('valid email');
    expect(admin.requireConfigured).not.toHaveBeenCalled();
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
  });

  it('rejects a non-string email with 400 (defensive type guard)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 42, roleCode: 'R-agent' });

    expect(res.status).toBe(400);
    expect(admin.requireConfigured).not.toHaveBeenCalled();
  });

  it('rejects a missing roleCode with 400 before any lookup (AC-F03-2)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'someone@acme.test' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('roleCode is required');
    expect(admin.requireConfigured).not.toHaveBeenCalled();
  });

  it('refuses an email with no account and no password with 409', async () => {
    role = 'R-tenant-admin';
    prisma.localUser = null;

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'ghost@acme.test', roleCode: 'R-agent' });

    expect(res.status).toBe(409);
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects an unknown role code with 400 before any write (AC-F03-2)', async () => {
    role = 'R-tenant-admin';
    prisma.localUser = { id: 'user-1' };

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'agent@acme.test', roleCode: 'R-made-up' });

    expect(res.status).toBe(400);
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
  });

  it('refuses a second membership for the same user with 409', async () => {
    role = 'R-tenant-admin';
    prisma.localUser = { id: 'user-1' };
    prisma.hasExistingMembership = true;

    const res = await request(app.getHttpServer())
      .post(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token')
      .send({ email: 'agent@acme.test', roleCode: 'R-agent' });

    // The fake resolves the compound key for user-1, so it already exists.
    expect(res.status).toBe(409);
    expect(prisma.tenantMembership.create).not.toHaveBeenCalled();
  });

  it('suspends a membership and emits one audit event (AC-F03-1)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .patch(`/tenants/${TENANT_ID}/memberships/${MEMBER_MEMBERSHIP_ID}/status`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      membershipId: MEMBER_MEMBERSHIP_ID,
      status: 'SUSPENDED',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.status_changed',
        resourceType: 'membership',
        resourceId: MEMBER_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        metadata: { status: 'SUSPENDED' },
      }),
    );
  });

  it('reports a membership of another tenant as 404 (AC-F04-3)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .patch(
        `/tenants/${TENANT_ID}/memberships/${FOREIGN_MEMBERSHIP_ID}/status`,
      )
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(404);
    expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
  });

  it('rejects a status outside the allowed set with 400 (AC-F03-2)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .patch(`/tenants/${TENANT_ID}/memberships/${MEMBER_MEMBERSHIP_ID}/status`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'DELETED' });

    expect(res.status).toBe(400);
    expect(prisma.tenantMembership.update).not.toHaveBeenCalled();
  });

  it('denies the member list when no role resolves for the tenant', async () => {
    role = null;

    const res = await request(app.getHttpServer())
      .get(`/tenants/${TENANT_ID}/users`)
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });
});
