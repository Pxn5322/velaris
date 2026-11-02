/**
 * BullMQ queue adapter (queue provisioning task, Proposed D-17).
 *
 * RED first: the adapter and its factory selection do not exist yet.
 * The spec pins:
 * - createIngestionQueue keeps the in-process adapter when REDIS_URL is
 *   absent (CI and unit tests need no Redis)
 * - createIngestionQueue returns the BullMQ adapter when REDIS_URL is set
 * - enqueue adds one job to the durable queue under the idempotency key
 * - the BullMQ processor runs the ingestion runner with the job payload
 * - idle() resolves once the queue reports no waiting/active jobs
 * - destroy closes worker, queue and connection
 *
 * bullmq and ioredis are mocked: no network, no Redis server.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IngestionJob, IngestionRunner } from './ingestion-types.js';
import {
  BullMqIngestionQueue,
  createIngestionQueue,
  INGESTION_QUEUE_NAME,
} from './bullmq-ingestion.queue.js';
import { InProcessIngestionQueue } from './ingestion-queue.js';

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueClose: vi.fn(),
  getJobCounts: vi.fn(),
  workerClose: vi.fn(),
  disconnect: vi.fn(),
  captureProcessor: vi.fn(),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(function () {
    return {
      add: mocks.queueAdd,
      close: mocks.queueClose,
      getJobCounts: mocks.getJobCounts,
    };
  }),
  Worker: vi.fn().mockImplementation(function (
    _name: string,
    processor: (job: { data: unknown }) => Promise<unknown>,
  ) {
    mocks.captureProcessor(processor);
    return { close: mocks.workerClose };
  }),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(function () {
    return { disconnect: mocks.disconnect };
  }),
}));

function job(overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    schemaVersion: 1,
    jobId: 'job-1',
    idempotencyKey: 'ingest:src-1',
    correlationId: 'corr-1',
    tenantId: 'tenant-a',
    sourceId: 'src-1',
    actorId: 'user-1',
    enqueuedAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

describe('queue factory selection (D-17)', () => {
  it('keeps the in-process adapter when REDIS_URL is absent', () => {
    const runner: IngestionRunner = { run: vi.fn() };
    expect(createIngestionQueue(runner, null)).toBeInstanceOf(
      InProcessIngestionQueue,
    );
  });

  it('returns the BullMQ adapter when REDIS_URL is set', () => {
    const runner: IngestionRunner = { run: vi.fn() };
    expect(
      createIngestionQueue(runner, 'rediss://queue.example.test:6380'),
    ).toBeInstanceOf(BullMqIngestionQueue);
  });
});

describe('BullMqIngestionQueue', () => {
  let runner: IngestionRunner & { run: ReturnType<typeof vi.fn> };
  let queue: BullMqIngestionQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = { run: vi.fn().mockResolvedValue({ status: 'READY' }) };
    queue = createIngestionQueue(
      runner,
      'rediss://queue.example.test:6380',
    ) as BullMqIngestionQueue;
  });

  afterEach(async () => {
    await queue.onModuleDestroy();
  });

  it('adds one durable job under a BullMQ-safe id', () => {
    queue.enqueue(job());

    // BullMQ rejects ':' in a custom id (live check, Redis 8.6): the id
    // is sanitised while the payload keeps the real idempotency key.
    expect(mocks.queueAdd).toHaveBeenCalledWith('ingest', job(), {
      jobId: 'ingest-src-1',
    });
    const options = mocks.queueAdd.mock.calls[0][2] as { jobId: string };
    expect(options.jobId).not.toContain(':');
  });

  it('keeps the idempotency key untouched inside the payload', () => {
    queue.enqueue(job());

    const payload = mocks.queueAdd.mock.calls[0][1] as IngestionJob;
    expect(payload.idempotencyKey).toBe('ingest:src-1');
  });

  it('never lets a failed add take the process down (live-check regression)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.queueAdd.mockRejectedValueOnce(
      new Error('Custom Id cannot contain :'),
    );

    expect(() => queue.enqueue(job())).not.toThrow();

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledTimes(1));
    expect(String(errorSpy.mock.calls[0][0])).toContain('not enqueued');
    errorSpy.mockRestore();
  });

  it('also survives a synchronous throw from the queue add', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.queueAdd.mockImplementationOnce(() => {
      throw new Error('Custom Id cannot contain :');
    });

    expect(() => queue.enqueue(job())).not.toThrow();
    expect(String(errorSpy.mock.calls[0][0])).toContain('not enqueued');
    errorSpy.mockRestore();
  });

  it('runs the ingestion runner from the BullMQ processor', async () => {
    expect(mocks.captureProcessor).toHaveBeenCalledTimes(1);
    const processor = mocks.captureProcessor.mock.calls[0][0] as (j: {
      data: unknown;
    }) => Promise<unknown>;

    await processor({ data: job() });

    expect(runner.run).toHaveBeenCalledWith(job());
  });

  it('idle resolves once the queue reports no pending work', async () => {
    mocks.getJobCounts
      .mockResolvedValueOnce({ wait: 1, active: 1, delayed: 0, paused: 0 })
      .mockResolvedValueOnce({ wait: 0, active: 0, delayed: 0, paused: 0 });

    await queue.idle();

    expect(mocks.getJobCounts).toHaveBeenCalledTimes(2);
  });

  it('destroy closes the worker, queue and both connections', async () => {
    await queue.onModuleDestroy();

    expect(mocks.workerClose).toHaveBeenCalledTimes(1);
    expect(mocks.queueClose).toHaveBeenCalledTimes(1);
    // Queue and worker each own a connection (D-17).
    expect(mocks.disconnect).toHaveBeenCalledTimes(2);
  });

  it('uses the knowledge-ingestion queue name', () => {
    expect(INGESTION_QUEUE_NAME).toBe('knowledge-ingestion');
  });
});
