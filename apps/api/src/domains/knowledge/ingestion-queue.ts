/**
 * Ingestion queue port and in-process implementation (T3.03).
 *
 * ARCHITECTURE.md §1 selects Redis + BullMQ for async ingestion, but the
 * queue service is not provisioned and a new runtime dependency needs an
 * owner decision first (AGENTS.md §3.4). This port keeps that decision
 * out of the controller and the pipeline: InProcessIngestionQueue runs
 * jobs inside the API process with duplicate suppression by idempotency
 * key, and a BullMQ adapter can implement the same interface later with
 * no change to callers (Proposed D-xx, run log).
 */

import { Inject, Injectable } from '@nestjs/common';
import type { IngestionJob, IngestionRunner } from './ingestion-types.js';

export const INGESTION_QUEUE = 'INGESTION_QUEUE';
export const INGESTION_RUNNER = 'INGESTION_RUNNER';

/** Enqueue fire-and-forget; idle() is the test/flush hook. */
export interface IngestionQueue {
  enqueue(job: IngestionJob): void;
  /** Resolve when every currently queued job has finished. */
  idle(): Promise<void>;
}

@Injectable()
export class InProcessIngestionQueue implements IngestionQueue {
  /** Jobs in flight, keyed by idempotency key for duplicate suppression. */
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(INGESTION_RUNNER) private readonly runner: IngestionRunner,
  ) {}

  enqueue(job: IngestionJob): void {
    if (this.inFlight.has(job.idempotencyKey)) {
      return;
    }
    const running = this.runner
      .run(job)
      .catch((error: unknown) => {
        // The runner records failure on the source row; the process log
        // keeps the unexpected case visible without failing the request.
        console.error(
          '[ingestion] job crashed:',
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        this.inFlight.delete(job.idempotencyKey);
      });
    this.inFlight.set(job.idempotencyKey, running);
  }

  async idle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight.values()]);
    }
  }
}
