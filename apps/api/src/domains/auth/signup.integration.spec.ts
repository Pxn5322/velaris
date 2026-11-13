/**
 * Tenant registration route (F-01, AC-F01-2) - POST /auth/signup.
 *
 * The route is public, so these tests run the real controller and the real
 * SignupService against a fake Prisma client and a mocked identity
 * provider. Covered:
 * - 400 for malformed input with zero external calls (AC-F01-2)
 * - 503 when the deployment holds no service-role configuration
 * - 409 when the identity provider already knows the email
 * - 201 creating organization, tenant, user, membership and owner role
 * - rollback of the auth account when the database write fails
 * - one audit event for the new account (AC-F11-1 intent)
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ROLE_RESOLVER } from '../permissions/role-resolver.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AuthController } from './auth.controller.js';
import { SignupService } from './signup.service.js';
import { SupabaseAdminService } from './supabase-admin.service.js';
import { SupabaseAuthGuard } from './supabase-auth.guard.js';
import { SupabaseTokenVerifier } from './supabase-token-verifier.service.js';
import { TokenRevocationService } from './token-revocation.service.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Minimal Prisma fake covering the signup transaction. */
function fakePrisma(options?: {
  existingSlugs?: string[];
  failTenantCreate?: boolean;
  /** Tenant create rejects with the Prisma unique-violation code. */
  uniqueViolation?: boolean;
  /** Seeded system roles are missing (migration contract broken). */
  roleNotSeeded?: boolean;
  /** Every slug candidate is taken, exhausting the retry budget. */
  allSlugsTaken?: boolean;
}) {
  const tenants: { id: string; slug: string; name: string }[] = [];
  const store = {
    enterpriseOrganization: {
      create: vi.fn(async ({ data }: { data: { name: string } }) => ({
        id: 'org-1',
        name: data.name,
      })),
    },
    tenant: {
      findUnique: vi.fn(async ({ where }: { where: { slug: string } }) =>
        options?.allSlugsTaken ||
        (options?.existingSlugs ?? []).includes(where.slug)
          ? { id: 'taken', slug: where.slug, name: 'Taken' }
          : null,
      ),
      create: vi.fn(
        async ({ data }: { data: { slug: string; name: string } }) => {
          if (options?.failTenantCreate) {
            throw new Error('connection lost');
          }
          if (options?.uniqueViolation) {
            // P2002: the unique constraint on tenants.slug fired.
            throw Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            });
          }
          const row = { id: `tenant-${tenants.length + 1}`, ...data };
          tenants.push(row);
          return row;
        },
      ),
    },
    user: {
      create: vi.fn(async () => ({ id: 'user-1' })),
    },
    tenantMembership: {
      create: vi.fn(async () => ({ id: 'membership-1' })),
    },
    role: {
      findFirst: vi.fn(async () =>
        options?.roleNotSeeded ? null : { id: 'role-tenant-admin' },
      ),
    },
    membershipRole: {
      create: vi.fn(async () => ({ id: 'mr-1' })),
    },
    // T6.06 (D-38): provisioning seeds the TRACES retention row.
    retentionPolicy: {
      create: vi.fn(async ({ data }: { data: object }) => ({
        id: 'policy-1',
        ...data,
      })),
    },
    $transaction: vi.fn(async (fn: (tx: typeof store) => Promise<unknown>) =>
      fn(store),
    ),
    _tenants: tenants,
  };
  return store;
}

describe('POST /auth/signup (integration)', () => {
  let app: INestApplication<App>;
  let prisma: ReturnType<typeof fakePrisma>;
  let auditRecord: ReturnType<typeof vi.fn>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const validBody = {
    email: 'owner@newco.test',
    password: 'correct-horse-battery',
    tenantName: 'NewCo Support',
  };

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'sb_secret_test');
    fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { id: 'auth-uid-1', email: 'owner@newco.test' }),
      );
    vi.stubGlobal('fetch', fetchMock);

    prisma = fakePrisma();
    auditRecord = vi.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SignupService,
        SupabaseAdminService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
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

  it('rejects a malformed email with 400 and creates nothing (AC-F01-2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...validBody, email: 'not-an-email' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('rejects a short password with 400 and creates nothing (AC-F01-2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...validBody, password: 'abc' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('rejects a missing workspace name with 400 and creates nothing (AC-F01-2)', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...validBody, tenantName: '  ' });

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 503 when the deployment has no service-role configuration', async () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 409 when the identity provider already knows the email', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(422, { msg: 'User already registered' }),
    );

    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('creates the workspace and its owner, then reports 201', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'owner@newco.test',
      slug: 'newco-support',
      tenantId: 'tenant-1',
    });
    expect(prisma.tenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ slug: 'newco-support' }),
    });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'supabase',
        externalSubject: 'auth-uid-1',
        emailNormalized: 'owner@newco.test',
      }),
    });
    expect(prisma.tenantMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'ACTIVE' }),
    });
    expect(prisma.membershipRole.create).toHaveBeenCalledWith({
      data: { membershipId: 'membership-1', roleId: 'role-tenant-admin' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.registered',
        resourceType: 'user',
        tenantId: 'tenant-1',
        actorId: 'auth-uid-1',
      }),
    );
  });

  it('derives a free slug when the name is already taken', async () => {
    prisma = fakePrisma({ existingSlugs: ['newco-support'] });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SignupService,
        SupabaseAdminService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
      ],
    }).compile();
    const freshApp = moduleRef.createNestApplication();
    await freshApp.init();

    const res = await request(freshApp.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('newco-support-2');
    await freshApp.close();
  });

  it('rejects an over-long workspace name with 400 and creates nothing', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...validBody, tenantName: 'x'.repeat(81) });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('at most 80');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a non-string field as missing (defensive type guards)', async () => {
    // The DTO pipe rejects these in production; the service guards too, so
    // a bypassing caller still gets 400 before any external call.
    for (const bad of [
      { ...validBody, email: 42 },
      { ...validBody, password: { hashed: true } },
      { ...validBody, tenantName: null },
    ]) {
      const res = await request(app.getHttpServer())
        .post('/auth/signup')
        .send(bad);
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('falls back to the workspace slug when the name has no slug characters', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ ...validBody, tenantName: '!!!' });

    expect(res.status).toBe(201);
    expect(res.body.slug).toBe('workspace');
  });

  it('answers 500 when the seeded owner role is missing (migration contract)', async () => {
    prisma = fakePrisma({ roleNotSeeded: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SignupService,
        SupabaseAdminService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
      ],
    }).compile();
    const freshApp = moduleRef.createNestApplication();
    await freshApp.init();

    const res = await request(freshApp.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(500);
    // The half-written workspace leaves no identity behind.
    const deleteCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
    await freshApp.close();
  });

  it('maps a unique-constraint race on the slug to 409', async () => {
    prisma = fakePrisma({ uniqueViolation: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SignupService,
        SupabaseAdminService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
      ],
    }).compile();
    const freshApp = moduleRef.createNestApplication();
    await freshApp.init();

    const res = await request(freshApp.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already taken');
    await freshApp.close();
  });

  it('answers 409 when every slug candidate is taken', async () => {
    prisma = fakePrisma({ allSlugsTaken: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SignupService,
        SupabaseAdminService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
      ],
    }).compile();
    const freshApp = moduleRef.createNestApplication();
    await freshApp.init();

    const res = await request(freshApp.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('free workspace address');
    expect(prisma.tenant.create).not.toHaveBeenCalled();
    await freshApp.close();
  });

  it('removes the auth account when the database write fails', async () => {
    prisma = fakePrisma({ failTenantCreate: true });
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        SignupService,
        SupabaseAdminService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        {
          provide: TokenRevocationService,
          useValue: {
            isRevoked: vi.fn().mockResolvedValue(false),
            revoke: vi.fn(),
          },
        },
        { provide: PRISMA_SERVICE, useValue: prisma },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: { resolveRole: async () => null } },
        {
          provide: TenantsService,
          useValue: { resolveContext: async () => null },
        },
      ],
    }).compile();
    const freshApp = moduleRef.createNestApplication();
    await freshApp.init();

    const res = await request(freshApp.getHttpServer())
      .post('/auth/signup')
      .send(validBody);

    expect(res.status).toBe(500);
    const deleteCall = fetchMock.mock.calls.find(
      (call) => (call[1] as RequestInit | undefined)?.method === 'DELETE',
    );
    expect(deleteCall).toBeTruthy();
    expect(String(deleteCall![0])).toContain('/auth/v1/admin/users/auth-uid-1');
    await freshApp.close();
  });
});
