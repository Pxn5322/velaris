/**
 * Retention defaults (T6.06; F-14; D-38).
 *
 * Only TRACES has a product default. A helper that returned a number for
 * KNOWLEDGE or MEMORY would turn an unapproved commercial window into a
 * stored promise, so the contract is asserted directly.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRACE_RETENTION_DAYS,
  defaultRetentionDays,
  RETENTION_CATEGORIES,
} from './retention-policy.js';

describe('retention defaults (D-38)', () => {
  it('applies a 30-day window to TRACES', () => {
    expect(DEFAULT_TRACE_RETENTION_DAYS).toBe(30);
    expect(defaultRetentionDays('TRACES')).toBe(30);
  });

  it('reports no default for KNOWLEDGE and MEMORY', () => {
    expect(defaultRetentionDays('KNOWLEDGE')).toBeNull();
    expect(defaultRetentionDays('MEMORY')).toBeNull();
  });

  it('covers every category exactly once', () => {
    expect(new Set(RETENTION_CATEGORIES).size).toBe(
      RETENTION_CATEGORIES.length,
    );
  });
});
