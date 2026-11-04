/**
 * T5.06 guarded AI run route (F-09, F-11; API-13-adjacent).
 *
 * Runs the real guard chain: SupabaseAuthGuard -> PermissionsGuard with
 * `ai.agent.configure` -> tenant scope check, then the F-09 runtime. The route
 * is the producer the trace read path was missing: every call writes one
 * `ai_traces` row, so the traces tab and the latency KPI have a source.
 *
 * Covered here: 401 without a credential, 403 without the permission (and no
 * trace write), 400 without a tenant scope (deny by default), 403 for a
 * guessed foreign tenant, 400 for a malformed body, and 200 with a grounded
 * answer plus one persisted trace.
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
import { LLM_PROVIDER } from '../../infrastructure/llm/llm.provider.js';
import { AuditService } from '../audit/audit.service.js';
import { SupabaseAuthGuard } from '../auth/supabase-auth.guard.js';
import { SupabaseTokenVerifier } from '../auth/supabase-token-verifier.service.js';
import {
  KnowledgeRetrievalService,
  type RetrievalHit,
} from '../knowledge/knowledge-retrieval.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AiRunController } from './ai-run.controller.js';
import { AiRuntimeService } from './ai-runtime.service.js';
import { AiTraceService } from './ai-trace.service.js';

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

const HIT: RetrievalHit = {
  chunkId: 'chunk-1',
  chunkIndex: 0,
  content: 'Refunds land within 5 business days.',
  score: 0.92,
  citation: {
    sourceId: 'src-1',
    sourceType: 'MARKDOWN',
    provenance: { uri: 'https://kb.test/refunds' },
    model: 'local-hash-v1',
  },
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function prismaFake() {
  return {
    aiTrace: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'trace-1',
        ...data,
      })),
    },
    retentionPolicy: { findUnique: vi.fn().mockResolvedValue(null) },
    user: { findUnique: vi.fn().mockResolvedValue(USER_ROW) },
  };
}

describe('AI run route (integration)', () => {
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
      controllers: [AiRunController],
      providers: [
        AiRuntimeService,
        AiTraceService,
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
          provide: LLM_PROVIDER,
          useValue: {
            model: 'fake-model',
            complete: vi.fn().mockResolvedValue({
              text: 'Refunds take 5 days.',
              model: 'fake-model',
            }),
          },
        },
        {
          provide: KnowledgeRetrievalService,
          useValue: { search: vi.fn().mockResolvedValue([HIT]) },
        },
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
    const res = await request(app.getHttpServer())
      .post('/ai/runs?tenantId=tenant-a')
      .send({ message: 'How long do refunds take?' });

    expect(res.status).toBe(401);
    expect(prisma.aiTrace.create).not.toHaveBeenCalled();
  });

  it('returns 403 without ai.agent.configure and writes no trace', async () => {
    role = 'R-agent';

    const res = await request(app.getHttpServer())
      .post('/ai/runs?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'How long do refunds take?' });

    expect(res.status).toBe(403);
    expect(prisma.aiTrace.create).not.toHaveBeenCalled();
  });

  it('returns 400 without a tenant scope (deny by default)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/ai/runs')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'How long do refunds take?' });

    expect(res.status).toBe(400);
    expect(prisma.aiTrace.create).not.toHaveBeenCalled();
  });

  it('returns 403 for a guessed tenant outside the memberships (AC-F04-3)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/ai/runs?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'How long do refunds take?' });

    expect(res.status).toBe(403);
    expect(prisma.aiTrace.create).not.toHaveBeenCalled();
  });

  it('returns 400 when the body carries no message', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/ai/runs?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 42 });

    expect(res.status).toBe(400);
    expect(prisma.aiTrace.create).not.toHaveBeenCalled();
  });

  it('answers from grounded knowledge and persists one trace (AC-F09-1, AC-F11-1)', async () => {
    role = 'R-tenant-admin';

    const res = await request(app.getHttpServer())
      .post('/ai/runs?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({ message: 'How long do refunds take?' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      outcome: 'respond',
      reason: 'grounded',
      model: 'fake-model',
    });
    expect(res.body.citations).toHaveLength(1);
    expect(res.body.trace).toMatchObject({
      tenantId: 'tenant-a',
      outcome: 'respond',
      traceId: 'trace-1',
    });
    expect(res.body.trace.latencyMs).toBeGreaterThanOrEqual(0);

    expect(prisma.aiTrace.create).toHaveBeenCalledTimes(1);
    const data = prisma.aiTrace.create.mock.calls[0][0].data as Record<
      string,
      unknown
    >;
    expect(data).toMatchObject({
      tenantId: 'tenant-a',
      provider: 'local',
      model: 'fake-model',
      outcome: 'respond',
    });
    expect(data.correlationId).toMatch(UUID_PATTERN);
    // The route body is not copied into the trace.
    expect(JSON.stringify(data)).not.toContain('refunds take');
  });
});
