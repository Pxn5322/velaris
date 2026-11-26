/**
 * Page window for the bounded list routes (D-81, D-82, D-83).
 *
 * The tickets queue and the conversation list answer the same contract, so
 * the defaults, the cap and the query parsing live here once. A caller reads
 * one window and never the whole table, and an illegal window is a 400 before
 * any read runs.
 */

import { BadRequestException } from '@nestjs/common';

/** First page a caller may ask for. */
export const DEFAULT_PAGE = 1;
/** Rows per page when the caller names no size. */
export const DEFAULT_PAGE_SIZE = 25;
/** Largest page a caller may ask for, so one request stays bounded. */
export const MAX_PAGE_SIZE = 100;

export interface PageWindow {
  page: number;
  pageSize: number;
}

/**
 * Turn the requested values into one legal window.
 *
 * A missing value takes the default. A non-integer, a page below 1 and a size
 * above the cap are 400 with the field name in the message.
 */
export function resolvePageWindow(options: {
  page?: number;
  pageSize?: number;
}): PageWindow {
  const page = requirePositiveInteger(options.page ?? DEFAULT_PAGE, 'page');
  const pageSize = requirePositiveInteger(
    options.pageSize ?? DEFAULT_PAGE_SIZE,
    'pageSize',
  );
  if (pageSize > MAX_PAGE_SIZE) {
    throw new BadRequestException('pageSize must be at most ' + MAX_PAGE_SIZE);
  }
  return { page, pageSize };
}

/** The offset a window starts at, for `skip`. */
export function pageOffset(window: PageWindow): number {
  return (window.page - 1) * window.pageSize;
}

export function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException(field + ' must be a positive integer');
  }
  return value;
}

/**
 * Read one numeric query parameter. An empty or missing value stays undefined
 * so the service applies its default; anything else must be an integer, which
 * the service refuses with 400 when it is not.
 */
export function optionalNumber(
  value: string | undefined,
  field: string,
): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(field + ' must be a positive integer');
  }
  return parsed;
}
