/**
 * Append-oriented audit persistence (T1.04, T6.10; AC-F03-1/AC-F11-1; D-60).
 *
 * One create path, no update and no delete: audit rows are history
 * (docs/DATABASE.md section 5, E-audit-event). A persistence failure
 * propagates to the caller, so a sensitive action never completes while
 * appearing to be recorded. `requestId` comes from the caller when it names
 * one, otherwise from the request correlation context (T5.01, F-13), so an
 * audit row can always be traced back to the HTTP request or job that caused
 * it.
 *
 * D-60 adds three things to a write:
 * - A scope key: `tenant:<id>`, or `platform` for a platform row. It is a
 *   stable text value, not a live tenant foreign key.
 * - An immutable actor snapshot (name, email, roles, membership, tenant and
 *   snapshot version), resolved once from the local user row. The read view
 *   prefers it, so a rename or a deletion cannot rewrite history.
 * - A sealed chain position: the row gets the next sequence number and a
 *   SHA-256 hash over its content, position and predecessor. The chain head
 *   row reserves the sequence and keeps its lock until the new hash is
 *   stored, so two writers cannot take the same position.
 */

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../../common/logging/correlation.js';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import {
  auditEventHash,
  auditScopeKey,
  AUDIT_CHAIN_VERSION,
  type AuditActorSnapshot,
} from './audit-chain.js';

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
    const scopeKey = auditScopeKey(event.tenantId);
    const snapshot = await this.actorSnapshot(event.actorId, event.tenantId);
    const createdAt = new Date();
    const id = randomUUID();
    const requestId = event.requestId ?? currentCorrelationId();
    const snapshotVersion = snapshot?.version ?? AUDIT_CHAIN_VERSION;

    await this.prisma.$transaction(async (tx) => {
      // Reserving the sequence on the head row holds its lock until commit,
      // so a concurrent writer waits here instead of taking the same number.
      const reserved = await tx.$queryRaw<
        Array<{ last_seq: bigint; last_hash: string | null }>
      >`
        INSERT INTO "audit_chains" ("scope_key", "last_seq", "last_hash", "updated_at")
        VALUES (${scopeKey}, 1, NULL, CURRENT_TIMESTAMP)
        ON CONFLICT ("scope_key") DO UPDATE
          SET "last_seq" = "audit_chains"."last_seq" + 1,
              "updated_at" = CURRENT_TIMESTAMP
        RETURNING "last_seq", "last_hash"
      `;
      const head = reserved[0];
      if (!head) {
        throw new Error('audit chain head was not reserved');
      }
      const chainSeq = BigInt(head.last_seq);
      const prevHash = head.last_hash ?? null;
      const eventHash = auditEventHash(
        {
          id,
          tenantId: event.tenantId ?? null,
          actorId: event.actorId ?? null,
          actorSnapshot: snapshot,
          snapshotVersion,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId ?? null,
          metadata: event.metadata,
          requestId: requestId ?? null,
          createdAt,
        },
        chainSeq,
        prevHash,
      );

      await tx.auditEvent.create({
        data: {
          id,
          action: event.action,
          resourceType: event.resourceType,
          resourceId: event.resourceId,
          tenantId: event.tenantId,
          scopeKey,
          actorId: event.actorId,
          actorSnapshot: snapshot
            ? (snapshot as unknown as Prisma.InputJsonValue)
            : undefined,
          snapshotVersion,
          metadataJson: event.metadata,
          requestId,
          chainSeq,
          prevHash,
          eventHash,
          createdAt,
        },
      });

      const advanced = await tx.$executeRaw`
        UPDATE "audit_chains"
        SET "last_hash" = ${eventHash}, "updated_at" = CURRENT_TIMESTAMP
        WHERE "scope_key" = ${scopeKey} AND "last_seq" = ${chainSeq}
      `;
      if (advanced !== 1) {
        throw new Error('audit chain head moved during the write');
      }
    });
  }

  /**
   * The actor labels as they were when the event happened. A row for a tenant
   * stores that tenant's membership and role names; a platform row stores the
   * user without a tenant membership. An unknown actor stores no snapshot, so
   * the read falls back to the live row.
   */
  private async actorSnapshot(
    actorId: string | undefined,
    tenantId: string | undefined,
  ): Promise<AuditActorSnapshot | null> {
    if (!actorId) return null;
    const user = await this.prisma.user.findFirst({
      where: { externalSubject: actorId },
      select: {
        id: true,
        displayName: true,
        emailNormalized: true,
        memberships: {
          select: {
            id: true,
            tenantId: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        },
      },
    });
    if (!user) return null;
    const membership = tenantId
      ? user.memberships.find((row) => row.tenantId === tenantId)
      : undefined;
    const roles =
      membership?.roles.map((assignment) => assignment.role.name).sort() ?? [];
    return {
      version: AUDIT_CHAIN_VERSION,
      userId: user.id,
      displayName: user.displayName,
      email: user.emailNormalized,
      membershipId: membership?.id ?? null,
      tenantId: membership?.tenantId ?? tenantId ?? null,
      roles,
    };
  }
}
