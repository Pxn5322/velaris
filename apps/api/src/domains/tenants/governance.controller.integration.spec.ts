/**
 * Governance routes (AC-F03-1, AC-F03-3).
 *
 * Runs the real guard chain on the real controller:
 * SupabaseAuthGuard -> PermissionsGuard -> governance service. Covers the
 * three actions AC-F03-1 names: create a tenant, disable a tenant and
 * change a user role. Each success must both persist and emit an audit
 * event. Denial cases prove that platform-wide tenant governance stays
 * outside R-tenant-admin (AC-F03-3) and that unknown or mismatched
 * identifiers are rejected (AC-F03-2).
 *
 * Synthetic data only; Prisma, fetch and the audit sink are stubbed.
 */

import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { PermissionsGuard } from '../../common/security/permissions.guard.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { GovernanceController } from './governance.controller.js';
import { GovernanceService } from './governance.service.js';

const ENTERPRISE_ORG_ID = 'org-1';
const TENANT_ID = 'tenant-1';
const MEMBERSHIP_ID = 'membership-1';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Governance routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;
  let prisma: {
    tenant: {
      create: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    tenantMembership: { findUnique: ReturnType<typeof vi.fn> };
    role: { findFirst: ReturnType<typeof vi.fn> };
    membershipRole: {
      deleteMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
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
    prisma = {
      tenant: {
        create: vi.fn().mockResolvedValue({
          id: TENANT_ID,
          enterpriseOrganizationId: ENTERPRISE_ORG_ID,
          name: 'Acme',
          slug: 'acme',
          status: 'ACTIVE',
          version: 0,
        }),
        findUnique: vi.fn().mockResolvedValue({
          id: TENANT_ID,
          name: 'Acme',
          slug: 'acme',
          status: 'ACTIVE',
        }),
        update: vi.fn().mockResolvedValue({
          id: TENANT_ID,
          name: 'Acme',
          slug: 'acme',
          status: 'SUSPENDED',
        }),
      },
      tenantMembership: {
        findUnique: vi.fn().mockResolvedValue({
          id: MEMBERSHIP_ID,
          tenantId: TENANT_ID,
          userId: 'user-1',
          status: 'ACTIVE',
        }),
      },
      role: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'role-agent',
          tenantId: null,
          code: 'R-agent',
          name: 'Agent',
        }),
      },
      membershipRole: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({
          membershipId: MEMBERSHIP_ID,
          roleId: 'role-agent',
        }),
      },
    };

    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [GovernanceController],
      providers: [
        GovernanceService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: ROLE_RESOLVER, useValue: resolver },
        { provide: 'PRISMA_SERVICE', useValue: prisma },
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
    const res = await request(app.getHttpServer()).post('/tenants');

    expect(res.status).toBe(401);
  });

  it('creates a tenant and persists a tenant.created audit row (AC-F03-1)', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', 'Bearer valid-token')
      .send({
        enterpriseOrganizationId: ENTERPRISE_ORG_ID,
        name: 'Acme',
        slug: 'acme',
      });

    expect(res.status).toBe(201);
    expect(prisma.tenant.create).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.created',
        resourceType: 'tenant',
        resourceId: TENANT_ID,
        tenantId: TENANT_ID,
        actorId: 'sub-123',
      }),
    );
  });

  it('refuses tenant creation for R-tenant-admin (AC-F03-3)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', 'Bearer valid-token')
      .send({
        enterpriseOrganizationId: ENTERPRISE_ORG_ID,
        name: 'Acme',
        slug: 'acme',
      });

    expect(res.status).toBe(403);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('rejects a tenant creation without a slug (validation)', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .post('/tenants')
      .set('Authorization', 'Bearer valid-token')
      .send({ enterpriseOrganizationId: ENTERPRISE_ORG_ID, name: 'Acme' });

    expect(res.status).toBe(400);
    expect(prisma.tenant.create).not.toHaveBeenCalled();
  });

  it('disables a tenant and persists a tenant.status_changed audit row (AC-F03-1)', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .patch(`/tenants/${TENANT_ID}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(prisma.tenant.update).toHaveBeenCalledWith({
      where: { id: TENANT_ID },
      data: { status: 'SUSPENDED' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'tenant.status_changed',
        resourceType: 'tenant',
        resourceId: TENANT_ID,
        tenantId: TENANT_ID,
        actorId: 'sub-123',
      }),
    );
  });

  it('rejects a status outside the allowed set (validation)', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .patch(`/tenants/${TENANT_ID}`)
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'DELETED' });

    expect(res.status).toBe(400);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('rejects a status change for a tenant that does not exist', async () => {
    role = 'R-enterprise-admin';
    prisma.tenant.findUnique.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .patch('/tenants/does-not-exist')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(404);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('changes a membership role and persists a role.changed audit row (AC-F03-1)', async () => {
    role = 'R-enterprise-admin';

    const res = await request(app.getHttpServer())
      .put(`/tenants/${TENANT_ID}/memberships/${MEMBERSHIP_ID}/roles`)
      .set('Authorization', 'Bearer valid-token')
      .send({ roleCode: 'R-agent' });

    expect(res.status).toBe(200);
    expect(prisma.membershipRole.deleteMany).toHaveBeenCalledWith({
      where: { membershipId: MEMBERSHIP_ID },
    });
    expect(prisma.membershipRole.create).toHaveBeenCalledWith({
      data: { membershipId: MEMBERSHIP_ID, roleId: 'role-agent' },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'role.changed',
        resourceType: 'membership',
        resourceId: MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        actorId: 'sub-123',
        metadata: expect.objectContaining({ roleCode: 'R-agent' }),
      }),
    );
  });

  it('rejects a role code no role row holds (validation)', async () => {
    role = 'R-enterprise-admin';
    prisma.role.findFirst.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .put(`/tenants/${TENANT_ID}/memberships/${MEMBERSHIP_ID}/roles`)
      .set('Authorization', 'Bearer valid-token')
      .send({ roleCode: 'R-made-up' });

    expect(res.status).toBe(400);
    expect(prisma.membershipRole.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects a membership that belongs to another tenant', async () => {
    role = 'R-enterprise-admin';
    prisma.tenantMembership.findUnique.mockResolvedValue({
      id: MEMBERSHIP_ID,
      tenantId: 'tenant-other',
      userId: 'user-1',
      status: 'ACTIVE',
    });

    const res = await request(app.getHttpServer())
      .put(`/tenants/${TENANT_ID}/memberships/${MEMBERSHIP_ID}/roles`)
      .set('Authorization', 'Bearer valid-token')
      .send({ roleCode: 'R-agent' });

    expect(res.status).toBe(404);
    expect(prisma.membershipRole.deleteMany).not.toHaveBeenCalled();
  });
});
