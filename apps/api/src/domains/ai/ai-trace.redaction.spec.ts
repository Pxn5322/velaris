/**
 * TH-07 redaction test (T6.01; SECURITY.md TH-07; TST-TH-07).
 *
 * A trace answers "what did the platform do" without answering "what did the
 * customer say". This spec proves that with a canary: the canary travels
 * through the whole run — it is in the customer message, in the retrieved
 * knowledge and in the reply — so its absence from the trace metadata and
 * from the failure log is evidence of redaction, not of an empty fixture.
 *
 * The positive controls matter as much as the assertions: a redaction test
 * that passes because the content never reached the component would keep
 * passing after the component started copying content.
 */

import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  KnowledgeRetrievalService,
  RetrievalHit,
} from '../knowledge/knowledge-retrieval.service.js';
import type { LlmProvider } from '../../infrastructure/llm/llm.provider.js';
import { runWithCorrelationId } from '../../common/logging/correlation.js';
import {
  AiRuntimeService,
  safeErrorDetail,
  type AiTraceMetadata,
} from './ai-runtime.service.js';
import type { AiTraceService } from './ai-trace.service.js';
import type { CanonicalRole } from '../permissions/permission.codes.js';

/** Sentinel that may never appear in operational metadata or logs. */
const CANARY = 'CANARY-7f3e9a-refund-4111';

/** The only fields a trace may carry: identifiers, counts and timings. */
const ALLOWED_TRACE_FIELDS = [
  'attempts',
  'citationCount',
  'correlationId',
  'latencyMs',
  'model',
  'outcome',
  'tenantId',
  'traceId',
];

function hit(score = 0.92): RetrievalHit {
  return {
    chunkId: 'chunk-1',
    chunkIndex: 0,
    content: `Refund policy: ${CANARY} lands within 5 business days.`,
    score,
    citation: {
      sourceId: 'src-1',
      sourceType: 'MARKDOWN',
      provenance: { uri: 'https://kb.test/refunds' },
      model: 'local-hash-v1',
    },
  };
}

function llmFake(): LlmProvider {
  return {
    model: 'fake-model',
    complete: vi.fn().mockResolvedValue({
      text: `A refund for ${CANARY} takes 5 days.`,
      model: 'fake-model',
    }),
  };
}

function retrievalFake(hits: RetrievalHit[]): KnowledgeRetrievalService {
  return {
    search: vi.fn().mockResolvedValue(hits),
  } as unknown as KnowledgeRetrievalService;
}

/** What the runtime passes to the trace writer. */
interface TraceWrite {
  trace: AiTraceMetadata;
  provider: string;
}

function service(
  options: {
    hits?: RetrievalHit[];
    record?: (input: TraceWrite) => Promise<string>;
  } = {},
) {
  const record = vi.fn<(input: TraceWrite) => Promise<string>>(
    options.record ?? (async () => 'trace-1'),
  );
  const runtime = new AiRuntimeService(
    retrievalFake(options.hits ?? [hit()]),
    llmFake(),
    { record } as unknown as AiTraceService,
    0.75,
  );
  return { runtime, traceWrite: record };
}

const base = {
  tenantId: 'tenant-a',
  role: 'R-tenant-admin' as CanonicalRole,
  message: `Customer asks about ${CANARY} refunds.`,
};

describe('TH-07 trace and log redaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never copies message, knowledge or reply content into the trace', async () => {
    const { runtime, traceWrite } = service();

    const result = await runWithCorrelationId('req-th07', () =>
      runtime.handle(base),
    );

    // Positive control: the canary really did travel through this run.
    expect(result.text).toContain(CANARY);
    expect(traceWrite).toHaveBeenCalledTimes(1);

    const input = traceWrite.mock.calls[0][0];
    const serialized = JSON.stringify(input);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain('4111');
    expect(serialized).not.toContain('Refund policy');
    expect(Object.keys(input.trace).sort()).toEqual(ALLOWED_TRACE_FIELDS);
    expect(input.trace).toMatchObject({
      correlationId: 'req-th07',
      tenantId: 'tenant-a',
      outcome: 'respond',
      // The writer assigns the row id, so the input carries none yet.
      traceId: null,
    });
    expect(result.trace.traceId).toBe('trace-1');
  });

  it('keeps the content out of the trace on an escalation too', async () => {
    const { runtime, traceWrite } = service({ hits: [hit(0.1)] });

    const result = await runWithCorrelationId('req-th07-esc', () =>
      runtime.handle(base),
    );

    // Positive control: the handoff context carries the content, because the
    // human receiving it needs it.
    expect(result.outcome).toBe('abstain');
    expect(result.escalation?.query).toContain(CANARY);
    expect(result.escalation?.excerpts.join(' ')).toContain(CANARY);

    expect(JSON.stringify(traceWrite.mock.calls[0][0])).not.toContain(CANARY);
  });

  it('logs the failure with the correlation id and no content', async () => {
    const logged: unknown[][] = [];
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (...args: unknown[]) => {
        logged.push(args);
      },
    );
    const { runtime } = service({
      record: async () => {
        throw new Error(`write failed for ${CANARY}`);
      },
    });

    const result = await runWithCorrelationId('req-th07-fail', () =>
      runtime.handle(base),
    );

    expect(result.trace.traceId).toBeNull();
    expect(result.text).toContain(CANARY);
    expect(logged).toHaveLength(1);
    expect(String(logged[0][0])).toContain('req-th07-fail');
    // An error message can quote the row it failed on, so the failure log
    // keeps the error name and its frames and drops the message.
    expect(JSON.stringify(logged)).not.toContain(CANARY);
    expect(String(logged[0][1])).toContain('Error');
  });
});

describe('safeErrorDetail', () => {
  it('drops the message but keeps the name and the frames', () => {
    const detail = safeErrorDetail(new Error(`failed for ${CANARY}`));

    expect(detail.startsWith('Error\n')).toBe(true);
    expect(detail).not.toContain(CANARY);
    expect(detail).toContain('ai-trace.redaction.spec');
  });

  it('reports a non-Error value by its type, not its contents', () => {
    expect(safeErrorDetail(`thrown ${CANARY}`)).toBe('string');
    expect(safeErrorDetail(null)).toBe('object');
  });

  it('returns the name alone when the error has no stack', () => {
    const error = new TypeError(`no stack ${CANARY}`);
    error.stack = undefined;

    expect(safeErrorDetail(error)).toBe('TypeError');
  });
});
