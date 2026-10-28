/**
 * Conversation and message domain (T2.03, F-05).
 *
 * Prisma-backed over the T2.01 `conversations`/`messages` tables.
 * Rules:
 * - every read and write is tenant-scoped; a cross-tenant id reads as
 *   not found (AC-F04-3, TH-01)
 * - conversation state changes follow CONVERSATION_TRANSITIONS and use
 *   the schema's `version` for optimistic concurrency: a stale
 *   expectedVersion or a raced write is 409 (AC-F05-1)
 * - the timeline filter (TH-05) lives in getTimeline: the caller's
 *   NOTE_INTERNAL_READ decision is passed in by the controller, and
 *   INTERNAL rows are stripped for callers without it
 * - an INTERNAL note can never carry authorType CUSTOMER (TH-05 double
 *   boundary)
 * - messages support the schema's idempotency key: a retried write with
 *   the same key returns the original row instead of duplicating
 */

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PRISMA_SERVICE } from '../../infrastructure/prisma/prisma.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

/** ConversationStatus values from prisma/schema.prisma. */
const CONVERSATION_STATUSES = [
  'OPEN',
  'PENDING',
  'RESOLVED',
  'CLOSED',
] as const;
type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

/** MessageVisibility and MessageAuthorType from prisma/schema.prisma. */
const MESSAGE_VISIBILITIES = ['CUSTOMER_VISIBLE', 'INTERNAL'] as const;
type MessageVisibility = (typeof MESSAGE_VISIBILITIES)[number];
const MESSAGE_AUTHOR_TYPES = ['CUSTOMER', 'AGENT', 'SYSTEM'] as const;
type MessageAuthorType = (typeof MESSAGE_AUTHOR_TYPES)[number];

/** Legal successor statuses. CLOSED is terminal (mirrors tickets). */
const CONVERSATION_TRANSITIONS: Record<
  ConversationStatus,
  readonly ConversationStatus[]
> = {
  OPEN: ['PENDING', 'RESOLVED', 'CLOSED'],
  PENDING: ['OPEN', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['OPEN', 'CLOSED'],
  CLOSED: [],
};

/** Input for a status change; expectedVersion guards lost updates. */
export interface UpdateConversationInput {
  status: string;
  expectedVersion?: number;
}

/** Input for a new message. authorType comes from the caller's role. */
export interface SendMessageInput {
  body: string;
  authorType: string;
  visibility?: string;
  idempotencyKey?: string;
}

@Injectable()
export class ConversationsService {
  constructor(@Inject(PRISMA_SERVICE) private readonly prisma: PrismaService) {}

  /**
   * Open a conversation for a customer. The customer must exist inside
   * the same tenant: an identifier with no row is refused before any
   * write (AC-F03-2 rule applied to this surface).
   */
  async createConversation(
    tenantId: string,
    customerId: string,
    channel: string,
  ) {
    requireText(tenantId, 'tenantId');
    requireText(customerId, 'customerId');
    requireText(channel, 'channel');

    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { tenantId: true },
    });
    if (!customer || customer.tenantId !== tenantId) {
      throw new NotFoundException(
        'Customer with ID ' + customerId + ' not found',
      );
    }

    return this.prisma.conversation.create({
      data: { tenantId, customerId, channel },
    });
  }

  /** Tenant-scoped list, most recently changed first. */
  listConversations(tenantId: string) {
    requireText(tenantId, 'tenantId');
    return this.prisma.conversation.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string) {
    return this.requireConversation(id, tenantId);
  }

  /**
   * Change conversation state. Same contract as tickets: the transition
   * must be legal, a supplied expectedVersion must match, and the write
   * pins id + tenant + version so a concurrent writer sees 409.
   */
  async updateStatus(
    id: string,
    tenantId: string,
    input: UpdateConversationInput,
  ) {
    const current = await this.requireConversation(id, tenantId);

    if (!isConversationStatus(input.status)) {
      throw new BadRequestException(
        'status must be one of ' + CONVERSATION_STATUSES.join(', '),
      );
    }
    if (input.status !== current.status) {
      if (
        !CONVERSATION_TRANSITIONS[
          current.status as ConversationStatus
        ].includes(input.status)
      ) {
        throw new ConflictException(
          'Invalid conversation status transition ' +
            current.status +
            ' -> ' +
            input.status,
        );
      }
    }
    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== current.version
    ) {
      throw new ConflictException(
        'Stale conversation version: expected ' +
          input.expectedVersion +
          ' but the current version is ' +
          current.version,
      );
    }

    const result = await this.prisma.conversation.updateMany({
      where: { id, tenantId, version: current.version },
      data: { status: input.status, version: current.version + 1 },
    });
    if (result.count === 0) {
      throw new ConflictException(
        'Conversation was modified concurrently; re-read it and retry',
      );
    }
    const written = await this.prisma.conversation.findUnique({
      where: { id },
    });
    if (!written) {
      throw new NotFoundException('Conversation with ID ' + id + ' not found');
    }
    return written;
  }

  /** Append a message to the timeline (AC-F05-1). */
  async sendMessage(
    tenantId: string,
    conversationId: string,
    input: SendMessageInput,
  ) {
    await this.requireConversation(conversationId, tenantId);
    requireText(input.body, 'body');

    if (
      input.visibility !== undefined &&
      !MESSAGE_VISIBILITIES.includes(input.visibility as MessageVisibility)
    ) {
      throw new BadRequestException(
        'visibility must be one of ' + MESSAGE_VISIBILITIES.join(', '),
      );
    }
    if (!MESSAGE_AUTHOR_TYPES.includes(input.authorType as MessageAuthorType)) {
      throw new BadRequestException(
        'authorType must be one of ' + MESSAGE_AUTHOR_TYPES.join(', '),
      );
    }
    // TH-05: a customer-authored message can never be an internal note.
    if (input.visibility === 'INTERNAL' && input.authorType === 'CUSTOMER') {
      throw new BadRequestException(
        'A customer author cannot create an internal note',
      );
    }

    const visibility = (input.visibility ??
      'CUSTOMER_VISIBLE') as MessageVisibility;

    if (input.idempotencyKey) {
      const existing = await this.prisma.message.findFirst({
        where: { conversationId, idempotencyKey: input.idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    try {
      return await this.prisma.message.create({
        data: {
          tenantId,
          conversationId,
          authorType: input.authorType as MessageAuthorType,
          visibility,
          body: input.body,
          idempotencyKey: input.idempotencyKey ?? null,
        },
      });
    } catch (error) {
      // A concurrent retry won the unique key; return its row instead.
      if (input.idempotencyKey) {
        const winner = await this.prisma.message.findFirst({
          where: { conversationId, idempotencyKey: input.idempotencyKey },
        });
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /**
   * Read the timeline in order. When includeInternal is false the
   * INTERNAL rows are removed here, at serialization time, so they can
   * never reach a response body (TH-05).
   */
  async getTimeline(
    conversationId: string,
    tenantId: string,
    includeInternal: boolean,
  ) {
    await this.requireConversation(conversationId, tenantId);
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return includeInternal
      ? messages
      : messages.filter((message) => message.visibility !== 'INTERNAL');
  }

  /**
   * Tenant scope is not a filter, it is existence: a conversation of
   * another tenant reads as not found (AC-F04-3, TH-01).
   */
  private async requireConversation(id: string, tenantId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id },
    });
    if (!conversation || conversation.tenantId !== tenantId) {
      throw new NotFoundException('Conversation with ID ' + id + ' not found');
    }
    return conversation;
  }
}

function isConversationStatus(value: unknown): value is ConversationStatus {
  return (
    typeof value === 'string' &&
    (CONVERSATION_STATUSES as readonly string[]).includes(value)
  );
}

function requireText(value: string | undefined, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException(field + ' is required');
  }
}
