/**
 * T5.06 AI trace writer (F-11; AC-F11-1, AC-F14-1).
 *
 * The runtime produces trace metadata, but nothing wrote it to `ai_traces`,
 * so the trace read path had no producer. This spec fixes the writer
 * contract:
 *
 * - one row per run, carrying tenant, correlation id, provider, model,
 *   outcome and latency;
 * - an expiry computed from the tenant's TRACES policy, with a documented
 *   default when the tenant has no policy row (D-31);
 * - no message or document content in the row, because a trace is
 *   operational metadata (SECURITY.md section 5);
 * - a correlation id is always present, so a row written outside an HTTP
 *   request is still identifiable.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  AiTraceService,
  DEFAULT_TRACE_RETENTION_DAYS,
} from './ai-trace.service.js';
import type { AiTraceMetadata } from './ai-runtime.service.js';

const DAY_MS = 86_400_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function trace(overrides: Partial<AiTraceMetadata> = {}): AiTraceMetadata {
  return {
    correlationId: 'req-1',
    tenantId: 'tenant-a',
    outcome: 'respond',
    model: 'fake-model',
    attempts: 1,
    citationCount: 2,
    latencyMs: 42,
    traceId: null,
    ...overrides,
  };
}

function prismaFake(policyDays: number | null = null) {
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'trace-1',
    ...data,
  }));
  const findUnique = vi.fn(async () =>
    policyDays === null ? null : { retentionDays: policyDays },
  );
  return {
    aiTrace: { create },
    retentionPolicy: { findUnique },
    create,
    findUnique,
  };
}

function service(prisma = prismaFake()) {
  return {
    service: new AiTraceService(prisma as unknown as PrismaService),
    prisma,
  };
}

describe('AiTraceService (T5.06)', () => {
  it('writes one row with the run metadata and no content', async () => {
    const { service: traces, prisma } = service();

    const id = await traces.record({
      trace: trace(),
      provider: 'groq',
      usage: { inputTokens: 11, outputTokens: 7 },
      spans: { retrieve: 3 },
    });

    expect(id).toBe('trace-1');
    expect(prisma.create).toHaveBeenCalledTimes(1);
    const data = prisma.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(data).toMatchObject({
      tenantId: 'tenant-a',
      correlationId: 'req-1',
      provider: 'groq',
      model: 'fake-model',
      outcome: 'respond',
      latencyMs: 42,
      usageJson: { inputTokens: 11, outputTokens: 7 },
      spansMetadataJson: { retrieve: 3 },
    });
    // A trace is operational metadata: no message or document text.
    expect(JSON.stringify(data)).not.toContain('refunds take');
  });

  it('uses the default window when the tenant has no TRACES policy', async () => {
    const { service: traces, prisma } = service();
    const before = Date.now();

    await traces.record({ trace: trace(), provider: 'groq' });

    const data = prisma.create.mock.calls[0][0].data as {
      expiresAt: Date;
      usageJson: unknown;
      spansMetadataJson: unknown;
    };
    expect(prisma.findUnique).toHaveBeenCalledWith({
      where: {
        tenantId_category: { tenantId: 'tenant-a', category: 'TRACES' },
      },
    });
    const expiry = data.expiresAt.getTime();
    expect(expiry).toBeGreaterThanOrEqual(
      before + DEFAULT_TRACE_RETENTION_DAYS * DAY_MS,
    );
    expect(expiry).toBeLessThanOrEqual(
      Date.now() + DEFAULT_TRACE_RETENTION_DAYS * DAY_MS,
    );
    expect(data.usageJson).toEqual({});
    expect(data.spansMetadataJson).toEqual({});
  });

  it('uses the tenant policy window when one exists (AC-F14-2)', async () => {
    const { service: traces, prisma } = service(prismaFake(7));
    const before = Date.now();

    await traces.record({ trace: trace(), provider: 'local' });

    const data = prisma.create.mock.calls[0][0].data as { expiresAt: Date };
    const expiry = data.expiresAt.getTime();
    expect(expiry).toBeGreaterThanOrEqual(before + 7 * DAY_MS);
    expect(expiry).toBeLessThanOrEqual(Date.now() + 7 * DAY_MS);
  });

  it('generates a correlation id when the run has no request context', async () => {
    const { service: traces, prisma } = service();

    await traces.record({
      trace: trace({ correlationId: null }),
      provider: 'local',
    });

    const data = prisma.create.mock.calls[0][0].data as {
      correlationId: string;
    };
    expect(data.correlationId).toMatch(UUID_PATTERN);
  });

  it('refuses a stored policy outside 1..3650 instead of writing a bad expiry', async () => {
    const { service: traces, prisma } = service(prismaFake(0));

    await expect(
      traces.record({ trace: trace(), provider: 'local' }),
    ).rejects.toThrow(/retentionDays/);
    expect(prisma.create).not.toHaveBeenCalled();
  });
});
