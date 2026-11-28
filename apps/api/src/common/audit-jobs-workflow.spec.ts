/**
 * Scheduled audit jobs (T6.10; D-60).
 *
 * `npm run audit:partitions` and `npm run audit:verify` were manual only, so a
 * partition horizon could fall behind the calendar and a broken chain could
 * stay unnoticed. D-60 requires integrity verification on a schedule, so
 * `.github/workflows/audit-jobs.yml` runs both jobs. These cases read the
 * committed workflow, so an edit that removes the schedule, hides a failure or
 * reads a literal connection string fails here instead of in production.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Resolve from this file, not the process CWD: vitest runs with cwd set to
// apps/api, while the workflow lives at the repository root.
const WORKFLOW_PATH = fileURLToPath(
  new URL('../../../../.github/workflows/audit-jobs.yml', import.meta.url),
);

function workflow(): string {
  expect(existsSync(WORKFLOW_PATH)).toBe(true);
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

describe('scheduled audit jobs workflow', () => {
  it('runs the jobs on a daily schedule and on demand', () => {
    const yaml = workflow();

    expect(yaml).toMatch(/on:\s*\r?\n\s*schedule:/);
    expect(yaml).toMatch(/cron: '\d{1,2} \d{1,2} \* \* \*'/);
    expect(yaml).toContain('workflow_dispatch:');
  });

  it('reads the database URL from the repository secret', () => {
    const yaml = workflow();

    expect(yaml).toContain('DATABASE_URL: ${{ secrets.DATABASE_URL }}');
    // A pasted connection string would put a credential in the repository.
    expect(yaml).not.toMatch(/postgres(ql)?:\/\//);
  });

  it('fails before the install when the secret is missing', () => {
    const yaml = workflow();
    const check = yaml.indexOf('Check the database secret');
    const install = yaml.indexOf('npm ci');

    expect(check).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(check);
    expect(yaml).toContain('::error::DATABASE_URL');
  });

  it('keeps the partition horizon ahead, then verifies every chain', () => {
    const yaml = workflow();
    const partitions = yaml.indexOf('npm run audit:partitions');
    const verify = yaml.indexOf('npm run audit:verify');

    expect(partitions).toBeGreaterThanOrEqual(0);
    expect(verify).toBeGreaterThan(partitions);
    // A swallowed failure would read as a pass on the dashboard.
    expect(yaml).not.toContain('continue-on-error');
    expect(yaml).not.toContain('|| true');
  });
});
