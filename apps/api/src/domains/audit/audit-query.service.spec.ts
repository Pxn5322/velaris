/**
 * T5.04 governance reads (F-11; AC-F11-3).
 *
 * Proves the tenant id reaches every query, that the page size is bounded,
 * and that a trace past its expiry is not readable (D-27). Auditing reads
 * never write, so the fake exposes only findMany.
 */

import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  AuditQueryService,
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  parseAuditLimit,
} from './audit-query.service.js';

const EVENT_ROW = {
  id: 'event-1',
  tenantId: 'tenant-a',
  actorId: 'user-1',
  action: 'ticket.updated',
  resourceType: 'ticket',
  resourceId: 'ticket-1',
  metadataJson: { status: 'OPEN' },
  requestId: 'req-1',
  createdAt: new Date('2026-11-03T10:00:00.000Z'),
};

const TRACE_ROW = {
  id: 'trace-1',
  tenantId: 'tenant-a',
  correlationId: 'req-1',
  agentId: 'agent-1',
  agentVersionId: 'version-1',
  provider: 'openai',
  model: 'gpt-4.1-mini',
  outcome: 'SUCCESS',
  latencyMs: 820,
  usageJson: { totalTokens: 120 },
  spansMetadataJson: { retrieve: 40 },
  createdAt: new Date('2026-11-03T10:00:00.000Z'),
  expiresAt: new Date('2026-12-03T10:00:00.000Z'),
};

function buildService(rows: { events?: unknown[]; traces?: unknown[] }) {
  const auditEvent = { findMany: vi.fn().mockResolvedValue(rows.events ?? []) };
  const aiTrace = { findMany: vi.fn().mockResolvedValue(rows.traces ?? []) };
  const prisma = { auditEvent, aiTrace } as unknown as PrismaService;
  return { service: new AuditQueryService(prisma), auditEvent, aiTrace };
}

describe('parseAuditLimit', () => {
  it('defaults to 25 when absent or empty', () => {
    expect(parseAuditLimit(undefined)).toBe(DEFAULT_AUDIT_LIMIT);
    expect(parseAuditLimit('')).toBe(DEFAULT_AUDIT_LIMIT);
  });

  it('accepts a whole number inside the range', () => {
    expect(parseAuditLimit('1')).toBe(1);
    expect(parseAuditLimit(String(MAX_AUDIT_LIMIT))).toBe(MAX_AUDIT_LIMIT);
  });

  it('rejects zero, a value above the cap and non-integers', () => {
    expect(parseAuditLimit('0')).toBeNull();
    expect(parseAuditLimit(String(MAX_AUDIT_LIMIT + 1))).toBeNull();
    expect(parseAuditLimit('2.5')).toBeNull();
    expect(parseAuditLimit('abc')).toBeNull();
    expect(parseAuditLimit('-5')).toBeNull();
  });
});

describe('AuditQueryService', () => {
  it('reads only the caller tenant and maps the event row', async () => {
    const { service, auditEvent } = buildService({ events: [EVENT_ROW] });

    const page = await service.listEvents('tenant-a', { limit: 10 });

    expect(auditEvent.findMany).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-a' },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'event-1',
        action: 'ticket.updated',
        requestId: 'req-1',
        createdAt: '2026-11-03T10:00:00.000Z',
      }),
    ]);
    expect(page.hasMore).toBe(false);
  });

  it('adds the action filter only when one is given', async () => {
    const { service, auditEvent } = buildService({ events: [EVENT_ROW] });

    await service.listEvents('tenant-a', {
      limit: 5,
      action: 'ticket.updated',
    });

    expect(auditEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'tenant-a', action: 'ticket.updated' },
      }),
    );
  });

  it('reports hasMore when the page is full', async () => {
    const { service } = buildService({
      events: [EVENT_ROW, { ...EVENT_ROW, id: 'event-2' }],
    });

    const page = await service.listEvents('tenant-a', { limit: 2 });

    expect(page.hasMore).toBe(true);
  });

  it('scopes trace reads to the tenant and excludes expired rows (D-27)', async () => {
    const { service, aiTrace } = buildService({ traces: [TRACE_ROW] });

    const page = await service.listTraces('tenant-a', { limit: 25 });

    const call = aiTrace.findMany.mock.calls[0][0];
    expect(call.where.tenantId).toBe('tenant-a');
    expect(call.where.expiresAt.gt).toBeInstanceOf(Date);
    expect(page.items[0]).toMatchObject({
      id: 'trace-1',
      correlationId: 'req-1',
      latencyMs: 820,
      outcome: 'SUCCESS',
    });
  });
});
