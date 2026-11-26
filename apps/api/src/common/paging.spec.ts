/** Shared page window for the bounded list routes (D-83). */

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  optionalNumber,
  pageOffset,
  resolvePageWindow,
} from './paging.js';

describe('page window (D-83)', () => {
  it('applies the shared defaults when the caller names no window', () => {
    expect(resolvePageWindow({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
    expect(DEFAULT_PAGE).toBe(1);
    expect(DEFAULT_PAGE_SIZE).toBe(25);
    expect(MAX_PAGE_SIZE).toBe(100);
  });

  it('keeps a legal window and derives its offset', () => {
    const window = resolvePageWindow({ page: 3, pageSize: 10 });
    expect(window).toEqual({ page: 3, pageSize: 10 });
    expect(pageOffset(window)).toBe(20);
  });

  it('refuses a page size above the cap, a page below 1 and a fraction', () => {
    expect(() => resolvePageWindow({ pageSize: MAX_PAGE_SIZE + 1 })).toThrow(
      BadRequestException,
    );
    expect(() => resolvePageWindow({ page: 0 })).toThrow(BadRequestException);
    expect(() => resolvePageWindow({ page: 1.5 })).toThrow(BadRequestException);
    // The cap itself is allowed.
    expect(resolvePageWindow({ pageSize: MAX_PAGE_SIZE }).pageSize).toBe(
      MAX_PAGE_SIZE,
    );
  });

  it('parses a query value, keeps an empty one undefined and refuses text', () => {
    expect(optionalNumber('2', 'page')).toBe(2);
    expect(optionalNumber(undefined, 'page')).toBeUndefined();
    expect(optionalNumber('  ', 'page')).toBeUndefined();
    expect(() => optionalNumber('two', 'page')).toThrow(BadRequestException);
  });
});
