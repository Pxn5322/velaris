#!/usr/bin/env node
/**
 * Audit partition horizon job (T6.10; D-60).
 *
 * `audit_events` is partitioned by month. The migration creates a fixed
 * horizon plus an overflow partition, and the overflow partition is a safety
 * net, not a plan: a horizon that falls behind the calendar piles rows into one
 * catch-all partition that retention cannot age out by month. This job keeps a
 * year of monthly partitions ready ahead of today by calling the migration's
 * `audit_ensure_month_partition`, which is idempotent.
 *
 * Usage:
 *   npm run audit:partitions                 # create the months that are missing
 *   npm run audit:partitions -- --check      # only report; exit 1 when behind
 *   npm run audit:partitions -- --months 24  # keep two years ahead instead
 *
 * Required environment: DATABASE_URL. The job creates partitions only; it never
 * drops one, so the retention gate stays with `audit_purge_expired_partitions`.
 *
 * Exit codes: 0 = the horizon is ready, 1 = a month is missing in `--check`
 * mode or the job could not read or create a partition (fails closed),
 * 2 = DATABASE_URL is missing.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DEFAULT_PARTITION_HORIZON_MONTHS,
  auditHorizonMonths,
  auditPartitionName,
} from '../apps/api/src/domains/audit/audit-partition-horizon.ts';

function parseMonths(argv) {
  const index = argv.indexOf('--months');
  if (index < 0) return DEFAULT_PARTITION_HORIZON_MONTHS;
  const value = Number(argv[index + 1]);
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError('--months must be a whole number of months or more');
  }
  return value;
}

async function partitionExists(prisma, name) {
  const rows = await prisma.$queryRaw`
    SELECT to_regclass(${name})::text AS name
  `;
  return Boolean(rows[0]?.name);
}

async function overflowRows(prisma) {
  const present = await partitionExists(prisma, 'audit_events_default');
  if (!present) return null;
  const rows = await prisma.$queryRaw`
    SELECT count(*)::int AS rows FROM "audit_events_default"
  `;
  return Number(rows[0]?.rows ?? 0);
}

async function main() {
  const argv = process.argv.slice(2);
  const checkOnly = argv.includes('--check');
  const monthsAhead = parseMonths(argv);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('audit-partitions: DATABASE_URL is required');
    process.exitCode = 2;
    return;
  }

  const horizon = auditHorizonMonths(new Date(), monthsAhead);
  const label = `${auditPartitionName(horizon[0]).replace(
    'audit_events_',
    '',
  )} .. ${auditPartitionName(horizon[horizon.length - 1]).replace(
    'audit_events_',
    '',
  )}`;
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    console.log(
      `audit-partitions: horizon ${label} (${horizon.length} month(s))`,
    );
    const missing = [];
    for (const month of horizon) {
      const name = auditPartitionName(month);
      if (await partitionExists(prisma, name)) continue;
      if (checkOnly) {
        missing.push(name);
        continue;
      }
      const created = await prisma.$queryRaw`
        SELECT audit_ensure_month_partition(${month.toISOString().slice(0, 10)}::date) AS name
      `;
      console.log(`  created ${created[0]?.name ?? name}`);
    }

    if (missing.length > 0) {
      console.error(
        `audit-partitions: FAIL - ${missing.length} month(s) missing: ${missing.join(
          ', ',
        )}`,
      );
      console.error('Run npm run audit:partitions to create them.');
      process.exitCode = 1;
      return;
    }

    const overflow = await overflowRows(prisma);
    if (overflow === null) {
      console.log('audit-partitions: notice - audit_events_default is absent');
    } else if (overflow > 0) {
      console.log(
        `audit-partitions: notice - audit_events_default holds ${overflow} row(s) written while the horizon was behind`,
      );
    }
    console.log(
      checkOnly
        ? `audit-partitions: PASS - all ${horizon.length} month(s) exist`
        : `audit-partitions: PASS - horizon ready through ${horizon[horizon.length - 1]
            .toISOString()
            .slice(0, 7)}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `audit-partitions: FAIL - ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
