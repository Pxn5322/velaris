import { describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../permissions/authorization.service.js';
import { AiAgentService, type AgentActor } from './ai-agent.service.js';

const actor: AgentActor = {
  tenantId: 'tenant-a',
  userId: 'user-1',
  role: 'R-tenant-admin',
};

function config(overrides: Record<string, unknown> = {}) {
  return {
    systemPrompt: 'Be helpful and cite sources.',
    model: 'llama-3.3-70b',
    temperature: 0.2,
    ...overrides,
  };
}

function makeService(overrides: {
  agent?: Record<string, unknown> | null;
  version?: Record<string, unknown> | null;
}) {
  const prisma = {
    aiAgent: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(overrides.agent ?? null),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    aiAgentVersion: {
      findFirst: vi.fn().mockResolvedValue(overrides.version ?? null),
      aggregate: vi.fn().mockResolvedValue({ _max: { version: 2 } }),
      create: vi.fn().mockResolvedValue({ id: 'version-new', version: 3 }),
    },
    $transaction: vi.fn(),
  };
  const evaluations = { run: vi.fn().mockResolvedValue({ runId: 'run-1' }) };
  const gate = { publish: vi.fn().mockResolvedValue({ version: 1 }) };
  const service = new AiAgentService(
    prisma as never,
    new AuthorizationService(),
    evaluations as never,
    gate as never,
  );
  return { service, prisma, evaluations, gate };
}

describe('AiAgentService', () => {
  it('lists only the caller tenant, newest first, with active and draft numbers', async () => {
    const { service, prisma } = makeService({});
    prisma.aiAgent.findMany.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Support',
        description: '',
        status: 'ACTIVE',
        activeVersionId: 'v1',
        activeVersion: { version: 1 },
        versions: [{ version: 2 }],
        updatedAt: new Date('2026-11-01T00:00:00Z'),
      },
    ]);

    const rows = await service.list(actor);

    expect(prisma.aiAgent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-a' } }),
    );
    expect(rows[0]).toMatchObject({
      activeVersion: 1,
      draftVersion: 2,
    });
  });

  it('refuses a role without ai.agent.configure before any read', async () => {
    const { service, prisma } = makeService({});
    await expect(service.list({ ...actor, role: 'R-agent' })).rejects.toThrow(
      /ai\.agent\.configure/,
    );
    expect(prisma.aiAgent.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 for an agent owned by another tenant', async () => {
    const { service } = makeService({ agent: null });
    await expect(service.detail(actor, 'agent-x')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('creates the agent and its first draft version in one transaction', async () => {
    const { service, prisma } = makeService({});
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          aiAgent: {
            create: vi.fn().mockResolvedValue({ id: 'agent-1' }),
          },
          aiAgentVersion: {
            create: vi.fn().mockResolvedValue({ id: 'v1', version: 1 }),
          },
        }),
    );

    const created = await service.create(actor, 'membership-1', {
      name: '  Support agent  ',
      description: ' First line ',
      config: config() as never,
    });

    expect(created).toEqual({
      agentId: 'agent-1',
      versionId: 'v1',
      version: 1,
    });
  });

  it('rejects a draft without a prompt, a model or a valid temperature', async () => {
    const { service } = makeService({});
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        config: config({ systemPrompt: '  ' }) as never,
      }),
    ).rejects.toThrow(/config\.systemPrompt/);
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        config: config({ model: '' }) as never,
      }),
    ).rejects.toThrow(/config\.model/);
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        config: config({ temperature: 3 }) as never,
      }),
    ).rejects.toThrow(/between 0 and 2/);
    await expect(
      service.create(actor, 'm-1', { name: '', config: config() as never }),
    ).rejects.toThrow(/name/);
  });

  it('rejects a malformed description, config and tool list', async () => {
    const { service } = makeService({});
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        description: 42 as never,
        config: config() as never,
      }),
    ).rejects.toThrow(/description must be a string/);
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        description: 'x'.repeat(501),
        config: config() as never,
      }),
    ).rejects.toThrow(/description is too long/);
    await expect(
      service.create(actor, 'm-1', { name: 'Support', config: null as never }),
    ).rejects.toThrow(/config is required/);
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        config: config({ tools: 'search' }) as never,
      }),
    ).rejects.toThrow(/config\.tools/);
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        config: config({ tools: [42] }) as never,
      }),
    ).rejects.toThrow(/config\.tools/);
  });

  it('rejects a non-finite temperature and accepts an absent description', async () => {
    const { service, prisma } = makeService({});
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        config: config({ temperature: Number.NaN }) as never,
      }),
    ).rejects.toThrow(/between 0 and 2/);

    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          aiAgent: { create: vi.fn().mockResolvedValue({ id: 'agent-1' }) },
          aiAgentVersion: {
            create: vi.fn().mockResolvedValue({ id: 'v1', version: 1 }),
          },
        }),
    );
    await expect(
      service.create(actor, 'm-1', {
        name: 'Support',
        description: null as never,
        config: config() as never,
      }),
    ).resolves.toMatchObject({ agentId: 'agent-1' });
  });

  it('stores trimmed tool names from a valid draft config', async () => {
    const { service, prisma } = makeService({});
    const createdConfig = vi.fn();
    prisma.$transaction.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          aiAgent: { create: vi.fn().mockResolvedValue({ id: 'agent-1' }) },
          aiAgentVersion: {
            create: createdConfig.mockResolvedValue({ id: 'v1', version: 1 }),
          },
        }),
    );

    await service.create(actor, 'm-1', {
      name: 'Support',
      config: config({ tools: [' search ', 'ticket_update'] }) as never,
    });

    expect(createdConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          configJson: expect.objectContaining({
            tools: ['search', 'ticket_update'],
          }),
        }),
      }),
    );
  });

  it('appends the next version number and never rewrites an earlier one', async () => {
    const { service, prisma } = makeService({ agent: { id: 'agent-1' } });

    const created = await service.createVersion(actor, 'agent-1', {
      config: config(),
    });

    expect(prisma.aiAgentVersion.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ _max: { version: true } }),
    );
    expect(prisma.aiAgentVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 3, status: 'DRAFT' }),
      }),
    );
    expect(created.version).toBe(3);
  });

  it('refuses a new version for an agent outside the tenant', async () => {
    const { service, prisma } = makeService({ agent: null });
    await expect(
      service.createVersion(actor, 'agent-x', { config: config() }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.aiAgentVersion.create).not.toHaveBeenCalled();
  });

  it('runs an evaluation through the EvaluationService with the server actor', async () => {
    const { service, evaluations } = makeService({ version: { id: 'v1' } });

    const run = await service.evaluate(actor, 'agent-1', 'v1', {
      datasetVersion: 'support-triage@1.0.0',
      provider: 'groq',
      model: 'llama-3.3-70b',
    });

    expect(evaluations.run).toHaveBeenCalledWith({
      agentVersionId: 'v1',
      datasetVersion: 'support-triage@1.0.0',
      provider: 'groq',
      model: 'llama-3.3-70b',
      actor: { tenantId: 'tenant-a', userId: 'user-1', role: 'R-tenant-admin' },
    });
    expect(run).toEqual({ runId: 'run-1' });
  });

  it('refuses to evaluate a version that belongs to another agent or tenant', async () => {
    const { service, evaluations } = makeService({ version: null });
    await expect(
      service.evaluate(actor, 'agent-1', 'v-foreign', {
        datasetVersion: 'support-triage@1.0.0',
        provider: 'groq',
        model: 'llama-3.3-70b',
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(evaluations.run).not.toHaveBeenCalled();
  });

  it('publishes only through the gate', async () => {
    const { service, gate } = makeService({ version: { id: 'v1' } });
    const result = await service.publish(actor, 'agent-1', 'v1');
    expect(gate.publish).toHaveBeenCalledWith({
      agentVersionId: 'v1',
      actor: { tenantId: 'tenant-a', userId: 'user-1', role: 'R-tenant-admin' },
    });
    expect(result).toEqual({ version: 1 });
  });

  it('does not reach the gate when the version is unknown', async () => {
    const { service, gate } = makeService({ version: null });
    await expect(
      service.publish(actor, 'agent-1', 'v-x'),
    ).rejects.toMatchObject({ status: 404 });
    expect(gate.publish).not.toHaveBeenCalled();
  });

  it('rolls back to a published version by moving the active pointer', async () => {
    const { service, prisma } = makeService({
      version: { id: 'v1', version: 1, status: 'PUBLISHED' },
    });

    const result = await service.rollback(actor, 'agent-1', 'v1');

    expect(prisma.aiAgent.update).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      data: { activeVersionId: 'v1' },
    });
    expect(result).toMatchObject({ activeVersionId: 'v1', activeVersion: 1 });
  });

  it('refuses a rollback to a draft and demands ai.agent.publish', async () => {
    const draft = makeService({
      version: { id: 'v2', version: 2, status: 'DRAFT' },
    });
    await expect(
      draft.service.rollback(actor, 'agent-1', 'v2'),
    ).rejects.toMatchObject({ status: 400 });

    const viewOnly = makeService({
      version: { id: 'v1', version: 1, status: 'PUBLISHED' },
    });
    await expect(
      viewOnly.service.rollback({ ...actor, role: 'R-agent' }, 'agent-1', 'v1'),
    ).rejects.toThrow(/ai\.agent\.publish/);
    expect(viewOnly.prisma.aiAgent.update).not.toHaveBeenCalled();
  });

  it('requires a version id on rollback and rejects an oversized name', async () => {
    const { service, prisma } = makeService({});
    await expect(service.rollback(actor, 'agent-1', '')).rejects.toThrow(
      /versionId is required/,
    );
    await expect(
      service.create(actor, 'm-1', {
        name: 'n'.repeat(121),
        config: config() as never,
      }),
    ).rejects.toThrow(/name is too long/);
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
  });

  it('reports a foreign version as not found on rollback', async () => {
    const { service, prisma } = makeService({ version: null });
    await expect(
      service.rollback(actor, 'agent-1', 'v-foreign'),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.aiAgent.update).not.toHaveBeenCalled();
  });
});
