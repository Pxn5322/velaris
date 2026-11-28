/**
 * Monthly audit partition horizon (T6.10; D-60).
 *
 * `audit_events` is partitioned by month with an overflow partition, so a row
 * is stored rather than refused. That also means a horizon that falls behind
 * the calendar silently piles rows into one catch-all partition, which a
 * retention drop cannot age out by month. The maintenance script therefore
 * keeps the horizon some months ahead of today; these cases pin the month
 * arithmetic, including the year boundary and the partition name.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PARTITION_HORIZON_MONTHS,
  auditHorizonMonths,
  auditMonthStart,
  auditPartitionName,
} from './audit-partition-horizon.js';

describe('auditMonthStart', () => {
  it('returns the first day of the month in UTC', () => {
    expect(
      auditMonthStart(new Date('2026-11-28T23:30:00.000Z')).toISOString(),
    ).toBe('2026-11-01T00:00:00.000Z');
  });

  it('reads the month from UTC, not from the host time zone', () => {
    expect(
      auditMonthStart(new Date('2026-12-01T00:30:00.000Z')).toISOString(),
    ).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('auditHorizonMonths', () => {
  it('starts at the current month and ends the requested months later', () => {
    const months = auditHorizonMonths(new Date('2026-11-28T10:00:00.000Z'), 3);

    expect(months.map((month) => month.toISOString())).toEqual([
      '2026-11-01T00:00:00.000Z',
      '2026-12-01T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
      '2027-02-01T00:00:00.000Z',
    ]);
  });

  it('covers the current month alone when nothing is ahead', () => {
    const months = auditHorizonMonths(new Date('2026-11-28T10:00:00.000Z'), 0);

    expect(months.map((month) => month.toISOString())).toEqual([
      '2026-11-01T00:00:00.000Z',
    ]);
  });

  it('keeps a year of months ahead of today', () => {
    expect(DEFAULT_PARTITION_HORIZON_MONTHS).toBe(12);

    const months = auditHorizonMonths(
      new Date('2026-11-28T10:00:00.000Z'),
      DEFAULT_PARTITION_HORIZON_MONTHS,
    );

    expect(months).toHaveLength(13);
    expect(months[months.length - 1].toISOString()).toBe(
      '2027-11-01T00:00:00.000Z',
    );
  });

  it('refuses a negative or fractional horizon', () => {
    expect(() =>
      auditHorizonMonths(new Date('2026-11-28T10:00:00.000Z'), -1),
    ).toThrow(RangeError);
    expect(() =>
      auditHorizonMonths(new Date('2026-11-28T10:00:00.000Z'), 1.5),
    ).toThrow(RangeError);
  });
});

describe('auditPartitionName', () => {
  it('names a month the way the migration names its partitions', () => {
    expect(auditPartitionName(new Date('2026-01-15T00:00:00.000Z'))).toBe(
      'audit_events_2026_01',
    );
    expect(auditPartitionName(new Date('2027-12-01T00:00:00.000Z'))).toBe(
      'audit_events_2027_12',
    );
  });
});
