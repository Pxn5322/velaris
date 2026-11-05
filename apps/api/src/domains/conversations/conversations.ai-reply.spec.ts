/**
 * API-13 AI reply contract (T6.05, F-09, AC-F09-1, AC-F09-2).
 *
 * The message route answers a customer message through the F-09 runtime. The
 * unit spec next to it proves the role decisions; this spec proves what the
 * route does with each runtime outcome, because the answer is now part of a
 * write path a customer waits on:
 *
 * - a grounded answer becomes a stored SYSTEM message the timeline shows, and
 *   its idempotency key derives from the customer message, so a retried
 *   request cannot post the answer twice;
 * - abstain, clarify and escalate store no answer and report the handoff
 *   reason, so the customer is told a human is needed instead of receiving an
 *   invented reply;
 * - a runtime fault is a handoff, never a lost message;
 * - the failure log keeps the error name and frames, never the error message
 *   (TH-07), because a provider error can quote the content it failed on.
 */

import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthorizationService } from '../permissions/authorization.service.js';
import type { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { TenantsService } from '../tenants/tenants.service.js';
import { CustomerScopeService } from '../customers/customer-scope.service.js';
import type {
  AiRuntimeResult,
  AiRuntimeService,
} from '../ai/ai-runtime.service.js';
import { ConversationsController } from './conversations.controller.js';
import type { ConversationsService } from './conversations.service.js';

const CUSTOMER_MESSAGE = 'CANARY-9c41f2-where-is-my-refund';

function runtimeResult(
  overrides: Partial<AiRuntimeResult> = {},
): AiRuntimeResult {
  return {
    outcome: 'respond',
    reason: 'grounded',
    text: 'The refund reached your account on Monday.',
    model: 'local-deterministic',
    citations: [
      {
        chunkId: 'chunk-1',
        chunkIndex: 0,
        sourceId: 'source-1',
        sourceType: 'FAQ',
        provenance: {},
        model: 'local-deterministic',
        score: 0.92,
      },
    ],
    attempts: 1,
    escalation: null,
    trace: {
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
      model: 'local-deterministic',
      outcome: 'respond',
      latencyMs: 12,
      attempts: 1,
      citationCount: 1,
      traceId: null,
    },
    ...overrides,
  };
}

function build() {
  const prisma = {
    customer: {
      findFirst: vi.fn(async () => ({ id: 'customer-1' })),
    },
  };
  const conversations = {
    findOne: vi.fn(async () => ({
      id: 'conv-1',
      tenantId: 'tenant-a',
      customerId: 'customer-1',
      status: 'OPEN',
      version: 0,
    })),
    sendMessage: vi.fn(
      async (
        _tenantId: string,
        _conversationId: string,
        input: { body: string; authorType: string; idempotencyKey?: string },
      ) => ({
        id: input.authorType === 'SYSTEM' ? 'msg-reply' : 'msg-customer',
        tenantId: 'tenant-a',
        conversationId: 'conv-1',
        authorType: input.authorType,
        visibility: 'CUSTOMER_VISIBLE',
        body: input.body,
        idempotencyKey: input.idempotencyKey ?? null,
        metadataJson: null,
        createdAt: new Date('2026-11-04T10:00:00Z'),
      }),
    ),
  };
  const tenants = {
    resolveContext: vi.fn(async () => ({
      userId: 'user-1',
      tenants: [{ tenantId: 'tenant-a' }],
    })),
    requireTenantAccess: vi.fn(async () => ({ tenantId: 'tenant-a' })),
  } as unknown as TenantsService;
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const ai = { handle: vi.fn() };
  const controller = new ConversationsController(
    conversations as unknown as ConversationsService,
    tenants,
    audit as unknown as AuditService,
    new AuthorizationService(),
    new CustomerScopeService(prisma as unknown as PrismaService),
    ai as unknown as AiRuntimeService,
  );
  return { controller, conversations, ai, audit };
}

function request() {
  return {
    user: {
      provider: 'supabase',
      subject: 'sub-123',
      email: 'buyer@example.test',
    },
    role: 'R-customer',
    query: { tenantId: 'tenant-a' },
  } as never;
}

describe('ConversationsController AI reply (API-13)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stores a grounded answer as a SYSTEM message with a derived key', async () => {
    const { controller, conversations, ai } = build();
    ai.handle.mockResolvedValue(runtimeResult());

    const result = await controller.sendMessage(
      'conv-1',
      'tenant-a',
      request(),
      {
        body: CUSTOMER_MESSAGE,
      } as never,
    );

    expect(ai.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-a',
        role: 'R-customer',
        message: CUSTOMER_MESSAGE,
      }),
    );
    expect(conversations.sendMessage).toHaveBeenNthCalledWith(
      2,
      'tenant-a',
      'conv-1',
      expect.objectContaining({
        body: 'The refund reached your account on Monday.',
        authorType: 'SYSTEM',
        visibility: 'CUSTOMER_VISIBLE',
        idempotencyKey: 'ai-reply:msg-customer',
      }),
    );
    expect(result).toMatchObject({
      authorType: 'CUSTOMER',
      ai: {
        outcome: 'respond',
        reason: 'grounded',
        reply: {
          id: 'msg-reply',
          body: 'The refund reached your account on Monday.',
          citationCount: 1,
        },
        handoff: null,
      },
    });
  });

  it('stores no answer and reports the handoff when the runtime abstains', async () => {
    const { controller, conversations, ai } = build();
    ai.handle.mockResolvedValue(
      runtimeResult({
        outcome: 'abstain',
        reason: 'no_relevant_knowledge',
        text: null,
        citations: [],
      }),
    );

    const result = await controller.sendMessage(
      'conv-1',
      'tenant-a',
      request(),
      {
        body: CUSTOMER_MESSAGE,
      } as never,
    );

    expect(conversations.sendMessage).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ai: {
        outcome: 'abstain',
        reason: 'no_relevant_knowledge',
        reply: null,
        handoff: { reason: 'no_relevant_knowledge', retrievedCount: 0 },
      },
    });
  });

  it('stores no answer and keeps the escalation context on escalate', async () => {
    const { controller, conversations, ai } = build();
    ai.handle.mockResolvedValue(
      runtimeResult({
        outcome: 'escalate',
        reason: 'provider_unavailable',
        text: null,
        citations: [],
        attempts: 2,
        escalation: {
          query: CUSTOMER_MESSAGE,
          reason: 'provider_unavailable',
          retrievedCount: 3,
          excerpts: ['internal excerpt'],
        },
      }),
    );

    const result = await controller.sendMessage(
      'conv-1',
      'tenant-a',
      request(),
      {
        body: CUSTOMER_MESSAGE,
      } as never,
    );

    expect(conversations.sendMessage).toHaveBeenCalledTimes(1);
    const summary = (result as unknown as { ai: Record<string, unknown> }).ai;
    expect(summary).toMatchObject({
      outcome: 'escalate',
      handoff: { reason: 'provider_unavailable', retrievedCount: 3 },
    });
    // The excerpt never leaves the server: the customer wrote the query, and
    // the retrieved context belongs to the agent who picks this up.
    expect(JSON.stringify(summary)).not.toContain('internal excerpt');
  });

  it('turns a runtime fault into a handoff and keeps the stored message', async () => {
    const { controller, conversations, ai } = build();
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    ai.handle.mockRejectedValue(
      new Error(`provider rejected ${CUSTOMER_MESSAGE}`),
    );

    const result = await controller.sendMessage(
      'conv-1',
      'tenant-a',
      request(),
      {
        body: CUSTOMER_MESSAGE,
      } as never,
    );

    expect(result).toMatchObject({
      body: CUSTOMER_MESSAGE,
      ai: {
        outcome: 'escalate',
        reason: 'provider_unavailable',
        reply: null,
        handoff: { reason: 'provider_unavailable', retrievedCount: 0 },
      },
    });
    expect(conversations.sendMessage).toHaveBeenCalledTimes(1);
    // TH-07: the log names the error type, never the message it carried.
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('AI run failed for conversation conv-1');
    expect(logged).not.toContain(CUSTOMER_MESSAGE);
  });
});
