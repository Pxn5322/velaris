#!/usr/bin/env node
/**
 * Audit chain verification job (T6.10; D-60).
 *
 * D-60 verifies the audit hash chain on a schedule, or by a documented manual
 * or CI job until a scheduler exists. This is that job: it checks every scope
 * (each tenant chain plus the platform chain), reports the unsealed rows that
 * predate migration 0025, and exits non-zero when any chain fails so a run
 * cannot read as a pass.
 *
 * Usage:
 *   npm run audit:verify
 *   DATABASE_URL=... node scripts/verify-audit-chains.mjs
 *
 * Required environment: DATABASE_URL. The job only reads; it prints no secret
 * and changes no row.
 *
 * Exit codes: 0 = every chain verified, 1 = at least one chain failed or the
 * run could not read the database (fails closed), 2 = DATABASE_URL is missing.
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DEFAULT_CHAIN_BATCH,
  verifyAllScopes,
} from '../apps/api/src/domains/audit/audit-chain.ts';
import { auditChainStore } from '../apps/api/src/domains/audit/audit-chain-store.ts';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('audit-verify: DATABASE_URL is required');
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });
  try {
    const reports = await verifyAllScopes(
      auditChainStore(prisma),
      DEFAULT_CHAIN_BATCH,
    );
    const sealed = reports.reduce((total, report) => total + report.sealed, 0);
    const unsealed = reports.reduce(
      (total, report) => total + report.unsealed,
      0,
    );
    const afterSeal = reports.reduce(
      (total, report) => total + report.unsealedAfterSeal,
      0,
    );

    console.log(`audit-verify: ${reports.length} scope(s)`);
    for (const report of reports) {
      const state = report.ok ? 'ok  ' : 'FAIL';
      const detail = report.ok
        ? ''
        : `  problem=${report.problem}  firstMismatchSeq=${
            report.firstMismatchSeq ?? '-'
          }`;
      const gap =
        report.unsealedAfterSeal > 0
          ? `  afterSeal=${report.unsealedAfterSeal}`
          : '';
      console.log(
        `  ${state}  ${report.scopeKey}  sealed=${report.sealed}  unsealed=${report.unsealed}${gap}${detail}`,
      );
    }

    const failed = reports.filter((report) => !report.ok);
    if (failed.length > 0) {
      console.error(
        `audit-verify: FAIL - ${failed.length} of ${reports.length} scope(s) did not verify`,
      );
      if (afterSeal > 0) {
        console.error(
          `audit-verify: FAIL - ${afterSeal} unsealed row(s) written after their chain was sealed`,
        );
      }
      process.exitCode = 1;
      return;
    }
    console.log(
      `audit-verify: PASS - ${reports.length} scope(s), ${sealed} sealed row(s), ${unsealed} unsealed legacy row(s)`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(
    `audit-verify: FAIL - ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exitCode = 1;
});
