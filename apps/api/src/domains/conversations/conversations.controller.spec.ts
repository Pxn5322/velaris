/**
 * Controller-level visibility decisions (T2.03, TH-05).
 *
 * The integration spec proves the boundary through the real guard chain
 * for the two roles the matrix defines. This spec covers the branch no
 * real role reaches today: a principal that holds ticket.write but not
 * note.internal.write must be refused when the body asks for an
 * INTERNAL note. The companion policy invariant below pins the matrix
 * assumption that every ticket.write role also holds note.internal.write,
 * so a future matrix change cannot silently widen note creation.
 */

import { ForbiddenException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../permissions/authorization.service.js';
import {
  PERMISSIONS,
  type CanonicalRole,
} from '../permissions/permission.codes.js';
import { ROLE_PERMISSIONS } from '../permissions/role-permissions.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { TenantsService } from '../tenants/tenants.service.js';
import { CustomerScopeService } from '../customers/customer-scope.service.js';
import { ConversationsController } from './conversations.controller.js';
import { ConversationsService } from './conversations.service.js';

function buildController(authorization: AuthorizationService) {
  const prisma = {
    customer: {
      findFirst: vi.fn(async () => ({ id: 'customer-1' })),
    },
    conversation: {
      findUnique: vi.fn(async () => ({
        id: 'conv-1',
        tenantId: 'tenant-a',
        customerId: 'customer-1',
        status: 'OPEN',
        version: 0,
      })),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'conv-new',
        version: 0,
        ...data,
      })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    message: {
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => [
        { id: 'msg-1', visibility: 'CUSTOMER_VISIBLE', body: 'public' },
        { id: 'msg-2', visibility: 'INTERNAL', body: 'staff only' },
      ]),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'msg-new',
        ...data,
      })),
    },
  };
  const service = new ConversationsService(prisma as unknown as PrismaService);
  const tenants = {
    resolveContext: vi.fn(async () => ({
      userId: 'user-1',
      tenants: [{ tenantId: 'tenant-a' }],
    })),
    requireTenantAccess: vi.fn(async () => ({ tenantId: 'tenant-a' })),
  } as unknown as TenantsService;
  const audit = {
    record: vi.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  return {
    controller: new ConversationsController(
      service,
      tenants,
      audit,
      authorization,
      new CustomerScopeService(prisma as unknown as PrismaService),
    ),
    service,
    audit,
  };
}

function requestWith(role: CanonicalRole | null) {
  return {
    user: {
      provider: 'supabase',
      subject: 'sub-123',
      email: 'user@example.test',
    },
    role,
    query: { tenantId: 'tenant-a' },
  } as never;
}

describe('ConversationsController visibility decisions (TH-05)', () => {
  let authorization: AuthorizationService;

  beforeEach(() => {
    authorization = new AuthorizationService();
  });

  it('refuses an INTERNAL note when the role lacks note.internal.write', async () => {
    const { controller } = buildController(authorization);
    await expect(
      controller.sendMessage('conv-1', 'tenant-a', requestWith('R-customer'), {
        body: 'escalate',
        visibility: 'INTERNAL',
      } as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lets a role with both permissions post an INTERNAL note', async () => {
    const { controller } = buildController(authorization);
    const message = await controller.sendMessage(
      'conv-1',
      'tenant-a',
      requestWith('R-tenant-admin'),
      { body: 'escalate', visibility: 'INTERNAL' } as never,
    );
    expect(message).toMatchObject({
      visibility: 'INTERNAL',
      authorType: 'AGENT',
    });
  });

  it('never sends an INTERNAL note as authorType CUSTOMER (TH-05)', async () => {
    const { controller } = buildController(authorization);
    const message = await controller.sendMessage(
      'conv-1',
      'tenant-a',
      requestWith('R-customer'),
      { body: 'hello' } as never,
    );
    expect(message).toMatchObject({ authorType: 'CUSTOMER' });
    expect(message).not.toMatchObject({ visibility: 'INTERNAL' });
  });

  it('policy invariant: every ticket.write role holds note.internal.write', () => {
    const ticketWriters = (
      Object.keys(ROLE_PERMISSIONS) as CanonicalRole[]
    ).filter((role) =>
      ROLE_PERMISSIONS[role].includes(PERMISSIONS.TICKET_WRITE),
    );
    expect(ticketWriters.length).toBeGreaterThan(0);
    for (const role of ticketWriters) {
      expect(
        ROLE_PERMISSIONS[role],
        `${role} must hold note.internal.write`,
      ).toContain(PERMISSIONS.NOTE_INTERNAL_WRITE);
    }
    expect(ROLE_PERMISSIONS['R-customer']).not.toContain(
      PERMISSIONS.TICKET_WRITE,
    );
    expect(ROLE_PERMISSIONS['R-customer']).not.toContain(
      PERMISSIONS.NOTE_INTERNAL_WRITE,
    );
  });
});
