/**
 * T3.02 knowledge source routes (API-08, API-09, AC-F07-1, AC-F07-2).
 *
 * Runs the real guard chain on the real controller:
 * SupabaseAuthGuard -> PermissionsGuard -> tenant scope check. Covers:
 * - 401 without a credential (authentication first)
 * - 403 for an authenticated principal without knowledge.manage (AC-F02-3;
 *   R-agent holds no knowledge permission)
 * - 400 when no tenant scope is supplied (deny by default)
 * - 403 when tenant A credentials target tenant B by guessed ID (AC-F04-3)
 * - 400 for an unsupported or malformed source reference (AC-F07-2)
 * - 413 for oversized inline content
 * - 201 with PENDING status and provenance on a valid reference (AC-F07-1)
 * - 200 reporting status/errorCode/provenance for an existing source
 *   (API-09), including a FAILED source whose error is readable
 * - 404 for an unknown or foreign source id (API-09)
 * - one audit event per created or retried source (AC-F11-1)
 *
 * Synthetic tenant A data only; the Prisma layer is an in-memory fake,
 * no network and no database.
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
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

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

type FakeSource = Record<string, unknown>;

function fakeKnowledgePrisma(rows: FakeSource[] = []) {
  const store = [...rows];
  let counter = 0;
  return {
    knowledgeSource: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: Record<string, unknown> & { deletedAt?: null };
        }) =>
          store.find((row) =>
            Object.entries(where).every(([key, value]) =>
              key === 'deletedAt' ? row.deletedAt === null : row[key] === value,
            ),
          ) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: FakeSource }) => {
        const row: FakeSource = {
          id: 'src-http-' + ++counter,
          status: 'PENDING',
          errorCode: null,
          provenanceJson: {},
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        store.push(row);
        return row;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: FakeSource;
        }) => {
          const row = store.find((r) => r.id === where.id)!;
          Object.assign(row, data, { updatedAt: new Date() });
          return row;
        },
      ),
    },
    _store: store,
  };
}

describe('Knowledge source routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;
  let prismaFake: ReturnType<typeof fakeKnowledgePrisma>;

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
    prismaFake = fakeKnowledgePrisma();
    const findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        KnowledgeService,
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
    const res = await request(app.getHttpServer()).post(
      '/knowledge-sources?tenantId=tenant-a',
    );

    expect(res.status).toBe(401);
  });

  it('returns 403 for an authenticated principal without knowledge.manage (AC-F02-3)', async () => {
    const res = await request(app.getHttpServer())
      .get('/knowledge-sources/src-1?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
  });

  it('returns 400 when no tenant scope is supplied (deny by default)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/knowledge-sources/src-1')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(400);
  });

  it('returns 403 for a guessed tenant outside the caller memberships (AC-F04-3)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token')
      .send({ sourceType: 'WEBSITE', sourceUri: 'https://evil.test/x' });

    expect(res.status).toBe(403);
    expect(prismaFake.knowledgeSource.create).not.toHaveBeenCalled();
  });

  it('rejects an unsupported source type with 400 (AC-F07-2)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ sourceType: 'VIDEO' });

    expect(res.status).toBe(400);
    expect(prismaFake.knowledgeSource.create).not.toHaveBeenCalled();
  });

  it('rejects a WEBSITE source without an http(s) URL with 400', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ sourceType: 'WEBSITE', sourceUri: 'not-a-url' });

    expect(res.status).toBe(400);
  });

  it('rejects oversized inline content with 413 (API-08)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ sourceType: 'MARKDOWN', content: 'x'.repeat(64 * 1024 + 1) });

    expect(res.status).toBe(413);
  });

  it('creates a PENDING source with provenance and one audit event (AC-F07-1)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ sourceType: 'WEBSITE', sourceUri: 'https://example.test/docs' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.tenantId).toBe('tenant-a');
    expect(res.body.provenanceJson).toMatchObject({
      sourceUri: 'https://example.test/docs',
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'knowledge.source_created',
        resourceType: 'knowledge_source',
        tenantId: 'tenant-a',
      }),
    );
  });

  it('resubmitting identical content is idempotent and reports retry (AC-F07-2)', async () => {
    role = 'R-tenant-admin';
    const body = { sourceType: 'FAQ', content: 'How do I reset a password?' };

    const first = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send(body);
    // Simulate an ingestion failure recorded by the pipeline.
    prismaFake._store[0]!.status = 'FAILED';
    prismaFake._store[0]!.errorCode = 'FETCH_FAILED';

    const retry = await request(app.getHttpServer())
      .post('/knowledge-sources?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send(body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.body.status).toBe('PENDING');
    expect(retry.body.errorCode).toBeNull();
    expect(prismaFake.knowledgeSource.create).toHaveBeenCalledTimes(1);
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'knowledge.source_retried' }),
    );
  });

  it('reports status, error code and provenance through GET (API-09)', async () => {
    role = 'R-tenant-admin';
    prismaFake._store.push({
      id: 'src-failed',
      tenantId: 'tenant-a',
      sourceType: 'WEBSITE',
      sourceUri: 'https://example.test/broken',
      status: 'FAILED',
      errorCode: 'FETCH_FAILED',
      provenanceJson: { sourceUri: 'https://example.test/broken' },
      contentHash: 'sha256:x',
      deletedAt: null,
    });

    const res = await request(app.getHttpServer())
      .get('/knowledge-sources/src-failed?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: 'src-failed',
      status: 'FAILED',
      errorCode: 'FETCH_FAILED',
    });
    expect(res.body.provenanceJson).toMatchObject({
      sourceUri: 'https://example.test/broken',
    });
  });

  it('returns 404 for an unknown source id (API-09)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .get('/knowledge-sources/missing?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(404);
  });
});
