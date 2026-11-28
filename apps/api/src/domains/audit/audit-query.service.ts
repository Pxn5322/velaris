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
import type { AuditEvent } from '@prisma/client';
import {
  PRISMA_SERVICE,
  type PrismaService,
} from '../../infrastructure/prisma/prisma.service.js';
import type { AuditActorSnapshot } from './audit-chain.js';

export const DEFAULT_AUDIT_LIMIT = 25;
export const MAX_AUDIT_LIMIT = 100;

export interface AuditEventView {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  /** Resolved from the local user row; null when the actor is unknown. */
  actorName: string | null;
  actorEmail: string | null;
  /** Human role names for the actor in this tenant. */
  actorRoles: string[];
  action: string;
  resourceType: string;
  resourceId: string | null;
  /** Human label for the affected row, when one can be resolved. */
  resourceLabel: string | null;
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
    const [actors, resourceLabels] = await Promise.all([
      this.actorDetails(rows, tenantId),
      this.resourceLabels(rows, tenantId),
    ]);
    return {
      items: rows.map((row) => {
        const actor = row.actorId ? actors.get(row.actorId) : undefined;
        const label = row.resourceId
          ? resourceLabels.get(row.resourceType + ':' + row.resourceId)
          : undefined;
        // D-60 stores the labels as they were at the event, so the view
        // prefers the snapshot; a row written before migration 0025 falls
        // back to the live user row.
        const snapshot = actorSnapshotOf(row.actorSnapshot);
        return {
          id: row.id,
          tenantId: row.tenantId,
          actorId: row.actorId,
          actorName:
            snapshot?.displayName ||
            snapshot?.email ||
            actor?.displayName ||
            actor?.email ||
            null,
          actorEmail: snapshot?.email ?? actor?.email ?? null,
          actorRoles:
            snapshot && snapshot.roles.length > 0
              ? snapshot.roles
              : (actor?.roles ?? []),
          action: row.action,
          resourceType: row.resourceType,
          resourceId: row.resourceId,
          resourceLabel: label ?? null,
          requestId: row.requestId,
          metadata: row.metadataJson,
          createdAt: row.createdAt.toISOString(),
        };
      }),
      limit: options.limit,
      hasMore: rows.length === options.limit,
    };
  }

  /**
   * Audit rows store the identity-provider subject, not users.id. One lookup
   * for the page resolves the display name, email and tenant role names, so
   * the browser never has to query the directory itself.
   */
  private async actorDetails(rows: AuditEvent[], tenantId: string) {
    const ids = [
      ...new Set(
        rows
          .map((row) => row.actorId)
          .filter(
            (id): id is string =>
              typeof id === 'string' && id.length > 0 && isUuid(id),
          ),
      ),
    ];
    const actors = new Map<
      string,
      { displayName: string; email: string; roles: string[] }
    >();
    if (ids.length === 0) return actors;

    const users = await this.prisma.user.findMany({
      where: { provider: 'supabase', externalSubject: { in: ids } },
      select: {
        externalSubject: true,
        displayName: true,
        emailNormalized: true,
        memberships: {
          select: {
            tenantId: true,
            roles: { select: { role: { select: { name: true } } } },
          },
        },
      },
    });
    for (const user of users) {
      const tenantRoles = user.memberships
        .filter((membership) => membership.tenantId === tenantId)
        .flatMap((membership) =>
          membership.roles.map((assignment) => assignment.role.name),
        );
      const roles =
        tenantRoles.length > 0
          ? tenantRoles
          : user.memberships.flatMap((membership) =>
              membership.roles.map((assignment) => assignment.role.name),
            );
      actors.set(user.externalSubject, {
        displayName: user.displayName,
        email: user.emailNormalized,
        roles: [...new Set(roles)],
      });
    }
    return actors;
  }

  /** Resolve human labels for the resource types the governance views show. */
  private async resourceLabels(rows: AuditEvent[], tenantId: string) {
    const idsByType = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.resourceId || !isUuid(row.resourceId)) continue;
      const ids = idsByType.get(row.resourceType) ?? [];
      if (!ids.includes(row.resourceId)) ids.push(row.resourceId);
      idsByType.set(row.resourceType, ids);
    }

    const labels = new Map<string, string>();
    await Promise.all(
      [...idsByType.entries()].map(async ([type, ids]) => {
        const found = await this.lookupResourceLabels(type, ids, tenantId);
        for (const [id, label] of found) {
          labels.set(type + ':' + id, label);
        }
      }),
    );
    return labels;
  }

  private async lookupResourceLabels(
    type: string,
    ids: string[],
    tenantId: string,
  ): Promise<Map<string, string>> {
    const labels = new Map<string, string>();
    switch (type) {
      case 'user': {
        const rows = await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true, emailNormalized: true },
        });
        for (const row of rows) {
          addLabel(labels, row.id, row.displayName || row.emailNormalized);
        }
        break;
      }
      case 'membership': {
        const rows = await this.prisma.tenantMembership.findMany({
          where: { id: { in: ids }, tenantId },
          select: {
            id: true,
            user: { select: { displayName: true, emailNormalized: true } },
          },
        });
        for (const row of rows) {
          addLabel(
            labels,
            row.id,
            row.user.displayName || row.user.emailNormalized,
          );
        }
        break;
      }
      case 'tenant': {
        const rows = await this.prisma.tenant.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
        for (const row of rows) addLabel(labels, row.id, row.name);
        break;
      }
      case 'role': {
        const rows = await this.prisma.role.findMany({
          where: { id: { in: ids }, OR: [{ tenantId: null }, { tenantId }] },
          select: { id: true, name: true },
        });
        for (const row of rows) addLabel(labels, row.id, row.name);
        break;
      }
      case 'ticket': {
        const rows = await this.prisma.ticket.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, title: true },
        });
        for (const row of rows) addLabel(labels, row.id, row.title);
        break;
      }
      case 'conversation': {
        const rows = await this.prisma.conversation.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, customer: { select: { displayName: true } } },
        });
        for (const row of rows) {
          addLabel(labels, row.id, 'with ' + row.customer.displayName);
        }
        break;
      }
      case 'message': {
        const rows = await this.prisma.message.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, body: true },
        });
        for (const row of rows) {
          const body = row.body.replace(/\s+/g, ' ').trim();
          addLabel(
            labels,
            row.id,
            body.length > 60 ? body.slice(0, 57) + '...' : body,
          );
        }
        break;
      }
      case 'ai_agent': {
        const rows = await this.prisma.aiAgent.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, name: true },
        });
        for (const row of rows) addLabel(labels, row.id, row.name);
        break;
      }
      case 'ai_model_provider': {
        const rows = await this.prisma.aiModelProvider.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        });
        for (const row of rows) addLabel(labels, row.id, row.name);
        break;
      }
      case 'webhook_endpoint': {
        const rows = await this.prisma.integrationEndpoint.findMany({
          where: { id: { in: ids }, tenantId },
          select: { id: true, displayName: true },
        });
        for (const row of rows) addLabel(labels, row.id, row.displayName);
        break;
      }
      case 'knowledge_source': {
        const rows = await this.prisma.knowledgeSource.findMany({
          where: { id: { in: ids }, tenantId },
          select: {
            id: true,
            sourceType: true,
            sourceUri: true,
            objectKey: true,
          },
        });
        for (const row of rows) {
          addLabel(
            labels,
            row.id,
            row.sourceUri ?? row.objectKey ?? row.sourceType,
          );
        }
        break;
      }
    }
    return labels;
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

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read the stored snapshot defensively: it is JSON written by an older build. */
function actorSnapshotOf(value: unknown): AuditActorSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Partial<AuditActorSnapshot>;
  if (typeof snapshot.displayName !== 'string') return null;
  return {
    version: typeof snapshot.version === 'number' ? snapshot.version : 1,
    userId: typeof snapshot.userId === 'string' ? snapshot.userId : '',
    displayName: snapshot.displayName,
    email: typeof snapshot.email === 'string' ? snapshot.email : '',
    membershipId:
      typeof snapshot.membershipId === 'string' ? snapshot.membershipId : null,
    tenantId: typeof snapshot.tenantId === 'string' ? snapshot.tenantId : null,
    roles: Array.isArray(snapshot.roles)
      ? snapshot.roles.filter(
          (role): role is string => typeof role === 'string',
        )
      : [],
  };
}

function isUuid(value: string): boolean {
  return UUID.test(value);
}

function addLabel(
  labels: Map<string, string>,
  id: string,
  label: string | null | undefined,
): void {
  const text = label?.trim();
  if (text) labels.set(id, text);
}
