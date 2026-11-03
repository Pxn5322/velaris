/**
 * Retention policy contract (T5.02; F-14; AC-F14-1, AC-F14-2).
 *
 * A tenant states, per category, how many days a record stays available. The
 * window is validated here before it can reach storage, and migration 0007
 * repeats the bound as a CHECK, so an invalid policy cannot enter through a
 * second path. The filters below decide availability: an expired record is
 * unavailable immediately, even before the lifecycle sweep removes it.
 */

import { BadRequestException } from '@nestjs/common';

/** Categories a tenant can configure; matches the RetentionCategory enum. */
export const RETENTION_CATEGORIES = ['KNOWLEDGE', 'TRACES', 'MEMORY'] as const;

export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];

export const RETENTION_DAYS_MIN = 1;
export const RETENTION_DAYS_MAX = 3650;

export interface RetentionPolicy {
  category: RetentionCategory;
  retentionDays: number;
}

const DAY_MS = 86_400_000;

function isRetentionCategory(value: unknown): value is RetentionCategory {
  return (
    typeof value === 'string' &&
    (RETENTION_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * Accept a 1..3650 day integer for a known category. Anything else is a
 * client error with the field named, so a settings form can show it.
 */
export function validateRetentionPolicy(input: {
  category: unknown;
  retentionDays: unknown;
}): RetentionPolicy {
  if (!isRetentionCategory(input.category)) {
    throw new BadRequestException(
      `category must be one of ${RETENTION_CATEGORIES.join(', ')}`,
    );
  }
  const retentionDays = input.retentionDays;
  if (
    typeof retentionDays !== 'number' ||
    !Number.isInteger(retentionDays) ||
    retentionDays < RETENTION_DAYS_MIN ||
    retentionDays > RETENTION_DAYS_MAX
  ) {
    throw new BadRequestException(
      `retentionDays must be an integer between ${RETENTION_DAYS_MIN} and ${RETENTION_DAYS_MAX}`,
    );
  }
  return { category: input.category, retentionDays };
}

/**
 * Instant before which a record of this category is expired. The caller
 * passes the validated window; an invalid one throws here too.
 */
export function retentionCutoff(
  category: RetentionCategory,
  retentionDays: number,
  now: Date = new Date(),
): Date {
  const policy = validateRetentionPolicy({ category, retentionDays });
  return new Date(now.getTime() - policy.retentionDays * DAY_MS);
}

/**
 * Prisma filter for sources that may still be retrieved. A null expiry means
 * the source has none; a future expiry means it is still current.
 */
export function activeKnowledgeSourceWhere(now: Date) {
  return {
    deletedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
  };
}

/** Prisma filter for memory rows that may still be used. */
export function activeMemoryWhere(now: Date) {
  return { deletedAt: null, expiresAt: { gt: now } };
}
