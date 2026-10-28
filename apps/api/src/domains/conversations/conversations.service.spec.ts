/**
 * Conversation and message domain rules (T2.03, AC-F05-1, TH-05).
 *
 * Prisma-backed service over the T2.01 `conversations`/`messages` tables.
 * Covered here with an in-memory fake of the Prisma client:
 * - tenant isolation on every read and write (AC-F04-3, TH-01)
 * - conversation state transitions with optimistic concurrency (the
 *   schema comment gives `version` exactly this job, AC-F05-1)
 * - timeline serialization filters INTERNAL messages (TH-05); the read
 *   path never sees the flag, the service decides from the caller role
 * - an agent (caller-supplied role) sees the full timeline
 * - message idempotency through the schema's unique key
 *
 * The HTTP-level visibility boundary lives in
 * conversations.controller.integration.spec.ts.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { ConversationsService } from './conversations.service.js';

type ConversationRow = {
  id: string;
  tenantId: string;
  customerId: string;
  channel: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

type MessageRow = {
  id: string;
  tenantId: string;
  conversationId: string;
  authorType: string;
  authorId: string | null;
  visibility: string;
  body: string;
  metadataJson: unknown;
  idempotencyKey: string | null;
  createdAt: Date;
};

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const CUSTOMER_A = 'customer-a';

function conversationRow(
  id: string,
  overrides: Partial<ConversationRow> = {},
): ConversationRow {
  return {
    id,
    tenantId: TENANT_A,
    customerId: CUSTOMER_A,
    channel: 'email',
    status: 'OPEN',
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function messageRow(
  id: string,
  overrides: Partial<MessageRow> = {},
): MessageRow {
  return {
    id,
    tenantId: TENANT_A,
    conversationId: 'conv-1',
    authorType: 'AGENT',
    authorId: null,
    visibility: 'CUSTOMER_VISIBLE',
    body: 'hello',
    metadataJson: null,
    idempotencyKey: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function fakePrisma(
  conversations: ConversationRow[],
  messages: MessageRow[],
  customers: { id: string; tenantId: string }[] = [
    { id: CUSTOMER_A, tenantId: TENANT_A },
  ],
) {
  const convStore = [...conversations];
  const msgStore = [...messages];
  const custStore = [...customers];
  let convCounter = 0;
  let msgCounter = 0;
  return {
    customer: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          custStore.find((c) => c.id === where.id) ?? null,
      ),
    },
    conversation: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          convStore.find((c) => c.id === where.id) ?? null,
      ),
      findMany: vi.fn(async ({ where }: { where: { tenantId: string } }) =>
        convStore.filter((c) => c.tenantId === where.tenantId),
      ),
      create: vi.fn(async ({ data }: { data: Partial<ConversationRow> }) => {
        const row: ConversationRow = {
          id: 'conv-new-' + ++convCounter,
          status: 'OPEN',
          version: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...(data as object),
        } as ConversationRow;
        convStore.push(row);
        return { ...row };
      }),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; tenantId: string; version: number };
          data: Partial<ConversationRow>;
        }) => {
          const hits = convStore.filter(
            (c) =>
              c.id === where.id &&
              c.tenantId === where.tenantId &&
              c.version === where.version,
          );
          hits.forEach((c) =>
            Object.assign(c, data, { updatedAt: new Date() }),
          );
          return { count: hits.length };
        },
      ),
    },
    message: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { conversationId: string; idempotencyKey: string };
        }) =>
          msgStore.find(
            (m) =>
              m.conversationId === where.conversationId &&
              m.idempotencyKey === where.idempotencyKey,
          ) ?? null,
      ),
      findMany: vi.fn(
        async ({ where }: { where: { conversationId: string } }) =>
          msgStore
            .filter((m) => m.conversationId === where.conversationId)
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
      create: vi.fn(async ({ data }: { data: Partial<MessageRow> }) => {
        const row: MessageRow = {
          id: 'msg-new-' + ++msgCounter,
          metadataJson: null,
          idempotencyKey: null,
          createdAt: new Date(),
          ...(data as object),
        } as MessageRow;
        msgStore.push(row);
        return { ...row };
      }),
    },
    _convStore: convStore,
    _msgStore: msgStore,
  };
}

describe('ConversationsService (T2.03)', () => {
  let prisma: ReturnType<typeof fakePrisma>;
  let service: ConversationsService;

  beforeEach(() => {
    prisma = fakePrisma([], []);
    service = new ConversationsService(prisma as unknown as PrismaService);
  });

  it('opens a conversation with OPEN status and version 0', async () => {
    const conversation = await service.createConversation(
      TENANT_A,
      CUSTOMER_A,
      'email',
    );
    expect(conversation.status).toBe('OPEN');
    expect(conversation.version).toBe(0);
    expect(conversation.tenantId).toBe(TENANT_A);
  });

  it('rejects an empty channel or customerId with 400', async () => {
    await expect(
      service.createConversation(TENANT_A, CUSTOMER_A, '  '),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.createConversation(TENANT_A, '', 'email'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a customer id with no row or another tenant (AC-F03-2)', async () => {
    await expect(
      service.createConversation(TENANT_A, 'customer-missing', 'email'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const foreign = fakePrisma(
      [],
      [],
      [{ id: 'customer-b', tenantId: TENANT_B }],
    );
    const other = new ConversationsService(foreign as unknown as PrismaService);
    await expect(
      other.createConversation(TENANT_A, 'customer-b', 'email'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(foreign.conversation.create).not.toHaveBeenCalled();
  });

  it('lists conversations of the given tenant only (AC-F04-1)', async () => {
    prisma._convStore.push(
      conversationRow('conv-a'),
      conversationRow('conv-b', { tenantId: TENANT_B }),
    );
    const result = await service.listConversations(TENANT_A);
    expect(result).toHaveLength(1);
    expect(result[0]!.tenantId).toBe(TENANT_A);
  });

  it('finds one conversation or reports not found across tenants', async () => {
    prisma._convStore.push(
      conversationRow('conv-a'),
      conversationRow('conv-b', { tenantId: TENANT_B }),
    );
    await expect(service.findOne('conv-a', TENANT_A)).resolves.toMatchObject({
      id: 'conv-a',
    });
    await expect(service.findOne('conv-b', TENANT_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.findOne('missing', TENANT_A)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('status update bumps the version (AC-F05-1 state change)', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    const updated = await service.updateStatus('conv-1', TENANT_A, {
      status: 'RESOLVED',
    });
    expect(updated.status).toBe('RESOLVED');
    expect(updated.version).toBe(1);
  });

  it('rejects a stale expectedVersion with 409', async () => {
    prisma._convStore.push(conversationRow('conv-1', { version: 4 }));
    await expect(
      service.updateStatus('conv-1', TENANT_A, {
        status: 'PENDING',
        expectedVersion: 3,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an illegal transition with 409 (CLOSED is terminal)', async () => {
    prisma._convStore.push(conversationRow('conv-1', { status: 'CLOSED' }));
    await expect(
      service.updateStatus('conv-1', TENANT_A, { status: 'OPEN' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an unknown status value with 400', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    await expect(
      service.updateStatus('conv-1', TENANT_A, {
        status: 'ARCHIVED',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports not found if the row vanishes between write and read', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    prisma.conversation.findUnique
      .mockResolvedValueOnce(conversationRow('conv-1')) // pre-write read
      .mockResolvedValueOnce(null); // post-write re-read
    await expect(
      service.updateStatus('conv-1', TENANT_A, { status: 'PENDING' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a same-status update is legal and only bumps the version', async () => {
    prisma._convStore.push(conversationRow('conv-1', { status: 'PENDING' }));
    const updated = await service.updateStatus('conv-1', TENANT_A, {
      status: 'PENDING',
    });
    expect(updated.status).toBe('PENDING');
    expect(updated.version).toBe(1);
  });

  it('a lost write race (count 0) reads as 409 conflict', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    prisma.conversation.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.updateStatus('conv-1', TENANT_A, { status: 'PENDING' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('sends a message and appends it to the timeline (AC-F05-1)', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    const message = await service.sendMessage(TENANT_A, 'conv-1', {
      body: 'First reply',
      authorType: 'AGENT',
    });
    expect(message.body).toBe('First reply');
    expect(message.visibility).toBe('CUSTOMER_VISIBLE');
    const timeline = await service.getTimeline('conv-1', TENANT_A, false);
    expect(timeline).toHaveLength(1);
  });

  it('rejects a message with an empty body with 400', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: '   ',
        authorType: 'AGENT',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('timeline strips INTERNAL messages without the internal flag (TH-05)', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    prisma._msgStore.push(
      messageRow('msg-1', { visibility: 'CUSTOMER_VISIBLE', body: 'public' }),
      messageRow('msg-2', { visibility: 'INTERNAL', body: 'staff only' }),
    );
    const asCustomer = await service.getTimeline('conv-1', TENANT_A, false);
    expect(asCustomer.map((m) => m.body)).toEqual(['public']);
    const asAgent = await service.getTimeline('conv-1', TENANT_A, true);
    expect(asAgent).toHaveLength(2);
  });

  it('rejects an internal note from a customer author (TH-05)', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: 'sneaky',
        authorType: 'CUSTOMER',
        visibility: 'INTERNAL',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown authorType or visibility with 400', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: 'x',
        authorType: 'ROBOT',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: 'x',
        authorType: 'AGENT',
        visibility: 'SECRET',
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('idempotency key returns the existing message instead of a duplicate', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    prisma._msgStore.push(
      messageRow('msg-existing', { idempotencyKey: 'retry-1' }),
    );
    const again = await service.sendMessage(TENANT_A, 'conv-1', {
      body: 'retry body',
      authorType: 'AGENT',
      idempotencyKey: 'retry-1',
    });
    expect(again.id).toBe('msg-existing');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('the repository layer catches a raced duplicate key', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    const competing = messageRow('msg-raced', { idempotencyKey: 'retry-2' });
    // Pre-check sees nothing; the competing write wins the unique key; the
    // catch path re-reads and returns the competitor's row.
    prisma.message.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(competing);
    prisma.message.create.mockRejectedValueOnce(
      new Error('Unique constraint failed on (conversationId,idempotencyKey)'),
    );
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: 'race',
        authorType: 'AGENT',
        idempotencyKey: 'retry-2',
      }),
    ).resolves.toMatchObject({ id: 'msg-raced' });
  });

  it('a duplicate-key error with no winner rethrows the original error', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    prisma.message.findFirst.mockResolvedValueOnce(null); // pre-check: none
    prisma.message.findFirst.mockResolvedValueOnce(null); // no winner after race
    prisma.message.create.mockRejectedValueOnce(
      new Error('Unique constraint failed on (conversationId,idempotencyKey)'),
    );
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: 'race',
        authorType: 'AGENT',
        idempotencyKey: 'retry-3',
      }),
    ).rejects.toThrow('Unique constraint');
  });

  it('any other write error propagates to the caller', async () => {
    prisma._convStore.push(conversationRow('conv-1'));
    prisma.message.create.mockRejectedValueOnce(new Error('connection lost'));
    await expect(
      service.sendMessage(TENANT_A, 'conv-1', {
        body: 'hello',
        authorType: 'AGENT',
      }),
    ).rejects.toThrow('connection lost');
  });
});
