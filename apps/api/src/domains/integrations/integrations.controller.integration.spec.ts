/**
 * Webhook delivery and endpoint registration routes (T5.05; F-13; AC-F13-2,
 * AC-F13-3, TH-08).
 *
 * The delivery route carries no bearer token: the signature authenticates the
 * sender and the endpoint row names the tenant, so the body cannot choose a
 * tenant. The registration route is guarded like every other tenant write.
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
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { computeSignature, hashPayload } from './webhook-signature.js';

const SECRET = 'whsec_test_secret_value';
const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.paid' });

const ENDPOINT_ROW = {
  id: 'endpoint-1',
  tenantId: 'tenant-a',
  provider: 'stripe',
  displayName: 'Billing',
  secretRef: 'WEBHOOK_SECRET_STRIPE_TEST',
  status: 'ACTIVE',
  createdAt: new Date('2026-11-01T09:00:00.000Z'),
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
    integrationEndpoint: {
      findUnique: vi.fn().mockResolvedValue(ENDPOINT_ROW),
      create: vi
        .fn()
        .mockImplementation(async ({ data }: { data: object }) => ({
          ...ENDPOINT_ROW,
          ...data,
        })),
      findMany: vi.fn().mockResolvedValue([ENDPOINT_ROW]),
    },
    webhookDelivery: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi
        .fn()
        .mockImplementation(async ({ data }: { data: object }) => ({
          id: 'delivery-row-1',
          receivedAt: new Date('2026-11-03T10:00:00.000Z'),
          ...data,
        })),
    },
    auditEvent: {
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    },
    user: { findUnique: vi.fn().mockResolvedValue(USER_ROW) },
  };
}

describe('Integrations routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let prisma: ReturnType<typeof prismaFake>;

  function signedHeaders(
    body = BODY,
    timestamp = `${Math.floor(Date.now() / 1000)}`,
  ) {
    return {
      'x-velaris-delivery-id': 'evt_1',
      'x-velaris-timestamp': timestamp,
      'x-velaris-signature': computeSignature(SECRET, timestamp, body),
    };
  }

  beforeEach(async () => {
    vi.stubEnv('SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
    vi.stubEnv('WEBHOOK_SECRET_STRIPE_TEST', SECRET);
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
      controllers: [IntegrationsController],
      providers: [
        IntegrationsService,
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

  it('accepts a correctly signed delivery and records one audit row', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-1')
      .set('Content-Type', 'application/json')
      .set(signedHeaders())
      .send(BODY);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      duplicate: false,
    });
    expect(prisma.webhookDelivery.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('performs no second side effect when the delivery repeats (TH-08)', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-1')
      .set('Content-Type', 'application/json')
      .set(signedHeaders())
      .send(BODY);

    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'delivery-row-1',
      endpointId: 'endpoint-1',
      deliveryId: 'evt_1',
      payloadHash: hashPayload(BODY),
      receivedAt: new Date('2026-11-03T10:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-1')
      .set('Content-Type', 'application/json')
      .set(signedHeaders())
      .send(BODY);

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a tampered body with 401 and no side effect (AC-F13-3)', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-1')
      .set('Content-Type', 'application/json')
      .set(signedHeaders())
      .send(JSON.stringify({ id: 'evt_1', type: 'invoice.refunded' }));

    expect(res.status).toBe(401);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a delivery with no signature headers', async () => {
    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-1')
      .set('Content-Type', 'application/json')
      .send(BODY);

    expect(res.status).toBe(401);
    expect(prisma.webhookDelivery.create).not.toHaveBeenCalled();
  });

  it('returns 409 for a reused delivery id with a different payload (AC-F13-2)', async () => {
    prisma.webhookDelivery.findUnique.mockResolvedValue({
      id: 'delivery-row-1',
      deliveryId: 'evt_1',
      payloadHash: 'different-hash',
      receivedAt: new Date('2026-11-03T10:00:00.000Z'),
    });

    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-1')
      .set('Content-Type', 'application/json')
      .set(signedHeaders())
      .send(BODY);

    expect(res.status).toBe(409);
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown endpoint', async () => {
    prisma.integrationEndpoint.findUnique.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .post('/webhooks/stripe/endpoint-x')
      .set('Content-Type', 'application/json')
      .set(signedHeaders())
      .send(BODY);

    expect(res.status).toBe(404);
  });

  it('requires a credential to register an endpoint', async () => {
    const res = await request(app.getHttpServer())
      .post('/integrations/endpoints')
      .send({
        tenantId: 'tenant-a',
        provider: 'stripe',
        displayName: 'Billing',
      });

    expect(res.status).toBe(401);
    expect(prisma.integrationEndpoint.create).not.toHaveBeenCalled();
  });

  it('refuses registration without integration.manage', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .post('/integrations/endpoints')
      .set('Authorization', 'Bearer valid-token')
      .send({
        tenantId: 'tenant-a',
        provider: 'stripe',
        displayName: 'Billing',
      });

    expect(res.status).toBe(403);
    expect(prisma.integrationEndpoint.create).not.toHaveBeenCalled();
  });

  it('registers an endpoint for the caller tenant and returns no secret value', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/integrations/endpoints')
      .set('Authorization', 'Bearer valid-token')
      .send({
        tenantId: 'tenant-a',
        provider: 'stripe',
        displayName: 'Billing',
        secretRef: 'WEBHOOK_SECRET_STRIPE_TEST',
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      tenantId: 'tenant-a',
      provider: 'stripe',
      secretRef: 'WEBHOOK_SECRET_STRIPE_TEST',
    });
    expect(JSON.stringify(res.body)).not.toContain(SECRET);
  });

  it('refuses registration in a tenant outside the memberships', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/integrations/endpoints')
      .set('Authorization', 'Bearer valid-token')
      .send({
        tenantId: 'tenant-b',
        provider: 'stripe',
        displayName: 'Billing',
      });

    expect(res.status).toBe(403);
    expect(prisma.integrationEndpoint.create).not.toHaveBeenCalled();
  });
});
