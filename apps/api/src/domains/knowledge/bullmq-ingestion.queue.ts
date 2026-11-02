/**
 * BullMQ ingestion queue adapter (queue provisioning task, Proposed D-17).
 *
 * ARCHITECTURE.md §1 selects Redis + BullMQ for async ingestion. This
 * adapter implements the same IngestionQueue port the controller uses, so
 * callers do not change: enqueue() writes one durable job under the
 * idempotency key, and a Worker in this process runs the ingestion
 * runner with the job payload. The consumer lives in apps/api for now
 * (the apps/worker process stays a scaffold until D-07 lands) — scope
 * note in the run log.
 *
 * Connection rule: when REDIS_URL is absent (CI, unit tests, first
 * clone), createIngestionQueue keeps InProcessIngestionQueue, so no
 * test and no build needs a Redis server. Each BullMQ object gets its
 * own ioredis connection; both close on module destroy.
 */

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import type { IngestionJob, IngestionRunner } from './ingestion-types.js';
import {
  InProcessIngestionQueue,
  type IngestionQueue,
} from './ingestion-queue.js';

/** One queue name per pipeline; workers and producers must agree. */
export const INGESTION_QUEUE_NAME = 'knowledge-ingestion';

/** Poll interval for idle() while jobs are still pending. */
const IDLE_POLL_MS = 25;

@Injectable()
export class BullMqIngestionQueue implements IngestionQueue, OnModuleDestroy {
  private readonly queue: Queue;
  private readonly worker: Worker;
  private readonly queueConnection: Redis;
  private readonly workerConnection: Redis;

  constructor(
    private readonly runner: IngestionRunner,
    redisUrl: string,
  ) {
    this.queueConnection = new Redis(redisUrl);
    // Workers issue blocking commands: ioredis requires the option below.
    this.workerConnection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(INGESTION_QUEUE_NAME, {
      connection: this.queueConnection,
    });
    this.worker = new Worker(
      INGESTION_QUEUE_NAME,
      async (job) => this.runner.run(job.data as IngestionJob),
      { connection: this.workerConnection, concurrency: 2 },
    );
  }

  enqueue(job: IngestionJob): void {
    // jobId = idempotency key: while that job still exists, BullMQ drops
    // the duplicate, mirroring the in-process suppression.
    //
    // Two rules the live check against Redis Cloud proved (they are
    // invisible while bullmq is mocked):
    // 1. BullMQ forbids ':' in a custom job id, so the id is sanitised
    //    here while the payload keeps the real idempotency key;
    // 2. queue.add throws or rejects on a bad job - either would reach
    //    Node as an uncaught error and take the whole process down.
    const options = { jobId: bullJobId(job.idempotencyKey) };
    try {
      void Promise.resolve(this.queue.add('ingest', job, options)).catch(
        (error: unknown) => this.reportEnqueueFailure(error),
      );
    } catch (error) {
      this.reportEnqueueFailure(error);
    }
  }

  /** A lost enqueue must stay visible in the log, never crash the API. */
  private reportEnqueueFailure(error: unknown): void {
    console.error(
      '[queue] ingestion job not enqueued:',
      error instanceof Error ? error.message : error,
    );
  }

  async idle(): Promise<void> {
    for (;;) {
      const counts = await this.queue.getJobCounts('wait', 'active', 'delayed');
      const pending =
        (counts.wait ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);
      if (pending === 0) return;
      await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS));
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
    this.queueConnection.disconnect();
    this.workerConnection.disconnect();
  }
}

/**
 * BullMQ job id for an idempotency key: ':' separates Redis key segments,
 * so BullMQ rejects it in a custom id (observed live against Redis 8.6).
 * The payload carries the untouched key, so suppression semantics stay.
 */
export function bullJobId(idempotencyKey: string): string {
  return idempotencyKey.replace(/:/g, '-');
}

/**
 * D-17 factory: durable BullMQ queue when REDIS_URL is set, the
 * in-process adapter otherwise. Both satisfy the same port.
 */
export function createIngestionQueue(
  runner: IngestionRunner,
  redisUrl: string | null,
): IngestionQueue {
  return redisUrl
    ? new BullMqIngestionQueue(runner, redisUrl)
    : new InProcessIngestionQueue(runner);
}
