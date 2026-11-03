/**
 * T4.06 agent lifecycle routes (API-10..API-12, AC-F08-1, AC-F08-3).
 *
 * Runs the real guard chain on the real controller:
 * SupabaseAuthGuard -> PermissionsGuard -> tenant scope check. Covers:
 * - 401 without a credential
 * - 403 for an authenticated principal without ai.agent.configure
 * - 400 when no tenant scope is supplied (deny by default)
 * - 403 when tenant A credentials guess tenant B (AC-F04-3)
 * - 201 creating an agent, with one ai.agent.created audit event
 * - list and detail scoped to the caller's tenant
 * - 200 publishing through the gate, with one ai.agent.published event
 * - 403 publishing without ai.agent.publish, audited as permission.denied
 *   (AC-F08-3), with the gate never reached
 * - 400 rolling back to a version that was never published
 *
 * Synthetic tenant A data only; the Prisma layer is an in-memory fake.
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
import { AgentPublishService } from '../ai/evaluation/agent-publish.service.js';
import { EvaluationService } from '../ai/evaluation/evaluation.service.js';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';
import {
  ROLE_RESOLVER,
  type RoleResolver,
} from '../permissions/role-resolver.js';
import { TenantsService } from '../tenants/tenants.service.js';
import { AiAgentController } from './ai-agent.controller.js';
import { AiAgentService } from './ai-agent.service.js';

const AGENT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const VERSION_ID = 'bbbbbbbb-0000-4000-8000-000000000001';

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

function fakeAgentPrisma() {
  const agents = [
    {
      id: AGENT_ID,
      tenantId: 'tenant-a',
      name: 'Support agent',
      description: '',
      status: 'DRAFT',
      activeVersionId: null,
      activeVersion: null,
      versions: [{ version: 1 }],
      updatedAt: new Date('2026-11-03T00:00:00Z'),
    },
  ];
  const versions = [
    {
      id: VERSION_ID,
      tenantId: 'tenant-a',
      agentId: AGENT_ID,
      version: 1,
      status: 'DRAFT',
      configJson: { systemPrompt: 'Help', model: 'llama-3.3-70b' },
      toolGrants: [],
      evaluationRuns: [],
    },
  ];
  return {
    aiAgent: {
      findMany: vi.fn().mockResolvedValue(agents),
      findFirst: vi
        .fn()
        .mockImplementation(
          async ({ where }: { where: { id?: string; tenantId: string } }) =>
            agents.find(
              (agent) =>
                agent.tenantId === where.tenantId &&
                (where.id === undefined || agent.id === where.id),
            ) ?? null,
        ),
      create: vi.fn().mockResolvedValue({ id: AGENT_ID }),
      update: vi.fn().mockResolvedValue({}),
    },
    aiAgentVersion: {
      findFirst: vi
        .fn()
        .mockImplementation(
          async ({
            where,
          }: {
            where: { id: string; agentId: string; tenantId: string };
          }) =>
            versions.find(
              (version) =>
                version.id === where.id &&
                version.agentId === where.agentId &&
                version.tenantId === where.tenantId,
            ) ?? null,
        ),
      aggregate: vi.fn().mockResolvedValue({ _max: { version: 1 } }),
      create: vi.fn().mockResolvedValue({ id: VERSION_ID, version: 1 }),
    },
    $transaction: vi
      .fn()
      .mockImplementation(async (callback: (tx: unknown) => unknown) =>
        callback({
          aiAgent: { create: vi.fn().mockResolvedValue({ id: AGENT_ID }) },
          aiAgentVersion: {
            create: vi.fn().mockResolvedValue({ id: VERSION_ID, version: 1 }),
          },
        }),
      ),
    _agents: agents,
    _versions: versions,
  };
}

describe('Agent lifecycle routes (integration)', () => {
  let app: INestApplication<App>;
  let role: CanonicalRole | null;
  let auditRecord: ReturnType<typeof vi.fn>;
  let gatePublish: ReturnType<typeof vi.fn>;
  let evaluationRun: ReturnType<typeof vi.fn>;
  let prismaFake: ReturnType<typeof fakeAgentPrisma>;

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
    gatePublish = vi.fn().mockResolvedValue({
      agentId: AGENT_ID,
      version: 1,
      publishedAt: new Date(),
    });
    evaluationRun = vi
      .fn()
      .mockResolvedValue({ runId: 'run-1', status: 'PASSED', summary: {} });
    prismaFake = fakeAgentPrisma();
    const findUnique = vi.fn().mockResolvedValue(USER_ROW);
    const resolver: RoleResolver = { resolveRole: async () => role };

    const moduleRef = await Test.createTestingModule({
      controllers: [AiAgentController],
      providers: [
        AiAgentService,
        AuthorizationService,
        SupabaseAuthGuard,
        SupabaseTokenVerifier,
        PermissionsGuard,
        { provide: PRISMA_SERVICE, useValue: prismaFake },
        { provide: AuditService, useValue: { record: auditRecord } },
        { provide: EvaluationService, useValue: { run: evaluationRun } },
        { provide: AgentPublishService, useValue: { publish: gatePublish } },
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
      '/ai/agents?tenantId=tenant-a',
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 without ai.agent.configure (AC-F02-3)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .get('/ai/agents?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
    expect(prismaFake.aiAgent.findMany).not.toHaveBeenCalled();
  });

  it('returns 400 when no tenant scope is supplied', async () => {
    role = 'R-tenant-admin';
    const res = await request(app.getHttpServer())
      .get('/ai/agents')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(400);
  });

  it('returns 403 when a caller guesses another tenant (AC-F04-3)', async () => {
    role = 'R-tenant-admin';
    const res = await request(app.getHttpServer())
      .get('/ai/agents?tenantId=tenant-b')
      .set('Authorization', 'Bearer valid-token');
    expect(res.status).toBe(403);
  });

  it('creates an agent and audits the creation', async () => {
    role = 'R-tenant-admin';
    const res = await request(app.getHttpServer())
      .post('/ai/agents?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token')
      .send({
        name: 'Support agent',
        config: { systemPrompt: 'Help', model: 'llama-3.3-70b' },
      });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ agentId: AGENT_ID, version: 1 });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai.agent.created',
        tenantId: 'tenant-a',
        actorId: 'sub-123',
      }),
    );
  });

  it('lists and reads only the caller tenant', async () => {
    role = 'R-tenant-admin';
    const list = await request(app.getHttpServer())
      .get('/ai/agents?tenantId=tenant-a')
      .set('Authorization', 'Bearer valid-token');
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const detail = await request(app.getHttpServer())
      .get(`/ai/agents/${AGENT_ID}?tenantId=tenant-a`)
      .set('Authorization', 'Bearer valid-token');
    expect(detail.status).toBe(200);
  });

  it('publishes through the gate and audits the publication', async () => {
    role = 'R-tenant-admin';
    const res = await request(app.getHttpServer())
      .post(
        `/ai/agents/${AGENT_ID}/versions/${VERSION_ID}/publish?tenantId=tenant-a`,
      )
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(201);
    expect(gatePublish).toHaveBeenCalledWith({
      agentVersionId: VERSION_ID,
      actor: {
        tenantId: 'tenant-a',
        userId: 'sub-123',
        role: 'R-tenant-admin',
      },
    });
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.agent.published' }),
    );
  });

  it('denies publication without ai.agent.publish and audits the denial (AC-F08-3)', async () => {
    role = 'R-agent';
    const res = await request(app.getHttpServer())
      .post(
        `/ai/agents/${AGENT_ID}/versions/${VERSION_ID}/publish?tenantId=tenant-a`,
      )
      .set('Authorization', 'Bearer valid-token');

    expect(res.status).toBe(403);
    expect(gatePublish).not.toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'permission.denied',
        resourceId: 'ai.agent.publish',
      }),
    );
  });

  it('refuses a rollback to a version that is not published', async () => {
    role = 'R-tenant-admin';
    const res = await request(app.getHttpServer())
      .post(`/ai/agents/${AGENT_ID}/rollback?tenantId=tenant-a`)
      .set('Authorization', 'Bearer valid-token')
      .send({ versionId: VERSION_ID });

    expect(res.status).toBe(400);
    expect(prismaFake.aiAgent.update).not.toHaveBeenCalled();
  });

  it('runs an evaluation through the service and audits the run', async () => {
    role = 'R-tenant-admin';
    const res = await request(app.getHttpServer())
      .post(
        `/ai/agents/${AGENT_ID}/versions/${VERSION_ID}/evaluations?tenantId=tenant-a`,
      )
      .set('Authorization', 'Bearer valid-token')
      .send({
        datasetVersion: 'support-triage@1.0.0',
        provider: 'groq',
        model: 'llama-3.3-70b',
      });

    expect(res.status).toBe(201);
    expect(evaluationRun).toHaveBeenCalled();
    expect(auditRecord).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ai.agent.evaluated' }),
    );
  });
});
