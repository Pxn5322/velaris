/**
 * T4.03 AI runtime contract (F-09; AC-F09-1, AC-F09-2, AC-F09-3).
 *
 * The runtime is the LangGraph state graph (D-19) behind F-09:
 * validate -> retrieve -> ground -> generate -> validate-response.
 * Each acceptance criterion maps to an outcome:
 *
 * - AC-F09-1 (grounded answer): authorized, sufficiently similar knowledge
 *   produces outcome `respond` with server-computed citations — the model
 *   never authors citations, so a prompt injection cannot fabricate one.
 * - AC-F09-2 (abstain/escalate): no relevant knowledge, a denied retrieval,
 *   a provider outage after bounded retry, an empty reply, a human request
 *   or an empty message each reach a non-respond outcome that carries
 *   context for the handoff, and never throw at the caller.
 * - AC-F09-3 (no bypass): the caller's tenantId and server-resolved role
 *   pass through to retrieval unchanged; a denied role never reaches the
 *   LLM at all.
 *
 * SECURITY.md section 6: the runtime owns the bounded retry (two attempts)
 * around the LLM port; the port itself stays retry-free.
 */

import { ForbiddenException, Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnowledgeRetrievalService } from '../knowledge/knowledge-retrieval.service.js';
import type { RetrievalHit } from '../knowledge/knowledge-retrieval.service.js';
import type { LlmProvider } from '../../infrastructure/llm/llm.provider.js';
import { runWithCorrelationId } from '../../common/logging/correlation.js';
import {
  AiRuntimeService,
  toResult,
  type AiTraceMetadata,
} from './ai-runtime.service.js';
import type { AiTraceService } from './ai-trace.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';

function hit(overrides: Partial<RetrievalHit> = {}): RetrievalHit {
  return {
    chunkId: 'chunk-1',
    chunkIndex: 0,
    content: 'Refunds land within 5 business days.',
    score: 0.92,
    citation: {
      sourceId: 'src-1',
      sourceType: 'MARKDOWN',
      provenance: { uri: 'https://kb.test/refunds' },
      model: 'local-hash-v1',
    },
    ...overrides,
  };
}

function llmFake(overrides: Partial<LlmProvider> = {}): LlmProvider {
  return {
    model: 'fake-model',
    complete: vi
      .fn()
      .mockResolvedValue({ text: 'Refunds take 5 days.', model: 'fake-model' }),
    ...overrides,
  };
}

function retrievalFake(hits: RetrievalHit[] = [hit()]) {
  return {
    search: vi.fn().mockResolvedValue(hits),
  } as unknown as KnowledgeRetrievalService;
}

function traceFake() {
  return {
    record: vi.fn(
      async (_input: { trace: AiTraceMetadata; provider: string }) => 'trace-1',
    ),
  };
}

function service(
  retrieval = retrievalFake(),
  llm = llmFake(),
  threshold?: number,
  traces = traceFake(),
): {
  service: AiRuntimeService;
  retrieval: KnowledgeRetrievalService;
  llm: LlmProvider;
  traces: ReturnType<typeof traceFake>;
} {
  return {
    service: new AiRuntimeService(
      retrieval,
      llm,
      traces as unknown as AiTraceService,
      threshold,
    ),
    retrieval,
    llm,
    traces,
  };
}

const base = {
  tenantId: 'tenant-a',
  role: 'R-tenant-admin' as CanonicalRole,
  message: 'How long do refunds take?',
};

describe('AiRuntimeService (T4.03)', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('AC-F09-1: grounded answer', () => {
    it('responds with citations computed from the retrieved hits', async () => {
      const { service: runtime, llm } = service();

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('respond');
      expect(result.reason).toBe('grounded');
      expect(result.text?.trim().length).toBeGreaterThan(0);
      expect(result.model).toBe('fake-model');
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0]).toMatchObject({
        chunkId: 'chunk-1',
        sourceId: 'src-1',
        sourceType: 'MARKDOWN',
        score: 0.92,
      });
      expect(result.escalation).toBeNull();
      expect(llm.complete).toHaveBeenCalledTimes(1);
    });

    it('sends the retrieved context to the model so the answer can be grounded', async () => {
      const { service: runtime, llm } = service();

      await runtime.handle(base);

      const request = vi.mocked(llm.complete).mock.calls[0][0];
      const prompt = JSON.stringify(request.messages);
      expect(prompt).toContain('Refunds land within 5 business days.');
      expect(prompt).toContain(base.message);
    });

    it('accepts a caller-supplied grounding threshold', async () => {
      const { service: runtime } = service(
        retrievalFake([hit({ score: 0.5 })]),
        llmFake(),
        0.3,
      );

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('respond');
    });
  });

  describe('AC-F09-2: abstain / clarify / escalate', () => {
    it('abstains without calling the model when no knowledge is returned', async () => {
      const { service: runtime, llm } = service(retrievalFake([]));

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('abstain');
      expect(result.reason).toBe('no_relevant_knowledge');
      expect(result.citations).toEqual([]);
      expect(result.escalation?.query).toBe(base.message);
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('abstains when every hit scores below the grounding threshold', async () => {
      const { service: runtime, llm } = service(
        retrievalFake([hit({ score: 0.1 })]),
        llmFake(),
      );

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('abstain');
      expect(result.reason).toBe('no_relevant_knowledge');
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('escalates with context instead of throwing when the provider fails twice', async () => {
      const failing = llmFake({
        complete: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      });
      const { service: runtime } = service(retrievalFake(), failing);

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('escalate');
      expect(result.reason).toBe('provider_unavailable');
      expect(result.attempts).toBe(2);
      expect(result.escalation).toMatchObject({
        query: base.message,
        retrievedCount: 1,
      });
      expect(result.escalation?.excerpts[0]).toContain('Refunds land');
    });

    it('retries once and answers when the provider recovers', async () => {
      const flaky = llmFake({
        complete: vi
          .fn()
          .mockRejectedValueOnce(new Error('timeout'))
          .mockResolvedValueOnce({ text: 'Five days.', model: 'fake-model' }),
      });
      const { service: runtime } = service(retrievalFake(), flaky);

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('respond');
      expect(result.attempts).toBe(2);
      expect(flaky.complete).toHaveBeenCalledTimes(2);
    });

    it('escalates when the model returns an empty reply', async () => {
      const empty = llmFake({
        complete: vi
          .fn()
          .mockResolvedValue({ text: '   ', model: 'fake-model' }),
      });
      const { service: runtime } = service(retrievalFake(), empty);

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('escalate');
      expect(result.reason).toBe('invalid_response');
      expect(result.text).toBeNull();
    });

    it('escalates on an explicit human request without retrieval or model calls', async () => {
      const { service: runtime, retrieval, llm } = service();

      const result = await runtime.handle({ ...base, requestHuman: true });

      expect(result.outcome).toBe('escalate');
      expect(result.reason).toBe('human_request');
      expect(result.escalation?.query).toBe(base.message);
      expect(vi.mocked(retrieval.search)).not.toHaveBeenCalled();
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('clarifies an empty message before any external call', async () => {
      const { service: runtime, retrieval, llm } = service();

      const result = await runtime.handle({ ...base, message: '   ' });

      expect(result.outcome).toBe('clarify');
      expect(result.reason).toBe('empty_input');
      expect(vi.mocked(retrieval.search)).not.toHaveBeenCalled();
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('escalates when the model output is unusable, keeping the retrieval context', async () => {
      const blank = llmFake({
        complete: vi.fn().mockResolvedValue({ text: '', model: 'fake-model' }),
      });
      const { service: runtime } = service(retrievalFake(), blank);

      const result = await runtime.handle(base);

      expect(result.outcome).toBe('escalate');
      expect(result.escalation?.retrievedCount).toBe(1);
    });
  });

  describe('AC-F09-3: authorization cannot be bypassed', () => {
    it('passes the tenant and server-resolved role through to retrieval unchanged', async () => {
      const { service: runtime, retrieval } = service();

      await runtime.handle({ ...base, role: 'R-agent' });

      expect(retrieval.search).toHaveBeenCalledWith({
        tenantId: 'tenant-a',
        role: 'R-agent',
        query: base.message,
      });
    });

    it('escalates a denied retrieval and never reaches the model', async () => {
      const denied = {
        search: vi
          .fn()
          .mockRejectedValue(new ForbiddenException('Missing permission')),
      } as unknown as KnowledgeRetrievalService;
      const { service: runtime, llm } = service(denied);

      const result = await runtime.handle({ ...base, role: 'R-customer' });

      expect(result.outcome).toBe('escalate');
      expect(result.reason).toBe('retrieval_denied');
      expect(result.citations).toEqual([]);
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('propagates a non-authorization retrieval failure as an operational fault', async () => {
      // A database outage is not an authorization outcome: the runtime
      // must not convert it into a silent escalation.
      const broken = {
        search: vi.fn().mockRejectedValue(new Error('connection reset')),
      } as unknown as KnowledgeRetrievalService;
      const { service: runtime, llm } = service(broken);

      await expect(runtime.handle(base)).rejects.toThrow('connection reset');
      expect(llm.complete).not.toHaveBeenCalled();
    });

    it('rejects an invalid tenant identifier before retrieval runs', async () => {
      const { service: runtime, retrieval } = service();

      await expect(runtime.handle({ ...base, tenantId: '' })).rejects.toThrow(
        'tenantId',
      );
      expect(vi.mocked(retrieval.search)).not.toHaveBeenCalled();
    });
  });

  describe('defensive result mapping', () => {
    it('answers escalate when a state somehow ends without an outcome', () => {
      const result = toResult({
        outcome: null,
        reason: null,
        text: null,
        model: null,
        citations: [],
        attempts: 0,
        escalation: null,
      });

      expect(result.outcome).toBe('escalate');
      expect(result.reason).toBe('provider_unavailable');
      expect(result.text).toBeNull();
    });
  });

  describe('escalation context shape', () => {
    it('carries the query and retrieved excerpts for the human handoff', async () => {
      const failing = llmFake({
        complete: vi.fn().mockRejectedValue(new Error('down')),
      });
      const { service: runtime } = service(
        retrievalFake([
          hit(),
          hit({ chunkId: 'chunk-2', content: 'Second excerpt.' }),
        ]),
        failing,
      );

      const result = await runtime.handle(base);

      expect(result.escalation?.retrievedCount).toBe(2);
      expect(result.escalation?.excerpts).toHaveLength(2);
      expect(result.escalation?.reason).toBe('provider_unavailable');
    });
  });
});

describe('AiRuntimeService trace metadata (T5.01, AC-F11-1)', () => {
  it('carries the correlation id of the unit of work', async () => {
    const { service: runtime } = service();

    const result = await runWithCorrelationId('trace-ai', () =>
      runtime.handle(base),
    );

    expect(result.trace).toEqual({
      correlationId: 'trace-ai',
      tenantId: 'tenant-a',
      outcome: 'respond',
      model: 'fake-model',
      attempts: 1,
      citationCount: 1,
      latencyMs: expect.any(Number),
      traceId: 'trace-1',
    });
    // Trace metadata must not copy message or document content.
    expect(JSON.stringify(result.trace)).not.toContain('refunds take');
  });

  it('reports null when no context exists instead of inventing an id', async () => {
    const { service: runtime } = service();

    const result = await runtime.handle(base);

    expect(result.trace.correlationId).toBeNull();
  });
});

describe('AiRuntimeService trace persistence (T5.06, AC-F11-1)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('writes exactly one row per run with the correlation id of the request', async () => {
    const { service: runtime, traces } = service();

    const result = await runWithCorrelationId('run-1', () =>
      runtime.handle(base),
    );

    expect(traces.record).toHaveBeenCalledTimes(1);
    const input = traces.record.mock.calls[0][0];
    expect(input.trace).toMatchObject({
      correlationId: 'run-1',
      tenantId: 'tenant-a',
      outcome: 'respond',
      model: 'fake-model',
      attempts: 1,
      citationCount: 1,
    });
    expect(input.trace.latencyMs).toBeGreaterThanOrEqual(0);
    expect(input.provider).toBe('local');
    expect(result.trace.traceId).toBe('trace-1');
    // Operational metadata only: the message never reaches the trace.
    expect(JSON.stringify(input)).not.toContain('refunds');
  });

  it('writes a row for a run that escalates instead of answering', async () => {
    const { service: runtime, traces } = service(retrievalFake([]));

    const result = await runtime.handle(base);

    expect(result.outcome).toBe('abstain');
    expect(traces.record).toHaveBeenCalledTimes(1);
    expect(traces.record.mock.calls[0][0].trace.outcome).toBe('abstain');
  });

  it('answers the customer when the trace write fails, and logs the failure', async () => {
    const logged = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const { service: runtime, traces } = service();
    traces.record.mockRejectedValueOnce(new Error('database down'));

    const result = await runtime.handle(base);

    expect(result.outcome).toBe('respond');
    expect(result.text?.trim().length).toBeGreaterThan(0);
    expect(result.trace.traceId).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain('trace');
  });
});
