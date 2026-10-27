/**
 * Append-oriented audit persistence (T1.04, AC-F03-1/AC-F11-1 intent).
 *
 * One create path, no update and no delete: audit rows are history
 * (docs/DATABASE.md section 5, E-audit-event). A persistence failure
 * propagates to the caller, so a sensitive action never completes while
 * appearing to be recorded. requestId stays unset until the correlation
 * middleware of F-13 supplies it.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

export interface AuditEventInput {
  /** Stable event code, example: permission.denied or ticket.created. */
  action: string;
  /** Affected resource kind, example: permission or ticket. */
  resourceType: string;
  resourceId?: string;
  /** Owning tenant; null for platform-scope events. */
  tenantId?: string;
  /** Identity-provider subject of the actor (UUID). */
  actorId?: string;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
}

@Injectable()
export class AuditService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  async record(event: AuditEventInput): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        tenantId: event.tenantId,
        actorId: event.actorId,
        metadataJson: event.metadata,
        requestId: event.requestId,
      },
    });
  }
}
