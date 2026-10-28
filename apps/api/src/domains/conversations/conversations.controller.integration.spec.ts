/**
 * Guarded conversation routes (T2.03, AC-F05-1/AC-F05-3, TH-05).
 *
 * Runs the real guard chain on the real controller:
 * SupabaseAuthGuard -> PermissionsGuard -> tenant scope check.
 * The verify criterion of the task lives here: an R-customer timeline
 * NEVER serializes an INTERNAL message, while an R-agent timeline does
 * (TH-05, TST-TH-05).
 *
 * Synthetic tenant A/B data only; the Prisma layer is an in-memory fake.
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
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

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

type FakeRow = Record<string, unknown>;

function fakePrisma(conversations: FakeRow[], messages: FakeRow[]) {
  const convStore = [...conversations];
  const msgStore = [...messages];
  let convCounter = 0;
  let msgCounter = 0;
  return {
    customer: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === 'customer-1'
          ? { id: 'customer-1', tenantId: 'tenant-a' }
          : null,
    },
    conversation: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        convStore.find((c) => c.id === where.id) ?? null,
      findMany: async ({ where }: { where: { tenantId: string } }) =>
        convStore.filter((c) => c.tenantId === where.tenantId),
      create: async ({ data }: { data: FakeRow }) => {
        const row: FakeRow = {
          id: 'conv-http-' + ++convCounter,
          status: 'OPEN',
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        convStore.push(row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; tenantId: string; version: number };
        data: FakeRow;
      }) => {
        const hits = convStore.filter(
          (c) =>
            c.id === where.id &&
            c.tenantId === where.tenantId &&
            c.version === where.version,
        );
        hits.forEach((c) => Object.assign(c, data));
        return { count: hits.length };
      },
    },
    message: {
      findFirst: async ({
        where,
      }: {
        where: { conversationId: string; idempotencyKey: string };
      }) =>
        msgStore.find(
          (m) =>
            m.conversationId === where.conversationId &&
            m.idempotencyKey === where.idempotencyKey,
        ) ?? null,
      findMany: async ({ where }: { where: { conversationId: string } }) =>
        msgStore
          .filter((m) => m.conversationId === where.conversationId)
          .sort(
            (a, b) =>
              (a.createdAt as Date).getTime() - (b.createdAt as Date).getTime(),
          ),
      create: async ({ data }: { data: FakeRow }) => {
        const row: FakeRow = {
          id: 'msg-http-' + ++msgCounter,
          idempotencyKey: null,
          metadataJson: null,
          createdAt: new Date(),
          ...data,
        };
        msgStore.push(row);
        return row;
      },
    },
    _convStore: convStore,
    _msgStore: msgStore,
  };
}

function conversationRow(id: string, overrides: FakeRow = {}): FakeRow {
  return {
    id,
    tenantId: 'tenant-a',
    customerId: 'customer-1',
    channel: 'email',
    status: 'OPEN',
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('Conversations routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;
  let prismaFake: ReturnType<typeof fakePrisma>;

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
    prismaFake = fakePrisma(
      [
        conversationRow('conv-live'),
        conversationRow('conv-other', { tenantId: 'tenant-b' }),
      ],
      [
        {
          id: 'msg-public',
          tenantId: 'tenant-a',
          conversationId: 'conv-live',
          authorType: 'AGENT',
          authorId: null,
          visibility: 'CUSTOMER_VISIBLE',
          body: 'Your refund is on the way',
          idempotencyKey: null,
          metadataJson: null,
          createdAt: new Date('2026-10-28T08:00:00Z'),
        },
        {
          id: 'msg-internal',
          tenantId: 'tenant-a',
          conversationId: 'conv-live',
          authorType: 'AGENT',
          authorId: null,
          visibility: 'INTERNAL',
          body: 'Customer churn risk - escalate',
          idempotencyKey: null,
          metadataJson: null,
          createdAt: new Date('2026-10-28T08:01:00Z'),
        },
      ],
    );
    const findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        ConversationsService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: PRISMA_SERVICE, useValue: prismaFake },
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
      '/conversations?tenantId=tenant-a',
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 without the read permission (AC-F05-3)', async () => {
    const res = await request(app.getHttpServer())
      .get('/conversations?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('returns 400 when no tenant scope is supplied', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/conversations')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(400);
  });

  it('lists conversations for the scoped tenant', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/conversations?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ id: 'conv-live' });
  });

  it('denies a guessed tenant-B conversation (AC-F04-3)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/conversations/conv-live?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('TH-05: an R-customer timeline never serializes an internal note', async () => {
    role = 'R-customer';
    const res = await request(app.getHttpServer())
      .get('/conversations/conv-live?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    const bodies = (res.body.messages as { body: string }[]).map((m) => m.body);
    expect(bodies).toEqual(['Your refund is on the way']);
    expect(bodies.some((b) => b.includes('churn risk'))).toBe(false);
  });

  it('an R-agent timeline includes the internal note', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/conversations/conv-live?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.messages[1]).toMatchObject({ visibility: 'INTERNAL' });
  });

  it('R-customer cannot post a message (AC-F05-3)', async () => {
    role = 'R-customer';
    const res = await request(app.getHttpServer())
      .post('/conversations/conv-live/messages?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ body: 'I want to reply' });
    expect(res.status).toBe(403);
  });

  it('R-agent posts a customer-visible message and it is audited', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .post('/conversations/conv-live/messages?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ body: 'We are on it' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      visibility: 'CUSTOMER_VISIBLE',
      authorType: 'AGENT',
      body: 'We are on it',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'message.created',
        resourceType: 'message',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
      }),
    );
  });

  it('R-agent opens a conversation and it is audited (AC-F05-1)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .post('/conversations?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ customerId: 'customer-1', channel: 'chat' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'OPEN',
      version: 0,
      channel: 'chat',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'conversation.created',
        resourceType: 'conversation',
        tenantId: 'tenant-a',
      }),
    );
  });

  it('R-agent updates conversation state with the version guard (AC-F05-1)', async () => {
    role = 'R-agent';
    const ok = await request(app.getHttpServer())
      .patch('/conversations/conv-live?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'PENDING', expectedVersion: 0 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'PENDING', version: 1 });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'conversation.updated' }),
    );

    const stale = await request(app.getHttpServer())
      .patch('/conversations/conv-live?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ status: 'RESOLVED', expectedVersion: 0 });
    expect(stale.status).toBe(409);
  });
});
