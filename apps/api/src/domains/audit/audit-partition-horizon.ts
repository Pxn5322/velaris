/**
 * Monthly audit partition horizon (T6.10; D-60).
 *
 * `audit_events` is partitioned by month with an overflow partition, so a row
 * outside the horizon is stored rather than refused. The overflow partition is
 * a safety net, not a plan: rows that land there cannot be aged out with their
 * month, and a horizon that falls behind turns every write into an unpartitioned
 * row. The maintenance job keeps the horizon some months ahead of today, and
 * this module owns the month arithmetic so the job and its tests agree.
 */

/** How many months past the current one the maintenance job keeps ready. */
export const DEFAULT_PARTITION_HORIZON_MONTHS = 12;

/** The first day of the month, in UTC, so the host time zone cannot shift it. */
export function auditMonthStart(from: Date): Date {
  return new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
}

/** The current month and `monthsAhead` months after it, in order. */
export function auditHorizonMonths(from: Date, monthsAhead: number): Date[] {
  if (!Number.isInteger(monthsAhead) || monthsAhead < 0) {
    throw new RangeError(
      'monthsAhead must be a whole number of months or more',
    );
  }
  const start = auditMonthStart(from);
  return Array.from(
    { length: monthsAhead + 1 },
    (_, offset) =>
      new Date(
        Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + offset, 1),
      ),
  );
}

/** The partition name the migration and its maintenance function use. */
export function auditPartitionName(month: Date): string {
  const start = auditMonthStart(month);
  return `audit_events_${start.getUTCFullYear()}_${String(
    start.getUTCMonth() + 1,
  ).padStart(2, '0')}`;
}
