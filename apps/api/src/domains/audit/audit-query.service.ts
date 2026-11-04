/**
 * Tenant-scoped reads for the governance views (T5.04; F-11, AC-F11-3).
 *
 * Audit rows and AI traces are history, so these reads never write and never
 * widen: every query carries the caller's tenant id. Two limits keep one
 * request bounded:
 * - `limit` defaults to 25 and is capped at 100, so a page cannot pull the
 *   whole history.
 * - A trace past `expiresAt` is not readable (D-27), because retention is a
 *   read-time filter as well as a sweep. Audit rows have no expiry: they are
 *   the record of what happened.
 */

import { Inject, Injectable } from '@nestjs/common';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';

export const DEFAULT_AUDIT_LIMIT = 25;
export const MAX_AUDIT_LIMIT = 100;

export interface AuditEventView {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AiTraceView {
  id: string;
  tenantId: string;
  correlationId: string;
  agentId: string | null;
  agentVersionId: string | null;
  provider: string;
  model: string | null;
  outcome: string;
  latencyMs: number;
  usage: unknown;
  spansMetadata: unknown;
  createdAt: string;
  expiresAt: string;
}

export interface AuditEventPage {
  items: AuditEventView[];
  limit: number;
  /** True when the page is full, so older rows can exist. */
  hasMore: boolean;
}

export interface AiTracePage {
  items: AiTraceView[];
  limit: number;
  hasMore: boolean;
}

/**
 * Clamp a requested page size. Returns null for a value that is not a whole
 * number in 1..MAX_AUDIT_LIMIT, so the controller can answer 400 instead of
 * silently serving a different size.
 */
export function parseAuditLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') {
    return DEFAULT_AUDIT_LIMIT;
  }
  if (!/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  if (value < 1 || value > MAX_AUDIT_LIMIT) {
    return null;
  }
  return value;
}

@Injectable()
export class AuditQueryService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async listEvents(
    tenantId: string,
    options: { limit: number; action?: string } = {
      limit: DEFAULT_AUDIT_LIMIT,
    },
  ): Promise<AuditEventPage> {
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        tenantId,
        ...(options.action ? { action: options.action } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        requestId: row.requestId,
        metadata: row.metadataJson,
        createdAt: row.createdAt.toISOString(),
      })),
      limit: options.limit,
      hasMore: rows.length === options.limit,
    };
  }

  async listTraces(
    tenantId: string,
    options: { limit: number } = { limit: DEFAULT_AUDIT_LIMIT },
  ): Promise<AiTracePage> {
    const rows = await this.prisma.aiTrace.findMany({
      where: { tenantId, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      take: options.limit,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        tenantId: row.tenantId,
        correlationId: row.correlationId,
        agentId: row.agentId,
        agentVersionId: row.agentVersionId,
        provider: row.provider,
        model: row.model,
        outcome: row.outcome,
        latencyMs: row.latencyMs,
        usage: row.usageJson,
        spansMetadata: row.spansMetadataJson,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expiresAt.toISOString(),
      })),
      limit: options.limit,
      hasMore: rows.length === options.limit,
    };
  }
}
