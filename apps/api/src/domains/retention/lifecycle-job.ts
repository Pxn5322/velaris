/**
 * Lifecycle job contract (T5.02; F-14; AC-F14-1).
 *
 * The ingestion queue already carries `schemaVersion`, `jobId`,
 * `idempotencyKey` and `correlationId` (ARCHITECTURE section 4). A retention
 * sweep uses the same envelope, so a job that deletes or expires records is
 * traceable and safe to run twice: the key is stable for one tenant, category
 * and cutoff day.
 */

import { randomUUID } from 'node:crypto';
import { currentCorrelationId } from '../../common/logging/correlation.js';
import {
  validateRetentionPolicy,
  type RetentionCategory,
} from './retention-policy.js';

export const LIFECYCLE_JOB_SCHEMA_VERSION = 1;

export interface LifecycleJob {
  schemaVersion: typeof LIFECYCLE_JOB_SCHEMA_VERSION;
  jobId: string;
  idempotencyKey: string;
  correlationId: string;
  tenantId: string;
  category: RetentionCategory;
  /** ISO instant; records older than this are expired. */
  cutoffAt: string;
  enqueuedAt: string;
}

export interface BuildLifecycleJobInput {
  tenantId: string;
  category: RetentionCategory;
  cutoffAt: Date;
  enqueuedAt?: Date;
}

/** Build one sweep job. Rejects an empty tenant or an unknown category. */
export function buildLifecycleJob(input: BuildLifecycleJobInput): LifecycleJob {
  if (typeof input.tenantId !== 'string' || input.tenantId.trim() === '') {
    throw new Error('tenantId is required');
  }
  // Reuses the policy validation so a job cannot name a category the policy
  // table does not know.
  validateRetentionPolicy({ category: input.category, retentionDays: 1 });

  const enqueuedAt = input.enqueuedAt ?? new Date();
  const cutoffDay = input.cutoffAt.toISOString().slice(0, 10);
  return {
    schemaVersion: LIFECYCLE_JOB_SCHEMA_VERSION,
    jobId: randomUUID(),
    idempotencyKey: `lifecycle:${input.tenantId}:${input.category}:${cutoffDay}`,
    correlationId: currentCorrelationId() ?? randomUUID(),
    tenantId: input.tenantId,
    category: input.category,
    cutoffAt: input.cutoffAt.toISOString(),
    enqueuedAt: enqueuedAt.toISOString(),
  };
}
