/**
 * T5.03 KPI summary (F-12; AC-F12-1, AC-F12-2, AC-F12-3).
 *
 * Formulas are proven against fixed counts and rows, the tenant id is proven
 * to appear on every query (AC-F12-3 at the data layer), and the empty and
 * stale states are proven separately (AC-F12-2). The Prisma layer is a fake
 * that records the arguments the service sends.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsService } from './analytics.service.js';
import { parseAnalyticsRange } from './analytics-range.js';
import { KPI_DEFINITION_VERSION } from './kpi-definitions.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const RANGE = parseAnalyticsRange({
  from: '2026-11-01T00:00:00.000Z',
  to: '2026-11-03T00:00:00.000Z',
  now: NOW,
});

function prismaFake() {
  return {
    conversation: { count: vi.fn().mockResolvedValue(0) },
    ticket: {
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
    },
    aiTrace: { findMany: vi.fn().mockResolvedValue([]) },
    auditEvent: { count: vi.fn().mockResolvedValue(0) },
    message: {
      aggregate: vi.fn().mockResolvedValue({ _max: { createdAt: null } }),
    },
  };
}

function service() {
  const prisma = prismaFake();
  return {
    service: new AnalyticsService(prisma as never),
    prisma,
  };
}

function metric(
  summary: { metrics: { code: string }[] },
  code: string,
): { value: number | null; sample: number } {
  const found = summary.metrics.find((item) => item.code === code) as
    { value: number | null; sample: number } | undefined;
  if (!found) {
    throw new Error(`missing metric ${code}`);
  }
  return { value: found.value, sample: found.sample };
}

describe('AnalyticsService summary (T5.03)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes every KPI from the documented formula (AC-F12-1)', async () => {
    const { service: analytics, prisma } = service();
    prisma.conversation.count
      .mockResolvedValueOnce(10) // AI-handled
      .mockResolvedValueOnce(4) // AI-resolved without an agent
      .mockResolvedValueOnce(2); // escalated
    prisma.ticket.count.mockResolvedValue(5);
    prisma.ticket.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-11-02T10:00:00.000Z'),
        resolvedAt: new Date('2026-11-02T12:30:00.000Z'),
      },
      {
        createdAt: new Date('2026-11-02T09:00:00.000Z'),
        resolvedAt: new Date('2026-11-02T09:30:00.000Z'),
      },
    ]);
    prisma.aiTrace.findMany.mockResolvedValue([
      { latencyMs: 100 },
      { latencyMs: 500 },
      { latencyMs: 300 },
      { latencyMs: 200 },
      { latencyMs: 400 },
    ]);
    prisma.auditEvent.count.mockResolvedValue(7);
    prisma.message.aggregate.mockResolvedValue({
      _max: { createdAt: new Date('2026-11-03T11:59:00.000Z') },
    });

    const summary = await analytics.summary('tenant-a', RANGE, NOW);

    expect(summary.state).toBe('OK');
    expect(summary.lastEventAt).toBe('2026-11-03T11:59:00.000Z');
    expect(summary.range).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-03T00:00:00.000Z',
    });
    expect(metric(summary, 'ai_resolution_rate')).toEqual({
      value: 0.4,
      sample: 10,
    });
    expect(metric(summary, 'escalation_rate')).toEqual({
      value: 0.2,
      sample: 10,
    });
    expect(metric(summary, 'ticket_resolution_hours')).toEqual({
      value: 1.5,
      sample: 2,
    });
    expect(metric(summary, 'open_ticket_backlog')).toEqual({
      value: 5,
      sample: 5,
    });
    expect(metric(summary, 'ai_latency_p95_ms')).toEqual({
      value: 500,
      sample: 5,
    });
    expect(metric(summary, 'audit_event_count')).toEqual({
      value: 7,
      sample: 7,
    });
  });

  it('scopes every query to the caller tenant (AC-F12-3)', async () => {
    const { service: analytics, prisma } = service();

    await analytics.summary('tenant-a', RANGE, NOW);

    const whereClauses = [
      ...prisma.conversation.count.mock.calls.map((call) => call[0].where),
      prisma.ticket.count.mock.calls[0][0].where,
      prisma.ticket.findMany.mock.calls[0][0].where,
      prisma.aiTrace.findMany.mock.calls[0][0].where,
      prisma.auditEvent.count.mock.calls[0][0].where,
      prisma.message.aggregate.mock.calls[0][0].where,
    ];
    for (const where of whereClauses) {
      expect(where.tenantId).toBe('tenant-a');
    }
  });

  it('reports EMPTY with null values when the range has no observations (AC-F12-2)', async () => {
    const { service: analytics } = service();

    const summary = await analytics.summary('tenant-a', RANGE, NOW);

    expect(summary.state).toBe('EMPTY');
    expect(summary.lastEventAt).toBeNull();
    for (const item of summary.metrics) {
      expect(item.value).toBeNull();
      expect(item.sample).toBe(0);
    }
  });

  it('reports STALE with real values when the newest observation is old (AC-F12-2)', async () => {
    const { service: analytics, prisma } = service();
    prisma.conversation.count
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    prisma.auditEvent.count.mockResolvedValue(3);
    prisma.message.aggregate.mockResolvedValue({
      _max: { createdAt: new Date('2026-11-03T09:00:00.000Z') },
    });

    const summary = await analytics.summary('tenant-a', RANGE, NOW);

    expect(summary.state).toBe('STALE');
    expect(summary.staleAfterMinutes).toBe(60);
    expect(metric(summary, 'ai_resolution_rate')).toEqual({
      value: 0.5,
      sample: 4,
    });
    expect(metric(summary, 'ai_resolution_rate').value).not.toBeNull();
  });

  it('returns null rather than zero when a denominator is empty', async () => {
    const { service: analytics, prisma } = service();
    prisma.auditEvent.count.mockResolvedValue(2);
    prisma.message.aggregate.mockResolvedValue({
      _max: { createdAt: new Date('2026-11-03T11:30:00.000Z') },
    });

    const summary = await analytics.summary('tenant-a', RANGE, NOW);

    expect(summary.state).toBe('OK');
    expect(metric(summary, 'ai_resolution_rate')).toEqual({
      value: null,
      sample: 0,
    });
    expect(metric(summary, 'escalation_rate').value).toBeNull();
  });

  it('uses the nearest-rank p95 and the median for even samples', async () => {
    const { service: analytics, prisma } = service();
    prisma.aiTrace.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) => ({ latencyMs: index + 1 })),
    );
    prisma.ticket.findMany.mockResolvedValue([
      {
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        resolvedAt: new Date('2026-11-01T01:00:00.000Z'),
      },
      {
        createdAt: new Date('2026-11-01T00:00:00.000Z'),
        resolvedAt: new Date('2026-11-01T05:00:00.000Z'),
      },
    ]);
    prisma.message.aggregate.mockResolvedValue({
      _max: { createdAt: new Date('2026-11-03T11:30:00.000Z') },
    });

    const summary = await analytics.summary('tenant-a', RANGE, NOW);

    // rank = ceil(0.95 * 20) = 19, so the 19th smallest value.
    expect(metric(summary, 'ai_latency_p95_ms')).toEqual({
      value: 19,
      sample: 20,
    });
    expect(metric(summary, 'ticket_resolution_hours')).toEqual({
      value: 3,
      sample: 2,
    });
  });

  it('publishes the definition version and formula with every metric (AC-F12-1)', async () => {
    const { service: analytics } = service();

    const summary = await analytics.summary('tenant-a', RANGE, NOW);

    expect(summary.metrics).toHaveLength(6);
    for (const item of summary.metrics) {
      expect(item.definitionVersion).toBe(KPI_DEFINITION_VERSION);
      expect(item.formula.length).toBeGreaterThan(20);
      expect(item.label.length).toBeGreaterThan(0);
    }
    expect(summary.metrics.map((item) => item.code)).toEqual([
      'ai_resolution_rate',
      'escalation_rate',
      'ticket_resolution_hours',
      'open_ticket_backlog',
      'ai_latency_p95_ms',
      'audit_event_count',
    ]);
  });
});
