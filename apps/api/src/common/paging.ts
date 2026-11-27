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

/** Position of a cursor row: the identifier and the column the page orders by. */
export interface PageAnchor {
  id: string;
  at: Date;
}

/** A cursor is the identifier of one row. */
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Read one cursor value, which must name a row of the noun's table. */
export function requireCursorId(cursor: string, noun: string): string {
  if (!UUID_PATTERN.test(cursor)) {
    throw new BadRequestException('cursor must be a ' + noun + ' identifier');
  }
  return cursor;
}

/**
 * Filter for the rows after `anchor` in `(column desc, id desc)` order (D-87).
 *
 * The range is one index condition, so the scan starts at the anchor instead
 * of at the newest row. The NOT prunes the rows of the anchor's own value that
 * come first in the id order. An OR over the two tie branches would be a
 * filter with no index condition, and the scan would walk every skipped row.
 */
export function keysetBefore<K extends 'createdAt' | 'updatedAt'>(
  column: K,
  anchor: PageAnchor,
): { [P in K]: { lte: Date } } & {
  NOT: { [P in K]: Date } & { id: { gte: string } };
} {
  return {
    [column]: { lte: anchor.at },
    NOT: { [column]: anchor.at, id: { gte: anchor.id } },
  } as { [P in K]: { lte: Date } } & {
    NOT: { [P in K]: Date } & { id: { gte: string } };
  };
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
