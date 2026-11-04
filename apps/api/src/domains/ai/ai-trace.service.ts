/**
 * AI trace persistence (T5.06; F-11; AC-F11-1, AC-F14-1).
 *
 * The runtime produced trace metadata but nothing wrote it, so the traces
 * view and the AI latency KPI had no producer. This service is the single
 * write path for `ai_traces`: one row per run, tenant-scoped, with an expiry
 * computed from the tenant's TRACES retention policy.
 *
 * A trace is operational metadata (docs/DATABASE.md E-ai-trace): tenant,
 * correlation id, provider, model, outcome, latency, usage and span
 * metadata. Message and document content never enter a row, so a trace holds
 * no personal data beyond the identifiers a support investigation needs.
 *
 * Retention: the tenant policy row decides `expires_at`; without one the
 * documented default applies (D-31). A stored policy outside 1..3650 is a
 * corrupt row and refuses the write, so an invalid expiry cannot be created
 * through this path.
 */

import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import { validateRetentionPolicy } from '../retention/retention-policy.js';
import type { AiTraceMetadata } from './ai-runtime.service.js';

/** Window used when the tenant has no TRACES policy (D-31). */
export const DEFAULT_TRACE_RETENTION_DAYS = 30;

const DAY_MS = 86_400_000;

export interface AiTraceRecordInput {
  /** Metadata the runtime produced for this run. */
  trace: AiTraceMetadata;
  /** Provider family that served the run, example: groq or local. */
  provider: string;
  agentId?: string | null;
  agentVersionId?: string | null;
  /** Token counts or cost inputs; never message content. */
  usage?: Prisma.InputJsonValue;
  /** Per-node span timings; never message content. */
  spans?: Prisma.InputJsonValue;
}

@Injectable()
export class AiTraceService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /** Persist one run and return the row id. */
  async record(input: AiTraceRecordInput): Promise<string> {
    const retentionDays = await this.retentionDaysFor(input.trace.tenantId);
    const row = await this.prisma.aiTrace.create({
      data: {
        tenantId: input.trace.tenantId,
        // A run outside an HTTP request or job still needs an identifier.
        correlationId: input.trace.correlationId ?? randomUUID(),
        agentId: input.agentId ?? null,
        agentVersionId: input.agentVersionId ?? null,
        provider: input.provider,
        model: input.trace.model,
        outcome: input.trace.outcome,
        latencyMs: Math.max(0, Math.round(input.trace.latencyMs)),
        usageJson: input.usage ?? {},
        spansMetadataJson: input.spans ?? {},
        expiresAt: new Date(Date.now() + retentionDays * DAY_MS),
      },
    });
    return row.id;
  }

  /**
   * Read the tenant's TRACES window, or the default when the tenant has no
   * policy row. A stored value outside the contract refuses the write.
   */
  private async retentionDaysFor(tenantId: string): Promise<number> {
    const policy = await this.prisma.retentionPolicy.findUnique({
      where: { tenantId_category: { tenantId, category: 'TRACES' } },
    });
    if (!policy) {
      return DEFAULT_TRACE_RETENTION_DAYS;
    }
    try {
      return validateRetentionPolicy({
        category: 'TRACES',
        retentionDays: policy.retentionDays,
      }).retentionDays;
    } catch (error) {
      throw new BadRequestException(
        `Stored TRACES retentionDays is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
