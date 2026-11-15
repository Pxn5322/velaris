/**
 * Tenant-scoped analytics summary (T5.03; F-12; AC-F12-1, AC-F12-2).
 *
 * Six KPIs, each with its definition from `kpi-definitions.ts`. Every query
 * carries the caller's tenant id, so a missing or guessed tenant never widens
 * the result (AC-F12-3 is enforced by the controller's scope check and these
 * filters).
 *
 * Two states keep the dashboard honest (AC-F12-2):
 * - `EMPTY`: the range holds no observations at all, so every value is null
 *   and the sample is zero; a zero would suggest measured inactivity.
 * - `STALE`: observations exist but the newest is older than the freshness
 *   window, so the page shows the age instead of implying live data.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import type { AnalyticsRange } from './analytics-range.js';
import {
  KPI_DEFINITIONS,
  type KpiCode,
  type KpiUnit,
} from './kpi-definitions.js';

export const FRESHNESS_WINDOW_MINUTES = 60;
/** Bound for row-level metrics so one wide range cannot exhaust memory. */
export const MAX_ROWS = 5000;

export type AnalyticsState = 'OK' | 'EMPTY' | 'STALE';

export interface KpiValue {
  code: KpiCode;
  label: string;
  unit: KpiUnit;
  definitionVersion: string;
  formula: string;
  /** Null when the denominator is zero or the state is EMPTY. */
  value: number | null;
  /** Observations behind the value; zero explains a null. */
  sample: number;
}

export interface AnalyticsSummary {
  tenantId: string;
  range: { from: string; to: string };
  generatedAt: string;
  state: AnalyticsState;
  staleAfterMinutes: number;
  /** Newest observation the summary saw, or null when none exists. */
  lastEventAt: string | null;
  metrics: KpiValue[];
}

/** Tenant Dashboard cards (separate from the platform KPI summary). */
export interface TenantDashboardSummary {
  tenantId: string;
  generatedAt: string;
  month: { from: string; to: string };
  totalMonthlyTokens: number;
  activeAgents: number;
  tickets: {
    total: number;
    open: number;
    pendingCustomer: number;
    inProgress: number;
    resolved: number;
    closed: number;
  };
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return Math.round(value * 100) / 100;
}

function nearestRankPercentile(
  values: number[],
  percentile: number,
): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((percentile / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

@Injectable()
export class AnalyticsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Current-calendar-month token usage plus live agent and ticket counts. */
  async tenantDashboard(
    tenantId: string,
    now: Date = new Date(),
  ): Promise<TenantDashboardSummary> {
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );

    const [tokenRows, activeAgents, ticketGroups] = await Promise.all([
      this.prisma.$queryRaw<{ total: bigint | number | string | null }[]>`
        SELECT COALESCE(SUM(
          CASE
            WHEN usage_json ? 'totalTokens'
              AND jsonb_typeof(usage_json->'totalTokens') = 'number'
              THEN (usage_json->>'totalTokens')::numeric
            ELSE
              COALESCE(
                CASE
                  WHEN jsonb_typeof(usage_json->'inputTokens') = 'number'
                    THEN (usage_json->>'inputTokens')::numeric
                  ELSE 0
                END,
                0
              ) +
              COALESCE(
                CASE
                  WHEN jsonb_typeof(usage_json->'outputTokens') = 'number'
                    THEN (usage_json->>'outputTokens')::numeric
                  ELSE 0
                END,
                0
              )
          END
        ), 0)::bigint AS total
        FROM ai_traces
        WHERE tenant_id = ${tenantId}::uuid
          AND created_at >= ${monthStart}
          AND created_at < ${monthEnd}
      `,
      this.prisma.aiAgent.count({
        where: { tenantId, status: 'ACTIVE' },
      }),
      this.prisma.ticket.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
    ]);

    const countFor = (status: string) =>
      ticketGroups.find((group) => group.status === status)?._count._all ?? 0;
    const open = countFor('OPEN');
    const pendingCustomer = countFor('PENDING_CUSTOMER');
    const inProgress = countFor('IN_PROGRESS');
    const resolved = countFor('RESOLVED');
    const closed = countFor('CLOSED');

    return {
      tenantId,
      generatedAt: now.toISOString(),
      month: { from: monthStart.toISOString(), to: monthEnd.toISOString() },
      totalMonthlyTokens: Number(tokenRows[0]?.total ?? 0),
      activeAgents,
      tickets: {
        total: open + pendingCustomer + inProgress + resolved + closed,
        open,
        pendingCustomer,
        inProgress,
        resolved,
        closed,
      },
    };
  }

  async summary(
    tenantId: string,
    range: AnalyticsRange,
    now: Date = new Date(),
  ): Promise<AnalyticsSummary> {
    const period = { gte: range.from, lte: range.to };
    const aiHandled = {
      some: { authorType: 'SYSTEM' as const },
    };

    const [
      eligible,
      aiResolved,
      escalated,
      backlog,
      resolvedTickets,
      traces,
      auditEvents,
      newest,
    ] = await Promise.all([
      this.prisma.conversation.count({
        where: { tenantId, createdAt: period, messages: aiHandled },
      }),
      this.prisma.conversation.count({
        where: {
          tenantId,
          createdAt: period,
          status: { in: ['RESOLVED', 'CLOSED'] },
          AND: [
            { messages: aiHandled },
            { messages: { none: { authorType: 'AGENT' } } },
          ],
        },
      }),
      this.prisma.conversation.count({
        where: {
          tenantId,
          createdAt: period,
          messages: aiHandled,
          tickets: { some: {} },
        },
      }),
      this.prisma.ticket.count({
        where: {
          tenantId,
          createdAt: { lte: range.to },
          AND: [
            { OR: [{ resolvedAt: null }, { resolvedAt: { gt: range.to } }] },
            { OR: [{ closedAt: null }, { closedAt: { gt: range.to } }] },
          ],
        },
      }),
      this.prisma.ticket.findMany({
        where: { tenantId, resolvedAt: period },
        select: { createdAt: true, resolvedAt: true },
        orderBy: { resolvedAt: 'desc' },
        take: MAX_ROWS,
      }),
      this.prisma.aiTrace.findMany({
        where: { tenantId, createdAt: period },
        select: { latencyMs: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_ROWS,
      }),
      this.prisma.auditEvent.count({
        where: { tenantId, createdAt: period },
      }),
      this.prisma.message.aggregate({
        where: { tenantId, createdAt: period },
        _max: { createdAt: true },
      }),
    ]);

    const resolutionHours = resolvedTickets
      .map((ticket) =>
        ticket.resolvedAt
          ? (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) /
            3_600_000
          : null,
      )
      .filter((value): value is number => value !== null);

    const latencies = traces.map((trace) => trace.latencyMs);
    const lastEventAt = newest._max.createdAt ?? null;

    const observations =
      eligible +
      aiResolved +
      escalated +
      backlog +
      resolutionHours.length +
      latencies.length +
      auditEvents;

    const stale =
      lastEventAt !== null &&
      now.getTime() - lastEventAt.getTime() > FRESHNESS_WINDOW_MINUTES * 60_000;
    const state: AnalyticsState =
      observations === 0 ? 'EMPTY' : stale ? 'STALE' : 'OK';

    const values: Record<KpiCode, { value: number | null; sample: number }> = {
      ai_resolution_rate: {
        value: ratio(aiResolved, eligible),
        sample: eligible,
      },
      escalation_rate: { value: ratio(escalated, eligible), sample: eligible },
      ticket_resolution_hours: {
        value: median(resolutionHours),
        sample: resolutionHours.length,
      },
      open_ticket_backlog: { value: backlog, sample: backlog },
      ai_latency_p95_ms: {
        value: nearestRankPercentile(latencies, 95),
        sample: latencies.length,
      },
      audit_event_count: { value: auditEvents, sample: auditEvents },
    };

    return {
      tenantId,
      range: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
      },
      generatedAt: now.toISOString(),
      state,
      staleAfterMinutes: FRESHNESS_WINDOW_MINUTES,
      lastEventAt: lastEventAt?.toISOString() ?? null,
      metrics: KPI_DEFINITIONS.map((definition) => ({
        code: definition.code,
        label: definition.label,
        unit: definition.unit,
        definitionVersion: definition.definitionVersion,
        formula: definition.formula,
        value: state === 'EMPTY' ? null : values[definition.code].value,
        sample: state === 'EMPTY' ? 0 : values[definition.code].sample,
      })),
    };
  }
}
