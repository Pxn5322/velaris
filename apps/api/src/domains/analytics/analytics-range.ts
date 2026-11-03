/**
 * Analytics range validation (T5.03; API-15).
 *
 * The summary takes an optional inclusive range. A missing bound defaults to
 * the last seven days; an ISO 8601 instant is accepted otherwise. The range
 * may not be inverted, longer than a year, or end in the future, because a
 * future end would report an empty period that has not happened.
 */

import { BadRequestException } from '@nestjs/common';

export const DEFAULT_RANGE_DAYS = 7;
export const MAX_RANGE_DAYS = 366;

const DAY_MS = 86_400_000;
const FUTURE_TOLERANCE_MS = 5 * 60_000;

export interface AnalyticsRange {
  from: Date;
  to: Date;
}

export interface AnalyticsRangeInput {
  from?: unknown;
  to?: unknown;
  now?: Date;
}

function parseInstant(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be an ISO 8601 date`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be an ISO 8601 date`);
  }
  return parsed;
}

/** Validate the query bounds, or supply the default seven-day range. */
export function parseAnalyticsRange(
  input: AnalyticsRangeInput = {},
): AnalyticsRange {
  const now = input.now ?? new Date();
  const to = parseInstant(input.to, 'to') ?? now;
  const from =
    parseInstant(input.from, 'from') ??
    new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);

  if (from.getTime() > to.getTime()) {
    throw new BadRequestException('from must not be later than to');
  }
  if (to.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new BadRequestException('to must not be in the future');
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw new BadRequestException(
      `the range must not exceed ${MAX_RANGE_DAYS} days`,
    );
  }
  return { from, to };
}
