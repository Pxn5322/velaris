/**
 * T5.03 analytics range (API-15).
 *
 * A missing bound defaults to seven days; a supplied bound must be an ISO
 * instant, ordered, within a year and not in the future.
 */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  parseAnalyticsRange,
} from './analytics-range.js';

const NOW = new Date('2026-11-03T12:00:00.000Z');

describe('parseAnalyticsRange', () => {
  it('defaults to the last seven days ending now', () => {
    const range = parseAnalyticsRange({ now: NOW });

    expect(range.to.toISOString()).toBe('2026-11-03T12:00:00.000Z');
    expect(range.from.toISOString()).toBe('2026-10-27T12:00:00.000Z');
    expect(DEFAULT_RANGE_DAYS).toBe(7);
  });

  it('accepts ISO instants inside the bounds', () => {
    const range = parseAnalyticsRange({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T00:00:00.000Z',
      now: NOW,
    });

    expect(range.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(range.to.toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('accepts a range of exactly one year', () => {
    const range = parseAnalyticsRange({
      from: '2025-11-02T12:00:00.000Z',
      to: '2026-11-03T12:00:00.000Z',
      now: NOW,
    });

    expect(range.to.getTime() - range.from.getTime()).toBe(
      MAX_RANGE_DAYS * 86_400_000,
    );
  });

  it('rejects an inverted range', () => {
    expect(() =>
      parseAnalyticsRange({
        from: '2026-11-02T00:00:00.000Z',
        to: '2026-11-01T00:00:00.000Z',
        now: NOW,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a range longer than a year', () => {
    expect(() =>
      parseAnalyticsRange({
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-11-03T00:00:00.000Z',
        now: NOW,
      }),
    ).toThrow(BadRequestException);
  });

  it('rejects a future end', () => {
    expect(() =>
      parseAnalyticsRange({ to: '2026-12-01T00:00:00.000Z', now: NOW }),
    ).toThrow(BadRequestException);
  });

  it('rejects a bound that is not an ISO instant', () => {
    expect(() => parseAnalyticsRange({ from: 'yesterday', now: NOW })).toThrow(
      BadRequestException,
    );
    expect(() => parseAnalyticsRange({ to: '2026-13-45', now: NOW })).toThrow(
      BadRequestException,
    );
  });
});
