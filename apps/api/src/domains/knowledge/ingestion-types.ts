/**
 * Ingestion job metadata contract (T3.03, ARCHITECTURE.md §4).
 *
 * Every asynchronous ingestion job carries the fields the architecture
 * requires on job interfaces: tenant ID, correlation ID, idempotency key,
 * actor/system identity and schema version. The tenant ID scopes every
 * database read and write the runner performs (TH-01, NFR-01).
 *
 * The contract lives in the knowledge domain for now; promotion to
 * `packages/contracts` happens when a second consumer outside apps/api
 * needs it (the worker process stays a scaffold until the queue and
 * embedding-provider decisions land). Recorded as a scope note in the
 * implementation plan run log.
 */

/**
 * Permanent ingestion failure carrying its reportable error code.
 * Permanent errors fail once (no retry); anything else is transient and
 * retries within the bounded budget (AC-F07-2).
 */
export class PermanentIngestionError extends Error {
  readonly permanent = true;

  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = 'PermanentIngestionError';
  }
}

/** One queued knowledge ingestion job. Versioned for queue compatibility. */
export interface IngestionJob {
  /** Contract schema version; bump on breaking field changes. */
  schemaVersion: 1;
  jobId: string;
  /** Duplicate suppression key: while in flight, equal keys run once. */
  idempotencyKey: string;
  /** Correlation ID for tracing from HTTP into the worker (NFR-06). */
  correlationId: string;
  /** Tenant scope: the runner touches rows of this tenant only. */
  tenantId: string;
  sourceId: string;
  /** Authenticated identity that submitted the source. */
  actorId: string;
  /** ISO timestamp of enqueue time. */
  enqueuedAt: string;
}

/** Durable outcome of one runner execution. */
export interface IngestionJobOutcome {
  sourceId: string;
  status: 'READY' | 'FAILED' | 'SKIPPED';
  /** Attempts consumed inside this execution (0 when skipped). */
  attempts: number;
  errorCode: string | null;
}

/** Minimal runner surface the queue depends on (no DI cycle). */
export interface IngestionRunner {
  run(job: IngestionJob): Promise<IngestionJobOutcome>;
}
