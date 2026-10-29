/**
 * T3.03 in-process ingestion queue (ARCHITECTURE.md §4 job contract).
 *
 * The queue is a port: the controller enqueues tenant-scoped job metadata
 * and a runner executes it. This spec pins the contract fields the
 * architecture requires on every job (tenant ID, correlation ID,
 * idempotency key, actor identity, schema version) and the two delivery
 * behaviours the pipeline depends on: duplicate suppression while a job
 * with the same idempotency key is in flight, and re-enqueue after
 * completion so a retry or resubmission runs again.
 *
 * The Redis/BullMQ adapter that replaces this in-process implementation
 * is deferred until the queue service is provisioned (Proposed D-xx, run
 * log); the port and contract stay identical.
 */

import { describe, expect, it, vi } from 'vitest';
import type { IngestionJob } from './ingestion-types.js';
import { InProcessIngestionQueue } from './ingestion-queue.js';

function job(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    idempotencyKey: 'ingest:src-1',
    correlationId: 'corr-1',
    tenantId: 'tenant-a',
    sourceId: 'src-1',
    actorId: 'user-1',
    enqueuedAt: '2026-10-29T00:00:00.000Z',
    ...overrides,
  };
}

function makeRunner(delayMs = 5) {
  const seen: IngestionJob[] = [];
  const runner = {
    run: vi.fn(async (received: IngestionJob) => {
      seen.push(received);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: 'READY' as const };
    }),
  };
  return { runner, seen };
}

describe('InProcessIngestionQueue (T3.03)', () => {
  it('delivers the full job contract to the runner', async () => {
    const { runner, seen } = makeRunner();
    const queue = new InProcessIngestionQueue(runner as never);
    const input = job();

    queue.enqueue(input);
    await queue.idle();

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(seen[0]).toEqual(input);
    expect(seen[0]).toMatchObject({
      schemaVersion: 1,
      tenantId: 'tenant-a',
      correlationId: 'corr-1',
      idempotencyKey: 'ingest:src-1',
      actorId: 'user-1',
    });
  });

  it('suppresses a duplicate idempotency key while the job is in flight', async () => {
    const { runner } = makeRunner(20);
    const queue = new InProcessIngestionQueue(runner as never);

    queue.enqueue(job());
    queue.enqueue(job({ jobId: 'job-2' }));
    await queue.idle();

    expect(runner.run).toHaveBeenCalledTimes(1);
  });

  it('accepts the same idempotency key again after completion (retry)', async () => {
    const { runner } = makeRunner(1);
    const queue = new InProcessIngestionQueue(runner as never);

    queue.enqueue(job());
    await queue.idle();
    queue.enqueue(job({ jobId: 'job-3' }));
    await queue.idle();

    expect(runner.run).toHaveBeenCalledTimes(2);
  });

  it('keeps running the other jobs when one runner call rejects', async () => {
    const runner = {
      run: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ status: 'READY' as const }),
    };
    const queue = new InProcessIngestionQueue(runner as never);

    queue.enqueue(job());
    queue.enqueue(job({ idempotencyKey: 'ingest:src-2' }));
    await queue.idle();

    expect(runner.run).toHaveBeenCalledTimes(2);
  });
});
